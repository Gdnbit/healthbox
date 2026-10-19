# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""
Tests for app.core.database.database.create_default_user().

Covers fresh-install creation, the no-op path when admins already exist, and
the new WARNING-only paths added to avoid auto-healing operator-intentional
demotions.
"""

import logging

import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database.database import (
    create_default_user,
    settings as database_settings,
)
from app.core.utils.security import verify_password
from app.crud.user import user as user_crud
from app.models.models import User
from app.schemas.user import UserCreate


def _seed_user(db: Session, *, username: str, role: str) -> User:
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


def _find_record(caplog, *, event: str):
    for record in caplog.records:
        if getattr(record, "event", None) == event:
            return record
    return None


class TestCreateDefaultUser:
    def test_noop_when_admin_exists(self, db_session: Session, caplog):
        alice = _seed_user(db_session, username="alice", role="admin")
        db_session.commit()

        initial_user_count = db_session.query(User).count()

        with caplog.at_level(logging.WARNING):
            create_default_user()

        db_session.expire_all()
        assert db_session.query(User).count() == initial_user_count
        alice_refreshed = db_session.query(User).filter(User.id == alice.id).one()
        assert alice_refreshed.role == "admin"
        # No warn-level records for our new events
        assert _find_record(caplog, event="admin_user_demoted_no_other_admins") is None
        assert _find_record(caplog, event="no_admin_users_detected") is None

    def test_creates_default_admin_on_fresh_install(self, db_session: Session, monkeypatch):
        """Regression: empty DB still triggers default admin creation."""
        assert db_session.query(User).count() == 0
        monkeypatch.setattr(database_settings, "ADMIN_DEFAULT_PASSWORD", "SyntheticBootstrapPass123")

        create_default_user()

        db_session.expire_all()
        created = (
            db_session.query(User)
            .filter(User.username == settings.ADMIN_DEFAULT_USERNAME.lower())
            .first()
        )
        assert created is not None
        assert created.role == "admin"
        assert created.must_change_password is True
        assert verify_password("SyntheticBootstrapPass123", created.password_hash)
        assert created.patient is not None

    @pytest.mark.parametrize("password", ["", "123", "admin123", "password123456", "x" * 129])
    def test_rejects_unsafe_bootstrap_without_creating_account(
        self, db_session: Session, monkeypatch, password
    ):
        """Direct application startup must not bypass the password policy."""
        monkeypatch.setattr(database_settings, "ADMIN_DEFAULT_USERNAME", "123")
        monkeypatch.setattr(database_settings, "ADMIN_DEFAULT_PASSWORD", password)

        with pytest.raises(ValueError):
            create_default_user()

        db_session.expire_all()
        assert db_session.query(User).count() == 0

    def test_existing_admin_does_not_require_bootstrap_password(
        self, db_session: Session, monkeypatch
    ):
        existing = _seed_user(db_session, username="existing_admin", role="admin")
        original_hash = existing.password_hash
        monkeypatch.setattr(database_settings, "ADMIN_DEFAULT_PASSWORD", "")

        create_default_user()

        db_session.expire_all()
        assert db_session.query(User).count() == 1
        assert existing.password_hash == original_hash
        assert verify_password("OriginalPass123", existing.password_hash)

    def test_warns_without_promoting_when_admin_user_demoted(
        self, db_session: Session, caplog
    ):
        """The reporting user's scenario: 'admin' exists but with role='user'."""
        seeded = _seed_user(db_session, username="admin", role="user")
        original_password_hash = seeded.password_hash
        db_session.commit()

        with caplog.at_level(logging.WARNING):
            create_default_user()

        db_session.expire_all()
        refreshed = db_session.query(User).filter(User.id == seeded.id).one()
        assert refreshed.role == "user"  # NOT auto-promoted
        assert refreshed.password_hash == original_password_hash

        record = _find_record(caplog, event="admin_user_demoted_no_other_admins")
        assert record is not None, (
            "Expected admin_user_demoted_no_other_admins warning, got records: "
            f"{[getattr(r, 'event', None) for r in caplog.records]}"
        )
        assert record.levelno == logging.WARNING
        assert "household_admin_recovery" in record.getMessage()
        assert "inspect" in record.getMessage()
        assert "--restore-admin-role" in record.getMessage()
        assert "--username admin" in record.getMessage()

    def test_warns_without_creating_when_users_exist_but_no_admin_named_user(
        self, db_session: Session, caplog
    ):
        """Users exist but neither an admin nor an 'admin'-named row exist."""
        _seed_user(db_session, username="bob", role="user")
        db_session.commit()

        with caplog.at_level(logging.WARNING):
            create_default_user()

        db_session.expire_all()
        # Still exactly one user (bob), no new admin created
        assert db_session.query(User).count() == 1
        assert db_session.query(User).filter(User.username == "admin").first() is None

        record = _find_record(caplog, event="no_admin_users_detected")
        assert record is not None, (
            "Expected no_admin_users_detected warning, got records: "
            f"{[getattr(r, 'event', None) for r in caplog.records]}"
        )
        assert record.levelno == logging.WARNING
        assert "configured owner account" in record.getMessage()
        assert "verified backup" in record.getMessage()
        assert "create_emergency_admin.py" not in record.getMessage()
        assert "--promote" not in record.getMessage()
