# -*- coding: utf-8 -*-
"""Unit tests for check_stale_overrides script.

Tests parsing and classification logic; run() and command_exists() are mocked.
"""

from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

# Allow importing the script's module (script lives in parent of tests/)
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from check_stale_overrides import (
    _find_dependency_overrides_section,
    _pubspec_without_override,
    check_stale_overrides,
)


class TestFindDependencyOverridesSection(unittest.TestCase):
    """Tests for _find_dependency_overrides_section."""

    def test_empty_content(self) -> None:
        self.assertEqual(_find_dependency_overrides_section(""), [])

    def test_no_dependency_overrides(self) -> None:
        content = "name: foo\ndependencies:\n  bar: ^1.0.0\n"
        self.assertEqual(_find_dependency_overrides_section(content), [])

    def test_single_override(self) -> None:
        content = "dependency_overrides:\n  analyzer: ^10.0.0\n"
        result = _find_dependency_overrides_section(content)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "analyzer")
        self.assertEqual(result[0][1], "^10.0.0")
        self.assertEqual(result[0][2], "  analyzer: ^10.0.0")

    def test_multiple_overrides(self) -> None:
        content = (
            "dependency_overrides:\n"
            "  analyzer: ^10.0.0\n"
            "  dart_style: ^3.1.6\n"
        )
        result = _find_dependency_overrides_section(content)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0][0], "analyzer")
        self.assertEqual(result[1][0], "dart_style")

    def test_section_ends_at_next_top_level_key(self) -> None:
        content = (
            "dependency_overrides:\n"
            "  foo: ^1.0\n"
            "name: my_app\n"
        )
        result = _find_dependency_overrides_section(content)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0][0], "foo")


class TestPubspecWithoutOverride(unittest.TestCase):
    """Tests for _pubspec_without_override."""

    def test_removes_exact_line(self) -> None:
        content = "a\n  pkg: ^1.0\nb\n"
        out = _pubspec_without_override(content, "  pkg: ^1.0")
        self.assertEqual(out, "a\nb\n")

    def test_preserves_trailing_newline(self) -> None:
        content = "a\n  pkg: ^1.0\n"
        out = _pubspec_without_override(content, "  pkg: ^1.0")
        self.assertTrue(out.endswith("\n"))


class TestCheckStaleOverrides(unittest.TestCase):
    """Tests for check_stale_overrides with mocked run and command_exists."""

    def test_classifies_required_and_stale_by_solve_result(self) -> None:
        """First override required (solve fails), second stale (solve succeeds)."""
        import tempfile
        content = (
            "name: test\n"
            "dependency_overrides:\n"
            "  analyzer: ^10.0.0\n"
            "  dart_style: ^3.1.6\n"
        )
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write(content)
            path = Path(f.name)
        try:
            with (
                patch("check_stale_overrides.run") as mock_run,
                patch("check_stale_overrides.command_exists", return_value=True),
            ):
                # First call (without analyzer): fail. Second call (without dart_style): succeed.
                mock_run.side_effect = [
                    SimpleNamespace(returncode=1),
                    SimpleNamespace(returncode=0),
                ]
                required, stale, err = check_stale_overrides(path, False, dry_run=False)
                self.assertIsNone(err)
                self.assertEqual(required, ["analyzer"])
                self.assertEqual(stale, ["dart_style"])
        finally:
            path.unlink(missing_ok=True)

    def test_classifies_stale_when_solve_succeeds(self) -> None:
        """Override is stale if pub get succeeds without it."""
        import tempfile
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("dependency_overrides:\n  foo: ^1.0\n")
            path = Path(f.name)
        try:
            with (
                patch("check_stale_overrides.run") as mock_run,
                patch("check_stale_overrides.command_exists", return_value=True),
            ):
                mock_run.return_value.returncode = 0
                required, stale, err = check_stale_overrides(path, False, dry_run=False)
                self.assertIsNone(err)
                self.assertEqual(required, [])
                self.assertEqual(stale, ["foo"])
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
