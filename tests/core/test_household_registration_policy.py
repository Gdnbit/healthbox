import re
from pathlib import Path

from app.core.config import settings


def test_public_registration_is_closed_by_default() -> None:
    """Household deployments must opt in before exposing public registration."""
    source = Path("app/core/config.py").read_text(encoding="utf-8")
    match = re.search(
        r'os\.getenv\(\s*"ALLOW_USER_REGISTRATION"\s*,\s*"([^"]+)"\s*\)',
        source,
    )

    assert match is not None, "ALLOW_USER_REGISTRATION must have an explicit default"
    assert match.group(1) == "False"


def test_household_admin_provisioning_overrides_legacy_registration_flag(
    monkeypatch,
) -> None:
    """A stale compatibility flag cannot reopen household public registration."""
    monkeypatch.setattr(settings, "ALLOW_USER_REGISTRATION", True)
    monkeypatch.setattr(settings, "HOUSEHOLD_ADMIN_PROVISIONING_ONLY", True)

    assert settings.public_registration_enabled is False


def test_compatibility_mode_requires_both_explicit_flags(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ALLOW_USER_REGISTRATION", True)
    monkeypatch.setattr(settings, "HOUSEHOLD_ADMIN_PROVISIONING_ONLY", False)

    assert settings.public_registration_enabled is True
