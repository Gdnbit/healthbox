"""Focused browser acceptance for recoverable health-source withdrawal."""

import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

import pytest

from tests.e2e.synthetic_browser_harness import (
    _assert_no_critical_horizontal_overflow,
    _create_schema,
    _port_is_open,
    _register_synthetic_user,
    _reserve_local_port,
    _single_patient_id,
    _stop_process,
    _wait_for_server,
)

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.slow,
    pytest.mark.skipif(
        os.environ.get("RUN_SYNTHETIC_BROWSER_E2E") != "1",
        reason="Set RUN_SYNTHETIC_BROWSER_E2E=1 to run the isolated Playwright flow",
    ),
]


def test_source_document_withdrawal_and_restore_in_browser(tmp_path: Path) -> None:
    """Show dependency impact, preserve the file, export lifecycle state and restore."""

    from playwright.sync_api import expect, sync_playwright

    project_root = Path(__file__).resolve().parents[2]
    build_dir = project_root / "frontend/build"
    assert (build_dir / "index.html").is_file()

    db_path = tmp_path / "source-lifecycle.sqlite3"
    upload_dir = tmp_path / "uploads"
    backup_dir = tmp_path / "backups"
    trash_dir = tmp_path / "trash"
    log_dir = tmp_path / "logs"
    for directory in (upload_dir, backup_dir, trash_dir, log_dir):
        directory.mkdir(parents=True, exist_ok=True)

    pdf_path = tmp_path / "synthetic-source-lifecycle.pdf"
    pdf_path.write_bytes(b"%PDF-1.4\n% synthetic lifecycle browser fixture\n%%EOF\n")

    port = _reserve_local_port()
    base_url = f"http://127.0.0.1:{port}"
    username = f"lifecycle_{secrets.token_hex(5)}"
    password = f"Lifecycle-{secrets.token_urlsafe(18)}-9"
    env = os.environ.copy()
    env.update(
        {
            "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
            "SECRET_KEY": secrets.token_urlsafe(64),
            "TESTING": "1",
            "SKIP_MIGRATIONS": "true",
            "STATIC_DIR": str(build_dir),
            "UPLOAD_DIR": str(upload_dir),
            "BACKUP_DIR": str(backup_dir),
            "TRASH_DIR": str(trash_dir),
            "LOG_DIR": str(log_dir),
            "ALLOW_USER_REGISTRATION": "true",
            "HOUSEHOLD_ADMIN_PROVISIONING_ONLY": "false",
            "AUTH_COOKIE_SECURE": "false",
            "CORS_ALLOWED_ORIGINS": base_url,
            "NOTIFICATIONS_ENABLED": "false",
            "REMOTE_RELEASE_NOTES_ENABLED": "false",
            "LOG_LEVEL": "WARNING",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    _create_schema(project_root, env)

    server_log_path = tmp_path / "server.log"
    desktop_screenshot = tmp_path / "source-withdrawn-desktop.png"
    mobile_screenshot = tmp_path / "source-restore-mobile.png"
    process: subprocess.Popen[str] | None = None
    with server_log_path.open("w", encoding="utf-8", newline="\n") as server_log:
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(port),
                    "--log-level",
                    "warning",
                    "--no-access-log",
                ],
                cwd=project_root,
                env=env,
                stdout=server_log,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            _wait_for_server(base_url, process)
            _register_synthetic_user(base_url, username, password)

            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(headless=True)
                context = browser.new_context(
                    locale="zh-CN",
                    viewport={"width": 1280, "height": 720},
                    reduced_motion="reduce",
                )
                context.add_init_script("window.localStorage.setItem('i18nextLng', 'zh');")
                page = context.new_page()
                page.set_default_timeout(20_000)
                try:
                    page.goto(f"{base_url}/login", wait_until="domcontentloaded")
                    page.locator("#username").fill(username)
                    page.locator("#password").fill(password)
                    page.get_by_role("button", name="登录", exact=True).click()
                    page.wait_for_url(f"{base_url}/dashboard")

                    patient_id = _single_patient_id(db_path)
                    page.goto(
                        f"{base_url}/health-insights?view=sources",
                        wait_until="domcontentloaded",
                    )
                    expect(page.get_by_text("录入与资料工作台", exact=True)).to_be_visible()
                    page.get_by_role("button", name="保存原件", exact=True).first.click()
                    upload_dialog = page.get_by_role("dialog", name="保存健康资料原件", exact=True)
                    upload_dialog.get_by_label("显示名称").fill("合成生命周期报告")
                    upload_dialog.locator('input[type="file"]').set_input_files(str(pdf_path))
                    upload_dialog.get_by_role("button", name="保存原件", exact=True).click()

                    source_row = page.locator("tr", has_text="合成生命周期报告")
                    expect(source_row).to_be_visible()
                    source_list_response = context.request.get(
                        f"{base_url}/api/v1/health-imports/patients/" f"{patient_id}/source-documents"
                    )
                    assert source_list_response.status == 200
                    source = source_list_response.json()[0]

                    batch_response = context.request.post(
                        f"{base_url}/api/v1/health-imports/patients/" f"{patient_id}/batches",
                        data={
                            "source_document_id": source["id"],
                            "parser_name": "browser-lifecycle-fixture",
                            "idempotency_key": "browser-lifecycle-fixture",
                            "candidates": [
                                {
                                    "observed_date": "2026-01-15",
                                    "test_name": "Synthetic lifecycle marker",
                                    "result_type": "quantitative",
                                    "numeric_value": 1.0,
                                    "unit": "unit/L",
                                }
                            ],
                        },
                    )
                    assert batch_response.status == 201

                    source_row.get_by_role("button", name="撤回", exact=True).click()
                    withdraw_dialog = page.get_by_role("dialog", name="撤回这份原件？", exact=True)
                    expect(withdraw_dialog).to_be_visible()
                    expect(withdraw_dialog.get_by_text("已有引用", exact=True)).to_be_visible()
                    expect(withdraw_dialog.get_by_text("录入批次", exact=True)).to_be_visible()
                    withdraw_dialog.get_by_label("撤回原因（可选）").fill("合成验收：传错档案")
                    withdraw_dialog.get_by_role("button", name="确认撤回", exact=True).click()

                    expect(source_row.get_by_text("已撤回（可恢复）", exact=True)).to_be_visible()
                    expect(source_row.get_by_role("button", name="录入候选项", exact=True)).to_be_disabled()
                    expect(source_row.get_by_role("button", name="恢复", exact=True)).to_be_visible()
                    _assert_no_critical_horizontal_overflow(page)
                    page.screenshot(path=str(desktop_screenshot), full_page=True)

                    active_response = context.request.get(
                        f"{base_url}/api/v1/health-imports/patients/" f"{patient_id}/source-documents"
                    )
                    assert active_response.status == 200
                    assert active_response.json() == []
                    retained_response = context.request.get(
                        f"{base_url}/api/v1/entity-files/files/" f"{source['primary_file_id']}"
                    )
                    assert retained_response.status == 200
                    delete_response = context.request.delete(
                        f"{base_url}/api/v1/entity-files/files/" f"{source['primary_file_id']}"
                    )
                    assert delete_response.status == 409

                    export_response = context.request.get(
                        f"{base_url}/api/v1/export/data" "?format=json&scope=source_documents"
                    )
                    assert export_response.status == 200
                    exported_source = export_response.json()["source_documents"][0]
                    assert exported_source["status"] == "archived"
                    assert exported_source["withdrawn_at"]
                    assert exported_source["withdrawal_reason"] == "合成验收：传错档案"

                    page.set_viewport_size({"width": 390, "height": 844})
                    source_row.get_by_role("button", name="恢复", exact=True).click()
                    restore_dialog = page.get_by_role("dialog", name="恢复这份原件？", exact=True)
                    expect(restore_dialog).to_be_visible()
                    _assert_no_critical_horizontal_overflow(page)
                    page.screenshot(path=str(mobile_screenshot), full_page=True)
                    restore_dialog.get_by_role("button", name="确认恢复", exact=True).click()
                    expect(source_row.get_by_role("button", name="撤回", exact=True)).to_be_visible()
                    expect(source_row.get_by_role("button", name="录入候选项", exact=True)).to_be_enabled()
                finally:
                    context.close()
                    browser.close()
        finally:
            _stop_process(process)

    assert process is not None and process.poll() is not None
    assert not _port_is_open(port)
    assert desktop_screenshot.stat().st_size > 0
    assert mobile_screenshot.stat().st_size > 0
    log_text = server_log_path.read_text(encoding="utf-8", errors="replace")
    assert password not in log_text
    assert not re.search(r"[A-Z]:[\\/]+(?:Users|SensitiveRecords)[\\/]", log_text)
    assert json.dumps({"username": username}, ensure_ascii=False) not in log_text
