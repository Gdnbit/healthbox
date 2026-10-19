"""Docs-only CI classification security regression tests (fabricated refs/paths)."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "healthbox-ci-scope.py"
spec = importlib.util.spec_from_file_location("healthbox_ci_scope", SCRIPT)
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class CiScopeTests(unittest.TestCase):
    def test_readme_is_fast(self):
        self.assertTrue(scope.only_existing_readmes([("M", "README.md")]))

    def test_bilingual_readmes_are_fast(self):
        self.assertTrue(scope.only_existing_readmes([("M", "README.md"), ("M", "README_EN.md")]))

    def test_legacy_chinese_readme_is_fast(self):
        self.assertTrue(scope.only_existing_readmes([("M", "README.zh-CN.md")]))

    def test_new_or_removed_document_must_get_full_checks(self):
        for status in ("A", "D", "R100"):
            self.assertFalse(scope.only_existing_readmes([(status, "README_EN.md")]))

    def test_unknown_or_no_changes_are_full(self):
        self.assertFalse(scope.only_existing_readmes(None))
        self.assertFalse(scope.only_existing_readmes([]))

    def test_security_and_packager_changes_are_full(self):
        for path in ("SECURITY.md", "PUBLIC_RELEASE_CHECKLIST.md",
                     "scripts/healthbox-package.py", "scripts/healthbox-privacy-check.py",
                     ".github/workflows/security.yml", "MODIFICATIONS.md"):
            with self.subTest(path=path):
                self.assertFalse(scope.only_existing_readmes([("M", path)]))

    def test_sensitive_business_or_dependencies_must_get_full_checks(self):
        for path in ("app/api/v1/endpoints/privacy_access.py",
                     "frontend/src/App.tsx", "requirements.txt",
                     "frontend/package-lock.json", "config/open-source-catalogs/test_library.json",
                     "docs/healthbox/PRIVACY_AND_AI.md"):
            with self.subTest(path=path):
                self.assertFalse(scope.only_existing_readmes([("M", "README.md"), ("M", path)]))

    def test_unknown_events_and_malformed_hashes_are_full(self):
        self.assertIsNone(scope.changed_paths("workflow_dispatch", "b"*40, "", "a"*40))
        self.assertIsNone(scope.changed_paths("push", "bad-sha", "a"*40, ""))
        self.assertIsNone(scope.changed_paths("push", "b"*40, "0"*40, ""))

    @patch.object(scope.subprocess, "run")
    def test_pr_compares_base_with_merge_head(self, git):
        git.side_effect = [
            subprocess.CompletedProcess([], 0, b"", b""),
            subprocess.CompletedProcess([], 0, b"M\0README.md\0", b""),
        ]
        self.assertEqual([("M", "README.md")],
                         scope.changed_paths("pull_request", "b"*40, "", "a"*40))
        self.assertEqual(git.call_args_list[1].args[0][-2:], ["a"*40, "b"*40])

    @patch.object(scope.subprocess, "run")
    def test_non_ancestor_or_force_push_runs_full(self, git):
        git.return_value = subprocess.CompletedProcess([], 1, b"", b"")
        self.assertIsNone(scope.changed_paths("push", "b"*40, "a"*40, ""))

    @patch.object(scope.subprocess, "run")
    def test_diff_failure_runs_full(self, git):
        git.side_effect = [
            subprocess.CompletedProcess([], 0, b"", b""),
            subprocess.CompletedProcess([], 1, b"", b"fatal"),
        ]
        self.assertIsNone(scope.changed_paths("pull_request", "b"*40, "", "a"*40))

    @patch.object(scope.subprocess, "run")
    def test_invalid_path_encoding_runs_full(self, git):
        git.side_effect = [
            subprocess.CompletedProcess([], 0, b"", b""),
            subprocess.CompletedProcess([], 0, b"M\0\xff\0", b""),
        ]
        self.assertIsNone(scope.changed_paths("pull_request", "b"*40, "", "a"*40))

    def test_file_must_be_an_existing_showcase_readme(self):
        self.assertFalse(scope.only_existing_readmes([("M", "docs/healthbox/ARCHITECTURE.md")]))
        self.assertFalse(scope.only_existing_readmes([("M", "README.md"), ("A", "docs/private.md")]))
