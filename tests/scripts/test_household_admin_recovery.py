"""CLI surface tests for the versioned household administrator recovery tool."""

import io
import json

from sqlalchemy.orm import Session, sessionmaker

from app.scripts.household_admin_recovery import main


def _session_factory(db_session: Session):
    return sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db_session.get_bind(),
    )


def test_inspect_cli_emits_one_structured_result(
    db_session: Session,
    test_admin_user,
):
    stdout = io.StringIO()
    stderr = io.StringIO()

    exit_code = main(
        ["inspect", "--username", "admin"],
        session_factory=_session_factory(db_session),
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 0
    payload = json.loads(stdout.getvalue())
    assert payload["result"] == "ready"
    assert payload["target"]["user_id"] == test_admin_user.id
    assert stderr.getvalue() == ""


def test_recover_cli_never_accepts_or_prints_password_argument(
    db_session: Session,
    test_admin_user,
):
    stdout = io.StringIO()
    stderr = io.StringIO()
    password = "SyntheticRecovery987!"
    answers = iter([password, password])

    exit_code = main(
        [
            "recover",
            "--username",
            "admin",
            "--confirm-user-id",
            str(test_admin_user.id),
            "--operator",
            "synthetic-server-owner",
            "--reason",
            "synthetic CLI drill",
        ],
        session_factory=_session_factory(db_session),
        password_reader=lambda _prompt: next(answers),
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 0
    payload = json.loads(stdout.getvalue())
    assert payload["result"] == "success"
    assert payload["maintenance_record_id"] > 0
    assert password not in stdout.getvalue()
    assert password not in stderr.getvalue()


def test_cli_parser_has_no_password_option(
    db_session: Session,
    test_admin_user,
):
    stdout = io.StringIO()
    stderr = io.StringIO()

    exit_code = main(
        [
            "recover",
            "--username",
            "admin",
            "--confirm-user-id",
            str(test_admin_user.id),
            "--operator",
            "synthetic-server-owner",
            "--reason",
            "synthetic CLI drill",
            "--password",
            "must-not-be-accepted",
        ],
        session_factory=_session_factory(db_session),
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 2
    assert "unrecognized arguments" in stderr.getvalue()
    assert "must-not-be-accepted" not in stdout.getvalue()
    assert "must-not-be-accepted" not in stderr.getvalue()


def test_database_session_creation_failure_is_structured_and_sanitized():
    stdout = io.StringIO()
    stderr = io.StringIO()
    sensitive_error = "postgresql://owner:synthetic-secret@db/private"

    def failing_factory():
        raise RuntimeError(sensitive_error)

    exit_code = main(
        ["inspect", "--username", "admin"],
        session_factory=failing_factory,
        stdout=stdout,
        stderr=stderr,
    )

    assert exit_code == 4
    payload = json.loads(stdout.getvalue())
    assert payload["error_code"] == "local_database_operation_failed"
    assert sensitive_error not in stdout.getvalue()
    assert sensitive_error not in stderr.getvalue()
