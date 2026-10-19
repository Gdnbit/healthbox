"""Regression tests for SQLite connection-pool selection."""

from sqlalchemy.pool import StaticPool

from app.core.database.database import DatabaseConfig


def _engine_kwargs(database_url: str) -> dict:
    config = DatabaseConfig.__new__(DatabaseConfig)
    config.database_url = database_url
    return config._get_engine_kwargs()


def test_file_sqlite_uses_normal_multi_connection_pool() -> None:
    kwargs = _engine_kwargs("sqlite:///synthetic-browser.sqlite3")

    assert "poolclass" not in kwargs
    assert kwargs["connect_args"]["check_same_thread"] is False


def test_memory_sqlite_keeps_static_pool() -> None:
    kwargs = _engine_kwargs("sqlite:///:memory:")

    assert kwargs["poolclass"] is StaticPool
