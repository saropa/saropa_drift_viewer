# Unified Publish Script — Detailed Plan

## Goal

Replace two independent publish pipelines (`publish.py` monolith + `publish_extension.py` + 11 modules) with **one modular script** that publishes the Dart package, the VS Code extension, or both.

## CLI

```
python scripts/publish.py dart                    # Dart package only
python scripts/publish.py extension               # VS Code extension only
python scripts/publish.py all                     # Both (dart first)
python scripts/publish.py extension --skip-tests  # Skip tests
python scripts/publish.py all --analyze-only      # Analysis only, no publish
```

All existing flags preserved: `--analyze-only`, `--skip-tests`, `--yes`.
Extension-only flags silently ignored when target is `dart`.

## Versioning

- **`pubspec.yaml`** is the single source of truth for version
- **`package.json`** synced to match during version validation step
- **`CHANGELOG.md`** at repo root is shared (already the case)
- Two git tags per release: `v{x.y.z}` (dart) + `ext-v{x.y.z}` (extension)

---

## Current State: 121 Functions Across 12 Files

| File | Functions | Dart | Extension | Shared |
|------|-----------|------|-----------|--------|
| `publish.py` (monolith) | 42 | 15 | 0 | 27 |
| `publish_extension.py` | 5 | 0 | 5 | 0 |
| `modules/display.py` | 9 | 0 | 0 | 9 |
| `modules/utils.py` | 7 | 0 | 4 | 3 |
| `modules/checks_prereqs.py` | 6 | 0 | 4 | 2 |
| `modules/checks_environment.py` | 3 | 0 | 3 | 0 |
| `modules/checks_project.py` | 8 | 0 | 5 | 3 |
| `modules/checks_version.py` | 12 | 0 | 6 | 6 |
| `modules/pipeline.py` | 10 | 0 | 10 | 0 |
| `modules/publish.py` | 11 | 0 | 5 | 6 |
| `modules/report.py` | 5 | 0 | 1 | 4 |
| `modules/install.py` | 3 | 0 | 2 | 1 |
| **Total** | **121** | **15** | **45** | **61** |

The monolith duplicates 27 shared functions (git, changelog, display, version) that the modules already have. The modules have 61 shared functions that can serve both targets.

---

## Target File Layout

```
scripts/
  publish.py                     # REWRITE — unified CLI entry point (~150 lines)
  publish_extension.py           # DELETE
  modules/
    __init__.py                  # KEEP (empty)
    # ── Shared (target-agnostic) ──
    constants.py                 # MODIFY — add Dart/repo paths, remove ext-only hardcoding
    display.py                   # KEEP — already target-agnostic (9 functions)
    utils.py                     # MODIFY — extract ext-specific helpers to ext_prereqs
    report.py                    # MODIFY — parameterize success banner with target
    target_config.py             # NEW — TargetConfig dataclass + version read/write
    pipeline.py                  # REWRITE — generic orchestration accepting TargetConfig
    checks_git.py                # NEW — extract from checks_project + monolith
    checks_version.py            # MODIFY — parameterize (read pubspec or package.json)
    git_ops.py                   # NEW — extract from modules/publish.py + monolith
    github_release.py            # NEW — extract from modules/publish.py + monolith
    # ── Dart-specific ──
    dart_prereqs.py              # NEW — check_dart, check_flutter, check_publish_workflow
    dart_build.py                # NEW — format, test, analyze, docs, dry-run
    dart_publish.py              # NEW — pub.dev publish (GH Actions trigger)
    # ── Extension-specific ──
    ext_prereqs.py               # RENAME from checks_prereqs.py ext parts + checks_environment
    ext_build.py                 # RENAME from checks_project.py ext parts
    ext_publish.py               # RENAME from publish.py module ext parts
    ext_install.py               # RENAME from install.py
```

**Summary: 18 module files** (7 new, 5 modified, 4 renamed, 1 kept, 1 deleted)

---

## TargetConfig Dataclass

