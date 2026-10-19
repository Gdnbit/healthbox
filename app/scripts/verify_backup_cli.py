#!/usr/bin/env python3
"""Verify a tracked backup by filename without requiring browser credentials."""

import argparse
import asyncio
import json
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.core.database.database import SessionLocal  # noqa: E402
from app.models.files import BackupRecord  # noqa: E402
from app.services.backup_service import BackupService  # noqa: E402


async def run(filename: str) -> int:
    safe_name = Path(filename).name
    db = SessionLocal()
    try:
        record = next(
            (
                item
                for item in db.query(BackupRecord)
                .order_by(BackupRecord.created_at.desc())
                .all()
                if item.file_path and Path(item.file_path).name == safe_name
            ),
            None,
        )
        if record is None:
            print(f"Backup file is not tracked: {safe_name}", file=sys.stderr)
            return 1
        result = await BackupService(db).verify_backup(record.id)
        print(json.dumps(result, sort_keys=True))
        return 0 if result.get("verified") else 1
    finally:
        db.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--filename", required=True)
    args = parser.parse_args()
    return asyncio.run(run(args.filename))


if __name__ == "__main__":
    raise SystemExit(main())
