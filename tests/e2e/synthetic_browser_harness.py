"""Ephemeral full-stack browser harness using synthetic data only."""

from __future__ import annotations

import json
import os
import re
import secrets
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import requests
from reportlab.pdfgen import canvas

STATE_TABLES = {
    "source_documents": "health_source_documents",
    "import_batches": "health_import_batches",
    "import_items": "health_import_items",
    "lab_results": "lab_results",
    "lab_components": "lab_test_components",
    "vitals": "vitals",
    "coverage_statements": "health_coverage_statements",
}


def _reserve_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        port = int(listener.getsockname()[1])
    if port == 8005:
        raise AssertionError("The isolated browser test must never use port 8005")
    return port


def _port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
        client.settimeout(0.25)
        return client.connect_ex(("127.0.0.1", port)) == 0


def _wait_for_server(base_url: str, process: subprocess.Popen[str]) -> None:
    session = requests.Session()
    session.trust_env = False
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError("The isolated application exited before readiness")
        try:
            response = session.get(f"{base_url}/health", timeout=1)
            if response.status_code == 200:
                return
        except requests.RequestException:
            pass
        time.sleep(0.2)
    raise AssertionError("The isolated application did not become ready in 60 seconds")


def _snapshot(db_path: Path) -> dict[str, Any]:
    with sqlite3.connect(db_path, timeout=5) as connection:
        snapshot = {
            name: int(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0])
            for name, table in STATE_TABLES.items()
        }
        row = connection.execute("SELECT status FROM health_import_batches ORDER BY id DESC LIMIT 1").fetchone()
    snapshot["batch_status"] = row[0] if row else None
    return snapshot


def _wait_for_state(db_path: Path, expected: dict[str, Any]) -> dict[str, Any]:
    deadline = time.monotonic() + 15
    actual: dict[str, Any] = {}
    while time.monotonic() < deadline:
        actual = _snapshot(db_path)
        if actual == expected:
            return actual
        time.sleep(0.1)
    raise AssertionError(f"State mismatch: expected {expected!r}, observed {actual!r}")


def _single_patient_id(db_path: Path) -> int:
    with sqlite3.connect(db_path, timeout=5) as connection:
        rows = connection.execute("SELECT id FROM patients ORDER BY id").fetchall()
    if len(rows) != 1:
        raise AssertionError(f"Expected one synthetic patient, observed {len(rows)} patients")
    return int(rows[0][0])


def _generate_synthetic_pdf(path: Path, case: dict[str, Any]) -> None:
    document = canvas.Canvas(str(path))
    document.setTitle(case["pdf_title"])
    document.drawString(72, 760, case["pdf_title"])
    document.drawString(72, 730, case["pdf_body"])
    document.drawString(72, 700, "No personal or clinical data is present in this file.")
    document.save()


def _assert_no_critical_horizontal_overflow(page: Any) -> None:
    evidence = page.evaluate("""() => {
          const viewport = document.documentElement.clientWidth;
          const overflow = Math.max(
            0,
            document.documentElement.scrollWidth - viewport,
            document.body.scrollWidth - document.body.clientWidth
          );
          const offenders = [...document.body.querySelectorAll('*')]
            .map(element => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                className: String(element.className || '').slice(0, 120),
                testId: element.getAttribute('data-testid'),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
              };
            })
            .filter(item => item.right > viewport + 2 && item.width > 0)
            .sort((left, right) => right.right - left.right)
            .slice(0, 8);
          return { overflow, viewport, offenders };
        }""")
    if evidence["overflow"] > 2:
        raise AssertionError(f"Critical horizontal overflow detected: {evidence!r}")


def _register_synthetic_user(base_url: str, username: str, password: str) -> None:
    session = requests.Session()
    session.trust_env = False
    response = session.post(
        f"{base_url}/api/v1/auth/register",
        json={
            "username": username,
            "email": f"{username}@example.com",
            "full_name": "Synthetic Household",
            "first_name": "Synthetic",
            "last_name": "Household",
            "password": password,
        },
        timeout=30,
    )
    if response.status_code != 200:
        raise AssertionError(f"Synthetic registration failed with status {response.status_code}")


def _create_schema(project_root: Path, env: dict[str, str]) -> None:
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            ("from app.core.database import Base, engine; " "Base.metadata.create_all(bind=engine); engine.dispose()"),
        ],
        cwd=project_root,
        env=env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=90,
        check=False,
    )
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout)[-2000:]
        raise AssertionError(f"Could not create isolated schema: {message}")