```python
# modules/target_config.py

@dataclass(frozen=True)
class TargetConfig:
    name: str                    # "dart" | "extension"
    display_name: str            # "Dart Package" | "VS Code Extension"
    tag_prefix: str              # "v" | "ext-v"
    changelog_path: str          # always REPO_ROOT / CHANGELOG.md
    version_file: str            # pubspec.yaml | package.json
    work_dir: str                # REPO_ROOT | EXTENSION_DIR
    git_stage_paths: list[str]   # ["."] | ["extension/", "scripts/"]
    commit_msg_fmt: str          # "Release v{version}" | "Release ext-v{version}"

DART = TargetConfig(
    name="dart",
    display_name="Dart Package",
    tag_prefix="v",
    changelog_path=str(CHANGELOG_PATH),
    version_file=str(PUBSPEC_PATH),
    work_dir=str(REPO_ROOT),
    git_stage_paths=["."],
    commit_msg_fmt="Release v{version}",
)

EXTENSION = TargetConfig(
    name="extension",
    display_name="VS Code Extension",
    tag_prefix="ext-v",
    changelog_path=str(CHANGELOG_PATH),
    version_file=str(PACKAGE_JSON_PATH),
    work_dir=str(EXTENSION_DIR),
    git_stage_paths=["extension/", "scripts/"],
    commit_msg_fmt="Release ext-v{version}",
)
```

### Version Read/Write (in target_config.py)

```python
def read_version(config: TargetConfig) -> str:
    """Read version from pubspec.yaml or package.json."""

def write_version(config: TargetConfig, version: str) -> None:
    """Write version to the target's version file."""

def sync_versions(version: str) -> None:
    """Write version to BOTH pubspec.yaml and package.json."""
```

---

## Module-by-Module Changes

### 1. `constants.py` — MODIFY

**Current**: Hardcoded to extension paths only.
**Change**: Add repo-root paths for Dart target.

```python
# Add:
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PUBSPEC_PATH = REPO_ROOT / "pubspec.yaml"
CHANGELOG_PATH = REPO_ROOT / "CHANGELOG.md"
TEST_DIR = REPO_ROOT / "test"
LIB_DIR = REPO_ROOT / "lib"

# Keep existing:
EXTENSION_DIR = REPO_ROOT / "extension"
PACKAGE_JSON_PATH = EXTENSION_DIR / "package.json"
SCRIPTS_DIR = REPO_ROOT / "scripts"
```

### 2. `display.py` — KEEP (no changes)

All 9 functions are already target-agnostic: `heading`, `ok`, `fix`, `fail`, `warn`, `info`, `dim`, `ask_yn`, `show_logo`. The monolith's duplicates (`print_header`, `print_success`, `print_warning`, `print_error`, `print_info`, `show_saropa_logo`) are dropped.

### 3. `utils.py` — MODIFY

**Remove** (move to `ext_prereqs.py`):
- `get_ovsx_pat()` → ext_prereqs
- `get_installed_extension_versions()` → ext_prereqs
- `read_package_version()` → replaced by `target_config.read_version()`

**Remove** (move to `git_ops.py`):
- `is_version_tagged()` → git_ops (parameterized with tag prefix)

**Keep**:
- `run(cmd, **kwargs)` — universal subprocess runner
- `elapsed_str(seconds)` — timing display
- `run_step(name, fn, results)` — step execution wrapper

### 4. `checks_git.py` — NEW

Extract from `checks_project.py` lines 19–89 + monolith lines 524–619:

```python
def check_working_tree() -> None:
    """Checks git is clean; shows changed files and prompts to continue."""
    # From checks_project.check_working_tree (24 lines)

def check_remote_sync() -> None:
    """Fetches origin and checks ahead/behind; auto-pulls if behind."""
    # From checks_project.check_remote_sync + _check_if_behind (41 lines)
```

Both are already target-agnostic in the modules. The monolith versions are longer (94 lines combined) but functionally equivalent. Use the module versions.

### 5. `checks_version.py` — MODIFY

**Current**: Reads/writes `package.json` only, uses `ext-v` tag prefix.
**Change**: Accept `TargetConfig` parameter to determine version file and tag prefix.

**Keep** (already shared):
- `_parse_semver()`, `_get_changelog_max_version()`, `_bump_patch()`
- `_changelog_has_unpublished_heading()`, `_has_unreleased_section()`
- `_ensure_unreleased_section()`, `_stamp_changelog()`

**Modify**:
- `_write_package_version()` → delegates to `target_config.write_version()`
- `_ensure_untagged_version()` → uses `config.tag_prefix` instead of hardcoded `ext-v`
- `_ask_version()` → accepts `TargetConfig` for display
- `validate_version_changelog()` → accepts `TargetConfig`, uses `read_version(config)`

**Add**:
- `sync_package_json_to_pubspec()` — for `all` mode, ensures package.json matches pubspec.yaml

### 6. `git_ops.py` — NEW

Extract from `modules/publish.py` lines 94–188 + monolith lines 803–893:

