"""Fail-closed CI scope detector for HealthBox's *existing* presentation READMEs.

Privacy/source-distribution checks are mandatory for every change. This tool
only decides whether expensive app, dependency and container jobs are needed.
Unknown events/refs, new or deleted docs, and any mixed code change run full CI.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SHA = re.compile(r"^[0-9a-fA-F]{40}$")
PRESENTATION = frozenset({"README.md", "README_EN.md", "README.zh-CN.md"})


def only_existing_readmes(changes: list[tuple[str, str]] | None) -> bool:
    return bool(changes) and all(status == "M" and path in PRESENTATION for status, path in changes)


def changed_paths(event: str, head: str, before: str, pr_base: str,
                  cwd: Path = ROOT) -> list[tuple[str, str]] | None:
    if event not in {"pull_request", "push"} or not SHA.fullmatch(head):
        return None
    start = pr_base if event == "pull_request" else before
    if not SHA.fullmatch(start) or start == "0" * 40:
        return None
    try:
        ancestor = subprocess.run(
            ["git", "merge-base", "--is-ancestor", start, head],
            cwd=cwd, capture_output=True, check=False,
        )
        if ancestor.returncode != 0:
            return None
        diff = subprocess.run(
            ["git", "diff", "--no-renames", "--name-status", "-z", start, head],
            cwd=cwd, capture_output=True, check=False,
        )
        if diff.returncode != 0:
            return None
        tokens = diff.stdout.split(b"\0")
        if tokens and tokens[-1] == b"":
            tokens.pop()
        if len(tokens) % 2:
            return None
        return [(tokens[i].decode("ascii"), tokens[i + 1].decode("utf-8"))
                for i in range(0, len(tokens), 2)]
    except (OSError, subprocess.SubprocessError, UnicodeError, ValueError):
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event", required=True)
    parser.add_argument("--head", required=True)
    parser.add_argument("--before", default="")
    parser.add_argument("--pr-base", default="")
    parser.add_argument("--github-output", required=True)
    args = parser.parse_args()
    changes = changed_paths(args.event, args.head, args.before, args.pr_base)
    docs_only = only_existing_readmes(changes)
    print(f"HealthBox CI scope: {'PRESENTATION_ONLY' if docs_only else 'FULL'} "
          f"(changed files: {len(changes) if changes is not None else 'unknown'})")
    # One line; nothing about the health data/source is emitted.
    with Path(args.github_output).open("a", encoding="utf-8") as output:
        output.write(f"docs_only={'true' if docs_only else 'false'}\n")


if __name__ == "__main__":
    main()
