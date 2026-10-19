#!/usr/bin/env python3
"""Record non-clinical metadata from a host-side isolated restore drill."""

import argparse
import json
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from app.core.database.database import SessionLocal  # noqa: E402
from app.services.backup_service import BackupService  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--filename", required=True)
    parser.add_argument("--status", required=True, choices=["passed", "failed"])
    parser.add_argument("--summary-json", required=True)
    args = parser.parse_args()

    try:
        summary = json.loads(args.summary_json)
        if not isinstance(summary, dict):
            raise ValueError("summary-json must contain an object")
    except (json.JSONDecodeError, ValueError) as error:
        print(f"Invalid restore drill summary: {error}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        record = BackupService(db).record_restore_drill(
            filename=args.filename,
            status=args.status,
            summary=summary,
        )
        print(
            json.dumps(
                {
                    "backup_id": record.id,
                    "status": record.restore_test_status,
                    "tested_at": record.restore_tested_at.isoformat(),
                }
            )
        )
        return 0
    except Exception as error:
        db.rollback()
        print(f"Unable to record restore drill: {error}", file=sys.stderr)
        return 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
