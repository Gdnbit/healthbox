"""Offline source-snapshot privacy gate. Never prints matched content.

Run on a source-only candidate, not a working instance. An optional external
JSON array of owner-specific regular expressions stays outside the candidate.
This complements (does not replace) Gitleaks and manual fixture review.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re

PRIVATE_DIRS = {
    ".git", ".ai", ".codex", ".agents", "handoff", "uploads", "backups", "logs",
    "node_modules", "__pycache__", ".pytest_cache", ".venv", "venv", "build", "dist",
    ".release-private", ".healthbox-local", ".ssh", ".aws", ".kube", ".gnupg",
}
PRIVATE_SUFFIXES = {
    ".db", ".sqlite", ".sqlite3", ".log", ".pem", ".key", ".p12", ".pfx",
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".heic", ".docx",
    ".zip", ".gz", ".7z", ".pyc", ".map", ".ttf", ".woff", ".woff2",
}
SVG_ALLOWLIST = {
    "frontend/public/healthbox-icon.svg",
    "frontend/public/assets/prototype/demo-avatar.svg",
}
PRIVATE_KEY = re.compile(r"^-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", re.M)


def scan(root, owner_patterns=()):
    root = Path(root).absolute()
    if root.is_symlink() or root.is_junction() or not root.is_dir():
        raise ValueError("A real source directory is required")
    root = root.resolve()
    patterns = [re.compile(pattern, re.I) for pattern in owner_patterns]
    findings = []
    files_scanned = 0

    def add(path, category, line=None):
        label = path.relative_to(root).as_posix()
        if any(pattern.search(label) for pattern in patterns):
            label = "<redacted-path>"
        item = {"path": label, "category": category}
        if line is not None:
            item["line"] = line
        findings.append(item)

    for folder, directories, files in os.walk(root, followlinks=False):
        for name in list(directories):
            path = Path(folder) / name
            if path.is_symlink() or path.is_junction():
                add(path, "link_or_junction")
                directories.remove(name)
            elif name.lower() in PRIVATE_DIRS:
                add(path, "private_or_generated_directory")
                directories.remove(name)
            elif any(pattern.search(path.relative_to(root).as_posix()) for pattern in patterns):
                add(path, "owner_identifier_in_path")
        for name in files:
            path = Path(folder) / name
            relative = path.relative_to(root).as_posix()
            if path.is_symlink():
                add(path, "link_or_junction")
                continue
            if name.lower() == ".git":
                add(path, "git_pointer_file")
                continue
            if name.startswith(".env") and name != ".env.example":
                add(path, "environment_file")
                continue
            if (path.suffix.lower() in PRIVATE_SUFFIXES or name.startswith(".coverage")
                    or "-wal" in name or "-shm" in name):
                add(path, "runtime_or_unreviewed_binary")
                continue
            if path.suffix.lower() == ".svg" and relative not in SVG_ALLOWLIST:
                add(path, "unreviewed_svg")
                continue
            if any(pattern.search(relative) for pattern in patterns):
                add(path, "owner_identifier_in_path")
            content = path.read_bytes()
            files_scanned += 1
            if b"\0" in content:
                add(path, "binary_content")
                continue
            try:
                text = content.decode("utf-8-sig")
            except UnicodeDecodeError:
                add(path, "unreviewed_encoding")
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if any(pattern.search(line) for pattern in patterns):
                    add(path, "owner_identifier_in_content", number)
                if name == ".env.example" and "=" in line and not line.lstrip().startswith("#"):
                    key, value = line.split("=", 1)
                    if key.strip().upper().endswith(("PASSWORD", "SECRET_KEY", "API_KEY", "TOKEN", "PRIVATE_KEY")):
                        if value.strip().strip("'\""):
                            add(path, "nonblank_secret_example", number)
            if PRIVATE_KEY.search(text):
                add(path, "private_key_material")
    return {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "files_scanned": files_scanned,
        "owner_patterns_applied": bool(patterns),
        "passed": not findings,
        "categories": dict(Counter(item["category"] for item in findings)),
        "findings": findings,
        "limitations": "No semantic guarantee; review synthetic data and run a dedicated secret scanner separately.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--private-patterns", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.absolute()
    report = args.report.resolve()
    if root.is_symlink() or root.is_junction():
        parser.error("The candidate root cannot be a link or junction")
    if report == root.resolve() or root.resolve() in report.parents:
        parser.error("Store reports outside the candidate")
    patterns = []
    if args.private_patterns:
        private = args.private_patterns.resolve()
        if root.resolve() in private.parents:
            parser.error("Owner-specific patterns must remain outside the candidate")
        patterns = json.loads(private.read_text(encoding="utf-8"))
        if not isinstance(patterns, list) or not all(isinstance(p, str) and p for p in patterns):
            parser.error("Expected a non-empty-string regex array")
        try:
            for pattern in patterns:
                re.compile(pattern)
        except re.error:
            parser.error("An owner pattern is invalid; pattern value suppressed")
    result = scan(root, patterns)
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key not in {"findings", "limitations"}}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
