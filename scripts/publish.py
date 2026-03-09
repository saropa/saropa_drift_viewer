#!/usr/bin/env python3
"""
Publish saropa_drift_viewer package to pub.dev and create GitHub release.

This script automates the complete release workflow for the Dart package.
The package is at the repository root (single package, no subfolder).

  Pre-checks (before numbered steps):
    - Validates pubspec.yaml and CHANGELOG.md versions: if changelog is ahead,
      pubspec is updated; if pubspec is ahead and [Unreleased] exists, it is
      converted to that version so pubspec wins.
    - If CHANGELOG shows the current version as already released (first
      versioned section matches pubspec) and has [Unreleased], offers to
      auto-bump to next patch so you do not re-publish the same version.
    - If version tag already exists on remote and CHANGELOG.md has an
      [Unreleased] section, offers to auto-bump to the next patch version
      (updates both CHANGELOG.md and pubspec.yaml)

  Numbered steps:
    1. Checks prerequisites (dart, git, gh auth, publish workflow)
    2. Checks working tree status
    3. Checks remote sync
    4. Formats code (in package dir)
    5. Runs tests (in package dir)
    6. Runs static analysis (in package dir)
    7. Validates changelog has release notes
    8. Generates documentation with dart doc (in package dir)
    9. Pre-publish validation (dry-run in package dir)
    10. Commits and pushes changes (repo root)
    11. Creates and pushes git tag (repo root)
    12. Triggers GitHub Actions publish to pub.dev
    13. Creates GitHub release with release notes

Version:   1.0
Author:    Saropa
Copyright: (c) 2026 Saropa

Platforms:
    - Windows (uses shell=True for .bat executables)
    - macOS (native executable lookup)
    - Linux (native executable lookup)

Usage:
    From repo root: python scripts/publish_pub_dev.py

The script is fully interactive - no command-line arguments needed.
It will prompt for confirmation at key steps.

Troubleshooting:
    GitHub release fails with "Bad credentials":
        If you have a GITHUB_TOKEN environment variable set (even if invalid),
        it takes precedence over 'gh auth login' credentials. To fix:
        - PowerShell: $env:GITHUB_TOKEN = ""
        - Bash: unset GITHUB_TOKEN
        Then run 'gh auth status' to verify your keyring credentials are active.

Exit Codes:
    0 - Success
    1 - Prerequisites failed
    2 - Working tree check failed
    3 - Tests failed
    4 - Analysis failed
    5 - Changelog validation failed
    6 - Pre-publish validation failed
    7 - Publish failed
    8 - Git operations failed
    9 - User cancelled
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import webbrowser
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import NoReturn


SCRIPT_VERSION = "1.0"


# =============================================================================
# EXIT CODES
# =============================================================================


class ExitCode(Enum):
    """Standard exit codes."""

    SUCCESS = 0
    PREREQUISITES_FAILED = 1
    WORKING_TREE_FAILED = 2
    TEST_FAILED = 3
    ANALYSIS_FAILED = 4
    CHANGELOG_FAILED = 5
    VALIDATION_FAILED = 6
    PUBLISH_FAILED = 7
    GIT_FAILED = 8
    USER_CANCELLED = 9


# =============================================================================
# COLOR AND PRINTING
# =============================================================================


class Color(Enum):
    """ANSI color codes."""

    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    CYAN = "\033[96m"
    MAGENTA = "\033[95m"
    WHITE = "\033[97m"
    RESET = "\033[0m"


def enable_ansi_support() -> None:
    """Enable ANSI escape sequence support on Windows."""
    if sys.platform == "win32":
        try:
            import ctypes
            from ctypes import wintypes

            kernel32 = ctypes.windll.kernel32

            # Constants
            STD_OUTPUT_HANDLE = -11
            ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004

            # Get stdout handle
            handle = kernel32.GetStdHandle(STD_OUTPUT_HANDLE)

            # Get current console mode
            mode = wintypes.DWORD()
            kernel32.GetConsoleMode(handle, ctypes.byref(mode))

            # Enable virtual terminal processing
            new_mode = mode.value | ENABLE_VIRTUAL_TERMINAL_PROCESSING
            kernel32.SetConsoleMode(handle, new_mode)
        except Exception:
            pass


# cspell: disable
def show_saropa_logo() -> None:
    """Display the Saropa 'S' logo in ASCII art."""
    logo = """
