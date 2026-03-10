#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unified publish pipeline for saropa_drift_viewer.

Supports both the Dart package (pub.dev) and VS Code extension
(Marketplace / Open VSX) from a single entry point.

Usage:
    python scripts/publish.py dart               # Dart package pipeline
    python scripts/publish.py extension           # Extension pipeline
    python scripts/publish.py all                 # Both targets
    python scripts/publish.py dart --analyze-only # Analysis only (no publish)
    python scripts/publish.py dart --bump minor   # Bump minor before validation

Exit codes match the ExitCode enum in modules/constants.py.
"""

import argparse
import subprocess
import sys
from pathlib import Path

# Ensure the scripts/ directory is on sys.path so `from modules ...` works
# regardless of which directory the script is invoked from.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Ensure colorama is available so modules.constants can init it on Windows.
try:
    import colorama  # noqa: F401
except ImportError:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", "colorama", "-q"],
        check=False,
        capture_output=True,
    )

from modules.constants import C, ExitCode, REPO_ROOT, EXTENSION_DIR
from modules.display import (
    ask_yn, close_publish_log, dim, heading, info, open_publish_log, show_logo,
)


# ── CLI ──────────────────────────────────────────────────────

_CLI_FLAGS = [
    ("--analyze-only", "Run analysis + build + package only. No publish."),
    ("--yes", "Accept version without prompting (CI mode)."),
    ("--skip-tests", "Skip test steps."),
    ("--skip-extensions", "Skip VS Code extension checks."),
    ("--skip-global-npm", "Skip global npm package checks."),
    ("--auto-install", "Auto-install .vsix without prompting (CI)."),
    ("--no-logo", "Suppress the Saropa ASCII art logo."),
]


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Drift Viewer -- Unified Publish Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "target",
        choices=["dart", "extension", "all"],
        help="Which target to build/publish.",
    )
    parser.add_argument(
        "--bump",
        choices=["patch", "minor", "major"],
        default=None,
        help="Bump version before validation (patch, minor, or major).",
    )
    for flag, help_text in _CLI_FLAGS:
        parser.add_argument(flag, action="store_true", help=help_text)
    return parser.parse_args()


# ── Target Info ──────────────────────────────────────────────


def _read_banner_version(target: str) -> str:
    """Read the version to display in the banner (target-appropriate)."""
    if target == "extension":
        from modules.target_config import EXTENSION, read_version
        return read_version(EXTENSION)
    from modules.target_config import DART, read_version
    return read_version(DART)


def _print_target_info(target: str, version: str) -> None:
    """Print target and version info after the logo."""
    labels = {"dart": "Dart", "extension": "Extension", "all": "All Targets"}
    print(f"\n  {C.BOLD}{labels[target]} Pipeline{C.RESET}  {dim(f'v{version}')}")
    print(f"  Project root: {dim(REPO_ROOT)}")
    if target in ("extension", "all"):
        print(f"  Extension:    {dim(EXTENSION_DIR)}")


# ── Results ──────────────────────────────────────────────────


def _print_results(
    results: list[tuple[str, bool, float]],
    version: str,
    vsix_path: str | None = None,
) -> str | None:
    """Save report, print timing chart, return report path."""
    from modules.report import save_report, print_timing, print_report_path

    report = save_report(results, version or "unknown", vsix_path)
    print_timing(results)
    print_report_path(report)
    return report


# ── Exit Codes ───────────────────────────────────────────────

_STEP_EXIT_CODES = {
    # Shared
    "git": ExitCode.PREREQUISITE_FAILED,
    "GitHub CLI": ExitCode.PREREQUISITE_FAILED,
    "Working tree": ExitCode.WORKING_TREE_DIRTY,
    "Remote sync": ExitCode.REMOTE_SYNC_FAILED,
    "Git commit & push": ExitCode.GIT_FAILED,
    "Git tag": ExitCode.GIT_FAILED,
    "GitHub release": ExitCode.RELEASE_FAILED,
    # Dart
    "Dart SDK": ExitCode.PREREQUISITE_FAILED,
    "Flutter SDK": ExitCode.PREREQUISITE_FAILED,
    "Publish workflow": ExitCode.PREREQUISITE_FAILED,
    "Dart format": ExitCode.QUALITY_FAILED,
    "Dart tests": ExitCode.TEST_FAILED,
    "Dart analysis": ExitCode.QUALITY_FAILED,
    "Dart docs": ExitCode.QUALITY_FAILED,
    "Dart dry-run": ExitCode.QUALITY_FAILED,
    "Dart version": ExitCode.VERSION_INVALID,
    "pub.dev publish": ExitCode.PUBLISH_FAILED,
    # Extension
    "Node.js": ExitCode.PREREQUISITE_FAILED,
    "npm": ExitCode.PREREQUISITE_FAILED,
    "VS Code CLI": ExitCode.PREREQUISITE_FAILED,
    "vsce PAT": ExitCode.PREREQUISITE_FAILED,
    "Global npm pkgs": ExitCode.PREREQUISITE_FAILED,
    "VS Code extensions": ExitCode.PREREQUISITE_FAILED,
    "Dependencies": ExitCode.DEPENDENCY_FAILED,
    "Compile": ExitCode.COMPILE_FAILED,
    "Tests": ExitCode.TEST_FAILED,
    "File line limits": ExitCode.QUALITY_FAILED,
    "Version validation": ExitCode.VERSION_INVALID,
    "Package": ExitCode.PACKAGE_FAILED,
    "Marketplace publish": ExitCode.PUBLISH_FAILED,
    "Open VSX publish": ExitCode.OPENVSX_FAILED,
}


def _exit_code_from_results(
    results: list[tuple[str, bool, float]],
) -> int:
    """Derive exit code from the most recent failing step."""
    for name, passed, _ in reversed(results):
        if not passed:
            return _STEP_EXIT_CODES.get(name, 1)
    return 1


# ── Main ─────────────────────────────────────────────────────


def _run_analysis(args, target, results):
    """Run per-target analysis. Returns (dart_version, ext_version, vsix_path, ok)."""
    dart_version = ""
    ext_version = ""
    vsix_path = None

    if target in ("dart", "all"):
        from modules.pipeline import run_dart_analysis
        dart_version, dart_ok = run_dart_analysis(args, results)
        if not dart_ok:
            return dart_version, ext_version, vsix_path, False

    if target in ("extension", "all"):
        from modules.pipeline import run_ext_analysis, package_and_install
        ext_version, ext_ok = run_ext_analysis(args, results)
        if not ext_ok:
            return dart_version, ext_version, vsix_path, False
        vsix_path = package_and_install(args, results, ext_version)
        if not vsix_path:
            return dart_version, ext_version, vsix_path, False

    return dart_version, ext_version, vsix_path, True


def _confirm_dart_publish(version: str) -> bool:
    """Confirm Dart package publish."""
    print(f"\n  {C.BOLD}{C.YELLOW}Dart Publish Summary{C.RESET}")
    print(f"  {'-' * 40}")
    print(f"  Version: {C.WHITE}v{version}{C.RESET}")
    print(f"  Tag:     {C.WHITE}v{version}{C.RESET}")
    print(f"\n  {C.YELLOW}This will:{C.RESET}")
    print(f"    1. Commit and push to origin")
    print(f"    2. Create git tag v{version}")
    print(f"    3. Trigger GitHub Actions publish to pub.dev")
    print(f"    4. Create GitHub release")
    print(f"\n  {C.RED}These actions are irreversible.{C.RESET}")
    return ask_yn("Proceed with publish?", default=False)


def _run_publish(args, target, dart_version, ext_version, vsix_path, results):
    """Run per-target publish steps. Returns exit code or None on success."""
    if target in ("dart", "all"):
        heading("Publish Confirmation")
        if not _confirm_dart_publish(dart_version):
            info("Publish cancelled by user.")
            return ExitCode.USER_CANCELLED

    if target in ("extension", "all"):
        from modules.ext_publish import confirm_publish
        heading("Publish Confirmation")
        if not confirm_publish(ext_version):
            info("Publish cancelled by user.")
            return ExitCode.USER_CANCELLED

    if target in ("dart", "all"):
        from modules.dart_publish import run_dart_publish
        if not run_dart_publish(dart_version, results):
            _print_results(results, dart_version)
            return _exit_code_from_results(results)

    if target in ("extension", "all"):
        from modules.ext_publish import run_ext_publish
        if not run_ext_publish(ext_version, vsix_path, results):
            _print_results(results, ext_version, vsix_path)
            return _exit_code_from_results(results)

    return None


def main() -> int:
    """Unified entry point: logo -> log -> analyze -> package -> publish."""
    if "--no-logo" not in sys.argv:
        show_logo()
    open_publish_log()
    try:
        return _main_inner()
    finally:
        close_publish_log()


def _main_inner() -> int:
    """Parse args, run pipeline, return exit code."""
    args = parse_args()
    target = args.target
    version = _read_banner_version(target)
    results: list[tuple[str, bool, float]] = []

    _print_target_info(target, version)

    dart_ver, ext_ver, vsix_path, ok = _run_analysis(args, target, results)
    if not ok:
        _print_results(results, ext_ver or dart_ver, vsix_path)
        return _exit_code_from_results(results)

    if args.analyze_only:
        report = _print_results(results, ext_ver or dart_ver, vsix_path)
        if report and target in ("extension", "all"):
            from modules.ext_install import prompt_open_report
            prompt_open_report(report)
        return ExitCode.SUCCESS

    err = _run_publish(args, target, dart_ver, ext_ver, vsix_path, results)
    return err if err is not None else ExitCode.SUCCESS


if __name__ == "__main__":
    sys.exit(main())