```python
def is_version_tagged(version: str, tag_prefix: str) -> bool:
    """Check if tag exists. Parameterized with prefix."""
    # From utils.is_version_tagged, add tag_prefix param

def git_commit_and_push(config: TargetConfig, version: str) -> None:
    """Stage paths from config, commit with config.commit_msg_fmt, push."""
    # Merge modules/publish.git_commit_and_push + _push_to_origin

def create_git_tag(config: TargetConfig, version: str) -> None:
    """Create and push annotated tag using config.tag_prefix."""
    # Merge modules/publish.create_git_tag + monolith.create_git_tag

def get_current_branch() -> str:
    """Return current git branch name."""
    # From monolith.get_current_branch

def get_remote_url() -> str:
    """Return origin remote URL."""
    # From monolith.get_remote_url
```

### 7. `github_release.py` — NEW

Extract from `modules/publish.py` lines 273–349 + monolith lines 916–977:

```python
def extract_changelog_section(version: str) -> str:
    """Extract release notes for a version from CHANGELOG.md."""
    # From modules/publish.extract_changelog_section

def create_github_release(config: TargetConfig, version: str,
                          asset_path: str | None = None) -> None:
    """Create GitHub release. Attach .vsix for extension, nothing for dart."""
    # Merge both create_github_release implementations
    # Use config.tag_prefix for tag name

def extract_repo_path(remote_url: str) -> str:
    """Extract owner/repo from GitHub remote URL."""
    # From monolith.extract_repo_path
```

### 8. `dart_prereqs.py` — NEW

Extract from monolith lines 460–521:

```python
def check_dart() -> None:
    """Verify dart SDK is installed and on PATH."""
    # From monolith.check_prerequisites (dart parts)

def check_flutter() -> None:
    """Verify flutter SDK is installed and on PATH."""
    # From monolith.check_prerequisites (flutter parts)

def check_publish_workflow() -> None:
    """Verify .github/workflows/publish.yml exists."""
    # From monolith.check_prerequisites (workflow check)
```

### 9. `dart_build.py` — NEW

Extract from monolith lines 622–800:

```python
def format_code() -> None:
    """Run dart format and report if files changed."""
    # From monolith.format_code (32 lines)

def run_tests() -> None:
    """Run dart test if test/ directory exists."""
    # From monolith.run_tests (19 lines)

def run_analysis() -> None:
    """Run dart analyze --fatal-infos (strips plugins for safety)."""
    # From monolith.run_analysis + _analysis_options_without_plugins (43 lines)

def generate_docs() -> None:
    """Run dart doc to generate API documentation."""
    # From monolith.generate_docs (9 lines)

def pre_publish_validation() -> None:
    """Run dart pub publish --dry-run (skipped on Windows)."""
    # From monolith.pre_publish_validation (34 lines)
```

### 10. `dart_publish.py` — NEW

Extract from monolith lines 371–383, 896–913:

```python
def package_on_pub_dev(package_name: str) -> bool:
    """HTTP-check whether the package already exists on pub.dev."""
    # From monolith.package_on_pub_dev (13 lines)

def publish_to_pubdev() -> None:
    """Confirm that tag push triggered GitHub Actions to publish."""
    # From monolith.publish_to_pubdev (18 lines)
```

### 11. `ext_prereqs.py` — RENAME+MERGE

Merge `checks_prereqs.py` (ext parts) + `checks_environment.py` + ext helpers from `utils.py`:

```python
# From checks_prereqs.py:
def check_node() -> None           # 16 lines
def check_npm() -> None            # 8 lines
def check_vsce_auth() -> None      # 53 lines
def check_ovsx_token() -> None     # 15 lines

# From checks_environment.py:
def check_vscode_cli() -> None             # 13 lines
def check_global_npm_packages() -> None    # 37 lines
def check_vscode_extensions() -> None      # 39 lines

# From utils.py:
def get_ovsx_pat() -> str | None                    # 19 lines
def get_installed_extension_versions() -> dict       # 27 lines
```

### 12. `ext_build.py` — RENAME

Rename from `checks_project.py` (ext parts only; git parts move to `checks_git.py`):

```python
def ensure_dependencies() -> None     # 28 lines
def step_compile() -> None            # 17 lines
def step_test() -> None               # 17 lines
def check_file_line_limits() -> None  # 33 lines
```

### 13. `ext_publish.py` — RENAME

Rename from `modules/publish.py` (ext parts only; git/GitHub parts move out):

