"""Create a source-only public candidate from an explicit path policy.

No old Git metadata, ignored runtime files, screenshots or unverified binaries
are copied. The destination must not exist. This tool does not publish anything.
"""
import argparse
import datetime
import hashlib
import json
import importlib.util
from pathlib import Path
import subprocess

ROOT_FILES = {
    ".dockerignore", ".gitattributes", ".gitignore", ".env.example",
    "LICENSE", "NOTICE", "ACKNOWLEDGEMENTS.md", "README.md", "README_EN.md", "README.zh-CN.md",
    "SECURITY.md", "CONTRIBUTING.md", "PUBLIC_RELEASE_CHECKLIST.md",
    "ROADMAP.md", "CHANGELOG.md", "CODE_OF_CONDUCT.md", "SUPPORT.md",
    "MODIFICATIONS.md", "UPSTREAM_PROVENANCE.json",
    "compose.healthbox.yml", "alembic.ini", "conftest.py", "pyproject.toml",
    "pytest.ini", "requirements.txt", "requirements-e2e.txt", "run.py",
}
SOURCE_ROOTS = {"app", "alembic", "shared", "tests", "evals", "frontend", "config"}
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".gz", ".ttf", ".woff", ".woff2", ".db", ".sqlite", ".sqlite3", ".pyd"}
SVG_ALLOWLIST = {"frontend/public/healthbox-icon.svg", "frontend/public/assets/prototype/demo-avatar.svg"}
CATALOG_REPLACEMENTS = {
    "shared/data/" + name: "config/open-source-catalogs/" + name
    for name in ("test_library.json", "panel_library.json", "vaccine_library.json")
}

def approved(path):
    parts = path.parts
    name = path.as_posix()
    if name == ".github/FUNDING.yml":
        return False
    if any(p in {".git", "node_modules", "build", "dist", "__pycache__", "uploads", "backups", "logs", ".ai"} for p in parts):
        return False
    if path.name.startswith(".env") and not path.name.endswith(".example"):
        return False
    if path.suffix.lower() in BINARY_SUFFIXES:
        return False
    if path.suffix.lower() == ".svg" and name not in SVG_ALLOWLIST:
        return False
    if name in ROOT_FILES:
        return True
    if name.startswith("docs/healthbox/"):
        return path.suffix == ".md"
    if name.startswith(".github/"):
        return path.suffix in {".yml", ".yaml", ".md"}
    if name.startswith("scripts/healthbox-") or name == "scripts/validate_test_library.py":
        return path.suffix in {".py", ".sh"}
    if name in {"docker/Dockerfile", "docker/entrypoint.sh"}:
        return True
    return bool(parts and parts[0] in SOURCE_ROOTS and not (parts[0] == "frontend" and path.suffix == ".md"))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("healthbox_notices", root / "scripts" / "healthbox-notices.py")
    notices = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(notices)
    provenance = json.loads((root / "UPSTREAM_PROVENANCE.json").read_text(encoding="utf-8"))
    if provenance.get("schema_version") != 1:
        parser.error("unreviewed upstream provenance schema")
    destination = args.destination.resolve()
    if destination.exists() or destination == root or root in destination.parents:
        parser.error("destination must be a new directory outside the source checkout")
    if args.manifest.resolve() == destination or destination in args.manifest.resolve().parents:
        parser.error("the private manifest must be outside the candidate")
    if args.manifest.exists():
        parser.error("refusing to overwrite an existing manifest")
    # Git enumerates tracked and new source files; ignored runtime content is never read.
    raw = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root)
    paths = {p.decode("utf-8") for p in raw.split(b"\0") if p}
    # Packaging script may be ignored by inherited private-repository rules.
    paths.add("scripts/healthbox-package.py")
    copied, excluded = [], []
    destination.mkdir(parents=True)
    for value in sorted(paths):
        if value == "MODIFICATIONS.md":
            continue  # Generated from this exact distribution, never copied stale.
        path = Path(value)
        source_path = CATALOG_REPLACEMENTS.get(value, value)
        source = root / source_path
        if not source.is_file() or not approved(path):
            excluded.append(value)
            continue
        if source.is_symlink() or root not in source.resolve().parents:
            raise RuntimeError(f"Refusing symbolic/out-of-tree source: {value}")
        content = source.read_bytes()
        if b"\0" in content:
            raise RuntimeError(f"Unapproved binary content: {value}")
        source_digest = hashlib.sha256(content).hexdigest()
        baseline = provenance["normalized_sha256"].get(value)
        status = "added" if baseline is None else "unchanged" if notices.normalized_hash(content) == baseline else "modified"
        if status == "modified":
            content, _ = notices.annotate(value, content)
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        # No copy2: do not carry source file timestamps/extended metadata.
        target.write_bytes(content)
        entry = {"path": value, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest(),
                 "source_sha256": source_digest, "upstream_status": status,
                 "notice_applied": status == "modified"}
        if source_path != value:
            entry["source_path"] = source_path
            entry["policy"] = "original_minimal_catalog"
        copied.append(entry)
    index_entry = {"path": "MODIFICATIONS.md", "generated": "modifications_index", "upstream_status": "added"}
    copied.append(index_entry)
    index = notices.render_modifications(copied, provenance)
    (destination / "MODIFICATIONS.md").write_bytes(index)
    index_entry.update(bytes=len(index), sha256=hashlib.sha256(index).hexdigest())
    copied.sort(key=lambda entry: entry["path"])
    manifest = {"observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "base_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip(),
                "implementation_dirty": bool(subprocess.check_output(["git", "status", "--porcelain"], cwd=root)),
                "files": copied, "excluded_paths": excluded,
                "old_git_metadata_copied": False,
                "catalog_policy": "original_minimal_catalogs_no_inherited_reference_dataset"}
    manifest["public_upstream_commit"] = provenance["upstream_commit"]
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"copied": len(copied), "excluded": len(excluded), "old_git_metadata_copied": False}))

if __name__ == "__main__":
    main()
