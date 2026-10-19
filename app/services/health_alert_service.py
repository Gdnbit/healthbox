import hashlib
from datetime import date, datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from app.models.activity_log import ActivityLog
from app.models.health_alerts import HealthAlertMute, HealthAlertRule
from app.models.labs import LabResult, LabTestComponent
from app.models.user import User
from app.schemas.health_alerts import HealthAlertRuleInput

ATTENTION_STATUSES = {"critical", "abnormal", "high", "low", "borderline"}
BUILTIN_STATUS_RULE_VERSION = 1


def _utc_now_naive() -> datetime:
    """Return UTC in the naive form used by the existing DateTime columns."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize(value: str | None) -> str:
    return " ".join((value or "").strip().lower().split())


def _observed_date(component: LabTestComponent) -> date | None:
    parent = component.lab_result
    if parent is None:
        return None
    return parent.completed_date or parent.ordered_date


def _metric_key(component: LabTestComponent) -> tuple[str, str]:
    return (
        _normalize(component.canonical_test_name or component.test_name),
        _normalize(component.unit),
    )


def _alert_id(*parts: object) -> str:
    raw = "|".join(str(part) for part in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _threshold_matches(operator: str, actual: float, expected: float) -> bool:
    return {
        "gt": actual > expected,
        "gte": actual >= expected,
        "lt": actual < expected,
        "lte": actual <= expected,
    }[operator]


class HealthAlertService:
    """Evaluate deterministic alerts without persisting derived medical claims."""

    def list_rules(self, db: Session, patient_id: int) -> list[HealthAlertRule]:
        return (
            db.query(HealthAlertRule)
            .filter(HealthAlertRule.patient_id == patient_id)
            .order_by(HealthAlertRule.created_at.asc())
            .all()
        )

    def create_rule(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        rule_in: HealthAlertRuleInput,
    ) -> HealthAlertRule:
        rule = HealthAlertRule(
            patient_id=patient_id,
            created_by_user_id=current_user.id,
            **rule_in.model_dump(),
        )
        db.add(rule)
        db.flush()
        self._audit_rule(db, rule, current_user, "created")
        db.commit()
        db.refresh(rule)
        return rule

    def update_rule(
        self,
        db: Session,
        *,
        rule: HealthAlertRule,
        current_user: User,
        rule_in: HealthAlertRuleInput,
    ) -> HealthAlertRule:
        for field, value in rule_in.model_dump().items():
            setattr(rule, field, value)
        rule.version += 1
        self._audit_rule(db, rule, current_user, "updated")
        db.commit()
        db.refresh(rule)
        return rule

    def evaluate(
        self,
        db: Session,
        *,
        patient_id: int,
        current_user: User,
        include_muted: bool = False,
        now: datetime | None = None,
    ) -> dict:
        calculated_at = now or _utc_now_naive()
        components = (
            db.query(LabTestComponent)
            .join(LabResult, LabTestComponent.lab_result_id == LabResult.id)
            .options(joinedload(LabTestComponent.lab_result))
            .filter(LabResult.patient_id == patient_id)
            .all()
        )
        latest = self._latest_components(components)
        alerts = self._source_status_alerts(latest, calculated_at)
        for rule in self.list_rules(db, patient_id):
            if not rule.enabled:
                continue
            alert = self._evaluate_rule(rule, latest, calculated_at)
            if alert is not None:
                alerts.append(alert)

        active_mutes = {
            mute.alert_id: mute
            for mute in db.query(HealthAlertMute)
            .filter(
                HealthAlertMute.user_id == current_user.id,
                HealthAlertMute.patient_id == patient_id,
                HealthAlertMute.muted_until > calculated_at,
            )
            .all()
        }
        muted_count = 0
        visible = []
        for alert in alerts:
            mute = active_mutes.get(alert["alert_id"])
            if mute is not None:
                muted_count += 1
                alert["muted_until"] = mute.muted_until
                if not include_muted:
                    continue
            visible.append(alert)

        severity_order = {"critical": 0, "warning": 1, "info": 2}
        visible.sort(
            key=lambda item: (
                severity_order[item["severity"]],
                item["title"].lower(),
                item["alert_id"],
            )
        )
        return {
            "patient_id": patient_id,
            "calculated_at": calculated_at,
            "active_count": len(alerts) - muted_count,
            "muted_count": muted_count,
            "alerts": visible,
        }

    def mute(
        self,
        db: Session,
        *,
        patient_id: int,
        alert_id: str,
        muted_until: datetime,
        reason: str | None,
        current_user: User,
    ) -> HealthAlertMute:
        now = _utc_now_naive()
        if muted_until <= now or muted_until > now + timedelta(days=3650):
            raise HTTPException(
                status_code=422,
                detail="Mute expiry must be in the future and within 10 years",
            )
        evaluated = self.evaluate(
            db,
            patient_id=patient_id,
            current_user=current_user,
            include_muted=True,
            now=now,
        )
        if not any(alert["alert_id"] == alert_id for alert in evaluated["alerts"]):
            raise HTTPException(status_code=404, detail="Health alert not found")

        mute = (
            db.query(HealthAlertMute)
            .filter(
                HealthAlertMute.user_id == current_user.id,
                HealthAlertMute.patient_id == patient_id,
                HealthAlertMute.alert_id == alert_id,
            )
            .first()
        )
        if mute is None:
            mute = HealthAlertMute(
                user_id=current_user.id,
                patient_id=patient_id,
                alert_id=alert_id,
            )
            db.add(mute)
        mute.muted_until = muted_until
        mute.reason = reason
        db.add(
            ActivityLog.create_activity(
                action="muted",
                entity_type="health_alert",
                description="Muted a deterministic health alert",
                user_id=current_user.id,
                patient_id=patient_id,
                metadata={"alert_id": alert_id, "muted_until": muted_until.isoformat()},
            )
        )
        db.commit()
        db.refresh(mute)
        return mute

    def unmute(
        self,
        db: Session,
        *,
        patient_id: int,
        alert_id: str,
        current_user: User,
    ) -> None:
        mute = (
            db.query(HealthAlertMute)
            .filter(
                HealthAlertMute.user_id == current_user.id,
                HealthAlertMute.patient_id == patient_id,
                HealthAlertMute.alert_id == alert_id,
            )
            .first()
        )
        if mute is not None:
            db.delete(mute)
        db.add(
            ActivityLog.create_activity(
                action="unmuted",
                entity_type="health_alert",
                description="Unmuted a deterministic health alert",
                user_id=current_user.id,
                patient_id=patient_id,
                metadata={"alert_id": alert_id},
            )
        )
        db.commit()

    @staticmethod
    def _latest_components(
        components: list[LabTestComponent],
    ) -> dict[tuple[str, str], LabTestComponent]:
        latest: dict[tuple[str, str], LabTestComponent] = {}
        for component in components:
            key = _metric_key(component)
            existing = latest.get(key)
            component_sort = (_observed_date(component) or date.min, component.id)
            existing_sort = (
                (_observed_date(existing) or date.min, existing.id)
                if existing is not None
                else None
            )
            if existing_sort is None or component_sort > existing_sort:
                latest[key] = component
        return latest

    def _source_status_alerts(
        self,
        latest: dict[tuple[str, str], LabTestComponent],
        calculated_at: datetime,
    ) -> list[dict]:
        alerts = []
        for component in latest.values():
            status = _normalize(component.status)
            if status not in ATTENTION_STATUSES:
                continue
            alerts.append(
                self._alert_payload(
                    component=component,
                    calculated_at=calculated_at,
                    alert_type="source_status",
                    severity="critical" if status == "critical" else "warning",
                    alert_id=_alert_id(
                        "source-status",
                        BUILTIN_STATUS_RULE_VERSION,
                        component.id,
                        status,
                    ),
                    rule_id="builtin.report_status",
                    rule_version=BUILTIN_STATUS_RULE_VERSION,
                    explanation=(
                        f"The source report marked the latest result as '{status}'."
                    ),
                    rule_description="Repeat the status supplied by the source report.",
                    limitations=(
                        "This repeats a report label and does not independently diagnose or "
                        "interpret the result."
                    ),
                )
            )
        return alerts

    def _evaluate_rule(
        self,
        rule: HealthAlertRule,
        latest: dict[tuple[str, str], LabTestComponent],
        calculated_at: datetime,
    ) -> dict | None:
        candidates = [
            component
            for (name, unit), component in latest.items()
            if name == _normalize(rule.test_name)
            and (not rule.unit or unit == _normalize(rule.unit))
        ]
        if not candidates:
            return None
        component = max(
            candidates,
            key=lambda item: (_observed_date(item) or date.min, item.id),
        )

        if rule.rule_type == "threshold":
            if (
                component.value is None
                or rule.threshold_value is None
                or not rule.operator
            ):
                return None
            if not _threshold_matches(
                rule.operator, float(component.value), float(rule.threshold_value)
            ):
                return None
            return self._alert_payload(
                component=component,
                calculated_at=calculated_at,
                alert_type="threshold",
                severity="warning",
                alert_id=_alert_id(
                    "threshold", rule.id, rule.version, component.id, component.value
                ),
                rule_id=f"custom.{rule.id}",
                rule_version=rule.version,
                explanation="The latest value matched the configured threshold rule.",
                rule_description=rule.name,
                limitations=(
                    "This is a user-configured numeric comparison, not a medical reference "
                    "range or diagnosis."
                ),
                threshold_operator=rule.operator,
                threshold_value=rule.threshold_value,
            )

        observed = _observed_date(component)
        if observed is None or rule.overdue_days is None:
            return None
        elapsed_days = (calculated_at.date() - observed).days
        if elapsed_days <= rule.overdue_days:
            return None
        return self._alert_payload(
            component=component,
            calculated_at=calculated_at,
            alert_type="overdue",
            severity="info",
            alert_id=_alert_id(
                "overdue", rule.id, rule.version, component.id, observed.isoformat()
            ),
            rule_id=f"custom.{rule.id}",
            rule_version=rule.version,
            explanation="The elapsed time since the latest stored result exceeded the rule.",
            rule_description=rule.name,
            limitations=(
                "This only measures time since the latest stored record. It cannot prove that "
                "a test was clinically due or not performed elsewhere."
            ),
            overdue_days=rule.overdue_days,
            elapsed_days=elapsed_days,
        )

    @staticmethod
    def _alert_payload(
        *,
        component: LabTestComponent,
        calculated_at: datetime,
        alert_type: str,
        severity: str,
        alert_id: str,
        rule_id: str,
        rule_version: int,
        explanation: str,
        rule_description: str,
        limitations: str,
        threshold_operator: str | None = None,
        threshold_value: float | None = None,
        overdue_days: int | None = None,
        elapsed_days: int | None = None,
    ) -> dict:
        observed = _observed_date(component)
        return {
            "alert_id": alert_id,
            "alert_type": alert_type,
            "severity": severity,
            "title": component.test_name,
            "explanation": explanation,
            "rule_id": rule_id,
            "rule_version": rule_version,
            "rule_description": rule_description,
            "evidence": {
                "component_id": component.id,
                "lab_result_id": component.lab_result_id,
                "observed_date": observed.isoformat() if observed else None,
                "test_name": component.test_name,
                "result_type": component.result_type or "quantitative",
                "numeric_value": component.value,
                "qualitative_value": component.qualitative_value,
                "textual_value": component.textual_value,
                "unit": component.unit,
                "status": component.status,
                "threshold_operator": threshold_operator,
                "threshold_value": threshold_value,
                "overdue_days": overdue_days,
                "elapsed_days": elapsed_days,
            },
            "source": {
                "lab_result_id": component.lab_result_id,
                "source_document_id": component.source_document_id,
                "source_page": component.source_page,
                "source_locator": component.source_locator,
                "import_batch_id": component.import_batch_id,
            },
            "calculated_at": calculated_at,
            "limitations": limitations,
            "muted_until": None,
        }

    @staticmethod
    def _audit_rule(
        db: Session, rule: HealthAlertRule, current_user: User, action: str
    ) -> None:
        db.add(
            ActivityLog.create_activity(
                action=action,
                entity_type="health_alert_rule",
                description=f"{action.capitalize()} a deterministic health alert rule",
                user_id=current_user.id,
                patient_id=rule.patient_id,
                entity_id=rule.id,
                metadata={
                    "rule_type": rule.rule_type,
                    "version": rule.version,
                    "enabled": rule.enabled,
                },
            )
        )


health_alert_service = HealthAlertService()