```python
def confirm_publish(version: str) -> None                    # 22 lines
def step_package() -> tuple[str, str]:                       # 32 lines
def get_marketplace_published_version() -> str | None        # 21 lines
def publish_marketplace(vsix_path: str) -> None              # 22 lines
def publish_openvsx(vsix_path: str) -> None                  # 24 lines
```

### 14. `ext_install.py` — RENAME

Rename from `install.py` (no changes):

```python
def print_install_instructions(vsix_path: str) -> None   # 41 lines
def prompt_install(vsix_path: str) -> None                # 23 lines
```

### 15. `report.py` — MODIFY

**Modify**: `print_success_banner` — accept `TargetConfig` to customize links/messages.

**Add**: Dart success banner variant (pub.dev link instead of marketplace links).

**Keep**: `_build_report_header`, `save_report`, `print_timing`, `print_report_path`.

### 16. `pipeline.py` — REWRITE

Complete rewrite. The current version is 377 lines of extension-specific orchestration.

```python
def run_analysis(config: TargetConfig, args, results) -> None:
    """Run all analysis steps for a target."""
    if config.name == "dart":
        _run_dart_analysis(args, results)
    else:
        _run_ext_analysis(args, results)

def run_publish(config: TargetConfig, version, results, **kwargs) -> None:
    """Run all publish steps for a target."""
    if config.name == "dart":
        _run_dart_publish(version, results)
    else:
        _run_ext_publish(version, results, kwargs.get("vsix_path"), kwargs.get("stores"))

def run_all(args, results) -> None:
    """Run both targets in sequence with unified versioning."""
```

### 17. `publish.py` (entry point) — REWRITE

Replace the 1325-line monolith with a ~150-line CLI entry point:

```python
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=["dart", "extension", "all"])
    parser.add_argument("--analyze-only", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()

    configs = resolve_targets(args.target)  # Returns [DART], [EXTENSION], or [DART, EXTENSION]
    results = []

    show_logo(read_version(configs[0]))

    # Shared prerequisites
    run_step("Git", check_git, results)
    run_step("GitHub CLI", check_gh_cli, results)
    run_step("Working tree", check_working_tree, results)
    run_step("Remote sync", check_remote_sync, results)

    # Per-target analysis
    for config in configs:
        run_analysis(config, args, results)

    if args.analyze_only:
        print_timing(results)
        return

    # Unified version resolution
    version = validate_version_changelog(configs)
    if len(configs) > 1:
        sync_versions(version)

    # Per-target publish
    for config in configs:
        run_publish(config, version, results)

    # Shared post-publish
    for config in configs:
        create_github_release(config, version)

    print_timing(results)
```

### 18. `publish_extension.py` — DELETE

All functionality absorbed into the unified `publish.py` + modules.

---

## Pipeline: `all` Mode (Full Sequence)

```
 #  Step                          Module             Target
──  ────                          ──────             ──────
 1  check_git                     checks_git         shared
 2  check_gh_cli                  checks_git         shared
 3  check_working_tree            checks_git         shared
 4  check_remote_sync             checks_git         shared
 ── Dart analysis ──────────────────────────────────────────
 5  check_dart                    dart_prereqs       dart
 6  check_flutter                 dart_prereqs       dart
 7  check_publish_workflow        dart_prereqs       dart
 8  format_code                   dart_build         dart
 9  run_tests (dart)              dart_build         dart
10  run_analysis                  dart_build         dart
11  generate_docs                 dart_build         dart
12  pre_publish_validation        dart_build         dart
 ── Extension analysis ─────────────────────────────────────
13  check_node                    ext_prereqs        ext
14  check_npm                     ext_prereqs        ext
15  check_vscode_cli              ext_prereqs        ext
16  ensure_dependencies           ext_build          ext
17  step_compile                  ext_build          ext
18  step_test                     ext_build          ext
19  check_file_line_limits        ext_build          ext
 ── Version & changelog ────────────────────────────────────
20  validate_version_changelog    checks_version     shared
21  sync_versions                 target_config      shared
     ── --analyze-only stops here ──
 ── Package ────────────────────────────────────────────────
22  step_package (.vsix)          ext_publish        ext
23  prompt_install                ext_install        ext
 ── Commit & tag ───────────────────────────────────────────
24  git_commit_and_push           git_ops            shared (single commit)
25  create_git_tag (v{ver})       git_ops            dart
26  create_git_tag (ext-v{ver})   git_ops            ext
 ── Publish ────────────────────────────────────────────────
27  publish_to_pubdev             dart_publish       dart
28  publish_marketplace           ext_publish        ext
29  publish_openvsx               ext_publish        ext
 ── GitHub releases ────────────────────────────────────────
30  create_github_release (dart)  github_release     dart
31  create_github_release (ext)   github_release     ext
```

