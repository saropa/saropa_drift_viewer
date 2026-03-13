# -*- coding: utf-8 -*-
"""Publish target configuration and version read/write helpers."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field

from modules.constants import (
    CHANGELOG_PATH,
    EXTENSION_DIR,
    PACKAGE_JSON_PATH,
    PUBSPEC_PATH,
    REPO_ROOT,
)
from modules.display import fail


@dataclass(frozen=True)
class TargetConfig:
    """Describes one publishable target (Dart package or VS Code extension)."""

    name: str
    display_name: str
    tag_prefix: str
    version_file: str
    work_dir: str
    git_stage_paths: tuple[str, ...] = field(default_factory=tuple)
    commit_msg_fmt: str = "Release {version}"

    @property
    def changelog_path(self) -> str:
        """Shared CHANGELOG.md at repo root."""
        return CHANGELOG_PATH


DART = TargetConfig(
    name="dart",
    display_name="Dart Package",
    tag_prefix="v",
    version_file=PUBSPEC_PATH,
    work_dir=REPO_ROOT,
    git_stage_paths=(".",),
    commit_msg_fmt="Release v{version}",
)

EXTENSION = TargetConfig(
    name="extension",
    display_name="VS Code Extension",
    tag_prefix="ext-v",
    version_file=PACKAGE_JSON_PATH,
    work_dir=EXTENSION_DIR,
    git_stage_paths=("extension/", "scripts/"),
    commit_msg_fmt="Release ext-v{version}",
)


# ── Version read / write ─────────────────────────────────


_SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def _parse_semver_tuple(version: str) -> tuple[int, int, int]:
    """Parse a semver string into (major, minor, patch) for comparison."""
    parts = version.split(".")
    return (int(parts[0]), int(parts[1]), int(parts[2])) if len(parts) == 3 else (0, 0, 0)


def _get_changelog_max_version() -> str | None:
    """Return the highest version from ## [x.y.z] headings in CHANGELOG.md."""
    versions: list[str] = []
    try:
        with open(CHANGELOG_PATH, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^## \[(\d+\.\d+\.\d+)\]", line)
                if m:
                    versions.append(m.group(1))
    except OSError:
        return None
    if not versions:
        return None
    return max(versions, key=_parse_semver_tuple)


def read_max_version() -> str:
    """Return the largest version from pubspec.yaml, package.json, and CHANGELOG.

    Used as the canonical version for the extension so a stale package.json
    does not override pubspec or CHANGELOG. Returns \"unknown\" if no valid
    version is found in any source.
    """
    candidates: list[str] = []
    for config in (DART, EXTENSION):
        v = read_version(config)
        if v != "unknown" and _SEMVER_RE.match(v):
            candidates.append(v)
    cl_max = _get_changelog_max_version()
    if cl_max:
        candidates.append(cl_max)
    if not candidates:
        return "unknown"
    return max(candidates, key=_parse_semver_tuple)


def read_version(config: TargetConfig) -> str:
    """Read the current version from the target's version file.

    Returns "unknown" if the file cannot be read or parsed.
    """
    try:
        with open(config.version_file, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return "unknown"

    if config.name == "dart":
        match = re.search(
            r"^version:\s*(\d+\.\d+\.\d+)", content, re.MULTILINE,
        )
        return match.group(1) if match else "unknown"

    # Extension: package.json
    try:
        data = json.loads(content)
        return data.get("version", "unknown")
    except json.JSONDecodeError:
        return "unknown"


def write_version(config: TargetConfig, version: str) -> bool:
    """Write *version* into the target's version file."""
    filename = os.path.basename(config.version_file)
    try:
        with open(config.version_file, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        fail(f"Could not read {filename}")
        return False

    if config.name == "dart":
        pattern = r"^(version:\s*)\d+\.\d+\.\d+"
        replacement = rf"\g<1>{version}"
        updated, count = re.subn(pattern, replacement, content, count=1, flags=re.MULTILINE)
    else:
        pattern = r'("version"\s*:\s*")([^"]+)(")'
        replacement = rf"\g<1>{version}\3"
        updated, count = re.subn(pattern, replacement, content, count=1)
    if count == 0:
        fail(f"Could not find 'version' in {filename}")
        return False

    try:
        with open(config.version_file, "w", encoding="utf-8") as f:
            f.write(updated)
    except OSError:
        fail(f"Could not write {filename}")
        return False
    return True


def sync_versions(version: str) -> bool:
    """Write *version* to both pubspec.yaml and package.json."""
    ok_dart = write_version(DART, version)
    ok_ext = write_version(EXTENSION, version)
    return ok_dart and ok_ext
