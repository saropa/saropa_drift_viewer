# Plan 65: Saropa Lints Extension — Add Package and analysis_options When Turned On

## Summary

**Current:** The saropa_lints extension does not add the Dart package to the user's project. The user must add `saropa_lints` to `pubspec.yaml` and run the server (and optionally run `dart run saropa_lints:init` to generate `analysis_options.yaml`).

**Desired:** When the user "turns on" the extension (e.g. enables it for the workspace), the extension should **modify the workspace** by adding the package and analysis config. This replaces the need for a separate init step.

## Goals

- Extension adds `saropa_lints` to the user's project when enabled.
- Extension adds or updates `analysis_options.yaml` (and optionally `analysis_options_custom.yaml`) when enabled.
- No separate "init" command or manual `dart run saropa_lints:init` required for first-time setup.
- Single "turn on" action configures the workspace so the user can run the server and get diagnostics.

## Behavior

### When the user turns the extension "on" (e.g. enable for workspace)

1. **pubspec.yaml**
   - If the workspace has a Dart/Flutter project (e.g. `pubspec.yaml` in workspace root or a detected project folder):
     - Add `saropa_lints` to `dev_dependencies` if not already present (e.g. `saropa_lints: ^8.2.2` or latest compatible).
     - If the user has multiple `pubspec.yaml` files (monorepo), extension may offer to add to selected projects or to the root only, depending on product choice.
   - Optionally run `dart pub get` / `flutter pub get` after editing so the analyzer can resolve the package.

2. **analysis_options.yaml**
   - If missing: create `analysis_options.yaml` with:
     - A minimal `analyzer` block (exclude build/, .dart_tool/, etc.) if desired.
     - A `plugins: saropa_lints:` block with a default tier (e.g. recommended) and the same structure as produced by `dart run saropa_lints:init --tier recommended` (or bundle a default config in the extension).
   - If present: merge or add the `plugins: saropa_lints:` section without wiping existing `analyzer` / `linter` configuration. Preserve user customizations where possible (e.g. existing rule toggles).

3. **analysis_options_custom.yaml** (optional)
   - If saropa_lints init generates this for settings (max_issues, platforms, packages), the extension may create or update it when turning on, so that tier-based defaults are consistent.

### Replacing "init"

- The current flow "user adds package + runs server + (optionally) runs `dart run saropa_lints:init`" is replaced by "user turns extension on → extension adds package + analysis_options (and runs pub get)."
- The extension may still expose a command like "Saropa Lints: Update analysis options" to re-run the equivalent of init (e.g. refresh tier or reset to defaults) without re-adding the dependency.

## Workspace Modifications (summary)

| File                  | Action when "turned on"                                      |
|-----------------------|--------------------------------------------------------------|
| `pubspec.yaml`        | Add `saropa_lints` to `dev_dependencies` if absent.           |
| `analysis_options.yaml` | Create or merge `plugins: saropa_lints:` block (default tier). |
| Optional              | Run `dart pub get` / `flutter pub get` after edits.          |

## Implementation Notes

- **Detection:** Determine workspace root(s) and whether each root is Dart/Flutter (e.g. presence of `pubspec.yaml`).
- **Safety:** Before writing, consider backup or "preview diff" so the user can see what will change.
- **Idempotency:** Turning on again should not duplicate entries or overwrite user customizations; prefer merge semantics.
- **Tier selection:** Default to a sensible tier (e.g. recommended); optional setting or prompt for essential / professional / etc.
- **custom_lint:** saropa_lints is used via the custom_lint plugin; ensure `analysis_options.yaml` uses the `plugins: saropa_lints:` form (saropa_lints does not provide `include: package:saropa_lints/analysis_options.yaml`).

## References

- This repo’s `analysis_options.yaml` and `pubspec.yaml` show the expected structure (plugins block, dev_dependency, no include URI).
- Comment in this repo: "Regenerate with: dart run saropa_lints:init --tier recommended".
- CHANGELOG and analysis_options comments: saropa_lints 6.x+ does not provide an include URI; use custom_lint and the plugins section.
- **Related:** Drift Advisor has a master switch `driftViewer.enabled` (no setup flow); saropa_lints extension is designed for explicit enable + "turn on = setup project". See extension/README.md § Design: extension enablement.
