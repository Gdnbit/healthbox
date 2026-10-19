"""Transactional administrator management for internal archive circles."""

from dataclasses import dataclass

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.utils.datetime_utils import get_utc_now
from app.models.activity_log import ActionType, ActivityLog, EntityType
from app.models.archive_circle import (
    ARCHIVE_CIRCLE_MEMBERSHIP_STATUSES,
    ARCHIVE_CIRCLE_SCOPE,
    ARCHIVE_CIRCLE_STATUSES,
    ArchiveCircle,
    ArchiveCircleMembership,
)
from app.models.patient import Patient
from app.models.user import User
from app.services.owner_access_service import (
    OwnerAccessError,
    ensure_sole_active_administrator,
)
from app.services.patient_access import PatientAccessService


@dataclass(frozen=True)
class ArchiveCircleError(Exception):
    """Stable management error that never contains health data."""

    code: str
    message: str
    status_code: int = 400

    def __str__(self) -> str:
        return self.message


def _normalize_text(
    value: str | None,
    *,
    field: str,
    minimum: int,
    maximum: int,
    required: bool,
) -> str | None:
    normalized = (value or "").strip()
    if not normalized and not required:
        return None
    if (
        len(normalized) < minimum
        or len(normalized) > maximum
        or "\n" in normalized
        or "\r" in normalized
    ):
        raise ArchiveCircleError(
            f"invalid_{field}",
            f"{field} must contain {minimum} to {maximum} single-line characters",
            422,
        )
    return normalized


