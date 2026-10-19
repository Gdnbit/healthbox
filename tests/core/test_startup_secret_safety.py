"""Startup diagnostics must not disclose connection secrets or private paths."""

import logging
from unittest.mock import Mock

import pytest

from app.core import startup
from app.core.database import database


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql://synthetic:synthetic-secret@invalid.example/synthetic",
        "sqlite:///private-instance/synthetic.db",
    ],
)
@pytest.mark.asyncio
async def test_startup_omits_connection_string(monkeypatch, caplog, database_url):
    monkeypatch.setenv("SKIP_MIGRATIONS", "false")
    monkeypatch.setattr(startup.settings, "DATABASE_URL", database_url)
    monkeypatch.setattr(startup, "check_database_connection", lambda: False)

    with caplog.at_level(logging.ERROR), pytest.raises(RuntimeError):
        await startup.startup_event()

    assert "Cannot connect to database" in caplog.text
    assert database_url not in caplog.text
    assert "synthetic-secret" not in caplog.text
    assert "private-instance" not in caplog.text


def test_database_connection_omits_driver_exception_contents(monkeypatch, caplog):
    failure = RuntimeError("authentication failed: postgresql://user:synthetic-secret@invalid/db")
    engine = Mock()
    engine.connect.side_effect = failure
    monkeypatch.setattr(database, "engine", engine)

    with caplog.at_level(logging.ERROR):
        assert database.check_database_connection() is False

    assert "synthetic-secret" not in caplog.text
    assert "incorrect database credentials" in caplog.text
    records = [
        record for record in caplog.records
        if getattr(record, "event", None) == "database_connection_check_failed"
    ]
    assert len(records) == 1
    assert not hasattr(records[0], "error")
    assert records[0].error_type == "RuntimeError"
