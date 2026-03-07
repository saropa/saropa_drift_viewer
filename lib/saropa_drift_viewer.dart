/// Debug-only HTTP server that exposes SQLite/Drift
/// table data as JSON and a minimal web viewer.
///
/// **Architecture:** The package is
/// dependency-injection friendly: it does not depend
/// on `drift`. You supply a [DriftDebugQuery] that
/// runs SQL; the server uses it for table listing,
/// table data, schema, and optional read-only SQL
/// runner. One server per process;
/// [DriftDebugServer.stop] clears state so
/// [DriftDebugServer.start] can be called again
/// (e.g. in tests).
///
/// Use from any Flutter or Dart app that has a
/// SQLite (or Drift) database. Add the package
/// (from pub.dev or a path dependency), then start
/// the server with [DriftDebugServer.start], passing
/// a [DriftDebugQuery] callback that runs SQL and
/// returns rows as maps.
///
/// ## Public API
///
/// * **[DriftDebugServer]** — Static API:
///   [DriftDebugServer.start] to run the server,
///   [DriftDebugServer.stop] to shut it down,
///   [DriftDebugServer.port] to read the bound port.
/// * **[DriftDebugQuery]** — Callback that executes
///   a SQL string and returns rows as
///   `List<Map<String, dynamic>>`. Pass as the
///   `query` argument to [DriftDebugServer.start].
/// * **[DriftDebugOnLog]** — Optional callback for
///   log messages (e.g. startup banner). Pass as
///   `onLog` to [DriftDebugServer.start].
/// * **[DriftDebugOnError]** — Optional callback for
///   errors and stack traces. Pass as `onError` to
///   [DriftDebugServer.start].
/// * **[DriftDebugGetDatabaseBytes]** — Optional
///   callback that returns the raw SQLite file bytes.
///   Pass as `getDatabaseBytes` to enable
///   "Download database" in the UI.
/// * **[DriftDebugErrorLogger]** — Helpers for
///   [DriftDebugOnLog] and [DriftDebugOnError]:
///   [DriftDebugErrorLogger.logCallback],
///   [DriftDebugErrorLogger.errorCallback], and
///   [DriftDebugErrorLogger.callbacks] for a single
///   prefix.
///
/// See the package README for HTTP endpoints, UI
/// features, and optional auth for dev tunnels.
library saropa_drift_viewer;

export 'src/drift_debug_server.dart';
export 'src/error_logger.dart';
export 'src/start_drift_viewer_extension.dart';
