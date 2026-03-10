# -*- coding: utf-8 -*-
"""Version validation and CHANGELOG management.

Handles version resolution, CHANGELOG stamping, and tag availability
checks. These are the most complex pre-publish validations; keeping
them separate from git/build checks improves readability.
"""

from __future__ import annotations

import datetime
import os
import re
import sys
from typing import TYPE_CHECKING

from modules.constants import C, CHANGELOG_PATH, TAG_PREFIX
from modules.display import ask_yn, fail, fix, ok, warn

if TYPE_CHECKING:
    from modules.target_config import TargetConfig


# ── Helpers ───────────────────────────────────────────────


def _changelog_for(config: TargetConfig | None) -> str:
    """Return the CHANGELOG path for the given config (or legacy default)."""
    if config is not None:
        return config.changelog_path
    return CHANGELOG_PATH


def _tag_prefix_for(config: TargetConfig | None) -> str:
    """Return the tag prefix for the given config (or legacy default)."""
    if config is not None:
        return config.tag_prefix
    return TAG_PREFIX


def _parse_semver(version: str) -> tuple[int, ...]:
    """Parse a semver string into a tuple of ints for comparison."""
    return tuple(int(x) for x in version.split("."))


def _get_changelog_max_version(
    config: TargetConfig | None = None,
) -> str | None:
    """Return the highest versioned heading in CHANGELOG.md, or None."""
    changelog_path = _changelog_for(config)
    versions: list[str] = []
    try:
        with open(changelog_path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r'^## \[(\d+\.\d+\.\d+)\]', line)
                if m:
                    versions.append(m.group(1))
    except OSError:
        return None
    if not versions:
        return None
    return max(versions, key=_parse_semver)


def _bump_patch(version: str) -> str:
    """Increment the patch component of a semver string."""
    major, minor, patch = version.split(".")
    return f"{major}.{minor}.{int(patch) + 1}"


# ── User Prompts ──────────────────────────────────────────


def _ask_version(current: str) -> str | None:
    """Prompt user to confirm or override the version. Returns version or None."""
    if not sys.stdin.isatty():
        # Non-interactive (e.g. IDE terminal with no stdin): accept default
        return current
    try:
        answer = input(
            f"  {C.YELLOW}Publish as v{current}? "
            f"[Y/n/version]: {C.RESET}",
        ).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        return None
    if not answer or answer.lower() in ("y", "yes"):
        return current
    if answer.lower() in ("n", "no"):
        return None
    # Treat as a version string -- validate basic semver shape
    if re.match(r'^\d+\.\d+\.\d+$', answer):
        return answer
    fail(f"Invalid version format: {answer} (expected x.y.z)")
    return None


def _offer_bump_and_apply(
    current: str,
    next_ver: str,
    fail_msg: str,
    default_yes: bool = True,
    config: TargetConfig | None = None,
) -> tuple[str, bool]:
    """Ask to bump; if yes, write version file and report. Returns (version, ok)."""
    if not ask_yn(f"Bump to v{next_ver}?", default=default_yes):
        fail(fail_msg)
        return current, False
    if not _write_version(next_ver, config):
        return current, False
    label = _version_file_label(config)
    fix(f"{label}: {current} -> {C.WHITE}{next_ver}{C.RESET}")
    return next_ver, True


# ── Version File Write ────────────────────────────────────


def _version_file_label(config: TargetConfig | None) -> str:
    """Return a human-readable label for the version file."""
    if config is not None:
        return os.path.basename(config.version_file)
    return "package.json"


def _write_version(version: str, config: TargetConfig | None = None) -> bool:
    """Write *version* into the target's version file."""
    from modules.target_config import EXTENSION, write_version
    return write_version(config if config is not None else EXTENSION, version)


# ── CHANGELOG ─────────────────────────────────────────────


# Keywords that mean "changelog not yet published" (any triggers auto-bump when tag exists).
_UNPUBLISHED_HEADING_RE = re.compile(
    r'^##\s*\[(?:Unreleased|Unpublished|Undefined)\]', re.IGNORECASE | re.MULTILINE
)

# First release heading: ## [x.y.z] or ## [x.y.z] - date (so we know where to insert [Unreleased])
_FIRST_RELEASE_HEADING_RE = re.compile(r'^##\s*\[\d+\.\d+\.\d+\]', re.MULTILINE)


