# -*- coding: utf-8 -*-
"""Pipeline orchestration: analysis and publish step sequencing.

Supports both the legacy extension-only entry point (publish_extension.py)
and the unified entry point (publish.py) via TargetConfig-aware functions.
"""

from __future__ import annotations

import argparse
import os
import time
from typing import TYPE_CHECKING

from modules.constants import C
from modules.display import heading, info, ok, warn
from modules.utils import run_step

if TYPE_CHECKING:
    from modules.target_config import TargetConfig


# ── Extension Analysis ───────────────────────────────────


def _run_ext_prerequisites(
    results: list[tuple[str, bool, float]],
) -> bool:
    """Extension prerequisite checks (Node, npm, git, VS Code CLI)."""
    from modules.ext_prereqs import check_node, check_npm, check_vscode_cli
    from modules.checks_git import check_git

    heading("Step 1 \u00b7 Prerequisites")
    for name, fn in [
        ("Node.js", check_node),
        ("npm", check_npm),
        ("git", check_git),
        ("VS Code CLI", check_vscode_cli),
    ]:
        if not run_step(name, fn, results):
            return False
    return True


def _run_ext_dev_checks(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> bool:
    """Extension dev environment + git state checks."""
    from modules.ext_prereqs import check_global_npm_packages, check_vscode_extensions
    from modules.checks_git import check_working_tree, check_remote_sync
    from modules.ext_build import ensure_dependencies

    if getattr(args, "skip_global_npm", False):
        heading("Step 2 \u00b7 Global npm Packages (skipped)")
    else:
        heading("Step 2 \u00b7 Global npm Packages")
        if not run_step("Global npm pkgs", check_global_npm_packages, results):
            return False

    if getattr(args, "skip_extensions", False):
        heading("Step 3 \u00b7 VS Code Extensions (skipped)")
    else:
        heading("Step 3 \u00b7 VS Code Extensions")
        if not run_step("VS Code extensions", check_vscode_extensions, results):
            return False

    heading("Step 4 \u00b7 Working Tree")
    if not run_step("Working tree", check_working_tree, results):
        return False

    heading("Step 5 \u00b7 Remote Sync")
    if not run_step("Remote sync", check_remote_sync, results):
        return False

    heading("Step 6 \u00b7 Dependencies")
    if not run_step("Dependencies", ensure_dependencies, results):
        return False

    return True


def _run_ext_build_and_validate(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> tuple[str, bool]:
    """Extension compile, test, quality, and version steps."""
    from modules.ext_build import step_compile, step_test, check_file_line_limits
    from modules.checks_version import validate_version_changelog

    heading("Step 7 \u00b7 Compile")
    if not run_step("Compile", step_compile, results):
        return "", False

    if getattr(args, "skip_tests", False):
        heading("Step 8 \u00b7 Tests (skipped)")
    else:
        heading("Step 8 \u00b7 Tests")
        if not run_step("Tests", step_test, results):
            return "", False

    heading("Step 9 \u00b7 Quality Checks")
    if not run_step("File line limits", check_file_line_limits, results):
        return "", False

    heading("Step 10 \u00b7 Version & CHANGELOG")
    if getattr(args, "yes", False):
        os.environ["PUBLISH_YES"] = "1"
    t0 = time.time()
    version, version_ok = validate_version_changelog()
    elapsed = time.time() - t0
    results.append(("Version validation", version_ok, elapsed))
    if not version_ok:
        return "", False

    return version, True


# ── Dart Analysis ────────────────────────────────────────


def run_dart_analysis(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> bool:
    """Run all Dart analysis steps. Returns True if all pass."""
    from modules.dart_prereqs import check_dart, check_flutter, check_publish_workflow
    from modules.dart_build import (
        format_code, run_tests, run_analysis,
        generate_docs, pre_publish_validation,
    )

    heading("Dart \u00b7 Prerequisites")
    for name, fn in [
        ("Dart SDK", check_dart),
        ("Flutter SDK", check_flutter),
        ("Publish workflow", check_publish_workflow),
    ]:
        if not run_step(name, fn, results):
            return False

    heading("Dart \u00b7 Format")
    if not run_step("Dart format", format_code, results):
        return False

    if getattr(args, "skip_tests", False):
        heading("Dart \u00b7 Tests (skipped)")
    else:
        heading("Dart \u00b7 Tests")
        if not run_step("Dart tests", run_tests, results):
            return False

    heading("Dart \u00b7 Analysis")
    if not run_step("Dart analysis", run_analysis, results):
        return False

    heading("Dart \u00b7 Documentation")
    if not run_step("Dart docs", generate_docs, results):
        return False

    heading("Dart \u00b7 Dry Run")
    if not run_step("Dart dry-run", pre_publish_validation, results):
        return False

    return True


def run_ext_analysis(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> tuple[str, bool]:
    """Run all extension analysis steps. Returns (version, all_passed)."""
    if not _run_ext_prerequisites(results):
        return "", False
    if not _run_ext_dev_checks(args, results):
        return "", False
    return _run_ext_build_and_validate(args, results)


# ── Legacy Public API (used by publish_extension.py) ─────


def run_analysis(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> tuple[str, bool]:
    """Run all extension analysis steps (1-10). Legacy API."""
    return run_ext_analysis(args, results)


# ── Package & Install ─────────────────────────────────────


def package_and_install(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
    version: str,
) -> str | None:
    """Package .vsix and offer local install. Returns vsix path."""
    from modules.ext_publish import step_package
    from modules.ext_prereqs import get_installed_extension_versions
    from modules.ext_install import print_install_instructions, prompt_install
    from modules.report import save_report, print_timing, print_report_path

    heading("Package")
    t0 = time.time()
    vsix_path = step_package()
    elapsed = time.time() - t0
    results.append(("Package", vsix_path is not None, elapsed))

    if not vsix_path:
        report = save_report(results, version or "unknown")
        print_timing(results)
        print_report_path(report)
        return None

    heading("Local Install")
    ok(f"VSIX: {C.WHITE}{os.path.basename(vsix_path)}{C.RESET}")
    installed = get_installed_extension_versions()
    if installed:
        parts = [f"{editor} v{ver}" for editor, ver in sorted(installed.items())]
        info(f"Installed locally: {', '.join(parts)}")
    else:
        info("Not installed in VS Code or Cursor.")
    print_install_instructions(vsix_path)
    if getattr(args, "auto_install", False):
        _auto_install_vsix(vsix_path)
    else:
        prompt_install(vsix_path)

    return vsix_path


def _auto_install_vsix(vsix_path: str) -> None:
    """CI mode: install .vsix via code CLI without prompting."""
    from modules.utils import run
    vsix_name = os.path.basename(vsix_path)
    info(f"Running: code --install-extension {vsix_name}")
    run(["code", "--install-extension", os.path.abspath(vsix_path)])


# ── Publish Phase ─────────────────────────────────────────


def ask_publish_stores() -> str:
    """Ask which store(s) to publish to. Returns 'vscode_only', 'openvsx_only', or 'both'."""
    print(f"\n  {C.YELLOW}Which store(s) to publish to?{C.RESET}")
    print("    1 = VS Code Marketplace only")
    print("    2 = Open VSX only (Cursor / VSCodium)")
    print("    3 = both")
    try:
        raw = input(f"  {C.YELLOW}Choice [3]: {C.RESET}").strip() or "3"
    except (EOFError, KeyboardInterrupt):
        print()
        return "both"
    if raw == "1":
        return "vscode_only"
    if raw == "2":
        return "openvsx_only"
    return "both"


def _check_publish_credentials(
    results: list[tuple[str, bool, float]],
    stores: str = "both",
) -> bool:
    """Verify credentials for chosen store(s)."""
    from modules.checks_git import check_gh_cli
    from modules.ext_prereqs import check_vsce_auth, check_ovsx_token

    heading("Publish Credentials")
    if not run_step("GitHub CLI", check_gh_cli, results):
        return False
    if stores in ("both", "vscode_only"):
        if not run_step("vsce PAT", check_vsce_auth, results):
            return False
    else:
        info("Skipping vsce PAT (publish to Open VSX only).")
    if stores in ("both", "openvsx_only"):
        run_step("OVSX PAT", check_ovsx_token, results)
    else:
        info("Skipping OVSX PAT (publish to VS Code Marketplace only).")
    return True


def _run_publish_steps(
    version: str,
    vsix_path: str,
    results: list[tuple[str, bool, float]],
    stores: str = "both",
) -> bool:
    """Commit, tag, and publish extension. Returns True on success."""
    from modules.git_ops import is_version_tagged, git_commit_and_push, create_git_tag
    from modules.ext_publish import (
        get_marketplace_published_version, publish_marketplace, publish_openvsx,
    )
    from modules.ext_prereqs import get_ovsx_pat
    from modules.github_release import create_github_release
    from modules.target_config import EXTENSION

    tagged = is_version_tagged(version, EXTENSION.tag_prefix)
    if tagged:
        heading("Step 11 \u00b7 Git Commit & Push")
        info(f"Tag ext-v{version} already exists; skipping commit & tag.")
        heading("Step 12 \u00b7 Git Tag")
        info("Skipped (tag exists).")
    else:
        heading("Step 11 \u00b7 Git Commit & Push")
        if not run_step("Git commit & push",
                        lambda: git_commit_and_push(EXTENSION, version), results):
            return False
        heading("Step 12 \u00b7 Git Tag")
        if not run_step("Git tag",
                        lambda: create_git_tag(EXTENSION, version), results):
            return False

    heading("Step 13 \u00b7 Publish to Marketplace")
    if stores == "openvsx_only":
        info("Skipping (publish to Open VSX only).")
    else:
        published = get_marketplace_published_version()
        if published == version:
            info(f"VS Code Marketplace already has v{version}; skipping.")
        else:
            if not run_step("Marketplace publish",
                            lambda: publish_marketplace(vsix_path), results):
                return False

    heading("Step 14 \u00b7 Publish to Open VSX")
    if stores == "vscode_only":
        info("Skipping (publish to VS Code Marketplace only).")
    else:
        pat = get_ovsx_pat()
        if not pat:
            try:
                import getpass
                prompt = "Paste Open VSX token or Enter to skip: "
                pat = (getpass.getpass(prompt=prompt) or "").strip()
                if pat:
                    os.environ["OVSX_PAT"] = pat
            except (EOFError, KeyboardInterrupt):
                pat = ""
            if not pat:
                warn("No token; skipping Open VSX.")
        if pat:
            openvsx_ok = run_step("Open VSX publish",
                                  lambda: publish_openvsx(vsix_path), results)
            if not openvsx_ok:
                warn("Open VSX publish failed; continuing to GitHub release.")

    heading("Step 15 \u00b7 GitHub Release")
    if not run_step("GitHub release",
                    lambda: create_github_release(EXTENSION, version, asset_path=vsix_path),
                    results):
        warn("Marketplace/Open VSX publish succeeded but GitHub release failed.")
        warn(f"Create manually: gh release create ext-v{version}")

    return True


def run_publish(
    version: str,
    vsix_path: str,
    results: list[tuple[str, bool, float]],
    stores: str,
) -> bool:
    """Run extension publish steps (11-15). Returns True on success."""
    from modules.report import (
        save_report, print_timing, print_success_banner, print_report_path,
    )

    if not _check_publish_credentials(results, stores):
        return False
    if not _run_publish_steps(version, vsix_path, results, stores=stores):
        return False

    report = save_report(results, version, vsix_path, is_publish=True)
    print_timing(results)
    print_success_banner(version, vsix_path)
    print_report_path(report)
    return True
