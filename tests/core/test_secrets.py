# Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
"""Tests for app.core.secrets module (Docker _FILE pattern support)."""

import logging

from app.core.secrets import get_secret


class TestGetSecret:
    """Tests for get_secret()."""

    def test_direct_env_var_returns_value(self, monkeypatch):
        monkeypatch.setenv("TEST_VAR", "direct_value")
        assert get_secret("TEST_VAR") == "direct_value"

    def test_file_reads_secret(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("file_secret_value")
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        assert get_secret("TEST_VAR") == "file_secret_value"

    def test_direct_var_takes_precedence_over_file(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("file_value")
        monkeypatch.setenv("TEST_VAR", "direct_value")
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        assert get_secret("TEST_VAR") == "direct_value"

    def test_direct_var_precedence_logs_warning(self, monkeypatch, tmp_path, caplog):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("file_value")
        monkeypatch.setenv("TEST_VAR", "direct_value")
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        with caplog.at_level(logging.WARNING, logger="app.core.secrets"):
            get_secret("TEST_VAR")
        assert "Both TEST_VAR and TEST_VAR_FILE are set" in caplog.text

    def test_default_fallback_when_neither_set(self, monkeypatch):
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.delenv("TEST_VAR_FILE", raising=False)
        assert get_secret("TEST_VAR", "fallback") == "fallback"

    def test_default_is_empty_string(self, monkeypatch):
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.delenv("TEST_VAR_FILE", raising=False)
        assert get_secret("TEST_VAR") == ""

    def test_whitespace_and_newline_stripping(self, monkeypatch, tmp_path):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("  my_secret_value  \n\n")
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        assert get_secret("TEST_VAR") == "my_secret_value"

    def test_file_not_found_returns_default(self, monkeypatch, caplog):
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", "/nonexistent/path/secret.txt")
        with caplog.at_level(logging.ERROR, logger="app.core.secrets"):
            result = get_secret("TEST_VAR", "default_val")
        assert result == "default_val"
        assert "file was not found" in caplog.text

    def test_permission_denied_returns_default(self, monkeypatch, tmp_path, caplog):
        secret_file = tmp_path / "permission-denied-secret.txt"
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))

        def raise_permission_error(*_args, **_kwargs):
            raise PermissionError("deterministic permission failure")

        monkeypatch.setattr("builtins.open", raise_permission_error)
        with caplog.at_level(logging.ERROR, logger="app.core.secrets"):
            result = get_secret("TEST_VAR", "default_val")
        assert result == "default_val"
        assert "permission was denied" in caplog.text

    def test_empty_file_returns_default(self, monkeypatch, tmp_path, caplog):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("")
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        with caplog.at_level(logging.WARNING, logger="app.core.secrets"):
            result = get_secret("TEST_VAR", "default_val")
        assert result == "default_val"
        assert "file is empty" in caplog.text

    def test_whitespace_only_file_returns_default(self, monkeypatch, tmp_path, caplog):
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("   \n\t  \n")
        monkeypatch.delenv("TEST_VAR", raising=False)
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        with caplog.at_level(logging.WARNING, logger="app.core.secrets"):
            result = get_secret("TEST_VAR", "default_val")
        assert result == "default_val"
        assert "file is empty" in caplog.text

    def test_direct_empty_string_still_takes_precedence(self, monkeypatch, tmp_path):
        """If VAR is explicitly set to empty string, that is the value (not _FILE)."""
        secret_file = tmp_path / "secret.txt"
        secret_file.write_text("file_value")
        monkeypatch.setenv("TEST_VAR", "")
        monkeypatch.setenv("TEST_VAR_FILE", str(secret_file))
        assert get_secret("TEST_VAR", "default") == ""
