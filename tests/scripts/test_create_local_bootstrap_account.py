"""Regression tests for the explicit localhost bootstrap-account command."""

import pytest
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.crud.user import user as user_crud
from app.models.models import User
from app.schemas.user import UserCreate
from app.scripts.create_local_bootstrap_account import ensure_local_bootstrap_account


def _seed_user(db: Session, *, username: str, role: str = "admin") -> User:
    return user_crud.create(
        db,
        obj_in=UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="OriginalPass123",
            full_name=f"Test {username}",
            role=role,
        ),
    )


def test_creates_requested_account_in_initialized_database(db_session: Session):
    _seed_user(db_session, username="existing_admin")

    outcome = ensure_local_bootstrap_account(username="123", password="SyntheticBootstrapPass123")

    db_session.expire_all()
    created = db_session.query(User).filter(User.username == "123").one()
    assert outcome == "created"
    assert created.role == "admin"
    assert created.is_active is True
    assert created.must_change_password is True
    assert created.patient is not None
    assert user_crud.authenticate(db_session, username="123", password="SyntheticBootstrapPass123") is created


@pytest.mark.parametrize("password", ["", "123", "admin123", "password123456"])
def test_cli_rejects_unsafe_bootstrap_credentials(db_session: Session, password):
    with pytest.raises(ValueError):
        ensure_local_bootstrap_account(username="new_admin", password=password)
    assert db_session.query(User).count() == 0


def test_existing_target_is_noop_without_password_or_role_reset(db_session: Session):
    existing = _seed_user(db_session, username="123", role="user")
    original_hash = existing.password_hash

    outcome = ensure_local_bootstrap_account(username="123", password="123")

    db_session.expire_all()
    unchanged = db_session.query(User).filter(User.username == "123").one()
    assert outcome == "already_exists"
    assert unchanged.id == existing.id
    assert unchanged.role == "user"
    assert unchanged.password_hash == original_hash
    assert unchanged.must_change_password is False


def test_public_user_schema_still_rejects_weak_password():
    with pytest.raises(ValidationError):
        UserCreate(
            username="ordinary",
            email="ordinary@example.com",
            password="123",
            full_name="Ordinary User",
            role="user",
        )
