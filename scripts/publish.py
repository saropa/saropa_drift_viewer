#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Unified publish pipeline for saropa_drift_advisor.

Supports both the Dart package (pub.dev) and VS Code extension
(Marketplace / Open VSX) from a single entry point.

Usage:
    python scripts/publish.py                     # Interactive menu
    python scripts/publish.py all                 # Full pipeline (Dart + Extension)
    python scripts/publish.py dart                # Dart package only (pub.dev)
    python scripts/publish.py extension           # VS Code extension only (Marketplace)
    python scripts/publish.py analyze             # Full analysis without publishing
    python scripts/publish.py openvsx             # Republish existing .vsix to Open VSX
    python scripts/publish.py dart --bump minor   # Bump version before validation

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


_TARGETS = {
    "all": "Full pipeline: Dart package + VS Code extension (pub.dev & Marketplace)",
    "dart": "Dart package only: validate, test, and publish to pub.dev",
    "extension": "VS Code extension only: compile, package, and publish to Marketplace",
    "analyze": "Analysis only: run all checks and packaging without publishing",
    "openvsx": "Open VSX republish: upload existing .vsix to Open VSX registry",
}

_TARGET_KEYS = list(_TARGETS.keys())


def _prompt_target() -> str:
    """Interactively ask the user which target to publish."""
    print(f"\n  {C.BOLD}Which target do you want to build/publish?{C.RESET}\n")
    for i, (key, desc) in enumerate(_TARGETS.items(), 1):
        print(f"    {C.CYAN}{i}{C.RESET}) {C.WHITE}{key:10}{C.RESET} {dim(desc)}")
    print()
    while True:
        try:
            choice = input(f"  {C.YELLOW}Enter choice (1-{len(_TARGETS)}): {C.RESET}").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(ExitCode.USER_CANCELLED)
        if choice in {str(i) for i in range(1, len(_TARGETS) + 1)}:
            return _TARGET_KEYS[int(choice) - 1]
        if choice.lower() in _TARGET_KEYS:
            return choice.lower()
        print(f"  {C.RED}Invalid choice. Please enter 1-{len(_TARGETS)} or a target name.{C.RESET}")


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Saropa Drift Advisor -- Unified Publish Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "target",
        nargs="?",
        choices=_TARGET_KEYS,
        default=None,
        help="Which target to build/publish (prompted if omitted).",
    )
    parser.add_argument(
        "--bump",
        choices=["patch", "minor", "major"],
        default=None,
        help="Bump version before validation (patch, minor, or major).",
    )
    for flag, help_text in _CLI_FLAGS:
        parser.add_argument(flag, action="store_true", help=help_text)
    args = parser.parse_args()
    if args.target is None:
        args.target = _prompt_target()
    return args


# ── Target Info ──────────────────────────────────────────────


def _read_banner_version(target: str) -> str:
    """Read the version to display in the banner (target-appropriate)."""
    if target in ("extension", "openvsx"):
        from modules.target_config import read_max_version
        return read_max_version()
    from modules.target_config import DART, read_version
    return read_version(DART)


def _print_target_info(target: str, version: str) -> None:
    """Print target and version info after the logo."""
    labels = {
        "all": "Full Pipeline",
        "dart": "Dart Package",
        "extension": "VS Code Extension",
        "analyze": "Analysis Only",
        "openvsx": "Open VSX Republish",
    }
    print(f"\n  {C.BOLD}{labels[target]}{C.RESET}  {dim(f'v{version}')}")
    print(f"  Project root: {dim(REPO_ROOT)}")
    if target in ("extension", "all", "openvsx", "analyze"):
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


