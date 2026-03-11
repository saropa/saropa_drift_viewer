# -*- coding: utf-8 -*-
"""Dart package publish helpers (pub.dev via GitHub Actions)."""

import urllib.error
import urllib.request

from modules.display import heading, info, ok, warn
from modules.git_ops import get_remote_url
from modules.github_release import extract_repo_path
from modules.utils import run_step


def package_on_pub_dev(package_name: str) -> bool:
    """Return True if the package page exists on pub.dev (not 404)."""
    try:
        req = urllib.request.Request(
            f"https://pub.dev/packages/{package_name}",
            headers={"User-Agent": "saropa_drift_advisor_publish_script/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        return e.code != 404
    except Exception:
        return True  # network error: assume exists


def publish_to_pubdev() -> bool:
    """Notify that publishing happens via GitHub Actions tag trigger."""
    ok("Tag push triggered GitHub Actions publish workflow!")
    print()
    info("Publishing is now running automatically on GitHub Actions.")
    info("No personal email will be shown on pub.dev.")
    print()

    remote_url = get_remote_url()
    repo_path = extract_repo_path(remote_url)
    info(f"Monitor progress at: https://github.com/{repo_path}/actions")
    print()
    return True


def run_dart_publish(
    version: str,
    results: list[tuple[str, bool, float]],
) -> bool:
    """Run Dart publish steps. Returns True on success."""
    from modules.checks_git import check_gh_cli
    from modules.github_release import create_github_release
    from modules.pipeline import _commit_and_tag
    from modules.target_config import DART
    from modules.report import (
        save_report, print_timing, print_success_banner, print_report_path,
    )

    heading("Dart \u00b7 Publish Credentials")
    if not run_step("GitHub CLI", check_gh_cli, results):
        return False

    if not _commit_and_tag(DART, version, results, "Dart \u00b7"):
        return False

    heading("Dart \u00b7 Publish to pub.dev")
    if not run_step("pub.dev publish", publish_to_pubdev, results):
        return False

    heading("Dart \u00b7 GitHub Release")
    if not run_step("GitHub release",
                    lambda: create_github_release(DART, version),
                    results):
        warn("GitHub release failed. Create manually: "
             f"gh release create v{version}")

    report = save_report(results, version, is_publish=True, config=DART)
    print_timing(results)
    print_success_banner(version, config=DART)
    print_report_path(report)
    return True