def _stop_process(process: subprocess.Popen[str] | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def _run_browser_flow(
    *,
    base_url: str,
    db_path: Path,
    temp_root: Path,
    project_root: Path,
    case: dict[str, Any],
    golden: dict[str, dict[str, Any]],
    username: str,
    password: str,
) -> tuple[
    dict[str, dict[str, Any]],
    dict[str, Any],
    dict[str, Any],
    str,
    int,
    int,
]:
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
        from playwright.sync_api import expect, sync_playwright
    except ImportError as error:
        raise AssertionError(
            "Playwright is missing; install requirements-e2e.txt without modifying production dependencies"
        ) from error

    pdf_path = temp_root / case["source_filename"]
    _generate_synthetic_pdf(pdf_path, case)
    csv_path = project_root / case["csv_fixture"]
    if not csv_path.is_file():
        raise AssertionError("The synthetic CSV fixture is missing")

    states: dict[str, dict[str, Any]] = {}
    export_payload: dict[str, Any] = {}
    portable_export_evidence: dict[str, Any] = {}
    portable_export_text = ""
    desktop_screenshot = temp_root / "desktop-committed.png"
    mobile_screenshot = temp_root / "mobile-committed.png"
    vital_mobile_screenshot = temp_root / "mobile-vital-export.png"

    states["initial"] = _wait_for_state(db_path, golden["initial"])

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=True)
        except Exception as error:
            raise AssertionError(
                "Installed Playwright Chromium is unavailable; install it before running this offline test"
            ) from error

        expect.set_options(timeout=15_000)
        context = browser.new_context(
            locale="zh-CN",
            viewport=case["viewports"]["desktop"],
            accept_downloads=True,
            reduced_motion="reduce",
        )
        context.add_init_script("""
            window.localStorage.setItem('i18nextLng', 'zh');
            window.__syntheticPrintCalls = 0;
            Object.defineProperty(window, 'print', {
              configurable: true,
              value: () => { window.__syntheticPrintCalls += 1; }
            });
            """)
        page = context.new_page()
        page.set_default_timeout(20_000)

        def select_metric(metric_name: str) -> None:
            metric_button = page.locator("button[aria-pressed]", has_text=metric_name)
            expect(metric_button).to_have_count(1)
            expect(metric_button).to_be_visible()
            if metric_button.get_attribute("aria-pressed") != "true":
                metric_button.click()
            expect(page.get_by_test_id("health-metric-visualization")).to_be_visible()

        def open_export_menu(button: Any, item_name: str) -> Any:
            for attempt in range(2):
                button.click()
                action = page.get_by_role("menuitem", name=item_name, exact=True)
                try:
                    action.wait_for(state="visible", timeout=10_000)
                    return action
                except PlaywrightTimeoutError:
                    page.keyboard.press("Escape")
                    if attempt == 1:
                        raise
            raise AssertionError("Export menu did not open")

        try:
            page.goto(f"{base_url}/login", wait_until="domcontentloaded")
            expect(page.get_by_text("登录您的账户", exact=True)).to_be_visible()
            page.locator("#username").fill(username)
            page.locator("#password").fill(password)
            page.get_by_role("button", name="登录", exact=True).click()
            page.wait_for_url(re.compile(r".*/family-health(?:\?.*)?$"), timeout=30_000)

            patient_id = _single_patient_id(db_path)
            vital_record_ids: list[int] = []
            for record in case["vital_export"]["records"]:
                response = context.request.post(
                    f"{base_url}/api/v1/vitals/",
                    data={**record, "patient_id": patient_id},
                )
                if response.status != 200:
                    raise AssertionError(f"Synthetic vital creation failed with status {response.status}")
                vital_record_ids.append(int(response.json()["id"]))
            states["vital_seeded"] = _wait_for_state(db_path, golden["vital_seeded"])

            page.goto(
                f"{base_url}/health-insights?view=sources",
                wait_until="domcontentloaded",
            )
            expect(page.get_by_text("录入与资料工作台", exact=True)).to_be_visible()
            _assert_no_critical_horizontal_overflow(page)

            open_source_upload = page.get_by_role("button", name="保存原件", exact=True).first
            upload_dialog = page.get_by_role("dialog", name="保存健康资料原件", exact=True)
            for attempt in range(3):
                if not upload_dialog.is_visible():
                    open_source_upload.click()
                try:
                    upload_dialog.wait_for(state="visible", timeout=5_000)
                    upload_dialog.get_by_label("显示名称").fill(case["source_display_name"])
                    upload_dialog.get_by_label("报告日期").fill("2026-01-15")
                    upload_dialog.get_by_label("机构").fill("Synthetic Home Lab")
                    upload_dialog.locator('input[type="file"]').set_input_files(str(pdf_path))
                    break
                except PlaywrightTimeoutError:
                    if attempt == 2:
                        raise
                    if upload_dialog.is_visible():
                        upload_dialog.get_by_role("button", name="取消", exact=True).click()
                        upload_dialog.wait_for(state="hidden", timeout=5_000)
            save_source_button = upload_dialog.get_by_role("button", name="保存原件", exact=True)
            expect(save_source_button).to_be_enabled()
            save_source_button.click()
            expect(
                page.locator(
                    "table.mantine-Table-table",
                    has_text=case["source_display_name"],
                )
            ).to_be_visible()
            states["source_saved"] = _wait_for_state(db_path, golden["source_saved"])

            source_row = page.locator("tr", has_text=case["source_display_name"])
            source_row.get_by_role("button", name="录入候选项", exact=True).click()
            expect(page.get_by_text("建立手工待复核批次", exact=True)).to_be_visible()
            page.get_by_text("CSV 模板", exact=True).click()
            page.locator('input[type="file"]').set_input_files(str(csv_path))
            page.get_by_role("button", name="预览并校验", exact=True).click()
            expect(page.get_by_text("有效：3", exact=True)).to_be_visible()
            for marker in case["expected_markers"]:
                expect(page.get_by_text(marker, exact=True).first).to_be_visible()
            states["previewed"] = _wait_for_state(db_path, golden["previewed"])

            page.get_by_role("button", name="建立待复核批次", exact=True).click()
            expect(page.get_by_text(re.compile(r"复核批次 #\d+"))).to_be_visible()
            states["pending_review"] = _wait_for_state(db_path, golden["pending_review"])

            for marker in case["expected_markers"]:
                page.get_by_role("button", name=re.compile(re.escape(marker))).click()
            decisions = page.get_by_role("textbox", name="复核决定", exact=True)
            expect(decisions).to_have_count(3)
            for index in range(3):
                decisions.nth(index).click()
                option = page.get_by_role("option", name="接受", exact=True)
                expect(option).to_be_visible()
                option.click()

            page.get_by_role("button", name="保存复核", exact=True).click()
            expect(page.get_by_role("button", name="将接受项写入正式记录", exact=True)).to_be_visible()
            states["reviewed"] = _wait_for_state(db_path, golden["reviewed"])

            page.get_by_role("button", name="将接受项写入正式记录", exact=True).click()
            expect(page.get_by_text("确认写入已复核候选项？", exact=True)).to_be_visible()
            if _snapshot(db_path) != golden["reviewed"]:
                raise AssertionError("Opening commit confirmation changed formal data")
            page.get_by_role("button", name="确认写入", exact=True).click()
            expect(page.get_by_role("button", name="回滚该批次", exact=True)).to_be_visible()
            states["committed"] = _wait_for_state(db_path, golden["committed"])

            comparison_lab_response = context.request.post(
                f"{base_url}/api/v1/lab-results/",
                data={
                    "patient_id": patient_id,
                    "test_name": "Synthetic comparison follow-up",
                    "status": "completed",
                    "completed_date": "2026-02-15",
                },
            )
            if comparison_lab_response.status != 201:
                raise AssertionError("Synthetic comparison lab result could not be created")
            comparison_lab_result_id = int(comparison_lab_response.json()["id"])
            comparison_component_response = context.request.post(
                f"{base_url}/api/v1/lab-test-components/lab-result/" f"{comparison_lab_result_id}/components/bulk",
                data={
                    "lab_result_id": comparison_lab_result_id,
                    "components": [
                        {
                            "test_name": case["expected_markers"][0],
                            "canonical_test_name": "Synthetic Marker Alpha",
                            "test_code": "SYN-A",
                            "result_type": "quantitative",
                            "value": 13.5,
                            "unit": "unit/L",
                            "ref_range_min": 10,
                            "ref_range_max": 15,
                            "status": "normal",
                            "category": "chemistry",
                            "lab_result_id": comparison_lab_result_id,
                        }
                    ],
                },
            )
            if comparison_component_response.status != 201:
                raise AssertionError("Synthetic comparison component could not be created")
            comparison_component_id = int(comparison_component_response.json()["components"][0]["id"])
            target_lab_response = context.request.post(
                f"{base_url}/api/v1/lab-results/",
                data={
                    "patient_id": patient_id,
                    "test_name": "Synthetic comparison target",
                    "status": "completed",
                    "completed_date": "2026-03-15",
                },
            )
            if target_lab_response.status != 201:
                raise AssertionError("Synthetic target lab result could not be created")
            target_lab_result_id = int(target_lab_response.json()["id"])
            target_component_response = context.request.post(
                f"{base_url}/api/v1/lab-test-components/lab-result/" f"{target_lab_result_id}/components/bulk",
                data={
                    "lab_result_id": target_lab_result_id,
                    "components": [
                        {
                            "test_name": case["expected_markers"][0],
                            "canonical_test_name": "Synthetic Marker Alpha",
                            "test_code": "SYN-A",
                            "result_type": "quantitative",
                            "value": 14.5,
                            "unit": "unit/L",
                            "ref_range_min": 10,
                            "ref_range_max": 15,
                            "status": "normal",
                            "category": "chemistry",
                            "lab_result_id": target_lab_result_id,
                        }
                    ],
                },
            )
            if target_component_response.status != 201:
                raise AssertionError("Synthetic target component could not be created")
            target_component_id = int(target_component_response.json()["components"][0]["id"])
            trend_response = context.request.get(
                f"{base_url}/api/v1/lab-test-components/patient/" f"{patient_id}/trends",
                params={
                    "test_name": case["expected_markers"][0],
                    "unit": "unit/L",
                    "limit": 500,
                },
            )
            if trend_response.status != 200:
                raise AssertionError("Synthetic comparison trend could not be loaded")
            source_points = [
                point for point in trend_response.json()["data_points"] if point.get("source_document_id") is not None
            ]
            if len(source_points) != 1:
                raise AssertionError("Expected one source-backed baseline point")
            baseline_component_id = int(source_points[0]["id"])
            source_document_id = int(source_points[0]["source_document_id"])

            page.goto(
                f"{base_url}/health-insights?view=exams",
                wait_until="domcontentloaded",
            )
            expect(page.get_by_text("体检批次对比", exact=True).first).to_be_visible()
            expect(page.get_by_role("textbox", name="目标体检", exact=True)).to_have_value(
                re.compile(rf"检验记录 #{target_lab_result_id}$")
            )
            for attempt in range(3):
                page.get_by_role("textbox", name="较早基线体检", exact=True).click()
                source_episode_option = page.get_by_role("option").filter(has_text=f"来源原件 #{source_document_id}")
                expect(source_episode_option).to_have_count(1)
                try:
                    source_episode_option.click(timeout=5_000)
                    break
                except PlaywrightTimeoutError:
                    # A late comparison refresh can close Mantine's portal.
                    # Reopen through the same user action; never force a click.
                    page.keyboard.press("Escape")
                    if attempt == 2:
                        raise
            page.wait_for_function(
                """expected => {
                  const params = new URL(window.location.href).searchParams;
                  return params.get('exam_target') === expected.target
                    && params.get('exam_baseline') === expected.baseline;
                }""",
                arg={
                    "target": f"lab:{target_lab_result_id}",
                    "baseline": f"source:{source_document_id}",
                },
            )
            expect(page.get_by_text("+2 unit/L", exact=True)).to_be_visible()
            expect(
                page.get_by_text(
                    "某项指标缺失只表示该批次没有正式结构化记录，不能据此认定当时没有检查。",
                    exact=True,
                )
            ).to_be_visible()
            exam_url = (
                f"{base_url}/health-insights?view=exams"
                f"&exam_target=lab%3A{target_lab_result_id}"
                f"&exam_baseline=source%3A{source_document_id}"
            )
            page.get_by_role("button", name=f"打开来源原件 {source_document_id}", exact=True).click()
            page.wait_for_url(f"{base_url}/health-insights?view=sources&source={source_document_id}")
            expect(page.locator('tr[data-focused="true"]')).to_contain_text(case["source_display_name"])

            page.goto(exam_url, wait_until="domcontentloaded")
            page.get_by_role("button", name=f"打开检验记录 {target_lab_result_id}", exact=True).click()
            page.wait_for_url(f"{base_url}/lab-results?view={target_lab_result_id}")

            page.goto(
                f"{base_url}/health-insights?view=coverage",
                wait_until="domcontentloaded",
            )
            page.get_by_text("按年份", exact=True).click()
            expect(page.get_by_text("1 个年份", exact=True)).to_be_visible()
            expect(page.get_by_role("columnheader", name="2026", exact=True)).to_be_visible()
            _assert_no_critical_horizontal_overflow(page)

            page.get_by_role("button", name="新增缺失声明", exact=True).click()
            create_coverage_dialog = page.get_by_role("dialog", name="新增缺失声明", exact=True)
            expect(create_coverage_dialog).to_be_visible()
            create_coverage_dialog.locator('input[type="date"]').fill("2026-01-15")
            metric_name_input = create_coverage_dialog.locator('input[required]:not([type="date"])')
            expect(metric_name_input).to_have_count(1)
            metric_name_input.fill(case["expected_markers"][0])
            metric_name_input.press("Tab")
            create_coverage_dialog.get_by_role("button", name="保存版本", exact=True).click()
            expect(create_coverage_dialog).to_be_hidden()
            expect(page.get_by_text("证据冲突", exact=True).first).to_be_visible()

            page.get_by_role("button", name="创建修订版本", exact=True).click()
            revise_coverage_dialog = page.get_by_role("dialog", name="创建声明新版本", exact=True)
            expect(revise_coverage_dialog).to_be_visible()
            revise_coverage_dialog.get_by_label("覆盖状态", exact=True).click()
            page.get_by_role("option", name="未知", exact=True).click()
            revise_coverage_dialog.get_by_label("核验状态", exact=True).click()
            page.get_by_role("option", name="待复核", exact=True).click()
            revision_reason_input = revise_coverage_dialog.locator("textarea[required]")
            expect(revision_reason_input).to_have_count(1)
            revision_reason_input.fill("Synthetic revision evidence")
            revise_coverage_dialog.get_by_role("button", name="保存版本", exact=True).click()
            expect(revise_coverage_dialog).to_be_hidden()
            expect(page.get_by_text("待复核", exact=True).first).to_be_visible()

            page.get_by_role("button", name="作废", exact=True).click()
            void_coverage_dialog = page.get_by_role("dialog", name="作废这条检查覆盖声明？", exact=True)
            expect(void_coverage_dialog).to_be_visible()
            void_reason_input = void_coverage_dialog.locator("textarea[required]")
            expect(void_reason_input).to_have_count(1)
            void_reason_input.fill("Synthetic fixture cleanup")
            void_coverage_dialog.get_by_role("button", name="确认作废", exact=True).click()
            expect(void_coverage_dialog).to_be_hidden()
            page.get_by_role("switch", name="显示已取代和已作废版本", exact=True).click()

            coverage_history_response = context.request.get(
                f"{base_url}/api/v1/health-coverage/patients/{patient_id}",
                params={"include_history": "true", "include_voided": "true"},
            )
            if coverage_history_response.status != 200:
                raise AssertionError("Coverage history could not be loaded")
            coverage_versions = coverage_history_response.json()
            if [item["version_number"] for item in coverage_versions] != [1, 2, 3]:
                raise AssertionError("Coverage statement versions are incomplete")
            if [item["status"] for item in coverage_versions] != [
                "superseded",
                "superseded",
                "voided",
            ]:
                raise AssertionError("Coverage statement lifecycle is incorrect")

            coverage_export_response = context.request.get(f"{base_url}/api/v1/export/data?format=json&scope=all")
            if coverage_export_response.status != 200:
                raise AssertionError("Coverage export could not be loaded")
            exported_coverage_versions = coverage_export_response.json().get("health_coverage_statements", [])
            if len(exported_coverage_versions) != 3:
                raise AssertionError("Full export omitted coverage history")

            with sqlite3.connect(db_path, timeout=5) as connection:
                connection.execute("DELETE FROM health_coverage_statements")
                connection.commit()
                remaining_coverage_rows = int(
                    connection.execute("SELECT COUNT(*) FROM health_coverage_statements").fetchone()[0]
                )
            if remaining_coverage_rows != 0:
                raise AssertionError("Synthetic coverage fixture cleanup failed")

            page.goto(
                f"{base_url}/health-insights?view=metrics",
                wait_until="domcontentloaded",
            )
            expect(page.get_by_text("指标目录", exact=True)).to_be_visible()
            for marker in case["expected_markers"]:
                expect(page.get_by_text(marker, exact=True).first).to_be_visible()
            select_metric(case["expected_markers"][0])
            expect(
                page.locator(
                    "table.mantine-Table-table",
                    has_text=case["source_display_name"],
                )
            ).to_be_visible()

            page.get_by_label("开始日期", exact=True).fill("2026-12-31")
            page.get_by_label("结束日期", exact=True).fill("2026-01-01")
            page.get_by_role("button", name="应用范围", exact=True).click()
            expect(page.get_by_text("开始日期不能晚于结束日期。", exact=True)).to_be_visible()
            if "metric_from=" in page.url or "metric_to=" in page.url:
                raise AssertionError("Invalid date window changed the URL state")

            page.get_by_label("开始日期", exact=True).fill("2026-01-01")
            page.get_by_label("结束日期", exact=True).fill("2026-12-31")
            page.get_by_role("button", name="应用范围", exact=True).click()
            page.wait_for_function(
                """expected => {
                  const params = new URL(window.location.href).searchParams;
                  return params.get('metric_from') === expected.from
                    && params.get('metric_to') === expected.to;
                }""",
                arg={
                    "from": "2026-01-01",
                    "to": "2026-12-31",
                },
            )
            expect(page.get_by_test_id("health-metric-applied-range")).to_have_text("2026-01-01 至 2026-12-31")
            page.get_by_test_id("health-metric-baseline-select").click()
            baseline_option = page.get_by_role("option").filter(has_text=f"#{baseline_component_id}")
            expect(baseline_option).to_have_count(1)
            baseline_option.click()
            page.wait_for_function(
                "expected => new URL(window.location.href).searchParams" ".get('metric_baseline') === expected",
                arg=str(baseline_component_id),
            )
            expect(page.get_by_test_id("health-metric-primary-delta")).to_contain_text("+2 unit/L")

            metric_url = (
                f"{base_url}/health-insights?view=metrics"
                "&metric_from=2026-01-01&metric_to=2026-12-31"
                f"&metric_baseline={baseline_component_id}"
            )
            source_row = page.locator("tr", has_text=f"来源文档 {source_document_id}")
            expect(source_row).to_have_count(1)
            source_row.get_by_role("button", name="查看来源", exact=True).click()
            page.wait_for_url(f"{base_url}/health-insights?view=sources&source={source_document_id}")
            focused_source_row = page.locator('tr[data-focused="true"]')
            expect(focused_source_row).to_contain_text(case["source_display_name"])

            page.goto(metric_url, wait_until="domcontentloaded")
            select_metric(case["expected_markers"][0])
            target_row = page.locator("tr", has_text="Synthetic comparison target")
            target_row.get_by_role("button", name="打开记录", exact=True).click()
            page.wait_for_url(f"{base_url}/lab-results?view={target_lab_result_id}")
            page.goto(metric_url, wait_until="domcontentloaded")
            select_metric(case["expected_markers"][0])
            _assert_no_critical_horizontal_overflow(page)
            page.screenshot(path=str(desktop_screenshot), full_page=True)

            committed_before_portable_export = _snapshot(db_path)
            export_button = page.get_by_role("button", name="导出与打印", exact=True)
            expect(export_button).to_be_visible()

            svg_action = open_export_menu(export_button, "下载 SVG")
            with page.expect_download() as svg_download_info:
                svg_action.click()
            svg_download = svg_download_info.value
            svg_path = temp_root / "portable-health-metric.svg"
            svg_download.save_as(svg_path)
            if not re.fullmatch(
                r"health-metric-[a-z0-9-]+-\d{8}T\d{6}Z\.svg",
                svg_download.suggested_filename,
            ):
                raise AssertionError("SVG export filename is not privacy-safe")
            svg_text = svg_path.read_text(encoding="utf-8")
            required_svg_text = (
                "<svg",
                "<title",
                case["source_display_name"],
                "2026-01-01 至 2026-12-31",
                f"基线记录 #{baseline_component_id}",
                f"目标记录 #{target_component_id}",
                "本导出仅整理已存记录，不构成诊断。",
            )
            if any(value not in svg_text for value in required_svg_text):
                raise AssertionError("SVG export is missing metric provenance content")
            selected_export_markers = [
                marker for marker in case["expected_markers"] if marker.casefold() in svg_text.casefold()
            ]
            if len(selected_export_markers) != 1:
                raise AssertionError("SVG export does not identify exactly one committed metric")

            expect(svg_action).to_be_hidden()
            csv_action = open_export_menu(export_button, "下载 CSV")
            with page.expect_download() as csv_download_info:
                csv_action.click()
            csv_download = csv_download_info.value
            csv_path = temp_root / "portable-health-metric.csv"
            csv_download.save_as(csv_path)
            if not re.fullmatch(
                r"health-metric-[a-z0-9-]+-\d{8}T\d{6}Z\.csv",
                csv_download.suggested_filename,
            ):
                raise AssertionError("CSV export filename is not privacy-safe")
            csv_bytes = csv_path.read_bytes()
            if not csv_bytes.startswith(b"\xef\xbb\xbf"):
                raise AssertionError("CSV export is missing the UTF-8 BOM")
            csv_text = csv_bytes.decode("utf-8-sig")
            required_csv_text = (
                case["source_display_name"],
                "来源记录 ID",
                "2026-01-01 至 2026-12-31",
                str(baseline_component_id),
                str(target_component_id),
                "绝对差值",
                "本导出仅整理已存记录，不构成诊断。",
            )
            if any(value not in csv_text for value in required_csv_text):
                raise AssertionError("CSV export is missing metric provenance content")
            if selected_export_markers[0].casefold() not in csv_text.casefold():
                raise AssertionError("SVG and CSV exports identify different metrics")

            expect(csv_action).to_be_hidden()
            open_export_menu(export_button, "打印 / 保存 PDF").click()
            page.wait_for_function("window.__syntheticPrintCalls === 1")
            print_calls = page.evaluate("window.__syntheticPrintCalls")
            if print_calls != 1:
                raise AssertionError("Print action did not invoke the browser print flow")
            if page.evaluate("document.body.classList.contains('health-metric-printing')"):
                raise AssertionError("Print-only body state was not cleaned up")
            if _snapshot(db_path) != committed_before_portable_export:
                raise AssertionError("Portable metric export changed formal data")

            portable_export_evidence = {
                "svg_bytes": svg_path.stat().st_size,
                "csv_bytes": csv_path.stat().st_size,
                "svg_filename_safe": True,
                "csv_filename_safe": True,
                "print_calls": print_calls,
                "database_unchanged": True,
                "visualization_context_verified": True,
                "source_deep_link_verified": True,
                "record_deep_link_verified": True,
                "exam_comparison_verified": True,
                "annual_coverage_verified": True,
                "coverage_evidence_lifecycle_verified": True,
                "coverage_history_export_verified": True,
            }
            portable_export_text = f"{svg_text}\n{csv_text}"

            page.set_viewport_size(case["viewports"]["mobile"])
            page.goto(metric_url, wait_until="domcontentloaded")
            expect(page.get_by_text("健康数据概览", exact=True)).to_be_visible()
            expect(page.get_by_text(case["expected_markers"][0], exact=True).first).to_be_visible()
            select_metric(case["expected_markers"][0])
            mobile_export_button = page.get_by_role("button", name="导出与打印", exact=True)
            expect(mobile_export_button).to_be_visible()
            open_export_menu(mobile_export_button, "下载 SVG")
            page.keyboard.press("Escape")
            page.screenshot(path=str(mobile_screenshot), full_page=True)
            _assert_no_critical_horizontal_overflow(page)

            page.goto(exam_url, wait_until="domcontentloaded")
            expect(page.get_by_text("体检批次对比", exact=True).first).to_be_visible()
            expect(page.get_by_text("+2 unit/L", exact=True)).to_be_visible()
            _assert_no_critical_horizontal_overflow(page)

            page.set_viewport_size(case["viewports"]["desktop"])
            page.goto(
                f"{base_url}/health-insights?view=vitals",
                wait_until="domcontentloaded",
            )
            vital_card = page.get_by_role("button", name=case["vital_export"]["card_name"], exact=True)
            expect(vital_card).to_be_visible()
            vital_card.click()
            expect(page.get_by_text("趋势分析", exact=True)).to_be_visible()
            page.get_by_label("开始日期", exact=True).fill("2026-01-01")
            page.get_by_label("结束日期", exact=True).fill("2026-12-31")
            page.get_by_role("button", name="应用范围", exact=True).click()
            expect(page.get_by_test_id("vital-trend-applied-range")).to_have_text("2026-01-01 至 2026-12-31")
            expect(page.get_by_test_id("vital-trend-primary-delta")).to_contain_text("收缩压: +3 mmHg")
            expect(page.get_by_test_id("vital-trend-secondary-delta")).to_contain_text("舒张压: +3 mmHg")
            vital_export_button = page.get_by_role("button", name="导出与打印", exact=True)
            expect(vital_export_button).to_be_visible()
            committed_before_vital_export = _snapshot(db_path)

            vital_svg_action = open_export_menu(vital_export_button, "下载 SVG")
            with page.expect_download() as vital_svg_download_info:
                vital_svg_action.click()
            vital_svg_download = vital_svg_download_info.value
            vital_svg_path = temp_root / "portable-vital-trend.svg"
            vital_svg_download.save_as(vital_svg_path)
            if not re.fullmatch(
                r"health-vital-blood-pressure-\d{8}T\d{6}Z\.svg",
                vital_svg_download.suggested_filename,
            ):
                raise AssertionError("Vital SVG filename is not privacy-safe")
            vital_svg_text = vital_svg_path.read_text(encoding="utf-8")
            required_vital_svg_text = (
                "<svg",
                "<title",
                "收缩压",
                "舒张压",
                "118/76",
                "121/79",
                "Synthetic Household",
                "2026-01-01 至 2026-12-31",
                f"基线记录 #{vital_record_ids[0]}",
                f"目标记录 #{vital_record_ids[1]}",
                "绝对差值: 3/3",
                "本导出仅整理已存记录，不构成诊断。",
            )
            if any(value not in vital_svg_text for value in required_vital_svg_text):
                raise AssertionError("Vital SVG is missing dual-value provenance content")
            if any(str(record_id) not in vital_svg_text for record_id in vital_record_ids):
                raise AssertionError("Vital SVG is missing an exact record ID")

            expect(vital_svg_action).to_be_hidden()
            vital_csv_action = open_export_menu(vital_export_button, "下载 CSV")
            with page.expect_download() as vital_csv_download_info:
                vital_csv_action.click()
            vital_csv_download = vital_csv_download_info.value
            vital_csv_path = temp_root / "portable-vital-trend.csv"
            vital_csv_download.save_as(vital_csv_path)
            if not re.fullmatch(
                r"health-vital-blood-pressure-\d{8}T\d{6}Z\.csv",
                vital_csv_download.suggested_filename,
            ):
                raise AssertionError("Vital CSV filename is not privacy-safe")
            vital_csv_bytes = vital_csv_path.read_bytes()
            if not vital_csv_bytes.startswith(b"\xef\xbb\xbf"):
                raise AssertionError("Vital CSV is missing the UTF-8 BOM")
            vital_csv_text = vital_csv_bytes.decode("utf-8-sig")
            required_vital_csv_text = (
                "主值",
                "次值",
                "生命体征记录 ID",
                "118/76",
                "121/79",
                "Synthetic Household",
                "2026-01-01 至 2026-12-31",
                str(vital_record_ids[0]),
                str(vital_record_ids[1]),
                "3/3",
                "本导出仅整理已存记录，不构成诊断。",
            )
            if any(value not in vital_csv_text for value in required_vital_csv_text):
                raise AssertionError("Vital CSV is missing dual-value provenance content")
            if any(str(record_id) not in vital_csv_text for record_id in vital_record_ids):
                raise AssertionError("Vital CSV is missing an exact record ID")

            expect(vital_csv_action).to_be_hidden()
            print_calls_before_vital = page.evaluate("window.__syntheticPrintCalls")
            open_export_menu(vital_export_button, "打印 / 保存 PDF").click()
            page.wait_for_function(
                "expected => window.__syntheticPrintCalls === expected",
                arg=print_calls_before_vital + 1,
            )
            vital_print_calls = page.evaluate("window.__syntheticPrintCalls") - print_calls_before_vital
            if page.evaluate("document.body.classList.contains('vital-trend-printing')"):
                raise AssertionError("Vital print-only body state was not cleaned up")
            if _snapshot(db_path) != committed_before_vital_export:
                raise AssertionError("Portable vital export changed formal data")

            page.get_by_role("tab", name="数据表", exact=True).click()
            target_vital_row = page.locator("tr:visible").filter(has_text="121").filter(has_text="/79")
            expect(target_vital_row).to_have_count(1)
            target_vital_row.get_by_role("button", name="打开记录", exact=True).click()
            page.wait_for_url(f"{base_url}/vitals?view={vital_record_ids[1]}")

            page.set_viewport_size(case["viewports"]["mobile"])
            page.goto(
                f"{base_url}/health-insights?view=vitals",
                wait_until="domcontentloaded",
            )
            mobile_vital_card = page.get_by_role("button", name=case["vital_export"]["card_name"], exact=True)
            expect(mobile_vital_card).to_be_visible()
            mobile_vital_card.click()
            mobile_vital_export_button = page.get_by_role("button", name="导出与打印", exact=True)
            expect(mobile_vital_export_button).to_be_visible()
            open_export_menu(mobile_vital_export_button, "下载 SVG")
            page.keyboard.press("Escape")
            page.screenshot(path=str(vital_mobile_screenshot), full_page=True)
            _assert_no_critical_horizontal_overflow(page)

            portable_export_evidence["vital"] = {
                "svg_bytes": vital_svg_path.stat().st_size,
                "csv_bytes": vital_csv_path.stat().st_size,
                "svg_filename_safe": True,
                "csv_filename_safe": True,
                "print_calls": vital_print_calls,
                "database_unchanged": True,
                "mobile_screenshot_bytes": vital_mobile_screenshot.stat().st_size,
                "visualization_context_verified": True,
                "record_deep_link_verified": True,
            }
            portable_export_text = f"{portable_export_text}\n{vital_svg_text}\n{vital_csv_text}"

            for temporary_lab_result_id in (
                target_lab_result_id,
                comparison_lab_result_id,
            ):
                comparison_delete_response = context.request.delete(
                    f"{base_url}/api/v1/lab-results/{temporary_lab_result_id}"
                )
                if comparison_delete_response.status != 200:
                    raise AssertionError("Synthetic comparison record cleanup failed")
            _wait_for_state(db_path, golden["committed"])

            export_response = context.request.get(f"{base_url}/api/v1/export/data?format=json&scope=all")
            if export_response.status != 200:
                raise AssertionError(f"JSON export failed with status {export_response.status}")
            export_payload = export_response.json()
            if len(export_payload.get("source_documents", [])) != 1:
                raise AssertionError("Export is missing the source document")
            if len(export_payload.get("health_import_batches", [])) != 1:
                raise AssertionError("Export is missing the review batch")
            lab_results = export_payload.get("lab_results", [])
            if len(lab_results) != 1:
                raise AssertionError("Export does not contain one committed lab result")
            components = lab_results[0].get("test_components", [])
            if {item.get("test_name") for item in components} != set(case["expected_markers"]):
                raise AssertionError("Exported components do not match synthetic truth")
            if any(
                item.get("source_document_id") is None or item.get("import_batch_id") is None for item in components
            ):
                raise AssertionError("Exported components are missing provenance")
            exported_vitals = export_payload.get("vitals", [])
            if len(exported_vitals) != len(case["vital_export"]["records"]):
                raise AssertionError("JSON export is missing synthetic vital records")
            exported_pressures = {(item.get("systolic_bp"), item.get("diastolic_bp")) for item in exported_vitals}
            expected_pressures = {
                (item["systolic_bp"], item["diastolic_bp"]) for item in case["vital_export"]["records"]
            }
            if exported_pressures != expected_pressures:
                raise AssertionError("Exported blood-pressure pairs changed meaning")

            page.set_viewport_size(case["viewports"]["desktop"])
            page.goto(
                f"{base_url}/health-insights?view=sources",
                wait_until="domcontentloaded",
            )
            expect(page.get_by_text("录入与资料工作台", exact=True)).to_be_visible()
            batch_row = page.locator("tr", has_text="generic-csv")
            batch_row.get_by_role("button", name="打开复核", exact=True).click()
            page.get_by_role("button", name="回滚该批次", exact=True).click()
            expect(page.get_by_text("确认回滚该批次？", exact=True)).to_be_visible()
            page.get_by_role("button", name="确认回滚", exact=True).click()
            expect(page.get_by_text("已回滚", exact=True).first).to_be_visible()
            states["rolled_back"] = _wait_for_state(db_path, golden["rolled_back"])
            expect(page.get_by_text(case["source_display_name"], exact=True).first).to_be_visible()

            page.goto(
                f"{base_url}/health-insights?view=metrics",
                wait_until="domcontentloaded",
            )
            expect(page.get_by_text("指标目录", exact=True)).to_be_visible()
            expect(page.get_by_text("当前尚未储存结构化检验指标。", exact=True)).to_be_visible()
            for marker in case["expected_markers"]:
                expect(page.get_by_text(marker, exact=True)).to_have_count(0)
        except Exception:
            # Wholly synthetic local run only; keep failure evidence in pytest's
            # temporary directory, never in public assets or source fixtures.
            page.screenshot(path=str(temp_root / "failure.png"), full_page=True)
            (temp_root / "failure-state.json").write_text(
                json.dumps({"url": page.url, "text": page.locator("body").inner_text()}, ensure_ascii=False),
                encoding="utf-8",
            )
            raise
        finally:
            context.close()
            browser.close()

    return (
        states,
        export_payload,
        portable_export_evidence,
        portable_export_text,
        desktop_screenshot.stat().st_size,
        mobile_screenshot.stat().st_size,
    )


