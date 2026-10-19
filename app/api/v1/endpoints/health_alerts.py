from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models.health_alerts import HealthAlertRule
from app.models.user import User
from app.schemas.health_alerts import (
    HealthAlertEvaluationResponse,
    HealthAlertMuteRequest,
    HealthAlertMuteResponse,
    HealthAlertRuleInput,
    HealthAlertRuleResponse,
)
from app.services.health_alert_service import health_alert_service

router = APIRouter()


def _get_rule_or_404(db: Session, rule_id: int) -> HealthAlertRule:
    rule = db.query(HealthAlertRule).filter(HealthAlertRule.id == rule_id).first()
    if rule is None:
        raise HTTPException(status_code=404, detail="Health alert rule not found")
    return rule


def _validate_alert_id(alert_id: str) -> None:
    if len(alert_id) != 64 or any(
        character not in "0123456789abcdef" for character in alert_id
    ):
        raise HTTPException(status_code=422, detail="Invalid health alert identifier")


@router.get(
    "/patients/{patient_id}/rules",
    response_model=list[HealthAlertRuleResponse],
)
def list_rules(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user)
    return health_alert_service.list_rules(db, patient_id)


@router.post(
    "/patients/{patient_id}/rules",
    response_model=HealthAlertRuleResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_rule(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    rule_in: HealthAlertRuleInput,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user, required_permission="edit")
    return health_alert_service.create_rule(
        db,
        patient_id=patient_id,
        current_user=current_user,
        rule_in=rule_in,
    )


@router.put(
    "/rules/{rule_id}",
    response_model=HealthAlertRuleResponse,
)
def update_rule(
    *,
    db: Session = Depends(deps.get_db),
    rule_id: int,
    rule_in: HealthAlertRuleInput,
    current_user: User = Depends(deps.get_current_user),
):
    rule = _get_rule_or_404(db, rule_id)
    deps.verify_patient_access(
        rule.patient_id, db, current_user, required_permission="edit"
    )
    return health_alert_service.update_rule(
        db, rule=rule, current_user=current_user, rule_in=rule_in
    )


@router.get(
    "/patients/{patient_id}/alerts",
    response_model=HealthAlertEvaluationResponse,
)
def evaluate_alerts(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    include_muted: bool = Query(False),
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user)
    return health_alert_service.evaluate(
        db,
        patient_id=patient_id,
        current_user=current_user,
        include_muted=include_muted,
    )


@router.post(
    "/patients/{patient_id}/alerts/{alert_id}/mute",
    response_model=HealthAlertMuteResponse,
)
def mute_alert(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    alert_id: str,
    mute_in: HealthAlertMuteRequest,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user, required_permission="edit")
    _validate_alert_id(alert_id)
    mute = health_alert_service.mute(
        db,
        patient_id=patient_id,
        alert_id=alert_id,
        muted_until=mute_in.muted_until,
        reason=mute_in.reason,
        current_user=current_user,
    )
    return HealthAlertMuteResponse(alert_id=mute.alert_id, muted_until=mute.muted_until)


@router.delete(
    "/patients/{patient_id}/alerts/{alert_id}/mute",
    status_code=status.HTTP_204_NO_CONTENT,
)
def unmute_alert(
    *,
    db: Session = Depends(deps.get_db),
    patient_id: int,
    alert_id: str,
    current_user: User = Depends(deps.get_current_user),
):
    deps.verify_patient_access(patient_id, db, current_user, required_permission="edit")
    _validate_alert_id(alert_id)
    health_alert_service.unmute(
        db,
        patient_id=patient_id,
        alert_id=alert_id,
        current_user=current_user,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
