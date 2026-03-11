# 67 — Fix pub.dev Publisher Identity

## Status

**MOSTLY COMPLETE** — Phases 1-3 done. Phase 4 (poison pill) blocked on
pub.dev admin access.

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
| Poison pill via CI (push `v0.2.5` tag, 2026-03-10) | `publish.yml` failed: "publishing from github is not enabled" — OIDC was never configured on pub.dev for this package |

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

## Completed: Phase 2 — GitHub Repo Rename

- Repository renamed to `saropa/saropa_drift_advisor` (2026-03-10)
- GitHub auto-redirects `saropa_drift_viewer` URLs
- Local remote updated: `git remote set-url origin https://github.com/saropa/saropa_drift_advisor.git`
- Local folder renamed to `d:\src\saropa_drift_advisor`

## Completed: Phase 3 — First Publish

- Published `saropa_drift_advisor` v0.3.0 locally via `dart pub publish`
- Transferred to `saropa.com` verified publisher on pub.dev
- Tagged `v0.3.0` and pushed
- Live at https://pub.dev/packages/saropa_drift_advisor

## BLOCKED: Phase 4 — Poison Pill

The `poison-pill` branch and `v0.2.5` tag exist on the remote, ready to
publish a deprecated version of `saropa_drift_viewer`. However, CI publishing
failed because OIDC was never properly configured on pub.dev for this package
(v0.2.3 and v0.2.4 CI publishes also failed — only v0.2.2 was ever published).

**To unblock**, one of:
1. Email `support@pub.dev` to request admin access or discontinuation
2. Get OIDC publishing enabled via pub.dev admin (requires access)
3. If admin access is granted, publish the poison pill locally

### Poison pill contents (on `poison-pill` branch)

- `pubspec.yaml`: name `saropa_drift_viewer`, version `0.2.5`, deprecation description
- `lib/saropa_drift_viewer.dart`: empty (no exports)
- `README.md`: deprecation notice pointing to `saropa_drift_advisor`
- All `lib/src/` deleted

### Why 0.2.5 (not 1.0.0)

Existing users have `^0.2.x` constraints. A 0.2.5 patch will auto-resolve
on their next `pub get`, showing them the deprecation. A 1.0.0 would not
be pulled by `^0.2.x` constraints and would be ignored.

## Phase 5 — Cleanup (after Phase 4)

- Delete `poison-pill` branch from remote
- Confirm old package shows deprecation on pub.dev

## Prevention (for all future packages)

1. **Always publish the first version locally** with `dart pub publish`
2. **Transfer to `saropa.com`** via the Admin tab on pub.dev
3. **Then** enable the GitHub Actions OIDC workflow for subsequent versions

## References

- [dart-lang/pub-dev#9261](https://github.com/dart-lang/pub-dev/issues/9261)
- [Automated publishing docs](https://dart.dev/tools/pub/automated-publishing)
- [Verified publishers docs](https://dart.dev/tools/pub/verified-publishers)
