"""Member-facing access transparency without health values or internal group data."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.utils.datetime_utils import get_utc_now
from app.models.activity_log import ActivityLog
from app.models.patient import Patient
from app.models.user import User
from app.services.archive_circle_service import ArchiveCircleService

VISIBLE_ACTIONS = (
    "viewed",
    "created",
    "updated",
    "deleted",
    "uploaded",
    "downloaded",
    "exported",
    "cancelled",
)

ACTION_LABELS = {
    "viewed": "查看",
    "created": "新增",
    "updated": "修改",
    "deleted": "作废或删除",
    "uploaded": "上传",
    "downloaded": "下载",
    "exported": "导出",
    "cancelled": "撤回",
}

AUTHORIZATION_LABELS = {
    "owner": "本人操作",
    "archive_circle": "相互可见关系",
    "owner_global_read": "管理员全局读取",
    "admin_cross_subject": "管理员维护",
    "delegated_upload": "管理员代上传",
    "recorded_access": "系统记录的授权",
}

RESOURCE_LABELS = {
    "dashboard": "结构化面板",
    "dashboard_export": "面板导出",
    "complete_archive": "完整档案导出",
    "formal_metric": "结构化指标",
    "archive_circle": "结构化面板",
    "health_archive_export": "完整档案导出",
    "health_source_document": "报告原件",
    "health_import_batch": "报告解析与入库",
    "lab_result": "检验记录",
    "lab_test_component": "结构化指标",
    "vitals": "生命体征",
    "health_record": "健康档案",
}

VISIBLE_RESULTS = {
    "allowed",
    "completed",
    "succeeded",
    "failed",
    "denied",
    "cancelled",
}

NOT_SHARED_BY_DEFAULT = [
    "报告原件",
    "报告文字描述",
    "编辑权限",
    "导出权限",
    "AI 分析权限",
]

HISTORY_NOTICE = (
    "这里只显示系统现有审计记录能够确认的访问和操作；早期未记录的行为不会被补写。"
)


def _patient_label(patient: Patient) -> str:
    return f"{patient.first_name}{patient.last_name}".strip() or "未命名档案"


class PrivacyAccessService:
    """Return only the current account owner's privacy transparency data."""

    def __init__(self, db: Session):
        self.db = db

    def get_current_user_access(
        self,
        *,
        actor: User,
        offset: int,
        limit: int,
    ) -> dict:
        owned = (
            self.db.query(Patient)
            .filter(Patient.owner_user_id == actor.id)
            .order_by(Patient.id)
            .all()
        )
        if not owned:
            raise HTTPException(
                status_code=404,
                detail={
                    "code": "privacy_subject_not_found",
                    "message": "No owned health subject was found",
                },
            )
        if len(owned) != 1:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "privacy_subject_ambiguous",
                    "message": "Privacy access requires exactly one owned subject",
                },
            )

        patient = owned[0]
        visible_subjects = ArchiveCircleService(self.db).list_accessible_subjects(actor)
        reciprocal_viewers = [
            {
                "display_name": subject["display_name"],
                "scope": "structured_dashboard",
                "scope_label": "结构化指标与趋势",
            }
            for subject in visible_subjects
            if subject["patient_id"] != patient.id
            and subject["scope"] == "structured_dashboard"
        ]

        query = self.db.query(ActivityLog).filter(
            ActivityLog.patient_id == patient.id,
            ActivityLog.action.in_(VISIBLE_ACTIONS),
        )
        total = query.count()
        logs = (
            query.order_by(ActivityLog.timestamp.desc(), ActivityLog.id.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        actor_labels = self._actor_patient_labels(
            {
                log.user_id
                for log in logs
                if log.user_id is not None
                and log.user_id != actor.id
                and (
                    log.user is None or log.user.role not in {"admin", "administrator"}
                )
            }
        )

        return {
            "subject": {"display_name": _patient_label(patient)},
            "visibility": {
                "administrator": {
                    "label": "系统管理员",
                    "can_read_all_server_data": True,
                },
                "reciprocal_viewers": reciprocal_viewers,
                "not_shared_by_default": NOT_SHARED_BY_DEFAULT,
            },
            "events": [
                self._event_response(
                    log=log,
                    current_user=actor,
                    actor_labels=actor_labels,
                )
                for log in logs
            ],
            "total": total,
            "offset": offset,
            "limit": limit,
            "generated_at": get_utc_now(),
            "history_notice": HISTORY_NOTICE,
        }

    def _actor_patient_labels(self, user_ids: set[int]) -> dict[int, str]:
        if not user_ids:
            return {}
        rows = (
            self.db.query(Patient)
            .filter(Patient.owner_user_id.in_(user_ids))
            .order_by(Patient.owner_user_id, Patient.id)
            .all()
        )
        labels: dict[int, str] = {}
        for patient in rows:
            labels.setdefault(patient.owner_user_id, _patient_label(patient))
        return labels

    def _event_response(
        self,
        *,
        log: ActivityLog,
        current_user: User,
        actor_labels: dict[int, str],
    ) -> dict:
        actor = self._actor_response(
            log=log,
            current_user=current_user,
            actor_labels=actor_labels,
        )
        metadata = log.event_metadata if isinstance(log.event_metadata, dict) else {}
        basis = str(metadata.get("access_basis") or "").strip()
        if basis not in AUTHORIZATION_LABELS:
            basis = (
                "owner"
                if actor["kind"] == "self"
                else (
                    "owner_global_read"
                    if actor["kind"] == "administrator"
                    else "recorded_access"
                )
            )
        resource = str(metadata.get("resource") or log.entity_type or "").strip()
        if resource not in RESOURCE_LABELS:
            resource = (
                log.entity_type
                if (log.entity_type or "") in RESOURCE_LABELS
                else "health_record"
            )
        result = str(metadata.get("result") or "").strip()
        if result not in VISIBLE_RESULTS:
            result = "recorded"

        return {
            "actor": actor,
            "action": log.action,
            "action_label": ACTION_LABELS[log.action],
            "resource": {
                "kind": resource,
                "label": RESOURCE_LABELS[resource],
            },
            "authorization": {
                "basis": basis,
                "label": AUTHORIZATION_LABELS[basis],
            },
            "result": result,
            "occurred_at": log.timestamp,
        }

    @staticmethod
    def _actor_response(
        *,
        log: ActivityLog,
        current_user: User,
        actor_labels: dict[int, str],
    ) -> dict:
        if log.user_id is None:
            return {"kind": "system", "label": "系统"}
        if log.user_id == current_user.id:
            return {"kind": "self", "label": "我"}
        if log.user is not None and log.user.role in {"admin", "administrator"}:
            return {"kind": "administrator", "label": "系统管理员"}
        return {
            "kind": "member",
            "label": actor_labels.get(log.user_id, "已停用账号"),
        }
