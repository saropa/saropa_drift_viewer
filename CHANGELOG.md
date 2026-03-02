# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**pub.dev** — [saropa_drift_viewer](https://pub.dev/packages/saropa_drift_viewer)

## [Unreleased]

### Added

- **`loopbackOnly`** — Option to bind to `127.0.0.1` only instead of `0.0.0.0`.
- **`corsOrigin`** — Option to set, restrict, or disable the `Access-Control-Allow-Origin` header (`'*'`, specific origin, or `null`).
- **`GET /api/health`** — Returns `{"ok": true}` for scripts or readiness probes.
- **`DriftDebugServer.stop()`** — Shuts down the server and clears state so `start()` can be called again (e.g. tests, graceful teardown).

## [0.1.0] - 2026-03-02

### Fixed

- **analysis_options.yaml**: Removed invalid `include: package:saropa_lints/analysis_options.yaml` (that URI is not provided by saropa_lints; use custom_lint CLI for its rules).
- **DriftDebugErrorLogger**: Replaced `print` with `stderr.writeln` in log/error fallbacks to satisfy `avoid_print`; added defensive try/catch to `logCallback` so logging never throws.

### Added

- **`DriftDebugServer`**: Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web UI.
- **`DriftDebugQuery`** typedef: callback that runs SQL and returns rows as list of maps.
- **`DriftDebugOnLog`** / **`DriftDebugOnError`**: optional logging callbacks.
- No dependency on Drift — works with any SQLite executor via the query callback.
- Default port 8642; configurable port, enabled flag, and optional log/error handlers.