In `all` mode, step 24 creates **one commit** for all changes (not two separate commits). Steps 25–26 create two tags on that same commit.

---

## Function Migration Map

### From monolith → new module

| Monolith Function | Lines | → New Location |
|---|---|---|
| `enable_ansi_support` | 125–151 | `constants.py` (init) |
| `show_saropa_logo` | 153–179 | DROP (use `display.show_logo`) |
| `print_colored` | 185–188 | DROP (use `display.*`) |
| `print_header` | 190–197 | DROP (use `display.heading`) |
| `print_success` | 199–202 | DROP (use `display.ok`) |
| `print_warning` | 204–207 | DROP (use `display.warn`) |
| `print_error` | 209–212 | DROP (use `display.fail`) |
| `print_info` | 214–217 | DROP (use `display.info`) |
| `exit_with_error` | 219–223 | DROP (use `sys.exit` directly) |
| `is_windows` | 230–232 | `utils.py` (already has shell detection) |
| `get_shell_mode` | 235–242 | DROP (use `utils.run`) |
| `run_command` | 250–284 | DROP (use `utils.run`) |
| `command_exists` | 286–288 | `utils.py` |
| `parse_version` | 296–299 | `checks_version._parse_semver` |
| `get_version_from_pubspec` | 302–308 | `target_config.read_version` |
| `update_pubspec_version` | 311–321 | `target_config.write_version` |
| `has_unreleased_section` | 324–327 | `checks_version._has_unreleased_section` |
| `bump_patch_version` | 330–333 | `checks_version._bump_patch` |
| `add_unreleased_section` | 336–346 | `checks_version._ensure_unreleased_section` |
| `update_changelog_unreleased` | 349–359 | `checks_version._stamp_changelog` |
| `get_package_name` | 362–368 | `dart_prereqs.get_package_name` |
| `package_on_pub_dev` | 371–383 | `dart_publish.package_on_pub_dev` |
| `get_latest_changelog_version` | 386–398 | `checks_version._get_changelog_max_version` |
| `validate_changelog_version` | 401–422 | `checks_version.validate_version_changelog` |
| `display_changelog` | 425–452 | `checks_version` (inline) |
| `check_prerequisites` | 460–521 | `dart_prereqs.*` (3 functions) |
| `check_working_tree` | 524–556 | `checks_git.check_working_tree` |
| `check_remote_sync` | 559–619 | `checks_git.check_remote_sync` |
| `format_code` | 622–653 | `dart_build.format_code` |
| `run_tests` | 656–674 | `dart_build.run_tests` |
| `_analysis_options_without_plugins` | 679–691 | `dart_build` (private) |
| `run_analysis` | 694–721 | `dart_build.run_analysis` |
| `validate_changelog` | 724–753 | `checks_version` (merged) |
| `generate_docs` | 756–764 | `dart_build.generate_docs` |
| `pre_publish_validation` | 767–800 | `dart_build.pre_publish_validation` |
| `git_commit_and_push` | 803–841 | `git_ops.git_commit_and_push` |
| `create_git_tag` | 844–893 | `git_ops.create_git_tag` |
| `publish_to_pubdev` | 896–913 | `dart_publish.publish_to_pubdev` |
| `create_github_release` | 916–977 | `github_release.create_github_release` |
| `get_current_branch` | 980–994 | `git_ops.get_current_branch` |
| `get_remote_url` | 997–1011 | `git_ops.get_remote_url` |
| `extract_repo_path` | 1014–1019 | `github_release.extract_repo_path` |
| `main` | 1027–end | `publish.py` (entry, rewritten) |

### From modules → new location

