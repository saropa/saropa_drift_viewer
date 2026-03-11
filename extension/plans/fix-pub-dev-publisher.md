# 67 — Fix pub.dev Publisher Identity

## Status

**IN PROGRESS** — Code rename done. Awaiting repo rename, first publish, and
poison pill.

## Problem

The `saropa_drift_viewer` package on pub.dev is owned by a CI OIDC service
identity. No human can access the Admin tab, transfer it to `saropa.com`,
discontinue, or retract it.

## Solution: Rename to `saropa_drift_advisor`

Publish a new package under the correct publisher, then poison-pill the old one.

## What Was Tried (on the old package)

| Action | Result |
|--------|--------|
| `dart pub uploader add` via CI (`add-uploader.yml`) | Command deprecated, exit code 1 |
| Filed [dart-lang/pub-dev#9261](https://github.com/dart-lang/pub-dev/issues/9261) | Closed, told to use `support@pub.dev` |
| OIDC API calls via `fix-publisher.yml` (run #1, 2026-03-10) | All 5 endpoints returned 401 — admin APIs reject GitHub OIDC tokens |

## Completed: Phase 1 — Code Rename

All references to `saropa_drift_viewer` updated to `saropa_drift_advisor`:

- `lib/saropa_drift_viewer.dart` renamed to `lib/saropa_drift_advisor.dart`
- `pubspec.yaml` — name `saropa_drift_advisor`, version `0.3.0`, all URLs updated
- `lib/flutter.dart` — export path and doc comments
- 7 Dart source/test files — `package:saropa_drift_advisor/` imports
- `example/pubspec.yaml` — dependency name
- 5 extension TypeScript source + 2 test files — pub.dev URLs, provider ID
- 4 Python publish scripts — repo URL, user-agent, pub.dev links
- README, ABOUT_SAROPA, example README, roadmap, CHANGELOG
- Deleted `fix-publisher.yml` and `add-uploader.yml`
- **All checks pass:** analyze, format, 56 Dart tests, 1168 extension tests

**NOT renamed** (intentional):
- Extension npm name: still `drift-viewer` (keep Marketplace installs)
- Extension command IDs: still `driftViewer.*` (keep user keybindings)
- Dart class names: `DriftViewerOverlay`, `DriftDebugServer`, etc. (still accurate)
- Local folder: still `d:\src\saropa_drift_viewer` (changes after repo rename)

## TODO: Phase 2 — GitHub Repo Rename

1. Go to https://github.com/saropa/saropa_drift_viewer/settings
2. Change repository name to `saropa_drift_advisor`
3. GitHub auto-redirects old URL indefinitely
4. Locally: `git remote set-url origin https://github.com/saropa/saropa_drift_advisor.git`
5. Commit all Phase 1 changes and push

## TODO: Phase 3 — First Publish (MUST be local, not CI)

1. `dart pub login` — ensure logged in as `craig.hathaway@saropa.com`
2. `dart pub publish --dry-run`
3. `dart pub publish`
4. Go to https://pub.dev/packages/saropa_drift_advisor/admin
5. Transfer to `saropa.com` verified publisher
6. Verify "Published by saropa.com" shows on pub.dev
7. `git tag v0.3.0 && git push origin v0.3.0`

**CRITICAL:** First version MUST be published locally — not via CI.
Publishing via CI is what caused this entire problem.

## TODO: Phase 4 — Poison Pill

CI can still publish to the old `saropa_drift_viewer` name via OIDC.
Use this to publish a **completely non-functional** version 0.2.5.

### Steps

1. Create a throwaway branch: `git checkout -b poison-pill`
2. Replace `pubspec.yaml` with:
   ```yaml
   name: saropa_drift_viewer
   description: "DEPRECATED. This package has been permanently replaced by saropa_drift_advisor. See https://pub.dev/packages/saropa_drift_advisor"
   version: 0.2.5
   homepage: https://pub.dev/packages/saropa_drift_advisor
   environment:
     sdk: ">=3.3.0 <4.0.0"
   ```
3. Replace `lib/saropa_drift_viewer.dart` with an empty file (no exports)
4. Delete everything in `lib/src/`
5. Replace `README.md` with:
   ```
   # saropa_drift_viewer — DEPRECATED

   This package has been permanently replaced by
   [saropa_drift_advisor](https://pub.dev/packages/saropa_drift_advisor).

   Update your pubspec.yaml:
   - Replace `saropa_drift_viewer` with `saropa_drift_advisor`
   - Replace `package:saropa_drift_viewer/` with `package:saropa_drift_advisor/`
   ```
6. Commit, tag `v0.2.5`, push tag to trigger `.github/workflows/publish.yml`
7. Verify https://pub.dev/packages/saropa_drift_viewer shows 0.2.5 with
   deprecation message
8. Delete the `poison-pill` branch (do NOT merge to main)

### Why 0.2.5 (not 1.0.0)

Existing users have `^0.2.x` constraints. A 0.2.5 patch will auto-resolve
on their next `pub get`, showing them the deprecation. A 1.0.0 would not
be pulled by `^0.2.x` constraints and would be ignored.

## Phase 5 — Cleanup

- Delete `poison-pill` branch
- Confirm old package shows deprecation on pub.dev
- Optionally rename local folder: `mv saropa_drift_viewer saropa_drift_advisor`

## Prevention (for all future packages)

1. **Always publish the first version locally** with `dart pub publish`
2. **Transfer to `saropa.com`** via the Admin tab on pub.dev
3. **Then** enable the GitHub Actions OIDC workflow for subsequent versions

## References

- [dart-lang/pub-dev#9261](https://github.com/dart-lang/pub-dev/issues/9261)
- [Automated publishing docs](https://dart.dev/tools/pub/automated-publishing)
- [Verified publishers docs](https://dart.dev/tools/pub/verified-publishers)
