import 'dart:developer' as developer;

import 'drift_debug_server.dart';

/// Log name for startDriftViewer errors (used when duck-typing fails).
const String _kStartViewerLogName = 'StartDriftViewer';

/// Runs [sql] against [db] using Drift-like API: customSelect(sql).get(), then maps row.data to Map.
///
/// Throws [StateError] if the return type or row shape is wrong.
/// [NoSuchMethodError] is caught and rethrown as [StateError] with stack trace.
Future<List<Map<String, dynamic>>> _runDriftQuery(Object db, String sql) async {
  try {
    final dynamic driftDb = db;
    final dynamic selectable = driftDb.customSelect(sql);
    final dynamic rows = await selectable.get();
    if (rows is! List) {
      throw StateError(
        'startDriftViewer expected customSelect(sql).get() to return a List, '
        + 'but got ${rows.runtimeType}.',
      );
    }

    return rows.map<Map<String, dynamic>>((dynamic row) {
      final dynamic data = row.data;
      if (data is! Map) {
        throw StateError(
          'startDriftViewer expected each row to have a Map-like data field, '
          + 'but got ${data.runtimeType}.',
        );
      }
      return Map<String, dynamic>.from(data);
    }).toList(growable: false);
  } on NoSuchMethodError catch (e, st) {
    developer.log(
      'startDriftViewer requires a Drift-like database with customSelect(sql).get() '
      + 'and rows exposing row.data as a Map. Missing member: $e',
      name: _kStartViewerLogName,
      error: e,
      stackTrace: st,
    );
    Error.throwWithStackTrace(
      StateError(
        'startDriftViewer requires a Drift-like database with customSelect(sql).get() '
        + 'and rows exposing row.data as a Map. Missing member: $e',
      ),
      st,
    );
  }
}

/// Convenience API for Drift apps: `await myDb.startDriftViewer(...)`.
///
/// This package intentionally does **not** depend on `drift`, so this extension is
/// implemented via runtime "duck typing". It expects the receiver (and optionally
/// [compareDatabase]) to behave like a Drift database:
/// - `customSelect(String sql)` returning an object with `Future<List> get()`
/// - each returned row having a `data` getter that is `Map`-like
///
/// If you prefer compile-time type safety, call [DriftDebugServer.start] directly.
///
/// Throws [StateError] if the receiver does not support the required API.
extension StartDriftViewerExtension on Object {
  /// Starts the Drift debug server with this object as the database.
  ///
  /// This starts a **localhost-only** server; no external network call is made.
  /// Wraps this object (and [compareDatabase] if provided) in a [DriftDebugQuery] by
  /// calling customSelect(sql).get() and mapping row.data to Map. See [DriftDebugServer.start] for parameters.
  /// When [compareDatabase] is non-null it must support the same Drift-like API (customSelect, get(), row.data as Map);
  /// otherwise queries that use the compare DB (e.g. GET /api/compare/report) will fail with [StateError] or 500.
  ///
  /// Throws [StateError] when the receiver or [compareDatabase] does not support the Drift-like API.
  /// Throws [NoSuchMethodError] (converted to [StateError] with stack) when customSelect or get() is missing.
  Future<void> startDriftViewer({
    bool enabled = true,
    int port = 8642,
    bool loopbackOnly = false,
    String? corsOrigin = '*',
    String? authToken,
    String? basicAuthUser,
    String? basicAuthPassword,
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    Object? compareDatabase,
    DriftDebugOnLog? onLog,
    DriftDebugOnError? onError,
  }) async {
    // ignore: unnecessary_await_in_return — keep await for stack trace (prefer_return_await).
    return await DriftDebugServer.start(
      query: (sql) => _runDriftQuery(this, sql),
      enabled: enabled,
      port: port,
      loopbackOnly: loopbackOnly,
      corsOrigin: corsOrigin,
      authToken: authToken,
      basicAuthUser: basicAuthUser,
      basicAuthPassword: basicAuthPassword,
      getDatabaseBytes: getDatabaseBytes,
      queryCompare: compareDatabase == null
          ? null
          : (sql) => _runDriftQuery(compareDatabase, sql),
      onLog: onLog,
      onError: onError,
    );
  }
}