| Current Module | Function | → New Location |
|---|---|---|
| `utils.py` | `get_ovsx_pat` | `ext_prereqs.py` |
| `utils.py` | `get_installed_extension_versions` | `ext_prereqs.py` |
| `utils.py` | `read_package_version` | DROP (use `target_config.read_version`) |
| `utils.py` | `is_version_tagged` | `git_ops.py` (parameterized) |
| `checks_prereqs.py` | `check_node` | `ext_prereqs.py` |
| `checks_prereqs.py` | `check_npm` | `ext_prereqs.py` |
| `checks_prereqs.py` | `check_git` | `checks_git.py` |
| `checks_prereqs.py` | `check_gh_cli` | `checks_git.py` |
| `checks_prereqs.py` | `check_vsce_auth` | `ext_prereqs.py` |
| `checks_prereqs.py` | `check_ovsx_token` | `ext_prereqs.py` |
| `checks_environment.py` | all 3 functions | `ext_prereqs.py` |
| `checks_project.py` | `check_working_tree` | `checks_git.py` |
| `checks_project.py` | `check_remote_sync` + `_check_if_behind` | `checks_git.py` |
| `checks_project.py` | `ensure_dependencies` + `_run_npm_install` | `ext_build.py` |
| `checks_project.py` | `step_compile` | `ext_build.py` |
| `checks_project.py` | `step_test` | `ext_build.py` |
| `checks_project.py` | `check_file_line_limits` | `ext_build.py` |
| `publish.py` (module) | `confirm_publish` | `ext_publish.py` |
| `publish.py` (module) | `step_package` | `ext_publish.py` |
| `publish.py` (module) | `git_commit_and_push` + `_push_to_origin` | `git_ops.py` |
| `publish.py` (module) | `create_git_tag` | `git_ops.py` |
| `publish.py` (module) | `get_marketplace_published_version` | `ext_publish.py` |
| `publish.py` (module) | `publish_marketplace` | `ext_publish.py` |
| `publish.py` (module) | `publish_openvsx` | `ext_publish.py` |
| `publish.py` (module) | `extract_changelog_section` | `github_release.py` |
| `publish.py` (module) | `create_github_release` | `github_release.py` |
| `publish.py` (module) | `_print_gh_troubleshooting` | `github_release.py` |
| `install.py` | `print_install_instructions` | `ext_install.py` |
| `install.py` | `prompt_install` | `ext_install.py` |
| `install.py` | `prompt_open_report` | `report.py` |

---

## Implementation Order

### Phase 1: Shared infrastructure (no behavior change)

1. **`target_config.py`** — Create TargetConfig dataclass + version read/write
2. **`constants.py`** — Add Dart/repo paths
3. **`checks_git.py`** — Extract git checks from checks_project + checks_prereqs
4. **`git_ops.py`** — Extract git operations from modules/publish.py
5. **`github_release.py`** — Extract from modules/publish.py
6. **`checks_version.py`** — Parameterize with TargetConfig

### Phase 2: Dart modules (extract from monolith)

7. **`dart_prereqs.py`** — Extract from monolith check_prerequisites
8. **`dart_build.py`** — Extract format/test/analyze/docs/dry-run
9. **`dart_publish.py`** — Extract pub.dev publish logic

### Phase 3: Extension modules (rename + clean up)

10. **`ext_prereqs.py`** — Merge checks_prereqs (ext) + checks_environment + utils (ext)
11. **`ext_build.py`** — Rename from checks_project (ext parts)
12. **`ext_publish.py`** — Rename from modules/publish.py (ext parts)
13. **`ext_install.py`** — Rename from install.py

### Phase 4: Orchestration

14. **`pipeline.py`** — Rewrite for generic orchestration
15. **`report.py`** — Parameterize with TargetConfig
16. **`utils.py`** — Remove migrated functions
17. **`publish.py`** — Rewrite entry point with argparse

### Phase 5: Cleanup

18. Delete `publish_extension.py`
19. Delete `checks_prereqs.py`, `checks_environment.py`, `checks_project.py`, `modules/publish.py`
20. Verify: `python scripts/publish.py dart --analyze-only`
21. Verify: `python scripts/publish.py extension --analyze-only`
22. Verify: `python scripts/publish.py all --analyze-only`

---

## Verification Checklist

- [ ] `python scripts/publish.py dart --analyze-only` — format, test, analyze, docs, dry-run
- [ ] `python scripts/publish.py extension --analyze-only` — compile, test, quality, .vsix
- [ ] `python scripts/publish.py all --analyze-only` — both in sequence
- [ ] After `all` run: pubspec.yaml and package.json have the same version
- [ ] `--skip-tests` flag works for both targets
- [ ] `--yes` flag skips interactive prompts
- [ ] Reports save to `reports/` directory
- [ ] Git commit includes correct staged paths per target
- [ ] Tags use correct prefix (`v` vs `ext-v`)
- [ ] GitHub releases attach `.vsix` for extension, nothing for dart