\033[38;5;208m                               ....\033[0m
\033[38;5;208m                       `-+shdmNMMMMNmdhs+-\033[0m
\033[38;5;209m                    -odMMMNyo/-..````.++:+o+/-\033[0m
\033[38;5;215m                 `/dMMMMMM/`           ``````````\033[0m
\033[38;5;220m                `dMMMMMMMMNdhhhdddmmmNmmddhs+-\033[0m
\033[38;5;226m                /MMMMMMMMMMMMMMMMMMMMMMMMMMMMMNh\\\033[0m
\033[38;5;190m              . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+\033[0m
\033[38;5;154m              o     `..~~~::~+==+~:/+sdNMMMMMMMMMMMo\033[0m
\033[38;5;118m              m                        .+NMMMMMMMMMN\033[0m
\033[38;5;123m              m+                         :MMMMMMMMMm\033[0m
\033[38;5;87m              /N:                        :MMMMMMMMM/\033[0m
\033[38;5;51m               oNs.                    `+NMMMMMMMMo\033[0m
\033[38;5;45m                :dNy/.              ./smMMMMMMMMm:\033[0m
\033[38;5;39m                 `/dMNmhyso+++oosydNNMMMMMMMMMd/\033[0m
\033[38;5;33m                    .odMMMMMMMMMMMMMMMMMMMMdo-\033[0m
\033[38;5;57m                       `-+shdNNMMMMNNdhs+-\033[0m
\033[38;5;57m                               ````\033[0m
"""
    print(logo)
    current_year = datetime.now().year
    copyright_year = f"2024-{current_year}" if current_year > 2024 else "2024"
    print(f"\033[38;5;195m(c) {copyright_year} Saropa. All rights reserved.\033[0m")
    print("\033[38;5;117mhttps://saropa.com\033[0m")
    print()


# cspell: enable


def print_colored(message: str, color: Color) -> None:
    """Print a message with ANSI color codes."""
    print(f"{color.value}{message}{Color.RESET.value}")


def print_header(text: str) -> None:
    """Print a section header."""
    print()
    print_colored("=" * 70, Color.CYAN)
    print_colored(f"  {text}", Color.CYAN)
    print_colored("=" * 70, Color.CYAN)
    print()


def print_success(text: str) -> None:
    """Print success message."""
    print_colored(f"  [OK] {text}", Color.GREEN)


def print_warning(text: str) -> None:
    """Print warning message."""
    print_colored(f"  [!] {text}", Color.YELLOW)


def print_error(text: str) -> None:
    """Print error message."""
    print_colored(f"  [X] {text}", Color.RED)


def print_info(text: str) -> None:
    """Print info message."""
    print_colored(f"  [>] {text}", Color.MAGENTA)


def exit_with_error(message: str, code: ExitCode) -> NoReturn:
    """Print error and exit."""
    print_error(message)
    sys.exit(code.value)


# =============================================================================
# PLATFORM DETECTION
# =============================================================================


def is_windows() -> bool:
    """Check if running on Windows."""
    return sys.platform == "win32"


def get_shell_mode() -> bool:
    """
    Get the appropriate shell mode for subprocess calls.

    On Windows, we need shell=True to find .bat/.cmd executables (e.g. dart.bat)
    that are in PATH. On macOS/Linux, executables are found directly without shell.
    """
    return is_windows()


# =============================================================================
# COMMAND EXECUTION
# =============================================================================


def run_command(
    cmd: list[str],
    cwd: Path,
    description: str,
    capture_output: bool = False,
    allow_failure: bool = False,
) -> subprocess.CompletedProcess:
    """Run a command and handle errors."""
    print_info(f"{description}...")
    print_colored(f"      $ {' '.join(cmd)}", Color.WHITE)

    use_shell = get_shell_mode()

    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=capture_output,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",  # Replace undecodable characters instead of failing
    )

    if result.returncode != 0 and not allow_failure:
        if capture_output:
            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(result.stderr)
        print_error(f"{description} failed (exit code {result.returncode})")
        return result

    print_success(f"{description} completed")
    return result


def command_exists(cmd: str) -> bool:
    """Check if a command exists in PATH."""
    return shutil.which(cmd) is not None


# =============================================================================
# VERSION AND CHANGELOG
# =============================================================================


def parse_version(version: str) -> tuple[int, int, int]:
    """Parse a version string into (major, minor, patch) tuple."""
    parts = version.split(".")
    return int(parts[0]), int(parts[1]), int(parts[2])


def get_version_from_pubspec(pubspec_path: Path) -> str:
    """Read version string from pubspec.yaml."""
    content = pubspec_path.read_text(encoding="utf-8")
    match = re.search(r"^version:\s*(\d+\.\d+\.\d+)", content, re.MULTILINE)
    if not match:
        raise ValueError("Could not find version in pubspec.yaml")
    return match.group(1)


def update_pubspec_version(pubspec_path: Path, new_version: str) -> None:
    """Update the version in pubspec.yaml."""
    content = pubspec_path.read_text(encoding="utf-8")
    updated = re.sub(
        r"^(version:\s*)\d+\.\d+\.\d+",
        rf"\g<1>{new_version}",
        content,
        count=1,
        flags=re.MULTILINE,
    )
    pubspec_path.write_text(updated, encoding="utf-8")


def has_unreleased_section(changelog_path: Path) -> bool:
    """Check if CHANGELOG.md has an [Unreleased] section."""
    content = changelog_path.read_text(encoding="utf-8")
    return bool(re.search(r"##\s*\[Unreleased\]", content, re.IGNORECASE))


def bump_patch_version(version: str) -> str:
    """Bump the patch component of a semantic version string."""
    major, minor, patch = parse_version(version)
    return f"{major}.{minor}.{patch + 1}"


def add_unreleased_section(changelog_path: Path) -> None:
    """Insert an [Unreleased] section before the first versioned section."""
    content = changelog_path.read_text(encoding="utf-8")
    new_section = "\n\n## [Unreleased]\n\n### Changed\n\n- Bump for release.\n\n"
    updated = re.sub(
        r"(?=\n##\s*\[\d+\.\d+\.\d+\])",
        new_section,
        content,
        count=1,
    )
    changelog_path.write_text(updated, encoding="utf-8")


def update_changelog_unreleased(changelog_path: Path, new_version: str) -> None:
    """Replace [Unreleased] header with versioned header."""
    content = changelog_path.read_text(encoding="utf-8")
    updated = re.sub(
        r"(##\s*)\[Unreleased\]",
        rf"\g<1>[{new_version}]",
        content,
        count=1,
        flags=re.IGNORECASE,
    )
    changelog_path.write_text(updated, encoding="utf-8")


def get_package_name(pubspec_path: Path) -> str:
    """Read package name from pubspec.yaml."""
    content = pubspec_path.read_text(encoding="utf-8")
    match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
    if not match:
        raise ValueError("Could not find name in pubspec.yaml")
    return match.group(1).strip()


def package_on_pub_dev(package_name: str) -> bool:
    """Return True if the package page exists on pub.dev (not 404)."""
    try:
        req = urllib.request.Request(
            f"https://pub.dev/packages/{package_name}",
            headers={"User-Agent": "saropa_drift_viewer_publish_script/1.0"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status == 200
    except urllib.error.HTTPError as e:
        return e.code != 404  # 404 -> not on pub.dev; other -> assume yes
    except Exception:
        return True  # network/other: assume on pub.dev, don't prompt


def get_latest_changelog_version(changelog_path: Path) -> str | None:
    """Extract the latest version from CHANGELOG.md."""
    if not changelog_path.exists():
        return None

    content = changelog_path.read_text(encoding="utf-8")

    # Match the first version header: ## [1.2.3] or ## 1.2.3
    match = re.search(r"##\s*\[?(\d+\.\d+\.\d+)\]?", content)
    if match:
        return match.group(1)

    return None


def validate_changelog_version(package_dir: Path, version: str) -> str | None:
    """Validate version exists in CHANGELOG and extract release notes."""
    changelog_path = package_dir / "CHANGELOG.md"

    if not changelog_path.exists():
        return None

    content = changelog_path.read_text(encoding="utf-8")

    # Check if version exists in CHANGELOG
    version_pattern = rf"##\s*\[?{re.escape(version)}\]?"
    if not re.search(version_pattern, content):
        return None

    # Extract release notes for this version
    pattern = rf"(?s)##\s*\[?{re.escape(version)}\]?[^\n]*\n(.*?)(?=##\s*\[?\d+\.\d+\.\d+|$)"
    match = re.search(pattern, content)

    if match:
        return match.group(1).strip()

    return ""


def display_changelog(package_dir: Path) -> str | None:
    """Display the latest changelog entry."""
    changelog_path = package_dir / "CHANGELOG.md"

    if not changelog_path.exists():
        print_warning("CHANGELOG.md not found")
        return None

    content = changelog_path.read_text(encoding="utf-8")

    # Extract the first version section
    match = re.search(
        r"^(## \[?\d+\.\d+\.\d+\]?.*?)(?=^## |\Z)", content, re.MULTILINE | re.DOTALL
    )

    if match:
        latest_entry = match.group(1).strip()
        print()
        print_colored("  CHANGELOG (latest entry):", Color.WHITE)
        print_colored("  " + "-" * 50, Color.CYAN)
        for line in latest_entry.split("\n"):
            print_colored(f"  {line}", Color.CYAN)
        print_colored("  " + "-" * 50, Color.CYAN)
        print()
        return latest_entry

    print_warning("Could not parse CHANGELOG.md")
    return None


# =============================================================================
# PUBLISH WORKFLOW STEPS
# =============================================================================


def check_prerequisites(project_dir: Path) -> bool:
    """Check that required tools are available and authenticated."""
    print_header("STEP 1: CHECKING PREREQUISITES")

    tools = [
        ("dart", "Install from https://dart.dev"),
        ("git", "Install from https://git-scm.com"),
        ("gh", "Install from https://cli.github.com"),
    ]

    all_found = True
    for tool, hint in tools:
        if command_exists(tool):
            print_success(f"{tool} found")
        else:
            print_error(f"{tool} not found. {hint}")
            all_found = False

    if not all_found:
        return False

    # Verify gh is authenticated (catches auth errors before doing heavy work)
    use_shell = get_shell_mode()
    result = subprocess.run(
        ["gh", "auth", "status"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        print_error("GitHub CLI is not authenticated.")
        print_info("Run 'gh auth login' to authenticate.")
        error_output = (result.stderr or "") + (result.stdout or "")
        if "GITHUB_TOKEN" in error_output:
            print_info(
                "If GITHUB_TOKEN env var is set but invalid, clear it first:\n"
                '      PowerShell: $env:GITHUB_TOKEN = ""\n'
                "      Bash: unset GITHUB_TOKEN"
            )
        return False
    print_success("gh authenticated")

    # Verify GitHub Actions publish workflow exists (at repo root)
    workflow_path = project_dir / ".github" / "workflows" / "publish.yml"
    if not workflow_path.exists():
        workflow_path = project_dir / ".github" / "workflows" / "publish.yaml"
    if workflow_path.exists():
        print_success(f"Publish workflow found ({workflow_path.name})")
    else:
        print_error(
            "No publish workflow found at .github/workflows/publish.yml"
        )
        print_info(
            "Publishing relies on GitHub Actions. "
            "Add a publish workflow before releasing."
        )
        return False

    return True


def check_working_tree(project_dir: Path) -> tuple[bool, bool]:
    """Check working tree status. Returns (ok, has_uncommitted_changes)."""
    print_header("STEP 2: CHECKING WORKING TREE")

    use_shell = get_shell_mode()

    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.stdout.strip():
        print_warning("You have uncommitted changes:")
        print_colored(result.stdout, Color.YELLOW)
        print()
        response = (
            input(
                "  These changes will be included in the release commit. Continue? [y/N] "
            )
            .strip()
            .lower()
        )
        if not response.startswith("y"):
            return False, True
        return True, True

    print_success("Working tree is clean")
    return True, False


def check_remote_sync(project_dir: Path, branch: str) -> bool:
    """Check if local branch is in sync with remote."""
    print_header("STEP 3: CHECKING REMOTE SYNC")

    use_shell = get_shell_mode()

    print_info("Fetching from remote...")
    result = subprocess.run(
        ["git", "fetch", "origin", branch],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode != 0:
        print_warning(
            "Could not fetch from remote. Proceeding anyway (remote branch may not exist yet)."
        )
        return True

    result = subprocess.run(
        ["git", "rev-list", "--count", f"HEAD..origin/{branch}"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode == 0 and result.stdout.strip():
        behind_count = int(result.stdout.strip())
        if behind_count > 0:
            print_error(f"Local branch is behind remote by {behind_count} commit(s).")
            print_info(f"Pull changes first with: git pull origin {branch}")
            return False

    result = subprocess.run(
        ["git", "rev-list", "--count", f"origin/{branch}..HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode == 0 and result.stdout.strip():
        ahead_count = int(result.stdout.strip())
        if ahead_count > 0:
            print_warning(
                f"You have {ahead_count} unpushed commit(s) that will be included."
            )
            print_success("Local branch is ahead of remote (will push with release)")
            return True

    print_success("Local branch is in sync with remote")
    return True


def format_code(package_dir: Path) -> bool:
    """Format code with dart format (runs in package directory)."""
    print_header("STEP 4: FORMATTING CODE")

    result = run_command(
        ["dart", "format", "."], package_dir, "Formatting code", capture_output=True
    )

    if result.returncode != 0:
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
        return False

    use_shell = get_shell_mode()
    status = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=package_dir,  # repo root (package at root)
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if status.stdout.strip():
        print_info("Files were formatted - will be included in commit")
    else:
        print_success("All files already formatted")

    return True


def run_tests(package_dir: Path) -> bool:
    """Run dart test (in package directory)."""
    print_header("STEP 5: RUNNING TESTS")

    test_dir = package_dir / "test"
    if test_dir.exists():
        result = run_command(
            ["dart", "test"], package_dir, "Running unit tests", capture_output=True
        )
        if result.returncode != 0:
            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(result.stderr)
            return False
    else:
        print_warning("No test directory found, skipping unit tests")

    return True


# cspell:ignore keepends

def _analysis_options_without_plugins(path: Path) -> tuple[str, str] | None:
    """Read analysis_options.yaml and return (content_without_plugins, full_content).
    If no 'plugins:' section at root level, return None (no change needed).
    """
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        # Root-level key only: no leading space, key is "plugins:"
        if line.startswith("plugins:") and not line.strip().startswith("#"):
            # Strip from this line to end of file (entire plugins block)
            without_plugins = "".join(lines[:i])
            return (without_plugins.rstrip() + "\n", text)
    return None


def run_analysis(package_dir: Path) -> bool:
    """Run dart analyze (in package directory).
    Temporarily removes analyzer plugins from analysis_options.yaml to avoid
    plugin crashes (e.g. saropa_lints MetadataImpl/Iterable compatibility)
    then restores the file.
    """
    print_header("STEP 6: RUNNING STATIC ANALYSIS")

    opts_path = package_dir / "analysis_options.yaml"
    backup_path = package_dir / "analysis_options.yaml.publish_backup"
    modified = _analysis_options_without_plugins(opts_path)

    try:
        if modified is not None:
            without_plugins, original = modified
            backup_path.write_text(original, encoding="utf-8")
            opts_path.write_text(without_plugins, encoding="utf-8")
            print_info("Temporarily disabled analyzer plugins to avoid plugin crashes.")

        result = run_command(
            ["dart", "analyze", "--fatal-infos"], package_dir, "Analyzing code"
        )
        return result.returncode == 0
    finally:
        if backup_path.exists():
            shutil.copy2(backup_path, opts_path)
            backup_path.unlink()
            print_info("Restored analysis_options.yaml.")


def validate_changelog(package_dir: Path, version: str) -> tuple[bool, str]:
    """Validate version exists in CHANGELOG and get release notes."""
    print_header("STEP 7: VALIDATING CHANGELOG")
    print_info("Keep CHANGELOG.md in sync with every release (see https://keepachangelog.com).")

    release_notes = validate_changelog_version(package_dir, version)

    if release_notes is None:
        print_error(f"Version {version} not found in CHANGELOG.md")
        print_info("Add release notes before publishing.")
        return False, ""

    print_success(f"Found version {version} in CHANGELOG.md")

    if not release_notes:
        print_warning("Version header found but no release notes content.")
        response = (
            input(f"  Use generic message 'Release {version}'? [y/N] ").strip().lower()
        )
        if not response.startswith("y"):
            return False, ""
        release_notes = f"Release {version}"
    else:
        print_colored("  Release notes preview:", Color.CYAN)
        for line in release_notes.split("\n")[:10]:
            print_colored(f"    {line}", Color.WHITE)
        if release_notes.count("\n") > 10:
            print_colored("    ...", Color.WHITE)

    return True, release_notes


def generate_docs(package_dir: Path) -> bool:
    """Generate documentation with dart doc (in package directory)."""
    print_header("STEP 8: GENERATING DOCUMENTATION")

    result = run_command(
        ["dart", "doc"], package_dir, "Generating documentation", capture_output=True
    )

    return result.returncode == 0


def pre_publish_validation(package_dir: Path) -> bool:
    """Run dart pub publish --dry-run (in package directory)."""
    print_header("STEP 9: PRE-PUBLISH VALIDATION")

    if is_windows():
        print_warning(
            "Skipping dry-run validation on Windows (known Dart SDK 'nul' path bug)."
        )
        print_info("Validation will occur during actual publish.")
        return True

    print_info("Running pre-publish validation...")
    use_shell = get_shell_mode()

    result = subprocess.run(
        ["dart", "pub", "publish", "--dry-run"],
        cwd=package_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode in (0, 65):
        print_success("Package validated successfully")
        return True

    print_error("Pre-publish validation failed:")
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)
    return False


def git_commit_and_push(project_dir: Path, version: str, branch: str) -> bool:
    """Commit changes and push to remote (at repo root)."""
    print_header("STEP 10: COMMITTING AND PUSHING CHANGES")

    tag_name = f"v{version}"
    use_shell = get_shell_mode()

    result = run_command(["git", "add", "-A"], project_dir, "Staging changes")
    if result.returncode != 0:
        return False

    result = subprocess.run(
        ["git", "status", "--porcelain"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.stdout.strip():
        result = run_command(
            ["git", "commit", "-m", f"Release {tag_name}"],
            project_dir,
            f"Committing: Release {tag_name}",
        )
        if result.returncode != 0:
            return False

        result = run_command(
            ["git", "push", "origin", branch], project_dir, f"Pushing to {branch}"
        )
        if result.returncode != 0:
            return False
    else:
        print_warning("No changes to commit. Skipping commit step.")

    return True


def create_git_tag(project_dir: Path, version: str) -> bool:
    """Create and push git tag (at repo root)."""
    print_header("STEP 11: CREATING GIT TAG")

    tag_name = f"v{version}"
    use_shell = get_shell_mode()

    result = subprocess.run(
        ["git", "tag", "-l", tag_name],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.stdout.strip():
        print_warning(f"Tag {tag_name} already exists locally. Skipping tag creation.")
    else:
        result = run_command(
            ["git", "tag", "-a", tag_name, "-m", f"Release {tag_name}"],
            project_dir,
            f"Creating tag {tag_name}",
        )
        if result.returncode != 0:
            return False

    result = subprocess.run(
        ["git", "ls-remote", "--tags", "origin", tag_name],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.stdout.strip():
        print_warning(f"Tag {tag_name} already exists on remote. Skipping push.")
    else:
        result = run_command(
            ["git", "push", "origin", tag_name],
            project_dir,
            f"Pushing tag {tag_name}",
        )
        if result.returncode != 0:
            return False

    return True


def publish_to_pubdev(project_dir: Path) -> bool:
    """Notify that publishing happens automatically via GitHub Actions tag trigger."""
    print_header("STEP 12: PUBLISHING TO PUB.DEV VIA GITHUB ACTIONS")

    print_success("Tag push triggered GitHub Actions publish workflow!")
    print()
    print_colored("  Publishing is now running automatically on GitHub Actions.", Color.CYAN)
    print_colored("  No personal email will be shown on pub.dev.", Color.GREEN)
    print()

    remote_url = get_remote_url(project_dir)
    repo_path = extract_repo_path(remote_url)
    print_colored(
        f"  Monitor progress at: https://github.com/{repo_path}/actions", Color.CYAN
    )
    print()

    return True


def create_github_release(
    project_dir: Path, version: str, release_notes: str
) -> tuple[bool, str | None]:
    """Create GitHub release using gh CLI (at repo root)."""
    print_header("STEP 13: CREATING GITHUB RELEASE")

    tag_name = f"v{version}"
    use_shell = get_shell_mode()

    result = subprocess.run(
        ["gh", "release", "view", tag_name],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode == 0:
        print_warning(
            f"GitHub release {tag_name} already exists. Skipping release creation."
        )
        return True, None

    result = subprocess.run(
        [
            "gh",
            "release",
            "create",
            tag_name,
            "--title",
            f"Release {tag_name}",
            "--notes",
            release_notes,
        ],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )

    if result.returncode == 0:
        print_success(f"Created GitHub release {tag_name}")
        return True, None

    error_output = (result.stderr or "") + (result.stdout or "")
    if (
        "401" in error_output
        or "Bad credentials" in error_output
        or "authentication" in error_output.lower()
    ):
        return False, (
            "GitHub CLI auth failed. If GITHUB_TOKEN env var is set, clear it first:\n"
            '      PowerShell: $env:GITHUB_TOKEN = ""\n'
            "      Bash: unset GITHUB_TOKEN\n"
            "      Then run: gh auth status"
        )

    return False, f"GitHub release failed (exit code {result.returncode})"


def get_current_branch(project_dir: Path) -> str:
    """Get the current git branch name."""
    use_shell = get_shell_mode()
    result = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return "main"


def get_remote_url(project_dir: Path) -> str:
    """Get the git remote URL."""
    use_shell = get_shell_mode()
    result = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0:
        return result.stdout.strip()
    return ""


def extract_repo_path(remote_url: str) -> str:
    """Extract owner/repo from git remote URL."""
    match = re.search(r"github\.com[:/](.+?)(?:\.git)?$", remote_url)
    if match:
        return match.group(1)
    return "owner/repo"


# =============================================================================
# MAIN
# =============================================================================


def main() -> int:
    """Main entry point."""
    enable_ansi_support()
    show_saropa_logo()
    print_colored(
        f"  saropa_drift_viewer publisher script v{SCRIPT_VERSION}", Color.MAGENTA
    )
    print()

    # Repo root = package root (script lives in scripts/)
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    package_dir = project_dir

    pubspec_path = package_dir / "pubspec.yaml"
    if not pubspec_path.exists():
        exit_with_error(
            f"pubspec.yaml not found at {pubspec_path}",
            ExitCode.PREREQUISITES_FAILED,
        )

    changelog_path = package_dir / "CHANGELOG.md"
    if not changelog_path.exists():
        exit_with_error(
            f"CHANGELOG.md not found at {changelog_path}",
            ExitCode.PREREQUISITES_FAILED,
        )

    package_name = get_package_name(pubspec_path)
    version = get_version_from_pubspec(pubspec_path)
    branch = get_current_branch(project_dir)
    remote_url = get_remote_url(project_dir)

    if not re.match(r"^\d+\.\d+\.\d+$", version):
        exit_with_error(
            f"Invalid version format '{version}'. Use semantic versioning: MAJOR.MINOR.PATCH",
            ExitCode.VALIDATION_FAILED,
        )

    changelog_version = get_latest_changelog_version(changelog_path)
    if changelog_version is None:
        exit_with_error(
            "Could not extract version from CHANGELOG.md", ExitCode.CHANGELOG_FAILED
        )

    if version != changelog_version:
        pubspec_ver = parse_version(version)
        changelog_ver = parse_version(changelog_version)

        if changelog_ver > pubspec_ver:
            print_warning(
                f"Version mismatch: pubspec.yaml has {version}, "
                f"but CHANGELOG.md latest is {changelog_version}."
            )
            print_info(
                f"Updating pubspec.yaml version from {version} to "
                f"{changelog_version} to match CHANGELOG.md."
            )
            update_pubspec_version(pubspec_path, changelog_version)
            version = changelog_version
            print_success(f"pubspec.yaml updated to {version}")
        else:
            # pubspec has higher version: use it as source of truth
            if has_unreleased_section(changelog_path):
                print_warning(
                    f"Version mismatch: pubspec.yaml has {version}, "
                    f"CHANGELOG.md latest is {changelog_version}. Using pubspec version."
                )
                update_changelog_unreleased(changelog_path, version)
                print_success(f"CHANGELOG.md: [Unreleased] -> [{version}]")
                changelog_version = version
            else:
                exit_with_error(
                    f"Version mismatch: pubspec.yaml has {version}, "
                    f"but CHANGELOG.md latest is {changelog_version}. "
                    "Add a CHANGELOG.md entry (or [Unreleased] section) for the new "
                    "version before publishing.",
                    ExitCode.CHANGELOG_FAILED,
                )

    tag_name = f"v{version}"

    # If CHANGELOG already has this version as a released section and [Unreleased]
    # exists, this version is already released—do not re-publish it.
    if version == changelog_version and has_unreleased_section(changelog_path):
        next_version = bump_patch_version(version)
        print_warning(
            f"CHANGELOG.md shows {version} as already released and has [Unreleased] "
            "content. Publishing the same version again would be incorrect."
        )
        response = (
            input(
                f"  Would you like to publish as v{next_version} instead? [y/N] "
            )
            .strip()
            .lower()
        )
        if not response.startswith("y"):
            exit_with_error(
                "Publish cancelled. Bump version (or add [Unreleased] and run again).",
                ExitCode.USER_CANCELLED,
            )
        update_changelog_unreleased(changelog_path, next_version)
        print_success(f"CHANGELOG.md: [Unreleased] -> [{next_version}]")
        update_pubspec_version(pubspec_path, next_version)
        print_success(f"pubspec.yaml: {version} -> {next_version}")
        version = next_version
        tag_name = f"v{version}"

    use_shell = get_shell_mode()
    result = subprocess.run(
        ["git", "ls-remote", "--tags", "origin", f"refs/tags/{tag_name}"],
        cwd=project_dir,
        capture_output=True,
        text=True,
        shell=use_shell,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode == 0 and result.stdout.strip():
        if has_unreleased_section(changelog_path):
            next_version = bump_patch_version(version)
            print_warning(
                f"Tag {tag_name} already exists on remote. "
                "This version has already been released."
            )
            response = (
                input(
                    f"  Would you like to publish as v{next_version} instead? [y/N] "
                )
                .strip()
                .lower()
            )
            if not response.startswith("y"):
                exit_with_error(
                    "User cancelled version bump.", ExitCode.USER_CANCELLED
                )
            update_changelog_unreleased(changelog_path, next_version)
            print_success(f"CHANGELOG.md: [Unreleased] -> [{next_version}]")
            update_pubspec_version(pubspec_path, next_version)
            print_success(f"pubspec.yaml: {version} -> {next_version}")
            version = next_version
            tag_name = f"v{version}"
        else:
            next_version = bump_patch_version(version)
            print_warning(
                f"Tag {tag_name} already exists on remote. "
                "This version has already been released."
            )
            response = (
                input(
                    f"  Bump to v{next_version} and continue? [y/N] "
                )
                .strip()
                .lower()
            )
            if not response.startswith("y"):
                exit_with_error(
                    "Publish cancelled. Add an [Unreleased] section to "
                    "CHANGELOG.md and run again to enable version bumping.",
                    ExitCode.USER_CANCELLED,
                )
            add_unreleased_section(changelog_path)
            update_changelog_unreleased(changelog_path, next_version)
            print_success(f"CHANGELOG.md: [Unreleased] -> [{next_version}]")
            update_pubspec_version(pubspec_path, next_version)
            print_success(f"pubspec.yaml: {version} -> {next_version}")
            version = next_version
            tag_name = f"v{version}"

    print_header("SAROPA DRIFT VIEWER PUBLISHER")

    print_colored("  Package Information:", Color.WHITE)
    print_colored(f"      Name:       {package_name}", Color.CYAN)
    print_colored(f"      Version:    {version}", Color.CYAN)
    print_colored(f"      Tag:        v{version}", Color.CYAN)
    print_colored(f"      Branch:     {branch}", Color.CYAN)
    print_colored(f"      Repository: {remote_url}", Color.CYAN)
    print()

    display_changelog(package_dir)

    # Workflow steps
    if not check_prerequisites(project_dir):
        exit_with_error("Prerequisites check failed", ExitCode.PREREQUISITES_FAILED)

    ok, _ = check_working_tree(project_dir)
    if not ok:
        exit_with_error(
            "Aborted by user. Commit or stash your changes first.",
            ExitCode.USER_CANCELLED,
        )

    if not check_remote_sync(project_dir, branch):
        exit_with_error("Remote sync check failed", ExitCode.WORKING_TREE_FAILED)

    if not format_code(package_dir):
        exit_with_error("Code formatting failed", ExitCode.VALIDATION_FAILED)

    if not run_tests(package_dir):
        exit_with_error(
            "Tests failed. Fix test failures before publishing.", ExitCode.TEST_FAILED
        )

    if not run_analysis(package_dir):
        exit_with_error(
            "Static analysis failed. Fix issues before publishing.",
            ExitCode.ANALYSIS_FAILED,
        )

    ok, release_notes = validate_changelog(package_dir, version)
    if not ok:
        exit_with_error("CHANGELOG validation failed", ExitCode.CHANGELOG_FAILED)

    if not generate_docs(package_dir):
        exit_with_error("Documentation generation failed", ExitCode.VALIDATION_FAILED)

    if not pre_publish_validation(package_dir):
        exit_with_error("Pre-publish validation failed", ExitCode.VALIDATION_FAILED)

    if not git_commit_and_push(project_dir, version, branch):
        exit_with_error("Git operations failed", ExitCode.GIT_FAILED)

    if not create_git_tag(project_dir, version):
        exit_with_error("Git tag creation failed", ExitCode.GIT_FAILED)

    if not publish_to_pubdev(project_dir):
        exit_with_error("Failed to trigger GitHub Actions publish", ExitCode.PUBLISH_FAILED)

    gh_success, gh_error = create_github_release(project_dir, version, release_notes)

    print()
    print_colored("=" * 70, Color.GREEN)
    print_colored(f"  RELEASE v{version} TRIGGERED!", Color.GREEN)
    print_colored("=" * 70, Color.GREEN)
    print()

    repo_path = extract_repo_path(remote_url)
    print_colored("  Publishing is running on GitHub Actions.", Color.CYAN)
    print_colored("  No personal email will be shown on pub.dev.", Color.GREEN)
    print()
    print_colored("  Monitor progress:", Color.WHITE)
    print_colored(
        f"      GitHub Actions: https://github.com/{repo_path}/actions", Color.CYAN
    )
    print_colored(
        f"      Package:        https://pub.dev/packages/{package_name}", Color.CYAN
    )

    if gh_success:
        print_colored(
            f"      Release:        https://github.com/{repo_path}/releases/tag/v{version}",
            Color.CYAN,
        )
    else:
        print()
        print_warning(f"GitHub release was not created: {gh_error}")
        print_colored("      To create it manually, run:", Color.YELLOW)
        print_colored("          gh auth login", Color.WHITE)
        print_colored(
            f'          gh release create v{version} --title "Release v{version}" --notes-file CHANGELOG.md',
            Color.WHITE,
        )
    print()

    if not package_on_pub_dev(package_name):
        print_colored(
            "  Package is not yet on pub.dev. Run locally: dart pub publish",
            Color.YELLOW,
        )
        response = (
            input("  Run 'dart pub publish' now? [y/N] ").strip().lower()
        )
        if response.startswith("y"):
            print()
            print_colored("  Running: dart pub publish", Color.CYAN)
            use_shell = get_shell_mode()
            result = subprocess.run(
                ["dart", "pub", "publish"],
                cwd=package_dir,
                shell=use_shell,
            )
            if result.returncode != 0:
                print_warning(
                    f"dart pub publish exited with code {result.returncode}. "
                    "Fix any errors and run it again from the package directory."
                )
        print()

    try:
        webbrowser.open(f"https://github.com/{repo_path}/actions")
    except Exception:
        pass

    return ExitCode.SUCCESS.value


if __name__ == "__main__":
    sys.exit(main())