def run_synthetic_browser_flow(*, project_root: Path, temp_root: Path, case: dict[str, Any]) -> dict[str, Any]:
    """Run the isolated flow and return only non-sensitive acceptance evidence."""
    build_dir = project_root / "frontend/build"
    if not (build_dir / "index.html").is_file():
        raise AssertionError("frontend/build is missing; run the Vite build first")

    golden = json.loads(
        (project_root / "evals/synthetic-browser-flow/golden/browser-flow-state.json").read_text(encoding="utf-8")
    )
    db_path = temp_root / "synthetic-browser.sqlite3"
    upload_dir = temp_root / "uploads"
    backup_dir = temp_root / "backups"
    trash_dir = temp_root / "trash"
    log_dir = temp_root / "logs"
    for directory in (upload_dir, backup_dir, trash_dir, log_dir):
        directory.mkdir(parents=True, exist_ok=True)

    port = _reserve_local_port()
    base_url = f"http://127.0.0.1:{port}"
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
    username = f"synth_{secrets.token_hex(5)}"
    password = f"Synth-{secrets.token_urlsafe(18)}-9"
    server_log_path = temp_root / "server.log"
    process: subprocess.Popen[str] | None = None
    states: dict[str, dict[str, Any]] = {}
    export_payload: dict[str, Any] = {}
    portable_export_evidence: dict[str, Any] = {}
    portable_export_text = ""
    desktop_bytes = 0
    mobile_bytes = 0

    with server_log_path.open("w", encoding="utf-8", newline="\n") as server_log:
        try:
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
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
                creationflags=creationflags,
            )
            _wait_for_server(base_url, process)
            _register_synthetic_user(base_url, username, password)
            (
                states,
                export_payload,
                portable_export_evidence,
                portable_export_text,
                desktop_bytes,
                mobile_bytes,
            ) = _run_browser_flow(
                base_url=base_url,
                db_path=db_path,
                temp_root=temp_root,
                project_root=project_root,
                case=case,
                golden=golden,
                username=username,
                password=password,
            )
        finally:
            _stop_process(process)

    server_stopped = process is not None and process.poll() is not None
    server_stopped = server_stopped and not _port_is_open(port)

    export_text = json.dumps(export_payload, ensure_ascii=False)
    log_text = server_log_path.read_text(encoding="utf-8", errors="replace")
    sensitive_matches: list[str] = []
    private_root = "E:" + os.sep + "Personal"
    private_root_variants = {private_root, private_root.replace(os.sep, "/")}
    forbidden_export = {
        "file_path": "server file path field",
        str(db_path): "database path",
        str(upload_dir): "upload path",
        password: "test password",
    }
    for value, label in forbidden_export.items():
        if value and value in export_text:
            sensitive_matches.append(label)
    if any(value in export_text for value in private_root_variants):
        sensitive_matches.append("personal data root")
    if any(value in portable_export_text for value in private_root_variants):
        sensitive_matches.append("personal data root in portable health export")
    if password in portable_export_text:
        sensitive_matches.append("test password in portable health export")
    if password in log_text:
        sensitive_matches.append("test password in server log")
    if any(value in log_text for value in private_root_variants):
        sensitive_matches.append("personal data root in server log")
    if any(
        marker in log_text
        for marker in (
            "github_releases_fetched",
            "github_releases_fetch_failed",
            "api.github.com/repos",
        )
    ):
        sensitive_matches.append("remote release request during isolated test")

    return {
        "states": states,
        "desktop_screenshot_bytes": desktop_bytes,
        "mobile_screenshot_bytes": mobile_bytes,
        "portable_export": portable_export_evidence,
        "server_stopped": server_stopped,
        "sensitive_matches": sorted(set(sensitive_matches)),
    }
