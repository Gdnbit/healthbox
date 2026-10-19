"""Deterministic distribution notices; preserves source bytes outside insertions."""
import hashlib
import json
from pathlib import Path

NOTICE = "Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md."
JSON_KEY = "x-healthbox-modification-notice"


def normalized_hash(content):
    return hashlib.sha256(content.replace(b"\r\n", b"\n")).hexdigest()


def annotate(path, content):
    """Return (annotated bytes, exact inserted bytes); never reserialize source."""
    bom = b"\xef\xbb\xbf" if content.startswith(b"\xef\xbb\xbf") else b""
    body = content[len(bom):]
    body.decode("utf-8")
    eol = b"\r\n" if b"\r\n" in body else b"\n"
    suffix = Path(path).suffix.lower()
    if path == "LICENSE":
        # Keep the canonical license machine-readable; its replacement notice
        # and upstream attribution live in NOTICE and the modification index.
        return content, b""
    elif suffix == ".json" and Path(path).name not in {"tsconfig.json", "jsconfig.json"}:
        data = json.loads(body)
        if not isinstance(data, dict):
            raise ValueError("Cannot attach an object notice to a non-object JSON file")
        if JSON_KEY in data:
            if data[JSON_KEY] != NOTICE:
                raise ValueError("Existing modification notice must be reviewed")
            return content, b""
        offset = body.index(b"{") + 1
        block = eol + b'  "' + JSON_KEY.encode() + b'": ' + json.dumps(NOTICE).encode() + (b"," if data else b"")
    else:
        if suffix in {".js", ".jsx", ".ts", ".tsx", ".mts", ".json"}:
            line = "// " + NOTICE
        elif suffix == ".css":
            line = "/* " + NOTICE + " */"
        elif suffix in {".html", ".md", ".svg"}:
            line = "<!-- " + NOTICE + " -->"
        elif suffix in {".py", ".sh", ".yml", ".yaml", ".ini", ".conf", ".toml", ".txt"} or Path(path).name in {
            ".dockerignore", ".gitattributes", ".gitignore", "Dockerfile",
        }:
            line = "# " + NOTICE
        else:
            raise ValueError("Unreviewed notice format: " + path)
        block = line.encode() + eol
        offset = 0
        lines = body.splitlines(keepends=True)
        if lines and (lines[0].startswith(b"#!") or lines[0].startswith(b"# syntax=")
                      or lines[0].lower().startswith(b"<!doctype")
                      or lines[0].startswith(b"@charset")):
            offset = len(lines[0])
        if suffix == ".py":
            for index, first_line in enumerate(lines[:2]):
                if b"coding" in first_line and first_line.lstrip().startswith(b"#"):
                    offset = max(offset, sum(len(x) for x in lines[:index + 1]))
        if suffix == ".md" and lines and lines[0].strip() == b"---":
            for index in range(1, len(lines)):
                if lines[index].strip() == b"---":
                    offset = sum(len(x) for x in lines[:index + 1])
                    break
    if offset == len(body) and offset and not body.endswith((b"\n", b"\r")):
        block = eol + block
    if block in body:
        return content, b""
    annotated = bom + body[:offset] + block + body[offset:]
    if annotated.replace(block, b"", 1) != content:
        raise ValueError("Notice insertion did not preserve source bytes")
    return annotated, block


def render_modifications(entries, provenance):
    changed = sorted(e["path"] for e in entries if e.get("upstream_status") == "modified")
    added = sorted(e["path"] for e in entries if e.get("upstream_status") == "added")
    lines = [
        "# HealthBox distribution modifications", "",
        "Upstream: MediKeep v0.68.0, Apache-2.0.",
        "Public upstream commit: " + provenance["upstream_commit"] + ".", "",
        "This is a derivative distribution, not a claim of sole authorship.",
        "Applicable upstream copyright and attribution remain in source and NOTICE.",
        "Changed inherited files carry format-appropriate in-file notices.",
        "JSON notices are an additional top-level metadata string; existing data is not rewritten.",
        "LICENSE contains the unmodified Apache-2.0 text; its replacement notice is in NOTICE.",
        "Line-ending-only differences are excluded from the content-change classification.", "",
        "Public starter catalogs replace inherited reference payloads; they contain no standard codes.",
        "Generated/added HealthBox files are listed separately. This index contains no private",
        "commit history, Git author identity, filesystem locations or runtime data.", "",
        "## Modified inherited files (" + str(len(changed)) + ")", "",
        *["- " + path for path in changed], "",
        "## Added distribution files (" + str(len(added)) + ")", "",
        *["- " + path for path in added], "",
    ]
    return "\n".join(lines).encode("utf-8")
