# -*- coding: utf-8 -*-
"""Report generation, timing display, and success banner.

Reports are saved to reports/<yyyymmdd>/ date subfolders (which are
gitignored) so the user has a persistent record of each pipeline run.
The timing chart gives a visual breakdown of where time was spent.
"""

import datetime
import os
import sys
import webbrowser

from modules.constants import C, MARKETPLACE_URL, OPENVSX_URL, REPO_ROOT, REPO_URL, TAG_PREFIX
from modules.display import heading, ok
from modules.utils import elapsed_str


def _build_report_lines(
    results: list[tuple[str, bool, float]],
    version: str,
    is_publish: bool,
    target_label: str = "Extension",
) -> list[str]:
    """Build the full report content lines."""
    total_time = sum(t for _, _, t in results)
    passed = sum(1 for _, p, _ in results if p)
    failed = len(results) - passed
    kind = "Publish" if is_publish else "Analysis"

    lines = [
        f"Drift Viewer {target_label} -- {kind} Report",
        f"Generated: {datetime.datetime.now().isoformat()}",
        f"Version: {version}",
        "",
        f"Results: {passed} passed, {failed} failed" if failed else
        f"Results: {passed} passed",
        f"Total time: {elapsed_str(total_time)}",
    ]
    return lines


def _append_report_details(
    lines: list[str],
    results: list[tuple[str, bool, float]],
    version: str,
    vsix_path: str | None,
    is_publish: bool,
    config,
) -> None:
    """Append VSIX info, publish links, and step details to report lines."""
    tag_prefix = config.tag_prefix if config else TAG_PREFIX
    if vsix_path and os.path.isfile(vsix_path):
        vsix_size = os.path.getsize(vsix_path) / 1024
        lines.append(f"VSIX file: {os.path.basename(vsix_path)}")
        lines.append(f"VSIX size: {vsix_size:.1f} KB")
    if is_publish:
        tag = f"{tag_prefix}{version}"
        lines.append(f"GitHub release: {REPO_URL}/releases/tag/{tag}")
        if not config or config.name != "dart":
            lines.append(f"Marketplace: {MARKETPLACE_URL}")
            lines.append(f"Open VSX (Cursor): {OPENVSX_URL}")
    lines.append("")
    lines.append("Step Details:")
    for name, ok_flag, secs in results:
        status = "PASS" if ok_flag else "FAIL"
        lines.append(f"  [{status}] {name:<25s} {elapsed_str(secs):>8s}")


def save_report(
    results: list[tuple[str, bool, float]],
    version: str,
    vsix_path: str | None = None,
    is_publish: bool = False,
    config=None,
) -> str | None:
    """Save a summary report to reports/<yyyymmdd>/. Returns the report path."""
    target_label = config.display_name if config else "Extension"
    target_slug = config.name if config else "extension"

    now = datetime.datetime.now()
    reports_dir = os.path.join(REPO_ROOT, "reports", now.strftime("%Y%m%d"))
    os.makedirs(reports_dir, exist_ok=True)

    kind = "publish" if is_publish else "analyze"
    report_name = f"{now:%Y%m%d_%H%M%S}_drift_viewer_{target_slug}_{kind}_report.log"
    report_path = os.path.join(reports_dir, report_name)

    lines = _build_report_lines(results, version, is_publish, target_label)
    _append_report_details(lines, results, version, vsix_path, is_publish, config)

    try:
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except OSError:
        return None
    return report_path


def print_timing(results: list[tuple[str, bool, float]]) -> None:
    """Print a coloured timing bar chart for all recorded steps.

    Each step gets a proportional bar (max 30 chars wide) showing
    its share of total time. Failed steps show a red X instead of check.
    """
    total = sum(t for _, _, t in results)
    heading("Timing")
    for name, passed, secs in results:
        icon = f"{C.GREEN}OK{C.RESET}" if passed else f"{C.RED}X {C.RESET}"
        # Scale bar length proportionally to total time (max 30 chars)
        bar_len = int(min(secs / max(total, 0.001) * 30, 30))
        bar = f"{C.GREEN}{'#' * bar_len}{C.RESET}" if bar_len else ""
        print(f"  {icon} {name:<25s} {elapsed_str(secs):>8s}  {bar}")
    print(f"  {'-' * 45}")
    print(f"    {'Total':<23s} {C.BOLD}{elapsed_str(total)}{C.RESET}")


def print_report_path(report: str | None) -> None:
    """Print the report file path if a report was saved."""
    if report:
        rel = os.path.relpath(report, REPO_ROOT)
        ok(f"Report: {C.WHITE}{rel}{C.RESET}")


def print_success_banner(version: str, vsix_path: str | None = None, config=None) -> None:
    """Print the final success summary with links.

    When *config* is provided with name ``'dart'``, shows pub.dev links.
    Otherwise shows VS Code Marketplace / Open VSX links (legacy behavior).
    """
    if config is not None and config.name == "dart":
        _print_dart_success_banner(version)
        return

    tag = f"{TAG_PREFIX}{version}"
    heading("Published Successfully!")
    vsix_name = os.path.basename(vsix_path) if vsix_path else "(none)"
    print(f"""
  {C.GREEN}{C.BOLD}v{version} is live!{C.RESET}

  {C.CYAN}Marketplace:{C.RESET}
    {C.WHITE}{MARKETPLACE_URL}{C.RESET}

  {C.CYAN}Open VSX (Cursor / VSCodium):{C.RESET}
    {C.WHITE}{OPENVSX_URL}{C.RESET}

  {C.CYAN}GitHub Release:{C.RESET}
    {C.WHITE}{REPO_URL}/releases/tag/{tag}{C.RESET}

  {C.CYAN}VSIX:{C.RESET}
    {C.WHITE}{vsix_name}{C.RESET}
""")
    if sys.stdin.isatty():
        try:
            webbrowser.open(MARKETPLACE_URL)
        except Exception:
            pass


def _print_dart_success_banner(version: str) -> None:
    """Print Dart package publish success summary."""
    heading("Published Successfully!")
    print(f"""
  {C.GREEN}{C.BOLD}v{version} is live!{C.RESET}

  {C.CYAN}pub.dev:{C.RESET}
    {C.WHITE}https://pub.dev/packages/saropa_drift_viewer{C.RESET}

  {C.CYAN}GitHub Release:{C.RESET}
    {C.WHITE}{REPO_URL}/releases/tag/v{version}{C.RESET}

  {C.CYAN}GitHub Actions:{C.RESET}
    {C.WHITE}{REPO_URL}/actions{C.RESET}
""")
