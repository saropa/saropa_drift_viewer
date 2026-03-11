# -*- coding: utf-8 -*-
"""Constants, exit codes, and color setup for the publish pipeline."""

import os

# Resolve paths relative to this file (scripts/modules/constants.py).
_MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT_DIR = os.path.dirname(_MODULE_DIR)
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
EXTENSION_DIR = os.path.join(REPO_ROOT, "extension")

# Dart package paths.
PUBSPEC_PATH = os.path.join(REPO_ROOT, "pubspec.yaml")
PACKAGE_JSON_PATH = os.path.join(EXTENSION_DIR, "package.json")
CHANGELOG_PATH = os.path.join(REPO_ROOT, "CHANGELOG.md")
TEST_DIR = os.path.join(REPO_ROOT, "test")
LIB_DIR = os.path.join(REPO_ROOT, "lib")

# Maximum lines allowed per TypeScript source file.
MAX_FILE_LINES = 300

# Git tag prefix — distinct from Dart package tags (which use "v").
TAG_PREFIX = "ext-v"

MARKETPLACE_EXTENSION_ID = "saropa.drift-viewer"
MARKETPLACE_URL = (
    "https://marketplace.visualstudio.com"
    f"/items?itemName={MARKETPLACE_EXTENSION_ID}"
)
REPO_URL = "https://github.com/saropa/saropa_drift_advisor"
OPENVSX_URL = "https://open-vsx.org/extension/saropa/drift-viewer"

# cspell:ignore urrent startfile unpushed

# VS Code extensions required for development (none yet).
REQUIRED_VSCODE_EXTENSIONS: list[str] = []

# Global npm packages required for scaffolding/publishing (none yet).
REQUIRED_GLOBAL_NPM_PACKAGES: list[str] = []


# ── Exit Codes ──────────────────────────────────────────────


class ExitCode:
    """Exit codes for each failure category."""
    SUCCESS = 0
    PREREQUISITE_FAILED = 1
    WORKING_TREE_DIRTY = 2
    REMOTE_SYNC_FAILED = 3
    DEPENDENCY_FAILED = 4
    COMPILE_FAILED = 5
    TEST_FAILED = 6
    QUALITY_FAILED = 7
    VERSION_INVALID = 8
    CHANGELOG_FAILED = 9
    PACKAGE_FAILED = 10
    GIT_FAILED = 11
    PUBLISH_FAILED = 12
    RELEASE_FAILED = 13
    USER_CANCELLED = 14
    OPENVSX_FAILED = 15


# ── Color Setup ──────────────────────────────────────────────
# Uses ANSI escape codes directly. colorama is optional on Windows
# to ensure the terminal interprets escape sequences correctly.


class _AnsiColors:
    """ANSI 256-color escape codes for terminal output."""
    RESET: str = "\033[0m"
    BOLD: str = "\033[1m"
    DIM: str = "\033[2m"
    GREEN: str = "\033[92m"
    YELLOW: str = "\033[93m"
    RED: str = "\033[91m"
    BLUE: str = "\033[94m"
    CYAN: str = "\033[96m"
    MAGENTA: str = "\033[95m"
    WHITE: str = "\033[97m"
    # Extended 256-color palette for the Saropa logo gradient.
    ORANGE_208: str = "\033[38;5;208m"
    ORANGE_209: str = "\033[38;5;209m"
    YELLOW_215: str = "\033[38;5;215m"
    YELLOW_220: str = "\033[38;5;220m"
    YELLOW_226: str = "\033[38;5;226m"
    GREEN_190: str = "\033[38;5;190m"
    GREEN_154: str = "\033[38;5;154m"
    GREEN_118: str = "\033[38;5;118m"
    CYAN_123: str = "\033[38;5;123m"
    CYAN_87: str = "\033[38;5;87m"
    BLUE_51: str = "\033[38;5;51m"
    BLUE_45: str = "\033[38;5;45m"
    BLUE_39: str = "\033[38;5;39m"
    BLUE_33: str = "\033[38;5;33m"
    BLUE_57: str = "\033[38;5;57m"
    PINK_195: str = "\033[38;5;195m"
    LIGHT_BLUE_117: str = "\033[38;5;117m"


# Try to initialise colorama for Windows compatibility; fall back gracefully.
# ANSI codes work natively in VS Code terminal and Windows Terminal,
# so we always use _AnsiColors. colorama.init() just ensures older
# Windows consoles (cmd.exe) interpret the escape sequences correctly.
try:
    import colorama # type: ignore
    colorama.init(autoreset=False)
    C = _AnsiColors
except ImportError:
    C = _AnsiColors
