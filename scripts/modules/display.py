# -*- coding: utf-8 -*-
"""Terminal display helpers, publish log, and the Saropa logo."""

import os
import re
import sys
from datetime import datetime

from modules.constants import C, REPO_ROOT


# ── Display Helpers ──────────────────────────────────────────


def heading(text: str) -> None:
    """Print a bold section heading."""
    bar = "=" * 60
    print(f"\n{C.CYAN}{bar}{C.RESET}")
    print(f"  {C.BOLD}{C.WHITE}{text}{C.RESET}")
    print(f"{C.CYAN}{bar}{C.RESET}")


def ok(text: str) -> None:
    print(f"  {C.GREEN}[OK]{C.RESET}   {text}")


def fix(text: str) -> None:
    """An issue was found and automatically repaired."""
    print(f"  {C.MAGENTA}[FIX]{C.RESET}  {text}")


def fail(text: str) -> None:
    print(f"  {C.RED}[FAIL]{C.RESET} {text}")


def warn(text: str) -> None:
    print(f"  {C.YELLOW}[WARN]{C.RESET} {text}")


def info(text: str) -> None:
    print(f"  {C.BLUE}[INFO]{C.RESET} {text}")


def print_cmd_output(result) -> None:
    """Print stdout/stderr from a subprocess result (if non-empty)."""
    if hasattr(result, "stdout") and result.stdout and result.stdout.strip():
        print(result.stdout)
    if hasattr(result, "stderr") and result.stderr and result.stderr.strip():
        print(result.stderr)


def dim(text: str) -> str:
    """Wrap text in dim ANSI codes for secondary information."""
    return f"{C.DIM}{text}{C.RESET}"


def ask_yn(question: str, default: bool = True) -> bool:
    """Prompt the user with a yes/no question. Returns the boolean answer.

    Handles EOF and Ctrl+C gracefully by returning the default.
    """
    hint = "Y/n" if default else "y/N"
    try:
        answer = input(
            f"  {C.YELLOW}{question} [{hint}]: {C.RESET}",
        ).strip().lower()
    except (EOFError, KeyboardInterrupt):
        print()
        return default
    if not answer:
        return default
    return answer in ("y", "yes")


# ── Publish Log (tee stdout to file) ────────────────────────

_ANSI_RE = re.compile(r"\033\[[0-9;]*m")
_original_stdout = None
_log_file = None


class _TeeWriter:
    """Wraps stdout to also write ANSI-stripped text to a log file."""

    def __init__(self, terminal, logfile):
        self.terminal = terminal
        self.logfile = logfile

    def write(self, text):
        self.terminal.write(text)
        self.logfile.write(_ANSI_RE.sub("", text))

    def flush(self):
        self.terminal.flush()
        self.logfile.flush()

    def isatty(self):
        return self.terminal.isatty()

    @property
    def encoding(self):
        return self.terminal.encoding


def open_publish_log() -> None:
    """Start teeing stdout to reports/YYYYMMDD/YYYYMMDD_publish_report.log."""
    global _original_stdout, _log_file  # noqa: PLW0603
    now = datetime.now()
    date_dir = os.path.join(REPO_ROOT, "reports", now.strftime("%Y%m%d"))
    os.makedirs(date_dir, exist_ok=True)
    path = os.path.join(
        date_dir, f"{now:%Y%m%d}_publish_report.log",
    )
    _log_file = open(path, "w", encoding="utf-8")  # noqa: SIM115
    _original_stdout = sys.stdout
    sys.stdout = _TeeWriter(_original_stdout, _log_file)


def close_publish_log() -> None:
    """Stop teeing and close the log file."""
    global _original_stdout, _log_file  # noqa: PLW0603
    if _original_stdout is None:
        return
    path = _log_file.name
    sys.stdout = _original_stdout
    _log_file.close()
    _original_stdout = None
    _log_file = None
    rel = os.path.relpath(path, REPO_ROOT)
    ok(f"Publish log: {C.WHITE}{rel}{C.RESET}")


# ── Logo ─────────────────────────────────────────────────────

# cSpell:disable
def show_logo(version: str = "") -> None:
    """Print the Saropa rainbow-gradient logo and optional version."""
    logo = f"""
{C.ORANGE_208}                               ....{C.RESET}
{C.ORANGE_208}                       `-+shdmNMMMMNmdhs+-{C.RESET}
{C.ORANGE_209}                    -odMMMNyo/-..````.++:+o+/-{C.RESET}
{C.YELLOW_215}                 `/dMMMMMM/`            ````````{C.RESET}
{C.YELLOW_220}                `dMMMMMMMMNdhhhdddmmmNmmddhs+-{C.RESET}
{C.YELLOW_226}                QMMMMMMMMMMMMMMMMMMMMMMMMMMMMMNhs{C.RESET}
{C.GREEN_190}              . :sdmNNNNMMMMMNNNMMMMMMMMMMMMMMMMm+{C.RESET}
{C.GREEN_154}              o     `..~~~::~+==+~:/+sdNMMMMMMMMMMMo{C.RESET}
{C.GREEN_118}              m                        .+NMMMMMMMMMN{C.RESET}
{C.CYAN_123}              m+                         :MMMMMMMMMm{C.RESET}
{C.CYAN_87}              qN:                        :MMMMMMMMMF{C.RESET}
{C.BLUE_51}               oNs.                    `+NMMMMMMMMo{C.RESET}
{C.BLUE_45}                :dNy\\.              ./smMMMMMMMMm:{C.RESET}
{C.BLUE_39}                 `TdMNmhyso+++oosydNNMMMMMMMMMdP+{C.RESET}
{C.BLUE_33}                    .odMMMMMMMMMMMMMMMMMMMMdo-{C.RESET}
{C.BLUE_57}                       `-+shdNNMMMMNNdhs+-{C.RESET}
{C.BLUE_57}                               ````{C.RESET}

  {C.PINK_195}Saropa Drift Advisor -- Publish Pipeline{C.RESET}"""
    print(logo)
    if version:
        print(f"  {C.LIGHT_BLUE_117}v{version}{C.RESET}")
    print(f"\n{C.CYAN}{'-' * 60}{C.RESET}")
# cSpell:enable
