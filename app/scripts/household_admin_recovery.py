#!/usr/bin/env python3
"""Versioned server-local recovery CLI for the sole household administrator.

The CLI accepts passwords only through an interactive, non-echoing prompt.
It emits one JSON result on stdout and never exposes authentication secrets.
"""

from __future__ import annotations

import argparse
import getpass
import json
import sys
from pathlib import Path
from typing import Callable, Sequence, TextIO

# Support both ``python -m`` and a direct script invocation in the container.
project_root = Path(__file__).resolve().parents[2]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from app.core.database.database import SessionLocal
from app.services.admin_recovery_service import (
    COMMAND_VERSION,
    RecoveryContractError,
    inspect_administrator_recovery,
    recover_administrator_access,
)


class SafeArgumentParser(argparse.ArgumentParser):
    """Avoid echoing an accidentally supplied password-like argument."""

    def error(self, message: str) -> None:
        if "unrecognized arguments" in message:
            message = "unrecognized arguments"
        raise CliUsageError(message)


class CliUsageError(Exception):
    pass


def _build_parser() -> argparse.ArgumentParser:
    parser = SafeArgumentParser(
        prog="household-admin-recovery",
        description=(
            "Inspect or recover the sole household administrator against the "
            "configured local database."
        ),
    )
    parser.add_argument(
        "--version",
        action="version",
        version=COMMAND_VERSION,
    )
    subparsers = parser.add_subparsers(dest="subcommand", required=True)

    inspect_parser = subparsers.add_parser(
        "inspect",
        help="Read-only recovery readiness and target inspection",
    )
    inspect_parser.add_argument("--username", required=True)

    recover_parser = subparsers.add_parser(
        "recover",
        help="Atomically reset password/MFA, unlock, and revoke sessions",
    )
    recover_parser.add_argument("--username", required=True)
    recover_parser.add_argument("--confirm-user-id", required=True, type=int)
    recover_parser.add_argument("--operator", required=True)
    recover_parser.add_argument("--reason", required=True)
    recover_parser.add_argument(
        "--restore-admin-role",
        action="store_true",
        help=(
            "Restore the configured owner role only when the database has no "
            "administrator"
        ),
    )
    recover_parser.add_argument(
        "--expected-owner-username",
        help="Required with --restore-admin-role and must match the configured owner",
    )
    return parser


def _write_json(stream: TextIO, payload: dict) -> None:
    stream.write(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    stream.write("\n")


def main(
    argv: Sequence[str] | None = None,
    *,
    session_factory=None,
    password_reader: Callable[[str], str] | None = None,
    stdout: TextIO | None = None,
    stderr: TextIO | None = None,
) -> int:
    """Run the CLI and return a process exit code without calling ``sys.exit``."""

    output = stdout or sys.stdout
    error_output = stderr or sys.stderr
    factory = session_factory or SessionLocal
    read_password = password_reader or getpass.getpass

    try:
        args = _build_parser().parse_args(list(argv) if argv is not None else None)
    except CliUsageError as exc:
        error_output.write(f"{exc}\n")
        return 2

    db = None
    try:
        db = factory()
        if args.subcommand == "inspect":
            result = inspect_administrator_recovery(db, username=args.username)
            _write_json(output, result)
            return 0 if result["result"] == "ready" else 3

        first_password = read_password("Recovery password: ")
        confirmed_password = read_password("Confirm recovery password: ")
        if first_password != confirmed_password:
            _write_json(
                output,
                {
                    "command_version": COMMAND_VERSION,
                    "action": "recover_admin_access",
                    "target": {"username": args.username},
                    "result": "blocked",
                    "error_code": "password_confirmation_mismatch",
                },
            )
            return 3

        result = recover_administrator_access(
            db,
            username=args.username,
            confirmed_user_id=args.confirm_user_id,
            new_password=first_password,
            operator=args.operator,
            reason=args.reason,
            restore_admin_role=args.restore_admin_role,
            expected_owner_username=args.expected_owner_username,
        )
        _write_json(output, result)
        return 0
    except RecoveryContractError as exc:
        _write_json(
            output,
            {
                "command_version": COMMAND_VERSION,
                "action": (
                    "inspect_admin_recovery"
                    if args.subcommand == "inspect"
                    else "recover_admin_access"
                ),
                "target": {"username": args.username},
                "result": "blocked",
                "error_code": exc.code,
                "message": exc.public_message,
            },
        )
        return 3
    except Exception:
        _write_json(
            output,
            {
                "command_version": COMMAND_VERSION,
                "action": (
                    "inspect_admin_recovery"
                    if args.subcommand == "inspect"
                    else "recover_admin_access"
                ),
                "target": {"username": args.username},
                "result": "failed",
                "error_code": "local_database_operation_failed",
            },
        )
        return 4
    finally:
        if db is not None:
            db.close()


if __name__ == "__main__":
    raise SystemExit(main())
