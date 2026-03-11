# -*- coding: utf-8 -*-
"""Local .vsix install workflow and report opener."""

import os
import shutil
import subprocess
import sys

from modules.constants import C
from modules.display import ask_yn, fail, heading, info, ok, warn
from modules.utils import run


def print_install_instructions(vsix_path: str) -> None:
    """Print instructions for installing the .vsix in VS Code."""
    vsix_name = os.path.basename(vsix_path)
    abs_path = os.path.abspath(vsix_path)

    heading("Install Instructions")

    opt = f"{C.BOLD}{C.CYAN}"
    key = f"{C.YELLOW}"
    rst = C.RESET

    print(f"""
  {opt}Option 1 -- Command Palette (recommended):{rst}

    1. Open VS Code
    2. Press  {key}Ctrl+Shift+P{rst}  (macOS: {key}Cmd+Shift+P{rst})
    3. Type:  {key}Extensions: Install from VSIX...{rst}
    4. Browse to:
       {C.WHITE}{abs_path}{rst}
    5. Click {key}"Install"{rst}
    6. Reload VS Code when prompted

  {opt}Option 2 -- Command line:{rst}

    {C.WHITE}code --install-extension {vsix_name}{rst}

  {opt}Option 3 -- Drag and drop:{rst}

    1. Open VS Code
    2. Open the Extensions sidebar  ({key}Ctrl+Shift+X{rst})
    3. Drag the .vsix file into the Extensions sidebar

  {opt}After installing:{rst}

    - Press {key}Ctrl+Shift+P{rst} and type {key}"Saropa Drift Advisor"{rst} to see all commands
    - Use {key}"Saropa Drift Advisor: Open in Browser"{rst} to open the debug viewer
    - Use {key}"Saropa Drift Advisor: Open in Editor Panel"{rst} for an embedded panel
""")


def prompt_install(vsix_path: str) -> None:
    """Ask the user whether to install the .vsix via the code CLI.

    On Windows, ``code --install-extension`` opens a VS Code window as a
    side effect.  The prompt warns about this so the user can choose the
    Command Palette method instead.
    """
    if not shutil.which("code"):
        warn("VS Code CLI (code) not found on PATH -- cannot auto-install.")
        info("Add it via: VS Code > Ctrl+Shift+P > "
             "'Shell Command: Install code command in PATH'")
        return

    prompt = "Install via CLI now?"
    if sys.platform == "win32":
        prompt = "Install via CLI now? (will briefly open a VS Code window)"
    if not ask_yn(prompt, default=False):
        return

    vsix_name = os.path.basename(vsix_path)
    info(f"Running: code --install-extension {vsix_name}")
    result = run(
        ["code", "--install-extension", os.path.abspath(vsix_path)],
    )
    if result.returncode != 0:
        fail(f"Install failed: {result.stderr.strip()}")
        return
    ok("Extension installed successfully!")
    info("Reload VS Code to activate the updated extension.")


# cspell:ignore startfile
def prompt_open_report(report_path: str) -> None:
    """Ask the user whether to open the build report."""
    if not ask_yn("Open build report?", default=False):
        return

    abs_path = os.path.abspath(report_path)
    if sys.platform == "win32":
        os.startfile(abs_path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", abs_path])
    else:
        subprocess.Popen(["xdg-open", abs_path])