def _changelog_has_unpublished_heading(
    config: TargetConfig | None = None,
) -> bool:
    """True if CHANGELOG has ## [Unreleased], [Unpublished], or [Undefined]."""
    changelog_path = _changelog_for(config)
    try:
        with open(changelog_path, encoding="utf-8") as f:
            for line in f:
                if _UNPUBLISHED_HEADING_RE.match(line):
                    return True
    except OSError:
        pass
    return False


def _ensure_unreleased_section(
    config: TargetConfig | None = None,
) -> bool:
    """If CHANGELOG has no ## [Unreleased], insert it before the first ## [x.y.z] section."""
    if _changelog_has_unpublished_heading(config):
        return True
    changelog_path = _changelog_for(config)
    try:
        with open(changelog_path, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        fail("Could not read CHANGELOG.md")
        return False
    match = _FIRST_RELEASE_HEADING_RE.search(content)
    if not match:
        fail("CHANGELOG.md has no ## [Unreleased] and no ## [x.y.z] release heading.")
        return False
    insert = "## [Unreleased]\n\n"
    new_content = content[: match.start()] + insert + content[match.start() :]
    try:
        with open(changelog_path, "w", encoding="utf-8") as f:
            f.write(new_content)
    except OSError:
        fail("Could not write CHANGELOG.md")
        return False
    fix("Added ## [Unreleased] to CHANGELOG.md")
    return True


def _stamp_changelog(
    version: str,
    config: TargetConfig | None = None,
) -> bool:
    """Replace '## [Unreleased]' with '## [version] - date'."""
    changelog_path = _changelog_for(config)
    try:
        with open(changelog_path, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        fail("Could not read CHANGELOG.md")
        return False

    today = datetime.datetime.now().strftime("%Y-%m-%d")
    replacement = f'## [{version}] - {today}'
    updated, count = _UNPUBLISHED_HEADING_RE.subn(replacement, content, count=1)
    if count == 0:
        fail("Could not find '## [Unreleased]' (or [Unpublished]/[Undefined]) in CHANGELOG.md")
        return False

    try:
        with open(changelog_path, "w", encoding="utf-8") as f:
            f.write(updated)
    except OSError:
        fail("Could not write CHANGELOG.md")
        return False

    ok(f"CHANGELOG: [Unreleased] -> [{version}] - {today}")
    return True


# ── Tag Availability ──────────────────────────────────────


def _is_tagged(version: str, config: TargetConfig | None = None) -> bool:
    """Check whether the version tag already exists (target-aware)."""
    from modules.git_ops import is_version_tagged
    prefix = _tag_prefix_for(config)
    return is_version_tagged(version, prefix)


def _ensure_untagged_version(
    version: str,
    config: TargetConfig | None = None,
) -> tuple[str, bool]:
    """If the version is already tagged, offer to bump patch.

    Keeps bumping until an available tag is found or the user declines.
    Returns (resolved_version, success).
    """
    prefix = _tag_prefix_for(config)
    original = version
    while _is_tagged(version, config):
        next_ver = _bump_patch(version)
        warn(f"Tag '{prefix}{version}' already exists.")
        if not ask_yn(f"Bump to {next_ver}?", default=True):
            fail("Version already tagged. Bump manually.")
            return version, False
        version = next_ver

    if version != original:
        if not _write_version(version, config):
            return version, False
        label = _version_file_label(config)
        fix(f"{label}: {original} -> {C.WHITE}{version}{C.RESET}")
    ok(f"Tag '{prefix}{version}' is available")
    return version, True


# ── Main Validation ───────────────────────────────────────


def _resolve_tagged_stale(
    pkg_version: str,
    next_ver: str,
    max_cl: str,
    config: TargetConfig | None,
) -> tuple[str, bool | None]:
    """Handle stale version when tag already exists. Returns (version, result)."""
    prefix = _tag_prefix_for(config)
    label = _version_file_label(config)
    warn(f"{prefix}{pkg_version} is already released (tag exists).")

    if _changelog_has_unpublished_heading(config):
        pkg_version, bump_ok = _offer_bump_and_apply(
            pkg_version, next_ver,
            "Version already tagged; bump to release changelog.",
            config=config,
        )
        return pkg_version, (None if bump_ok else False)

    if ask_yn(f"Publish v{pkg_version} as-is (e.g. sync)?", default=True):
        ok(f"Publishing v{pkg_version} as-is")
        return pkg_version, True
    pkg_version, bump_ok = _offer_bump_and_apply(
        pkg_version, next_ver,
        f"Set {label} version higher than {max_cl}",
        config=config,
    )
    return pkg_version, (None if bump_ok else False)


def _resolve_stale_version(
    pkg_version: str,
    max_cl: str,
    config: TargetConfig | None,
) -> tuple[str, bool | None]:
    """Handle version <= CHANGELOG max. Returns (version, result).

    *result* is True/False for early return, or None to continue.
    """
    next_ver = _bump_patch(max_cl)

    if _is_tagged(pkg_version, config):
        return _resolve_tagged_stale(pkg_version, next_ver, max_cl, config)

    label = _version_file_label(config)
    warn(f"{label} v{pkg_version} <= CHANGELOG max v{max_cl}")
    pkg_version, bump_ok = _offer_bump_and_apply(
        pkg_version, next_ver,
        f"Set {label} version higher than {max_cl}",
        config=config,
    )
    if not bump_ok:
        if not ask_yn(
            f"Publish v{pkg_version} as-is (no CHANGELOG stamp)?",
            default=False,
        ):
            fail(f"Set {label} version higher than {max_cl}")
            return pkg_version, False
        ok(f"Publishing v{pkg_version} as-is")
        return pkg_version, True
    return pkg_version, None


def _confirm_version(
    version: str,
    config: TargetConfig | None,
) -> tuple[str, bool]:
    """Prompt user to confirm or override the version. Returns (version, ok)."""
    prefix = _tag_prefix_for(config)
    label = _version_file_label(config)

    if os.environ.get("PUBLISH_YES"):
        confirmed = version
    else:
        confirmed = _ask_version(version)
    if confirmed is None:
        fail("Version not confirmed. Press Y or Enter to confirm, or run with --yes.")
        return version, False
    if confirmed != version:
        if _is_tagged(confirmed, config):
            fail(f"Tag '{prefix}{confirmed}' already exists.")
            return confirmed, False
        if not _write_version(confirmed, config):
            return confirmed, False
        fix(f"{label}: {version} -> {C.WHITE}{confirmed}{C.RESET}")
        version = confirmed
    return version, True


def validate_version_changelog(
    config: TargetConfig | None = None,
) -> tuple[str, bool]:
    """Validate version, resolve tag conflicts, confirm, and stamp CHANGELOG."""
    label = _version_file_label(config)

    from modules.target_config import EXTENSION, read_version
    pkg_version = read_version(config if config is not None else EXTENSION)
    if pkg_version == "unknown":
        fail(f"Could not read version from {label}")
        return pkg_version, False

    max_cl = _get_changelog_max_version(config)
    if max_cl and _parse_semver(pkg_version) <= _parse_semver(max_cl):
        pkg_version, result = _resolve_stale_version(pkg_version, max_cl, config)
        if result is not None:
            return pkg_version, result

    if not _changelog_has_unpublished_heading(config):
        if not _ensure_unreleased_section(config):
            return pkg_version, False

    version, tag_ok = _ensure_untagged_version(pkg_version, config)
    if not tag_ok:
        return version, False

    version, confirmed = _confirm_version(version, config)
    if not confirmed:
        return version, False

    if not _stamp_changelog(version, config):
        return version, False

    ok(f"Version {C.WHITE}{version}{C.RESET} validated")
    return version, True


def sync_package_json_to_pubspec() -> bool:
    """Sync package.json version to match pubspec.yaml (for ``all`` mode)."""
    from modules.target_config import DART, EXTENSION, read_version, write_version
    dart_ver = read_version(DART)
    if dart_ver == "unknown":
        fail("Could not read version from pubspec.yaml")
        return False
    ext_ver = read_version(EXTENSION)
    if ext_ver == dart_ver:
        ok(f"package.json already at {dart_ver}")
        return True
    if not write_version(EXTENSION, dart_ver):
        return False
    fix(f"package.json: {ext_ver} -> {C.WHITE}{dart_ver}{C.RESET}")
    return True
