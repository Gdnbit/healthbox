import hashlib
import json
from copy import deepcopy
from typing import Literal

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import UserPrivacyConsent

HOUSEHOLD_PRIVACY_NOTICE_VERSION = "household-privacy-notice@1.0.0"
HOUSEHOLD_PRIVACY_NOTICE_LOCALE = "zh-CN"

HOUSEHOLD_PRIVACY_NOTICE_SECTIONS = [
    {
        "key": "operator_and_purpose",
        "title": "谁在运营，以及为什么处理这些资料",
        "body": (
            "这套服务由实例所有者运营，只向受邀的本人、家人和少量朋友开放。"
            "用途是长期保存和整理健康资料、查看结构化趋势，并在你主动操作时导出或打印。"
        ),
    },
    {
        "key": "data_and_retention",
        "title": "保存哪些内容，以及保存多久",
        "body": (
            "系统会保存账号资料、体检报告原件、你确认的结构化健康数据、修订历史、"
            "操作审计和备份。主数据、原件与修订默认长期保存；备份按实例配置轮换。"
        ),
    },
    {
        "key": "sole_admin_global_read",
        "title": "唯一管理员可以读取服务器中的全部健康资料",
        "body": (
            "实例所有者是唯一系统管理员，可以读取全部成员的健康数据和原件，"
            "并执行已授权的维护操作。查看、下载、导出和维护会按能力留痕，"
            "审计记录不复制健康原值。"
        ),
    },
    {
        "key": "reciprocal_structured_dashboard",
        "title": "管理员可以配置组内双向查看结构化面板",
        "body": (
            "管理员可在后台把成员加入内部共享组。同组成员彼此可以查看结构化指标和趋势；"
            "普通成员不需要管理或了解组名，成员调整也不要求全体逐次批准。"
        ),
    },
    {
        "key": "not_shared_by_default",
        "title": "普通共享默认不包含原件和操作权限",
        "body": (
            "组内默认不共享报告原件、叙述型健康背景、编辑、代上传、导出、AI 问答、"
            "个性化筛查或提醒。扩大共享范围必须发布新版本并重新告知。"
        ),
    },
    {
        "key": "external_processing_separate",
        "title": "外部 OCR、模型或存储需要另行明确确认",
        "body": (
            "本次确认不包含把健康资料发送给外部 OCR、大模型或存储供应商。"
            "这些能力默认关闭；将来如需启用，必须单独说明供应商、字段、位置和保留方式。"
        ),
    },
    {
        "key": "rights_and_exit",
        "title": "如何查阅、更正、撤回共享或停止使用",
        "body": (
            "你可以维护自己的资料，并联系实例所有者申请查阅、复制、更正、撤回共享、"
            "停用账号、删除或停止处理。无法立即删除的备份或审计记录会说明原因和限制。"
        ),
    },
]

HOUSEHOLD_PRIVACY_SCOPE_SNAPSHOT = {
    "operator": "sole_instance_owner",
    "purposes": [
        "source_preservation",
        "structured_health_records",
        "longitudinal_visualization",
        "user_initiated_export",
    ],
    "data_categories": [
        "account_profile",
        "health_source_originals",
        "structured_health_records",
        "revision_history",
        "metadata_only_audit",
        "configured_backups",
    ],
    "retention": "long_term_with_configured_backup_rotation",
    "sole_admin_global_read": True,
    "reciprocal_structured_dashboard": True,
    "shared_by_default": ["structured_metrics", "trends"],
    "not_shared_by_default": [
        "source_originals",
        "narrative_background",
        "write_access",
        "delegated_upload",
        "export",
        "ai_questions",
        "personalized_screening",
        "reminders",
    ],
    "external_processing": "separate_confirmation_required",
    "rights_route": "contact_instance_owner",
}


def _notice_document() -> dict:
    return {
        "notice_version": HOUSEHOLD_PRIVACY_NOTICE_VERSION,
        "locale": HOUSEHOLD_PRIVACY_NOTICE_LOCALE,
        "kicker": "受邀成员激活说明",
        "title": "家庭健康档案服务使用与隐私说明",
        "summary": "请先了解这套家庭健康档案如何保存、使用和共享资料。",
        "sections": HOUSEHOLD_PRIVACY_NOTICE_SECTIONS,
        "scope": HOUSEHOLD_PRIVACY_SCOPE_SNAPSHOT,
        "external_processing_consent_included": False,
        "external_processing_title": "本次确认不包含外部处理",
        "external_processing_body": (
            "外部 OCR、模型或存储仍保持关闭；" "将来如需启用，会显示单独的说明和确认。"
        ),
        "confirmation_text": "我已阅读并理解以上说明，自愿继续使用。",
        "accept_label": "同意并进入家庭健康档案",
        "decline_label": "暂不同意并退出",
        "version_label": "版本",
    }


def current_notice_document() -> dict:
    """Return a detached copy safe for public invitation presentation."""

    return deepcopy(_notice_document())


def current_notice_sha256() -> str:
    payload = json.dumps(
        _notice_document(),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def latest_current_decision(
    db: Session,
    user_id: int,
) -> UserPrivacyConsent | None:
    return (
        db.query(UserPrivacyConsent)
        .filter(
            UserPrivacyConsent.user_id == user_id,
            UserPrivacyConsent.notice_version == HOUSEHOLD_PRIVACY_NOTICE_VERSION,
        )
        .order_by(
            UserPrivacyConsent.decided_at.desc(),
            UserPrivacyConsent.id.desc(),
        )
        .first()
    )


def privacy_consent_required(db: Session, user_id: int) -> bool:
    if not settings.HOUSEHOLD_PRIVACY_CONSENT_REQUIRED:
        return False
    latest = latest_current_decision(db, user_id)
    return not (
        latest is not None
        and latest.decision == "accepted"
        and latest.notice_sha256 == current_notice_sha256()
    )


def current_notice_response(db: Session, user_id: int) -> dict:
    latest = latest_current_decision(db, user_id)
    document = _notice_document()
    accepted = not privacy_consent_required(db, user_id)
    return {
        **document,
        "required": settings.HOUSEHOLD_PRIVACY_CONSENT_REQUIRED,
        "accepted": accepted,
        "latest_decision": latest.decision if latest is not None else None,
        "latest_decided_at": latest.decided_at if latest is not None else None,
    }


def record_decision(
    db: Session,
    *,
    user_id: int,
    notice_version: str,
    decision: Literal["accepted", "declined"],
) -> tuple[UserPrivacyConsent, bool]:
    if notice_version != HOUSEHOLD_PRIVACY_NOTICE_VERSION:
        raise ValueError("privacy_notice_version_conflict")

    notice_hash = current_notice_sha256()
    latest = latest_current_decision(db, user_id)
    if (
        latest is not None
        and latest.decision == decision
        and latest.notice_sha256 == notice_hash
    ):
        return latest, False

    row = UserPrivacyConsent(
        user_id=user_id,
        notice_version=HOUSEHOLD_PRIVACY_NOTICE_VERSION,
        notice_locale=HOUSEHOLD_PRIVACY_NOTICE_LOCALE,
        notice_sha256=notice_hash,
        decision=decision,
        scope_snapshot=HOUSEHOLD_PRIVACY_SCOPE_SNAPSHOT,
    )
    db.add(row)
    db.flush()
    return row, True
