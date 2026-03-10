# -*- coding: utf-8 -*-
"""Shell execution, timing helpers, and backward-compatibility re-exports."""

import json
import os
import shutil
import subprocess
import sys
import time

from modules.constants import EXTENSION_DIR, MARKETPLACE_EXTENSION_ID, REPO_ROOT, TAG_PREFIX


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess[str]:
    """Run a shell command and return the result.

    shell=True is needed on Windows so that npm/npx/.cmd scripts resolve
    via PATH through cmd.exe. On macOS/Linux, shell=False is safer and
    avoids quoting issues.
    """
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        shell=(sys.platform == "win32"),
        **kwargs,
    )


def elapsed_str(seconds: float) -> str:
    """Format elapsed seconds as a human-readable string."""
    if seconds < 1:
        return f"{seconds * 1000:.0f}ms"
    return f"{seconds:.1f}s"


def run_step(
    name: str,
    fn: object,
    results: list[tuple[str, bool, float]],
) -> bool:
    """Time and record a single pipeline step."""
    t0 = time.time()
    passed = fn()  # type: ignore[operator]
    elapsed = time.time() - t0
    results.append((name, passed, elapsed))
    return passed


def command_exists(cmd: str) -> bool:
    """Return True if *cmd* is found on PATH."""
    return shutil.which(cmd) is not None


# ── Backward-compatibility re-exports ─────────────────────
# These functions have moved to ext_prereqs / git_ops / target_config,
# but are kept here so existing callers (checks_version, publish_extension)
# continue to work without changes.


def get_ovsx_pat() -> str:
    """Delegates to ext_prereqs.get_ovsx_pat()."""
    from modules.ext_prereqs import get_ovsx_pat as _get_ovsx_pat
    return _get_ovsx_pat()


def get_installed_extension_versions(
    extension_id: str = MARKETPLACE_EXTENSION_ID,
) -> dict[str, str]:
    """Delegates to ext_prereqs.get_installed_extension_versions()."""
    from modules.ext_prereqs import get_installed_extension_versions as _get
    return _get(extension_id)


def read_package_version() -> str:
    """Read the extension version from package.json."""
    pkg_path = os.path.join(EXTENSION_DIR, "package.json")
    try:
        with open(pkg_path, encoding="utf-8") as f:
            data = json.load(f)
        return data.get("version", "unknown")
    except (OSError, json.JSONDecodeError):
        return "unknown"


def is_version_tagged(version: str) -> bool:
    """Check whether ext-v{version} tag already exists."""
    tag = f"{TAG_PREFIX}{version}"
    result = run(["git", "tag", "-l", tag], cwd=REPO_ROOT)
    return bool(result.stdout.strip())
