# -*- coding: utf-8 -*-
"""Pipeline orchestration: analysis and publish step sequencing."""

from __future__ import annotations

import argparse
import os
import time
from typing import TYPE_CHECKING

from modules.constants import C
from modules.display import heading, info, ok
from modules.utils import run_step

if TYPE_CHECKING:
    from modules.target_config import TargetConfig


# ── Shared Helpers ───────────────────────────────────────


def _validate_version_step(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
    config: "TargetConfig",
    step_label: str,
) -> tuple[str, bool]:
    """Run version validation for a target. Returns (version, ok)."""
    from modules.checks_version import validate_version_changelog

    heading(step_label)
    if getattr(args, "yes", False):
        os.environ["PUBLISH_YES"] = "1"
    t0 = time.time()
    version, version_ok = validate_version_changelog(config=config)
    elapsed = time.time() - t0
    results.append((f"{config.display_name} version", version_ok, elapsed))
    if not version_ok:
        return "", False
    return version, True


def _commit_and_tag(
    config: "TargetConfig",
    version: str,
    results: list[tuple[str, bool, float]],
    label: str,
) -> bool:
    """Commit, push, and tag for a target. Skips if tag exists."""
    from modules.git_ops import is_version_tagged, git_commit_and_push, create_git_tag

    tagged = is_version_tagged(version, config.tag_prefix)
    if tagged:
        heading(f"{label} Git Commit & Push")
        info(f"Tag {config.tag_prefix}{version} already exists; skipping.")
        heading(f"{label} Git Tag")
        info("Skipped (tag exists).")
        return True

    heading(f"{label} Git Commit & Push")
    if not run_step("Git commit & push",
                    lambda: git_commit_and_push(config, version), results):
        return False
    heading(f"{label} Git Tag")
    if not run_step("Git tag",
                    lambda: create_git_tag(config, version), results):
        return False
    return True


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
    from modules.target_config import EXTENSION

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

    return _validate_version_step(args, results, EXTENSION, "Step 10 \u00b7 Version & CHANGELOG")


# ── Dart Analysis ────────────────────────────────────────


def _run_dart_build_steps(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> bool:
    """Run Dart format, test, analysis, docs, and dry-run."""
    from modules.dart_build import (
        format_code, run_tests, run_analysis,
        generate_docs, pre_publish_validation,
    )

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


def run_dart_analysis(
    args: argparse.Namespace,
    results: list[tuple[str, bool, float]],
) -> tuple[str, bool]:
    """Run all Dart analysis steps. Returns (version, all_passed)."""
    from modules.dart_prereqs import check_dart, check_flutter, check_publish_workflow
    from modules.checks_git import check_git, check_working_tree, check_remote_sync
    from modules.target_config import DART

    heading("Dart \u00b7 Prerequisites")
    for name, fn in [
        ("Dart SDK", check_dart),
        ("Flutter SDK", check_flutter),
        ("git", check_git),
        ("Publish workflow", check_publish_workflow),
    ]:
        if not run_step(name, fn, results):
            return "", False

    heading("Dart \u00b7 Working Tree")
    if not run_step("Working tree", check_working_tree, results):
        return "", False

    heading("Dart \u00b7 Remote Sync")
    if not run_step("Remote sync", check_remote_sync, results):
        return "", False

    if not _run_dart_build_steps(args, results):
        return "", False

    return _validate_version_step(args, results, DART, "Dart \u00b7 Version & CHANGELOG")


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

