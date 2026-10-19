"""Isolated browser acceptance for the household health storage MVP."""

import json
import os
from pathlib import Path

import pytest

from tests.e2e.synthetic_browser_harness import run_synthetic_browser_flow

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.slow,
    pytest.mark.skipif(
        os.environ.get("RUN_SYNTHETIC_BROWSER_E2E") != "1",
        reason=("Set RUN_SYNTHETIC_BROWSER_E2E=1 to run the isolated Playwright flow"),
    ),
]


def test_household_health_source_to_rollback_flow(tmp_path: Path) -> None:
    """Exercise source → review → commit → visualization → export → rollback."""
    project_root = Path(__file__).resolve().parents[2]
    case = json.loads(
        (project_root / "evals/synthetic-browser-flow/cases/browser-flow.json").read_text(encoding="utf-8")
    )
    golden = json.loads(
        (project_root / "evals/synthetic-browser-flow/golden/browser-flow-state.json").read_text(encoding="utf-8")
    )

    result = run_synthetic_browser_flow(
        project_root=project_root,
        temp_root=tmp_path,
        case=case,
    )

    assert result["states"] == golden
    assert result["desktop_screenshot_bytes"] > 0
    assert result["mobile_screenshot_bytes"] > 0
    assert result["portable_export"]["svg_bytes"] > 0
    assert result["portable_export"]["csv_bytes"] > 0
    assert result["portable_export"]["svg_filename_safe"] is True
    assert result["portable_export"]["csv_filename_safe"] is True
    assert result["portable_export"]["print_calls"] == 1
    assert result["portable_export"]["database_unchanged"] is True
    assert result["portable_export"]["visualization_context_verified"] is True
    assert result["portable_export"]["source_deep_link_verified"] is True
    assert result["portable_export"]["record_deep_link_verified"] is True
    assert result["portable_export"]["exam_comparison_verified"] is True
    assert result["portable_export"]["annual_coverage_verified"] is True
    assert result["portable_export"]["coverage_evidence_lifecycle_verified"] is True
    assert result["portable_export"]["coverage_history_export_verified"] is True
    assert result["portable_export"]["vital"]["svg_bytes"] > 0
    assert result["portable_export"]["vital"]["csv_bytes"] > 0
    assert result["portable_export"]["vital"]["svg_filename_safe"] is True
    assert result["portable_export"]["vital"]["csv_filename_safe"] is True
    assert result["portable_export"]["vital"]["print_calls"] == 1
    assert result["portable_export"]["vital"]["database_unchanged"] is True
    assert result["portable_export"]["vital"]["visualization_context_verified"] is True
    assert result["portable_export"]["vital"]["record_deep_link_verified"] is True
    assert result["portable_export"]["vital"]["mobile_screenshot_bytes"] > 0
    assert result["server_stopped"] is True
    assert result["sensitive_matches"] == []
