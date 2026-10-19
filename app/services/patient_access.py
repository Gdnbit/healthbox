# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Patient Access Service - Unified access control logic for all phases
"""

from typing import List

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.core.logging.config import get_logger
from app.core.utils.datetime_utils import get_utc_now
from app.models.archive_circle import (
    ARCHIVE_CIRCLE_SCOPE,
    ArchiveCircle,
    ArchiveCircleMembership,
)
from app.models.models import Patient, PatientShare, User

logger = get_logger(__name__, "app")

STANDARD_PERMISSION_HIERARCHY = {"view": 1, "edit": 2, "full": 3}


class PatientAccessService:
    """Unified service for patient access across all phases"""

    def __init__(self, db: Session):
        self.db = db

    def get_accessible_patients(
        self, user: User, permission: str = "view"
    ) -> List[Patient]:
        """
        Get all patients accessible to a user across all contexts

        Args:
            user: The user requesting access
            permission: Required permission level ('view', 'edit', 'full')

        Returns:
            List of patients the user can access
        """
        logger.info(
            f"Getting accessible patients for user {user.id} with permission '{permission}'"
        )

        if permission not in STANDARD_PERMISSION_HIERARCHY:
            logger.warning(
                "Rejected unknown patient permission",
                extra={"user_id": user.id, "permission": permission},
            )
            return []

        accessible_patients = []

        # 1. Own patients (always accessible)
        try:
            own_patients = (
                self.db.query(Patient).filter(Patient.owner_user_id == user.id).all()
            )
            accessible_patients.extend(own_patients)
            logger.info(f"Found {len(own_patients)} owned patients")
        except Exception as e:
            logger.error(f"Error querying owned patients: {e}")
            # Fallback to old user_id query for backward compatibility
            own_patients = (
                self.db.query(Patient).filter(Patient.user_id == user.id).all()
            )
            accessible_patients.extend(own_patients)
            logger.info(f"Found {len(own_patients)} owned patients (fallback method)")

        # 2. Individually shared patients (Phase 1)
        shared_patients = (
            self._get_individually_shared_patients(user, permission)
            if settings.LEGACY_DIRECTIONAL_SHARING_ENABLED
            else []
        )
        accessible_patients.extend(shared_patients)
        logger.info(f"Found {len(shared_patients)} individually shared patients")

        # 3. Family patients (Phase 2+ - will be implemented later)
        # family_patients = self._get_family_patients(user, permission)
        # accessible_patients.extend(family_patients)

        # Remove duplicates and return
        unique_patients = list({p.id: p for p in accessible_patients}.values())
        logger.info(f"Total accessible patients: {len(unique_patients)}")
        return unique_patients

    def can_access_patient(
        self, user: User, patient: Patient, permission: str = "view"
    ) -> bool:
        """
        Check if user can access a specific patient

        Args:
            user: The user requesting access
            patient: The patient to check access for
            permission: Required permission level ('view', 'edit', 'full')

        Returns:
            True if user can access patient, False otherwise
        """
        logger.debug(
            f"Checking access for user {user.id} to patient {patient.id} with permission '{permission}'"
        )

        if permission == ARCHIVE_CIRCLE_SCOPE:
            return self.can_access_structured_dashboard(user, patient)

        if permission not in STANDARD_PERMISSION_HIERARCHY:
            logger.warning(
                "Rejected unknown patient permission",
                extra={
                    "user_id": user.id,
                    "patient_id": patient.id,
                    "permission": permission,
                },
            )
            return False

        # 1. Owner always has access
        if patient.owner_user_id == user.id:
            logger.debug("Access granted: User is owner")
            return True

        if not settings.LEGACY_DIRECTIONAL_SHARING_ENABLED:
            logger.debug("Access denied: Legacy directional sharing is disabled")
            return False

        # 2. Check privacy level (Phase 3+ feature, but basic check)
        if patient.privacy_level == "private":
            logger.debug("Access denied: Patient is private")
            return False

        # 3. Check individual sharing (Phase 1)
        if self._check_individual_sharing(user, patient, permission):
            logger.debug("Access granted: Individual sharing")
            return True

        # 4. Check family context (Phase 2+ - will be implemented later)
        # if patient.family_id and self._check_family_access(user, patient, permission):
        #     logger.debug("Access granted: Family access")
        #     return True

        logger.debug("Access denied: No valid access path found")
        return False

    @staticmethod
    def _membership_is_current(membership, now):
        return and_(
            membership.status == "active",
            membership.scope == ARCHIVE_CIRCLE_SCOPE,
            or_(
                membership.expires_at.is_(None),
                membership.expires_at > now,
            ),
        )

    def _circle_subject_rows(self, user: User):
        """Return direct common-circle rows without traversing overlapping members."""

        now = get_utc_now()
        viewer_membership = aliased(ArchiveCircleMembership)
        target_membership = aliased(ArchiveCircleMembership)
        viewer_patient = aliased(Patient)

        return (
            self.db.query(
                Patient,
                viewer_membership.updated_at.label("viewer_changed_at"),
                target_membership.updated_at.label("target_changed_at"),
                ArchiveCircle.updated_at.label("circle_changed_at"),
            )
            .join(
                target_membership,
                target_membership.patient_id == Patient.id,
            )
            .join(
                ArchiveCircle,
                ArchiveCircle.id == target_membership.circle_id,
            )
            .join(
                viewer_membership,
                viewer_membership.circle_id == ArchiveCircle.id,
            )
            .join(
                viewer_patient,
                viewer_patient.id == viewer_membership.patient_id,
            )
            .filter(
                viewer_patient.owner_user_id == user.id,
                ArchiveCircle.status == "active",
                self._membership_is_current(viewer_membership, now),
                self._membership_is_current(target_membership, now),
            )
        )

    def can_access_structured_dashboard(
        self,
        user: User,
        patient: Patient,
    ) -> bool:
        """Authorize the owner or a direct peer in one active common circle."""

        if patient.owner_user_id == user.id:
            return True
        return (
            self._circle_subject_rows(user).filter(Patient.id == patient.id).first()
            is not None
        )

    def get_structured_dashboard_subjects(self, user: User) -> list[dict]:
        """Return a deduplicated, circle-metadata-free subject directory."""

        subjects: dict[int, dict] = {}
        owned = (
            self.db.query(Patient)
            .filter(Patient.owner_user_id == user.id)
            .order_by(Patient.id)
            .all()
        )
        for patient in owned:
            subjects[patient.id] = {
                "patient_id": patient.id,
                "display_name": (
                    f"{patient.first_name}{patient.last_name}".strip() or "未命名档案"
                ),
                "scope": "owner",
                "available": True,
                "relationship_changed_at": patient.updated_at,
            }

        for patient, viewer_changed, target_changed, circle_changed in (
            self._circle_subject_rows(user).order_by(Patient.id).all()
        ):
            if patient.owner_user_id == user.id:
                continue
            changed_candidates = [
                value
                for value in (viewer_changed, target_changed, circle_changed)
                if value is not None
            ]
            relationship_changed_at = (
                max(changed_candidates) if changed_candidates else None
            )
            existing = subjects.get(patient.id)
            if (
                existing is None
                or existing["relationship_changed_at"] is None
                or (
                    relationship_changed_at is not None
                    and relationship_changed_at > existing["relationship_changed_at"]
                )
            ):
                subjects[patient.id] = {
                    "patient_id": patient.id,
                    "display_name": (
                        f"{patient.first_name}{patient.last_name}".strip()
                        or "未命名档案"
                    ),
                    "scope": ARCHIVE_CIRCLE_SCOPE,
                    "available": True,
                    "relationship_changed_at": relationship_changed_at,
                }

        return [subjects[key] for key in sorted(subjects)]

    def get_patient_context(self, user: User, patient: Patient) -> dict:
        """
        Get context information about how user can access this patient

        Args:
            user: The user requesting access
            patient: The patient to get context for

        Returns:
            Dict with context information
        """
        context = {
            "patient_id": patient.id,
            "user_id": user.id,
            "is_owner": patient.owner_user_id == user.id,
            "access_type": None,
            "permission_level": None,
            "is_self_record": patient.is_self_record
            and patient.owner_user_id == user.id,
            "privacy_level": patient.privacy_level,
        }

        if context["is_owner"]:
            context["access_type"] = "owner"
            context["permission_level"] = "full"
        else:
            # Check individual sharing
            if settings.LEGACY_DIRECTIONAL_SHARING_ENABLED:
                share = (
                    self.db.query(PatientShare)
                    .filter(
                        PatientShare.patient_id == patient.id,
                        PatientShare.shared_with_user_id == user.id,
                        PatientShare.is_active.is_(True),
                    )
                    .first()
                )

                if share:
                    context["access_type"] = "individual_share"
                    context["permission_level"] = share.permission_level
                    context["expires_at"] = share.expires_at
            # Future: Add family context check here

        return context

    def _get_individually_shared_patients(
        self, user: User, permission: str
    ) -> List[Patient]:
        """Get patients shared individually with the user"""
        logger.debug(f"Getting individually shared patients for user {user.id}")

        if (
            not settings.LEGACY_DIRECTIONAL_SHARING_ENABLED
            or permission not in STANDARD_PERMISSION_HIERARCHY
        ):
            return []

        # Get active shares with the user
        shares = (
            self.db.query(PatientShare)
            .filter(
                PatientShare.shared_with_user_id == user.id,
                PatientShare.is_active.is_(True),
            )
            .all()
        )

        accessible_patients = []
        for share in shares:
            if self._check_individual_sharing(user, share.patient, permission):
                accessible_patients.append(share.patient)

        return accessible_patients

    def _check_individual_sharing(
        self, user: User, patient: Patient, permission: str
    ) -> bool:
        """Check if user has individual sharing access to patient"""
        if (
            not settings.LEGACY_DIRECTIONAL_SHARING_ENABLED
            or permission not in STANDARD_PERMISSION_HIERARCHY
        ):
            return False

        share = (
            self.db.query(PatientShare)
            .filter(
                PatientShare.patient_id == patient.id,
                PatientShare.shared_with_user_id == user.id,
                PatientShare.is_active.is_(True),
            )
            .first()
        )

        if not share:
            return False

        # Check expiration
        if share.expires_at and share.expires_at < get_utc_now():
            logger.debug(f"Share expired for patient {patient.id}")
            return False

        # Check permission level
        user_level = STANDARD_PERMISSION_HIERARCHY.get(share.permission_level, 0)
        required_level = STANDARD_PERMISSION_HIERARCHY[permission]

        return user_level >= required_level

    def get_user_patient_count(self, user: User) -> dict:
        """
        Get counts of different types of patients for a user

        Returns:
            Dict with patient counts
        """
        owned_count = (
            self.db.query(Patient).filter(Patient.owner_user_id == user.id).count()
        )

        shared_count = 0
        if settings.LEGACY_DIRECTIONAL_SHARING_ENABLED:
            shared_count = (
                self.db.query(PatientShare)
                .filter(
                    PatientShare.shared_with_user_id == user.id,
                    PatientShare.is_active.is_(True),
                )
                .count()
            )

        return {
            "owned": owned_count,
            "shared_with_me": shared_count,
            "total_accessible": owned_count + shared_count,
        }