def _confirm_full_publish(dart_version: str, ext_version: str) -> bool:
    """Confirm combined Dart + Extension publish for 'all' target."""
    from modules.constants import MARKETPLACE_EXTENSION_ID, REPO_URL, TAG_PREFIX
    ext_tag = f"{TAG_PREFIX}{ext_version}"

    print(f"\n  {C.BOLD}{C.YELLOW}Full Publish Summary{C.RESET}")
    print(f"  {'-' * 40}")
    print(f"\n  {C.CYAN}Dart Package (pub.dev){C.RESET}")
    print(f"    Version: {C.WHITE}v{dart_version}{C.RESET}")
    print(f"    Tag:     {C.WHITE}v{dart_version}{C.RESET}")
    print(f"\n  {C.CYAN}VS Code Extension (Marketplace){C.RESET}")
    print(f"    Version: {C.WHITE}v{ext_version}{C.RESET}")
    print(f"    Tag:     {C.WHITE}{ext_tag}{C.RESET}")
    print(f"    ID:      {C.WHITE}{MARKETPLACE_EXTENSION_ID}{C.RESET}")

    print(f"\n  {C.YELLOW}This will:{C.RESET}")
    print(f"    1. Commit and push to origin")
    print(f"    2. Create git tags v{dart_version} + {ext_tag}")
    print(f"    3. Publish Dart package to pub.dev (via GitHub Actions)")
    print(f"    4. Publish extension to VS Code Marketplace + Open VSX")
    print(f"    5. Create GitHub releases for both")
    print(f"\n  {C.RED}These actions are irreversible.{C.RESET}")
    return ask_yn("Proceed with publish?", default=False)


def _run_publish(args, target, dart_version, ext_version, vsix_path, results):
    """Run per-target publish steps. Returns exit code or None on success."""
    heading("Publish Confirmation")

    if target == "all":
        if not _confirm_full_publish(dart_version, ext_version):
            info("Publish cancelled by user.")
            return ExitCode.USER_CANCELLED
    elif target == "dart":
        if not _confirm_dart_publish(dart_version):
            info("Publish cancelled by user.")
            return ExitCode.USER_CANCELLED
    elif target == "extension":
        from modules.ext_publish import confirm_publish
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


def _run_openvsx_only() -> int:
    """Publish the latest .vsix to Open VSX (skip full pipeline)."""
    import glob
    import os
    from modules.ext_prereqs import get_ovsx_pat
    from modules.ext_publish import publish_openvsx, _save_ovsx_pat_to_env

    pattern = os.path.join(EXTENSION_DIR, "*.vsix")
    vsix_files = sorted(glob.glob(pattern), key=os.path.getmtime)
    if not vsix_files:
        from modules.display import fail
        fail(f"No .vsix found in {EXTENSION_DIR}. Run 'extension' target first.")
        return ExitCode.PACKAGE_FAILED

    vsix_path = vsix_files[-1]
    info(f"Using: {os.path.basename(vsix_path)}")

    pat = get_ovsx_pat()
    if not pat:
        try:
            import getpass
            info(f"Token page: {C.WHITE}https://open-vsx.org/user-settings/tokens{C.RESET}")
            pat = (getpass.getpass(
                prompt="  Paste Open VSX token: ",
            ) or "").strip()
            if pat:
                os.environ["OVSX_PAT"] = pat
                _save_ovsx_pat_to_env(pat)
        except (EOFError, KeyboardInterrupt):
            pat = ""
    if not pat:
        from modules.display import fail
        fail("No OVSX_PAT. Cannot publish to Open VSX.")
        return ExitCode.PREREQUISITE_FAILED

    if publish_openvsx(vsix_path):
        return ExitCode.SUCCESS
    return ExitCode.OPENVSX_FAILED


def _main_inner() -> int:
    """Parse args, run pipeline, return exit code."""
    args = parse_args()
    target = args.target
    version = _read_banner_version(target if target not in ("openvsx", "analyze") else "extension")
    results: list[tuple[str, bool, float]] = []

    _print_target_info(target, version)

    if target == "openvsx":
        return _run_openvsx_only()

    # "analyze" target runs full pipeline analysis without publishing
    if target == "analyze":
        args.analyze_only = True
        target = "all"

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
