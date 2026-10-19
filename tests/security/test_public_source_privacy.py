"""Source-boundary tests use only fabricated content and no application database."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "healthbox-privacy-check.py"
spec = importlib.util.spec_from_file_location("healthbox_source_privacy", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SourcePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / "candidate"
        self.root.mkdir()

    def write(self, relative, value=b"synthetic"):
        file = self.root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)
        return file

    def test_clean_source_and_blank_example_are_allowed(self):
        self.write("README.md", b"# Synthetic source\n")
        self.write(".env.example", b"SECRET_KEY=\n")
        self.assertTrue(gate.scan(self.root)["passed"])

    def test_runtime_files_and_secrets_are_blocked(self):
        for name in (".env", ".env.production", "records.db", "report.pdf", ".coverage", "bundle.js.map"):
            with self.subTest(name=name):
                file = self.write(name)
                self.assertFalse(gate.scan(self.root)["passed"])
                file.unlink()

    def test_private_directories_are_not_read(self):
        self.write(".git/config")
        result = gate.scan(self.root)
        self.assertFalse(result["passed"])
        self.assertEqual(result["files_scanned"], 0)

    def test_git_worktree_pointer_is_blocked(self):
        self.write(".git", b"gitdir: ../private-history")
        self.assertIn("git_pointer_file", gate.scan(self.root)["categories"])

    def test_secret_examples_must_be_blank(self):
        self.write(".env.example", b"ADMIN_DEFAULT_PASSWORD=fabricated-example\n")
        self.assertIn("nonblank_secret_example", gate.scan(self.root)["categories"])

    def test_private_directory_case_is_ignored(self):
        self.write(".SSH/config")
        self.assertIn("private_or_generated_directory", gate.scan(self.root)["categories"])

    def test_binary_or_unknown_encoding_is_blocked(self):
        self.write("app/source.py", b"\0private")
        self.assertFalse(gate.scan(self.root)["passed"])
        self.write("app/source.py", b"\xff\xfe")
        self.assertEqual(gate.scan(self.root)["findings"][0]["category"], "unreviewed_encoding")

    def test_owner_patterns_detect_content_without_echo(self):
        marker = "household-owner.example"
        self.write("app/source.py", marker.encode())
        result = gate.scan(self.root, [r"household-owner\.example"])
        self.assertFalse(result["passed"])
        self.assertNotIn(marker, json.dumps(result))
        self.assertEqual(result["findings"][0]["line"], 1)

    def test_owner_paths_are_redacted(self):
        self.write("household-owner.example/data.txt")
        result = gate.scan(self.root, [r"household-owner\.example"])
        self.assertNotIn("household-owner.example", json.dumps(result))
        self.assertFalse(result["passed"])

    def test_private_key_material_is_blocked(self):
        key_header = "-----BEGIN " + "PRIVATE KEY-----"
        self.write("app/secret.txt", key_header.encode())
        self.assertIn("private_key_material", gate.scan(self.root)["categories"])

    def test_unreviewed_svg_is_blocked(self):
        self.write("frontend/public/unknown.svg", b"<svg/>")
        self.assertIn("unreviewed_svg", gate.scan(self.root)["categories"])

    def test_cli_rejects_report_inside_candidate(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), "--report", str(self.root / "scan.json")],
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / "scan.json").exists())

    def test_cli_rejects_private_patterns_inside_candidate(self):
        private = self.write("private-patterns.json", b'["fabricated-owner"]')
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), "--report", str(self.base / "scan.json"),
             "--private-patterns", str(private)],
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.base / "scan.json").exists())

    def test_cli_saves_report_outside_candidate(self):
        self.write("README.md")
        report = self.base / "scan.json"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.root), "--report", str(report)],
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertTrue(json.loads(report.read_text())["passed"])


if __name__ == "__main__":
    unittest.main()
