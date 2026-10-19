#!/usr/bin/env python3
"""Create the configured localhost-only household bootstrap account once.

The command is deliberately idempotent: if the target username already
exists, it exits successfully without changing password, role, status, or
profile data. The initial password is read from application configuration and
is never printed.
"""

import argparse
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.core.config import settings  # noqa: E402
from app.core.database import database  # noqa: E402
from app.core.logging.config import get_logger, log_security_event  # noqa: E402
from app.crud.user import user  # noqa: E402
from app.services.auth import AuthService  # noqa: E402

logger = get_logger(__name__, "security")


def ensure_local_bootstrap_account(username: str, password: str) -> str:
    """Create one bootstrap admin, or leave an existing username untouched."""
    normalized_username = username.strip().lower()
    db = database.SessionLocal()
    try:
        existing_user = user.get_by_username(db, username=normalized_username)
        if existing_user is not None:
            logger.info(
                "Local bootstrap account already exists; no changes applied",
                extra={
                    "category": "security",
                    "event": "local_bootstrap_account_already_exists",
                    "username": normalized_username,
                    "user_id": existing_user.id,
                },
            )
            return "already_exists"

        created_user = AuthService.create_bootstrap_admin(
            db,
            username=normalized_username,
            password=password,
        )
        log_security_event(
            logger,
            event="local_bootstrap_account_created",
            user_id=created_user.id,
            ip_address="localhost-cli",
            message=(
                f"Created local bootstrap account '{normalized_username}' "
                "with mandatory first-login password change"
            ),
            username=normalized_username,
        )
        return "created"
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="幂等创建仅限本机使用的家庭初始化管理员账号。"
    )
    parser.add_argument(
        "--username",
        default=settings.ADMIN_DEFAULT_USERNAME,
        help="初始化账号；默认读取 ADMIN_DEFAULT_USERNAME。",
    )
    args = parser.parse_args()

    outcome = ensure_local_bootstrap_account(
        username=args.username,
        password=settings.ADMIN_DEFAULT_PASSWORD,
    )
    if outcome == "created":
        print(f"已创建初始化账号“{args.username}”，首次登录后必须修改密码。")
    else:
        print(f"账号“{args.username}”已存在，未修改任何账号信息。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
