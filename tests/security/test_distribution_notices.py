"""Distribution notice correctness without importing the application."""
import ast
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("distribution_notices", ROOT / "scripts" / "healthbox-notices.py")
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class NoticeTests(unittest.TestCase):
    def check_preserved(self, path, source):
        output, inserted = notices.annotate(path, source)
        self.assertTrue(inserted)
        self.assertEqual(output.replace(inserted, b"", 1), source)
        self.assertEqual(notices.annotate(path, output)[0], output)
        return output

    def test_python_docstring_future_and_shebang_survive(self):
        source = b'#!/usr/bin/env python\n# coding: utf-8\n"""Module."""\nfrom __future__ import annotations\nvalue = 1\n'
        output = self.check_preserved("app/source.py", source)
        self.assertTrue(output.startswith(b"#!/usr/bin/env python\n# coding: utf-8\n"))
        self.assertEqual(ast.dump(ast.parse(source)), ast.dump(ast.parse(output)))

    def test_bom_and_crlf_survive(self):
        source = b'\xef\xbb\xbf"""Synthetic."""\r\nvalue = 1\r\n'
        output = self.check_preserved("app/source.py", source)
        self.assertTrue(output.startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\n", output.replace(b"\r\n", b""))
        self.assertEqual(ast.dump(ast.parse(source)), ast.dump(ast.parse(output)))

    def test_json_metadata_changes_no_existing_value(self):
        for source in (b'{}', b'{\r\n  "name": "synthetic", "values": [1,2]\r\n}'):
            with self.subTest(source=source):
                output = self.check_preserved("frontend/package-lock.json", source)
                decoded = json.loads(output)
                self.assertEqual(decoded.pop(notices.JSON_KEY), notices.NOTICE)
                self.assertEqual(decoded, json.loads(source))

    def test_jsonc_uses_comment_not_schema_property(self):
        output = self.check_preserved("frontend/tsconfig.json", b'{\n// options\n"compilerOptions":{}\n}')
        self.assertTrue(output.startswith(b"// "))
        self.assertNotIn(notices.JSON_KEY.encode(), output)

    def test_nonobject_json_requires_explicit_review(self):
        with self.assertRaises(ValueError):
            notices.annotate("data.json", b"[]")

    def test_unknown_format_fails_closed(self):
        with self.assertRaises(ValueError):
            notices.annotate("file.unknown", b"synthetic")

    def test_html_doctype_stays_first(self):
        output = self.check_preserved("frontend/index.html", b'<!doctype html>\n<html></html>\n')
        self.assertTrue(output.startswith(b"<!doctype html>\n<!-- "))

    def test_css_charset_stays_first(self):
        output = self.check_preserved("frontend/source.css", b'@charset "UTF-8";\nbody { color: red; }\n')
        self.assertTrue(output.startswith(b'@charset "UTF-8";\n/* '))

    def test_markdown_frontmatter_stays_first(self):
        output = self.check_preserved("README.md", b"---\ntitle: synthetic\n---\n# Title\n")
        self.assertTrue(output.startswith(b"---\ntitle: synthetic\n---\n<!-- "))

    def test_shell_directive_and_formats(self):
        for path, source in (
            ("docker/Dockerfile", b"# syntax=docker/dockerfile:1\nFROM example\n"),
            ("docker/entrypoint.sh", b"#!/bin/sh\necho synthetic\n"),
            ("frontend/source.tsx", b"export const value = 1;\n"),
            ("requirements.txt", b"example-package==1\n"),
            (".gitignore", b"uploads/\n"),
        ):
            with self.subTest(path=path):
                self.check_preserved(path, source)

    def test_license_body_is_unchanged(self):
        source = b"Apache License\nVersion 2.0\n"
        output = self.check_preserved("LICENSE", source)
        self.assertTrue(output.endswith(source))

    def test_conflicting_json_notice_is_not_overwritten(self):
        with self.assertRaises(ValueError):
            notices.annotate("data.json", json.dumps({notices.JSON_KEY:"different"}).encode())


if __name__ == "__main__":
    unittest.main()
