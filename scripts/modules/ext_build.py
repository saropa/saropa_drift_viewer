# -*- coding: utf-8 -*-
"""Extension build steps: dependencies, compile, test, quality."""

import os

from modules.constants import C, MAX_FILE_LINES, EXTENSION_DIR, REPO_ROOT
from modules.display import fail, fix, info, ok, print_cmd_output
from modules.utils import run


def ensure_dependencies() -> bool:
    """Run npm install if node_modules is stale or missing."""
    node_modules = os.path.join(EXTENSION_DIR, "node_modules")
    pkg_json = os.path.join(EXTENSION_DIR, "package.json")

    if not os.path.isfile(pkg_json):
        fail("package.json not found.")
        return False

    if not os.path.isdir(node_modules):
        fix("node_modules/ missing -- running npm install...")
        return _run_npm_install()

    lock = os.path.join(node_modules, ".package-lock.json")
    if os.path.isfile(lock):
        if os.path.getmtime(pkg_json) > os.path.getmtime(lock):
            fix("package.json newer than lockfile -- running npm install...")
            return _run_npm_install()

    ok("node_modules/ up to date")
    return True


def _run_npm_install() -> bool:
    """Run npm install and report result."""
    result = run(["npm", "install"], cwd=EXTENSION_DIR, check=False)
    if result.returncode != 0:
        fail(f"npm install failed: {result.stderr.strip()}")
        return False
    ok("npm install completed")
    return True


def step_compile() -> bool:
    """Run the TypeScript compiler (``npm run compile``)."""
    info("Running npm run compile...")
    result = run(["npm", "run", "compile"], cwd=EXTENSION_DIR, check=False)
    if result.returncode != 0:
        fail("Compile failed:")
        print_cmd_output(result)
        return False
    ok("Compile passed (tsc)")
    return True


def step_test() -> bool:
    """Run the test suite via ``npm run test``."""
    info("Running npm run test...")
    result = run(["npm", "run", "test"], cwd=EXTENSION_DIR, check=False)
    if result.returncode != 0:
        fail("Tests failed:")
        print_cmd_output(result)
        return False
    ok("Tests passed")
    return True


def check_file_line_limits() -> bool:
    """Block on .ts files exceeding the line limit."""
    src_dir = os.path.join(EXTENSION_DIR, "src")
    violations: list[str] = []

    for dirpath, _dirs, filenames in os.walk(src_dir):
        for fname in filenames:
            if not fname.endswith(".ts"):
                continue
            filepath = os.path.join(dirpath, fname)
            with open(filepath, encoding="utf-8") as f:
                count = sum(1 for _ in f)
            if count > MAX_FILE_LINES:
                rel = os.path.relpath(filepath, REPO_ROOT)
                violations.append(f"{rel} ({count} lines)")

    if violations:
        fail(f"{len(violations)} file(s) exceed {MAX_FILE_LINES}-line limit:")
        for v in violations:
            print(f"         {C.RED}{v}{C.RESET}")
        return False

    ok(f"All .ts files are within the {MAX_FILE_LINES}-line limit")
    return True
