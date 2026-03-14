#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check which dependency_overrides are required vs stale (safe to remove).

Implements the fix for the "stale override" false positive: before reporting
an override as stale, we run a version solve with that override removed.
If the solve fails, the override is required and must not be reported as stale.

See: bugs/history/20260313/stale_override_false_positive.md

Usage:
    python scripts/check_stale_overrides.py [--pubspec PATH] [--flutter] [--dry-run]
    python scripts/check_stale_overrides.py   # uses repo pubspec.yaml, auto-detects dart vs flutter

Exit code: 0 on success; 1 on error (e.g. missing pubspec, dart/flutter not found).
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

# Ensure scripts/ is on path for modules
sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import colorama  # noqa: F401
except ImportError:
    pass

from modules.constants import C, REPO_ROOT
from modules.display import fail, info, ok, warn
from modules.utils import command_exists, run


def _find_dependency_overrides_section(content: str) -> list[tuple[str, str, str]]:
    """Parse dependency_overrides from pubspec content.

    Returns list of (package_name, version, full_line) for each override.
    Uses line-based parsing to avoid a YAML dependency.
    """
    lines = content.splitlines()
    result: list[tuple[str, str, str]] = []
    in_section = False
    for line in lines:
        stripped = line.strip()
        if stripped == "dependency_overrides:":
            in_section = True
            continue
        if not in_section:
            continue
        # Next top-level key (no leading space) ends the section
        if line and not line.startswith((" ", "\t")):
            break
        # Indented line: "  package_name: version"
        match = re.match(r"^(\s+)(\S+):\s*(.*)$", line)
        if match:
            indent, name, value = match.groups()
            result.append((name, value.strip(), line))
    return result


def _pubspec_without_override(content: str, line_to_remove: str) -> str:
    """Return pubspec content with the given override line removed.

    Removes exactly one line. If that was the only override, the
    dependency_overrides section may be left empty (pub accepts that).
    """
    lines = content.splitlines()
    out = []
    for line in lines:
        if line == line_to_remove:
            continue
        out.append(line)
    return "\n".join(out) + ("\n" if content.endswith("\n") else "")


def _uses_flutter(pubspec_path: Path) -> bool:
    """Heuristic: project uses Flutter if 'flutter' appears in environment or dependencies."""
    try:
        text = pubspec_path.read_text(encoding="utf-8")
    except OSError:
        return False
    return "flutter:" in text or "sdk: flutter" in text.lower()


def check_stale_overrides(
    pubspec_path: Path,
    use_flutter: bool | None,
    dry_run: bool,
) -> tuple[list[str], list[str], str | None]:
    """Run version solve with each override removed.

    Returns (required_list, stale_list, error_message).
    If error_message is not None, the run failed (e.g. missing tool or unreadable pubspec).
    """
    try:
        content = pubspec_path.read_text(encoding="utf-8")
    except OSError as e:
        fail(f"Cannot read pubspec: {pubspec_path} — {e}")
        return ([], [], f"Cannot read pubspec: {e}")

    overrides = _find_dependency_overrides_section(content)
    if not overrides:
        info("No dependency_overrides found in pubspec.")
        return ([], [], None)

    use_flutter_cmd = use_flutter if use_flutter is not None else _uses_flutter(pubspec_path)
    cmd = ["flutter", "pub", "get"] if use_flutter_cmd else ["dart", "pub", "get"]
    if use_flutter_cmd and not command_exists("flutter"):
        fail("flutter not found; use --no-flutter for pure Dart projects.")
        return ([], [], "flutter not found")
    if not use_flutter_cmd and not command_exists("dart"):
        fail("dart not found.")
        return ([], [], "dart not found")

    cwd = str(pubspec_path.parent)
    required: list[str] = []
    stale: list[str] = []
    total = len(overrides)

    for idx, (name, version, full_line) in enumerate(overrides, start=1):
        if dry_run:
            info(f"[dry-run] Would test override: {name} {version}")
            continue
        info(f"Testing override {idx}/{total}: {name} …")
        modified = _pubspec_without_override(content, full_line)
        try:
            pubspec_path.write_text(modified, encoding="utf-8")
            result = run(cmd, cwd=cwd, check=False)
            if result.returncode != 0:
                required.append(name)
            else:
                stale.append(name)
        finally:
            # Restore original pubspec so the next iteration or caller sees correct state
            pubspec_path.write_text(content, encoding="utf-8")

    return (required, stale, None)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check which dependency_overrides are required (version solve fails without them) vs stale (safe to remove).",
    )
    parser.add_argument(
        "--pubspec",
        type=Path,
        default=Path(REPO_ROOT) / "pubspec.yaml",
        help="Path to pubspec.yaml (default: repo root)",
    )
    parser.add_argument(
        "--flutter",
        action="store_true",
        help="Use 'flutter pub get' (default: auto-detect from pubspec)",
    )
    parser.add_argument(
        "--no-flutter",
        action="store_true",
        help="Use 'dart pub get' even if pubspec mentions Flutter",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only list overrides, do not run version solve",
    )
    args = parser.parse_args()

    use_flutter = None
    if args.flutter:
        use_flutter = True
    if args.no_flutter:
        use_flutter = False

    info(f"Pubspec: {args.pubspec}")
    required, stale, err = check_stale_overrides(args.pubspec, use_flutter, args.dry_run)

    if err is not None:
        return 1
    if args.dry_run:
        return 0
    if not required and not stale:
        return 0

    print()
    for pkg in required:
        ok(f"Required (do not remove): {C.WHITE}{pkg}{C.RESET}")
    for pkg in stale:
        warn(f"Stale (safe to remove): {C.WHITE}{pkg}{C.RESET}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
