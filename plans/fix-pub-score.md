# 68 — Fix pub.dev Score (120/160)

## Status

**In progress** — static analysis and dependency fixes applied locally, pending
publish to verify.

## Problem

The `saropa_drift_viewer` package on pub.dev scores **120 / 160 pub points**
with **0 likes** and **100 downloads**. Two sections are losing points:

| Section                        | Score   | Lost |
|--------------------------------|---------|------|
| Follow Dart file conventions   | 30 / 30 |   0  |
| Provide documentation          | 20 / 20 |   0  |
| Platform support               | 20 / 20 |   0  |
| Pass static analysis           | 40 / 50 | **10** |
| Support up-to-date dependencies| 10 / 40 | **30** |
| **Total**                      | **120 / 160** | **40** |

## Root Cause Analysis

### 1. Static Analysis (-10 pts, 40/50)

The published version (0.2.3) has **6 lint issues** when analyzed with
`lints_core`. The first two shown by pub.dev:

| Lint | Location (published) | Description |
|------|---------------------|-------------|
| `curly_braces_in_flow_control_structures` | `drift_debug_server_io.dart:755` | Bare `if` statement without braces |
| `unescaped_html_in_doc_comment` | `drift_debug_server_io.dart:929` | `<name>` in doc comment interpreted as HTML |

In the current codebase (post-refactor into handler files), the same patterns
exist across multiple files:

- **Bare `if` statements** — `if (x) return y;` without braces — found in 9
  Dart files (~49 occurrences)
- **Angle brackets in doc comments** — `<name>` URL path parameters in
  `table_handler.dart` (4 occurrences)

### 2. Dependencies (-30 pts, 10/40)

Three sub-checks, two failing:

#### 2a. Outdated constraint (0/10)

The published `intl: ^0.19.0` does not allow the stable `0.20.0`. Pub.dev
requires that all dependency constraints accept the latest stable version.

#### 2b. Lower-bound downgrade failure (0/20)

Running `flutter pub downgrade && flutter analyze` fails because the
published `webview_flutter: ^4.12.0` allows resolving to `4.12.0`, which
does not have `onSslAuthError` or `SslAuthError` (introduced in a later
`4.x` release). The code in `drift_viewer_floating_button.dart` uses these
APIs, causing two compile errors:

```
UNDEFINED_NAMED_PARAMETER - onSslAuthError isn't defined
UNDEFINED_CLASS - SslAuthError
```

The `dart_code_metrics_annotations: ^1.1.0` dependency (since removed) may
also have contributed to downgrade issues.

#### 2c. SDK support (10/10) — passing

Package supports latest stable Dart and Flutter SDKs.

## Fixes Applied

### Static analysis (this session)

All bare `if` statements in Dart source files wrapped with braces:

| File | Occurrences fixed |
|------|-------------------|
| `drift_debug_session.dart` | 3 |
| `drift_debug_server_io.dart` | 5 |
| `drift_viewer_floating_button.dart` | 10 |
| `drift_viewer_overlay.dart` | 1 |
| `server/analytics_handler.dart` | 4 |
| `server/auth_handler.dart` | 4 |
| `server/sql_handler.dart` | 5 |
| `server/server_types.dart` | 3 |
| `server/server_context.dart` | 15 |

Angle brackets in doc comments escaped with backticks in
`server/table_handler.dart` (4 occurrences):

```
// Before
/// GET /api/table/<name>/columns.

// After
/// GET `/api/table/<name>/columns`.
```

Post-fix: `flutter analyze lib/` reports **no issues found**.

### Dependencies (already applied in local pubspec.yaml)

| Change | Before | After | Fixes |
|--------|--------|-------|-------|
| `intl` constraint | `^0.19.0` | `^0.20.2` | Allows latest stable `0.20.x` |
| `webview_flutter` constraint | `^4.12.0` | `^4.13.0` | Lower bound includes `onSslAuthError` / `SslAuthError` |
| `dart_code_metrics_annotations` | `^1.1.0` | removed | No longer needed |

## Verification

### Before publishing

1. Run `flutter analyze lib/` — must report 0 issues
2. Run `flutter pub downgrade` then `flutter analyze lib/` — must pass
   (verifies lower-bound compatibility)
3. Run `dart pub outdated --no-dev-dependencies --up-to-date
   --no-dependency-overrides` — all constraints must accept latest stable
4. Run `dart pub publish --dry-run` — must succeed

### After publishing

1. Wait for pub.dev re-analysis (~1 hour)
2. Verify score is 160/160 at
   https://pub.dev/packages/saropa_drift_viewer/score
3. Confirm all five report sections show green checkmarks

## Expected Score After Fix

| Section                        | Expected |
|--------------------------------|----------|
| Follow Dart file conventions   | 30 / 30  |
| Provide documentation          | 20 / 20  |
| Platform support               | 20 / 20  |
| Pass static analysis           | 50 / 50  |
| Support up-to-date dependencies| 40 / 40  |
| **Total**                      | **160 / 160** |

## Files Changed

- `lib/src/drift_debug_session.dart` — braces
- `lib/src/drift_debug_server_io.dart` — braces
- `lib/src/drift_viewer_floating_button.dart` — braces
- `lib/src/drift_viewer_overlay.dart` — braces
- `lib/src/server/analytics_handler.dart` — braces
- `lib/src/server/auth_handler.dart` — braces
- `lib/src/server/sql_handler.dart` — braces
- `lib/src/server/server_types.dart` — braces
- `lib/src/server/server_context.dart` — braces
- `lib/src/server/table_handler.dart` — braces + doc comment escaping
- `pubspec.yaml` — dependency constraints (already applied)

## References

- [pub.dev scoring](https://pub.dev/help/scoring)
- [lints_core rules](https://pub.dev/packages/lints)
- [Dart downgrade testing](https://dart.dev/go/downgrade-testing)