class ArchiveCircleService:
    """Manage circle membership and derive reciprocal subject visibility."""

    def __init__(self, db: Session):
        self.db = db

    def _ensure_actor(self, actor: User) -> None:
        try:
            ensure_sole_active_administrator(self.db, actor)
        except OwnerAccessError as error:
            raise ArchiveCircleError(
                error.code,
                error.message,
                error.status_code,
            ) from error

    def _circle(self, circle_id: int, *, mutable: bool = False) -> ArchiveCircle:
        circle = (
            self.db.query(ArchiveCircle).filter(ArchiveCircle.id == circle_id).first()
        )
        if circle is None:
            raise ArchiveCircleError(
                "archive_circle_not_found",
                "Archive circle was not found",
                404,
            )
        if mutable and circle.status == "archived":
            raise ArchiveCircleError(
                "archive_circle_archived",
                "Archived circles cannot be modified",
                409,
            )
        return circle

    def _patient(self, patient_id: int) -> Patient:
        patient = (
            self.db.query(Patient)
            .join(User, User.id == Patient.owner_user_id)
            .filter(
                Patient.id == patient_id,
                User.is_active.is_(True),
            )
            .first()
        )
        if patient is None:
            raise ArchiveCircleError(
                "active_owned_subject_required",
                "An active account-owned subject is required",
                404,
            )
        return patient

    def _membership(
        self,
        circle_id: int,
        patient_id: int,
    ) -> ArchiveCircleMembership | None:
        return (
            self.db.query(ArchiveCircleMembership)
            .filter(
                ArchiveCircleMembership.circle_id == circle_id,
                ArchiveCircleMembership.patient_id == patient_id,
            )
            .first()
        )

    def _audit(
        self,
        *,
        actor: User,
        circle_id: int,
        operation: str,
        action: str,
        patient_id: int | None = None,
        previous_status: str | None = None,
        new_status: str | None = None,
        target_circle_id: int | None = None,
    ) -> None:
        metadata = {
            "actor_user_id": actor.id,
            "circle_id": circle_id,
            "operation": operation,
            "result": "allowed",
        }
        if patient_id is not None:
            metadata["patient_id"] = patient_id
        if previous_status is not None:
            metadata["previous_status"] = previous_status
        if new_status is not None:
            metadata["new_status"] = new_status
        if target_circle_id is not None:
            metadata["target_circle_id"] = target_circle_id
        self.db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type=EntityType.ARCHIVE_CIRCLE,
                entity_id=circle_id,
                user_id=actor.id,
                patient_id=patient_id,
                description="Sole administrator changed archive-circle membership",
                metadata=metadata,
            )
        )

    def _commit(self) -> None:
        try:
            self.db.commit()
        except IntegrityError as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "archive_circle_conflict",
                "Archive circle change conflicts with existing state",
                409,
            ) from error
        except Exception as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "archive_circle_audit_failed",
                "Archive circle change was rolled back because it could not be audited",
                503,
            ) from error

    def _flush(self) -> None:
        try:
            self.db.flush()
        except IntegrityError as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "archive_circle_conflict",
                "Archive circle change conflicts with existing state",
                409,
            ) from error
        except Exception as error:
            self.db.rollback()
            raise ArchiveCircleError(
                "archive_circle_change_failed",
                "Archive circle change could not be prepared",
                503,
            ) from error

    def create_circle(
        self,
        *,
        actor: User,
        name: str,
        description: str | None = None,
    ) -> ArchiveCircle:
        self._ensure_actor(actor)
        circle = ArchiveCircle(
            name=_normalize_text(
                name,
                field="name",
                minimum=1,
                maximum=80,
                required=True,
            ),
            description=_normalize_text(
                description,
                field="description",
                minimum=1,
                maximum=240,
                required=False,
            ),
            status="active",
            created_by_user_id=actor.id,
        )
        self.db.add(circle)
        self._flush()
        self._audit(
            actor=actor,
            circle_id=circle.id,
            operation="create_circle",
            action=ActionType.CREATED,
            new_status="active",
        )
        self._commit()
        self.db.refresh(circle)
        return circle

    def set_circle_status(
        self,
        *,
        actor: User,
        circle_id: int,
        status: str,
    ) -> ArchiveCircle:
        self._ensure_actor(actor)
        if status not in ARCHIVE_CIRCLE_STATUSES:
            raise ArchiveCircleError(
                "invalid_archive_circle_status",
                "Archive circle status is invalid",
                422,
            )
        circle = self._circle(circle_id)
        previous = circle.status
        circle.status = status
        self._audit(
            actor=actor,
            circle_id=circle.id,
            operation="set_circle_status",
            action=ActionType.UPDATED,
            previous_status=previous,
            new_status=status,
        )
        self._commit()
        self.db.refresh(circle)
        return circle

    def add_member(
        self,
        *,
        actor: User,
        circle_id: int,
        patient_id: int,
    ) -> ArchiveCircleMembership:
        self._ensure_actor(actor)
        circle = self._circle(circle_id, mutable=True)
        if circle.status != "active":
            raise ArchiveCircleError(
                "active_archive_circle_required",
                "Members can only be added to an active circle",
                409,
            )
        self._patient(patient_id)
        membership = self._membership(circle.id, patient_id)
        now = get_utc_now()
        previous = membership.status if membership else None
        if membership is None:
            membership = ArchiveCircleMembership(
                circle_id=circle.id,
                patient_id=patient_id,
                scope=ARCHIVE_CIRCLE_SCOPE,
                status="active",
                joined_at=now,
                updated_by_user_id=actor.id,
            )
            self.db.add(membership)
        else:
            membership.status = "active"
            membership.scope = ARCHIVE_CIRCLE_SCOPE
            membership.expires_at = None
            membership.joined_at = now
            membership.paused_at = None
            membership.removed_at = None
            membership.updated_by_user_id = actor.id
        self._audit(
            actor=actor,
            circle_id=circle.id,
            patient_id=patient_id,
            operation="add_member",
            action=ActionType.ACTIVATED,
            previous_status=previous,
            new_status="active",
        )
        self._commit()
        self.db.refresh(membership)
        return membership

    def set_membership_status(
        self,
        *,
        actor: User,
        circle_id: int,
        patient_id: int,
        status: str,
    ) -> ArchiveCircleMembership:
        self._ensure_actor(actor)
        self._circle(circle_id, mutable=True)
        if status not in {"active", "paused"}:
            raise ArchiveCircleError(
                "invalid_archive_circle_membership_status",
                "Membership status must be active or paused",
                422,
            )
        membership = self._membership(circle_id, patient_id)
        if membership is None or membership.status == "removed":
            raise ArchiveCircleError(
                "archive_circle_membership_not_found",
                "Archive circle membership was not found",
                404,
            )
        previous = membership.status
        membership.status = status
        membership.paused_at = get_utc_now() if status == "paused" else None
        membership.updated_by_user_id = actor.id
        self._audit(
            actor=actor,
            circle_id=circle_id,
            patient_id=patient_id,
            operation="set_membership_status",
            action=(
                ActionType.ACTIVATED if status == "active" else ActionType.DEACTIVATED
            ),
            previous_status=previous,
            new_status=status,
        )
        self._commit()
        self.db.refresh(membership)
        return membership

    def remove_member(
        self,
        *,
        actor: User,
        circle_id: int,
        patient_id: int,
    ) -> ArchiveCircleMembership:
        self._ensure_actor(actor)
        self._circle(circle_id, mutable=True)
        membership = self._membership(circle_id, patient_id)
        if membership is None or membership.status == "removed":
            raise ArchiveCircleError(
                "archive_circle_membership_not_found",
                "Archive circle membership was not found",
                404,
            )
        previous = membership.status
        membership.status = "removed"
        membership.removed_at = get_utc_now()
        membership.paused_at = None
        membership.updated_by_user_id = actor.id
        self._audit(
            actor=actor,
            circle_id=circle_id,
            patient_id=patient_id,
            operation="remove_member",
            action=ActionType.DEACTIVATED,
            previous_status=previous,
            new_status="removed",
        )
        self._commit()
        self.db.refresh(membership)
        return membership

    def move_member(
        self,
        *,
        actor: User,
        patient_id: int,
        source_circle_id: int,
        target_circle_id: int,
    ) -> ArchiveCircleMembership:
        self._ensure_actor(actor)
        if source_circle_id == target_circle_id:
            raise ArchiveCircleError(
                "archive_circle_move_same_target",
                "Source and target circles must differ",
                422,
            )
        self._circle(source_circle_id, mutable=True)
        target_circle = self._circle(target_circle_id, mutable=True)
        if target_circle.status != "active":
            raise ArchiveCircleError(
                "active_archive_circle_required",
                "Target circle must be active",
                409,
            )
        self._patient(patient_id)
        source = self._membership(source_circle_id, patient_id)
        if source is None or source.status == "removed":
            raise ArchiveCircleError(
                "archive_circle_membership_not_found",
                "Source membership was not found",
                404,
            )
        target = self._membership(target_circle_id, patient_id)
        if target is not None and target.status != "removed":
            raise ArchiveCircleError(
                "archive_circle_target_membership_exists",
                "Target circle already contains this subject",
                409,
            )

        now = get_utc_now()
        previous = source.status
        source.status = "removed"
        source.removed_at = now
        source.paused_at = None
        source.updated_by_user_id = actor.id
        if target is None:
            target = ArchiveCircleMembership(
                circle_id=target_circle_id,
                patient_id=patient_id,
                scope=ARCHIVE_CIRCLE_SCOPE,
                status="active",
                joined_at=now,
                updated_by_user_id=actor.id,
            )
            self.db.add(target)
        else:
            target.status = "active"
            target.scope = ARCHIVE_CIRCLE_SCOPE
            target.expires_at = None
            target.joined_at = now
            target.paused_at = None
            target.removed_at = None
            target.updated_by_user_id = actor.id

        self._audit(
            actor=actor,
            circle_id=source_circle_id,
            patient_id=patient_id,
            operation="move_member",
            action=ActionType.UPDATED,
            previous_status=previous,
            new_status="active",
            target_circle_id=target_circle_id,
        )
        self._commit()
        self.db.refresh(target)
        return target

    def list_accessible_subjects(self, actor: User) -> list[dict]:
        return PatientAccessService(self.db).get_structured_dashboard_subjects(actor)

    def list_admin_subjects(self, actor: User) -> list[dict]:
        self._ensure_actor(actor)
        rows = (
            self.db.query(Patient, User)
            .join(User, User.id == Patient.owner_user_id)
            .order_by(Patient.id)
            .all()
        )
        return [
            {
                "patient_id": patient.id,
                "display_name": (
                    f"{patient.first_name}{patient.last_name}".strip() or "未命名档案"
                ),
                "account_id": owner.id,
                "username": owner.username,
                "account_active": owner.is_active,
            }
            for patient, owner in rows
        ]

    def list_circles(self, actor: User) -> list[dict]:
        self._ensure_actor(actor)
        circles = (
            self.db.query(ArchiveCircle)
            .order_by(ArchiveCircle.created_at, ArchiveCircle.id)
            .all()
        )
        result = []
        for circle in circles:
            memberships = (
                self.db.query(ArchiveCircleMembership, Patient, User)
                .join(Patient, Patient.id == ArchiveCircleMembership.patient_id)
                .join(User, User.id == Patient.owner_user_id)
                .filter(ArchiveCircleMembership.circle_id == circle.id)
                .order_by(ArchiveCircleMembership.id)
                .all()
            )
            result.append(
                {
                    "id": circle.id,
                    "name": circle.name,
                    "description": circle.description,
                    "status": circle.status,
                    "created_at": circle.created_at,
                    "updated_at": circle.updated_at,
                    "members": [
                        {
                            "patient_id": patient.id,
                            "display_name": (
                                f"{patient.first_name}{patient.last_name}".strip()
                                or "未命名档案"
                            ),
                            "account_id": owner.id,
                            "username": owner.username,
                            "account_active": owner.is_active,
                            "status": membership.status,
                            "scope": membership.scope,
                            "joined_at": membership.joined_at,
                            "paused_at": membership.paused_at,
                            "removed_at": membership.removed_at,
                            "updated_at": membership.updated_at,
                        }
                        for membership, patient, owner in memberships
                    ],
                }
            )
        return result

    def get_circle(self, actor: User, circle_id: int) -> dict:
        self._ensure_actor(actor)
        self._circle(circle_id)
        for circle in self.list_circles(actor):
            if circle["id"] == circle_id:
                return circle
        raise ArchiveCircleError(
            "archive_circle_not_found",
            "Archive circle was not found",
            404,
        )


__all__ = [
    "ARCHIVE_CIRCLE_MEMBERSHIP_STATUSES",
    "ARCHIVE_CIRCLE_SCOPE",
    "ARCHIVE_CIRCLE_STATUSES",
    "ArchiveCircleError",
    "ArchiveCircleService",
]
