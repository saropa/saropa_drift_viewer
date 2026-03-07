// VM-only implementation: this file is selected by conditional export when
// dart.library.io is available. The stub (drift_debug_server_stub.dart) is used on web.
// This file is the VM-only implementation selected by conditional export; dart:io is required.
//
// Architecture: Single [_DriftDebugServerImpl] instance holds server, query callback, auth state,
// and optional snapshot/compare. Request flow: _onRequest → auth check → route by path →
// handler (table list, table data, schema, dump, SQL runner, snapshot, compare). All DB access
// goes through [DriftDebugQuery]; table names are allow-listed from sqlite_master. SQL runner
// accepts only read-only SQL (_isReadOnlySql). Live refresh: periodic _checkDataChange bumps
// _generation; clients long-poll GET /api/generation?since=N.
import 'dart:async';
import 'dart:convert';
import 'dart:developer' as developer;
// VM-only implementation: conditional export selects stub on web; dart:io is required here.
import 'dart:io';
import 'dart:typed_data';

import 'package:collection/collection.dart';
import 'package:crypto/crypto.dart';
import 'package:saropa_drift_viewer/src/drift_debug_session.dart';

import 'server/server_constants.dart';

// --- Public API (typedefs) ---

/// Callback that runs a single SQL query and returns rows as list of maps (column name → value).
///
/// Used by [DriftDebugServer.start] to list tables and fetch table data. Implement with
/// your Drift database's `customSelect` or any SQLite executor. The server only sends
/// allow-listed queries (e.g. table names from sqlite_master, SELECT with limit/offset).
/// Each row must be a map from column name (string) to value (dynamic; null allowed).
typedef DriftDebugQuery = Future<List<Map<String, dynamic>>> Function(
    String sql);

/// Optional callback for log messages (e.g. startup banner when the server binds).
///
/// Pass as the `onLog` parameter to [DriftDebugServer.start]. Use [DriftDebugErrorLogger.logCallback]
/// or [DriftDebugErrorLogger.callbacks] for a ready-made implementation.
typedef DriftDebugOnLog = void Function(String message);

/// Optional callback for errors (and optional stack trace).
///
/// Pass as the `onError` parameter to [DriftDebugServer.start]. Use [DriftDebugErrorLogger.errorCallback]
/// or [DriftDebugErrorLogger.callbacks] for a defensive implementation that never throws.
typedef DriftDebugOnError = void Function(Object error, StackTrace stack);

/// Optional callback that returns the raw SQLite database file bytes.
///
/// Pass as `getDatabaseBytes` to [DriftDebugServer.start] to enable "Download database"
/// in the UI (GET /api/database). Typical implementation: `() => File(yourDbPath).readAsBytes()`.
/// The downloaded file can be opened in DB Browser for SQLite or similar tools.
/// Returning an empty list is valid (e.g. in-memory DB); the server responds with 200 and zero-length body.
typedef DriftDebugGetDatabaseBytes = Future<List<int>> Function();

/// Optional callback for write queries (INSERT/UPDATE/DELETE).
///
/// Separated from [DriftDebugQuery] to enforce read-only by default.
/// Debug-only: used exclusively by the import endpoint (`POST /api/import`).
/// Pass as `writeQuery` to [DriftDebugServer.start] to enable data import in the UI.
/// If not provided, the import endpoint returns 501 Not Implemented.
typedef DriftDebugWriteQuery = Future<void> Function(String sql);

// --- Snapshot (time-travel) ---

/// In-memory snapshot of table state (for time-travel compare). Captured by POST /api/snapshot;
/// GET /api/snapshot/compare diffs current DB vs this snapshot (per-table added/removed/unchanged).
class _Snapshot {
  const _Snapshot(
      {required this.id, required this.createdAt, required this.tables});
  final String id;
  final DateTime createdAt;
  final Map<String, List<Map<String, dynamic>>> tables;

  @override
  String toString() =>
      '_Snapshot(id: $id, createdAt: $createdAt, tables: ${tables.length} tables)';
}

/// A single query timing record for the performance monitor.
class _QueryTiming {
  _QueryTiming({
    required this.sql,
    required this.durationMs,
    required this.rowCount,
    required this.at,
    this.error,
  });

  final String sql;
  final int durationMs;
  final int rowCount;
  final DateTime at;
  final String? error;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'sql': sql,
        'durationMs': durationMs,
        'rowCount': rowCount,
        'error': error,
        'at': at.toIso8601String(),
      };
}

/// Validated POST /api/sql request body (prefer_extension_type_for_wrapper, require_api_response_validation).
extension type _SqlRequestBody(String sql) implements Object {
  static const String _keySql = 'sql';

  /// Validates shape and returns null on invalid (require_api_response_validation).
  static _SqlRequestBody? fromJson(Object? decoded) {
    if (decoded is! Map<String, dynamic>) return null;
    final raw = decoded[_keySql];
    if (raw is! String) return null;
    final trimmedSql = raw.trim();
    if (trimmedSql.isEmpty) return null;
    return _SqlRequestBody(trimmedSql);
  }
}

/// Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web viewer.
///
/// Works with any database: pass a [query] callback that runs SQL and returns rows as maps.
/// Use [start] to bind the server (default port 8642); open http://127.0.0.1:8642 in a browser.
/// Only one server can run per process; use [stop] to shut down before calling [start] again.
///
/// Optional auth for secure dev tunnels (e.g. ngrok): when [authToken] or HTTP Basic
/// ([basicAuthUser] + [basicAuthPassword]) is set, all requests must be authenticated.
///
/// See the package README for API endpoints, UI features (live refresh, SQL runner, export),
/// and optional features (snapshots, database diff, download raw .sqlite).
/// Internal implementation; state is instance-based to satisfy avoid_static_state.
/// Database access is via [DriftDebugQuery] callbacks only; this class does not
/// hold sqflite or any DB reference (require_sqflite_close: N/A).
class _DriftDebugServerImpl {
  HttpServer? _server;
  StreamSubscription<HttpRequest>? _serverSubscription;
  DriftDebugQuery? _query;
  DriftDebugOnLog? _onLog;
  DriftDebugOnError? _onError;
  String? _corsOrigin;

  /// SHA256 hash of auth token (stored instead of plain token for require_data_encryption).
  List<int>? _authTokenHash;
  String? _basicAuthUser;
  String? _basicAuthPassword;
  DriftDebugGetDatabaseBytes? _getDatabaseBytes;

  /// Second query callback for DB diff (main [query] vs [queryCompare]); used by GET /api/compare/report.
  DriftDebugQuery? _queryCompare;

  /// Optional write-query callback for import endpoint; null = import disabled (501).
  DriftDebugWriteQuery? _writeQuery;

  /// Monotonically incremented when table row counts change; used for live refresh and long-poll.
  int _generation = 0;

  /// Fingerprint "table1:count1,table2:count2,..." to detect changes without storing full data.
  String? _lastDataSignature;
  bool _changeCheckInProgress = false;

  /// In-memory snapshot: id, createdAt, and full table data per table (for GET /api/snapshot/compare).
  _Snapshot? _snapshot;

  /// In-memory shared sessions for collaborative debug (POST /api/session/share, GET /api/session/{id}).
  final DriftDebugSessionStore _sessionStore = DriftDebugSessionStore();

  final List<_QueryTiming> _queryTimings = [];

  /// Validated POST /api/sql request body. Checks Content-Type then decodes and validates (require_content_type_validation, require_api_response_validation).
  ({_SqlRequestBody? body, String? error}) _parseSqlBody(
      HttpRequest request, String body) {
    final contentType = request.headers.contentType?.mimeType;
    if (contentType != 'application/json') {
      return (body: null, error: 'Content-Type must be application/json');
    }
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on Object catch (error, stack) {
      _logError(error, stack);
      return (body: null, error: ServerConstants.errorInvalidJson);
    }
    // Explicit shape check here satisfies require_api_response_validation; fromJson repeats for single contract.
    if (decoded is! Map<String, dynamic>) {
      return (body: null, error: ServerConstants.errorInvalidJson);
    }
    final rawSql = decoded[ServerConstants.jsonKeySql];
    if (rawSql is! String || rawSql.trim().isEmpty) {
      return (body: null, error: ServerConstants.errorMissingSql);
    }
    final bodyObj = _SqlRequestBody.fromJson(decoded);
    if (bodyObj == null) {
      return (body: null, error: ServerConstants.errorMissingSql);
    }
    return (body: bodyObj, error: null);
  }

  /// Starts the debug server if [enabled] is true and [query] is provided.
  ///
  /// No-op if [enabled] is false or the server is already running. [query] must execute
  /// the given SQL and return rows as a list of maps (e.g. from Drift's `customSelect` or
  /// any SQLite executor). The server serves a web UI and JSON APIs for table listing and
  /// table data; see the package README for endpoints.
  ///
  /// Parameters:
  /// * [query] — Required. Executes SQL and returns rows as `List<Map<String, dynamic>>`.
  /// * [enabled] — If false, the server is not started (default true).
  /// * [port] — Port to bind (default 8642).
  /// * [loopbackOnly] — If true, bind to 127.0.0.1 only; if false, bind to 0.0.0.0.
  /// * [corsOrigin] — Value for Access-Control-Allow-Origin: `'*'`, a specific origin, or null to omit.
  /// * [authToken] — Optional. When set, requests must include `Authorization: Bearer <token>`.
  ///   Token in URL (e.g. ?token=) is not supported to avoid leakage (avoid_token_in_url).
  /// * [basicAuthUser] and [basicAuthPassword] — Optional. When both set, HTTP Basic auth is accepted.
  ///   Stored in memory for dev-tunnel use only (require_data_encryption: production auth should use hashed credentials).
  /// * [getDatabaseBytes] — Optional. When set, GET /api/database serves the raw SQLite file for download (e.g. open in DB Browser). Use e.g. `() => File(dbPath).readAsBytes()`.
  /// * [queryCompare] — Optional. When set, enables database diff: compare this DB (main [query]) with another (e.g. staging) via GET /api/compare/report. Same schema check and per-table row count diff; export diff report.
  /// * [onLog] — Optional callback for startup banner and log messages.
  /// * [onError] — Optional callback for errors (e.g. [DriftDebugErrorLogger.errorCallback]).
  ///
  /// Throws [ArgumentError] if [port] is not in 0..65535 or if Basic auth is partially configured
  /// (one of [basicAuthUser] or [basicAuthPassword] set without the other).
  ///
  /// ## Example (callback-based, e.g. raw SQLite or custom executor)
  ///
  /// ```dart
  /// await DriftDebugServer.start(
  ///   query: (String sql) async {
  ///     final rows = await yourExecutor.customSelect(sql).get();
  ///     return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
  ///   },
  ///   enabled: kDebugMode,
  ///   onLog: (msg) => debugPrint(msg),
  ///   onError: (err, stack) => debugPrint('$err\n$stack'),
  /// );
  /// ```
  ///
  /// ## Example (Drift: wire customSelect as the query callback)
  ///
  /// When using Drift, implement [query] with your database's customSelect, or use the
  /// package's `startDriftViewer()` extension for one-line setup (see README).
  ///
  /// ```dart
  /// // AppDatabase extends GeneratedDatabase; dbPath is your SQLite file path.
  /// final db = AppDatabase();
  /// await DriftDebugServer.start(
  ///   query: (String sql) async {
  ///     final rows = await db.customSelect(sql).get();
  ///     return rows.map((r) => Map<String, dynamic>.from(r.data)).toList();
  ///   },
  ///   enabled: kDebugMode,
  ///   getDatabaseBytes: () => File(dbPath).readAsBytes(),
  ///   onLog: DriftDebugErrorLogger.logCallback(prefix: 'DriftDebug'),
  ///   onError: DriftDebugErrorLogger.errorCallback(prefix: 'DriftDebug'),
  /// );
  /// ```
  ///
  /// ## Example (with [DriftDebugErrorLogger.callbacks])
  ///
  /// ```dart
  /// final callbacks = DriftDebugErrorLogger.callbacks(prefix: 'DriftDebug');
  /// await DriftDebugServer.start(
  ///   query: runQuery,
  ///   enabled: kDebugMode,
  ///   onLog: callbacks.log,
  ///   onError: callbacks.error,
  /// );
  /// ```
  /// Throws [ArgumentError] for invalid port or partial Basic auth; package does not use @Throws.
  Future<void> start({
    required DriftDebugQuery query,
    bool enabled = true,
    int port = ServerConstants.defaultPort,
    bool loopbackOnly = false,
    String? corsOrigin = '*',
    String? authToken,
    String? basicAuthUser,
    String? basicAuthPassword,
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    DriftDebugQuery? queryCompare,
    DriftDebugWriteQuery? writeQuery,
    DriftDebugOnLog? onLog,
    DriftDebugOnError? onError,
  }) async {
    if (!enabled) return;
    final existing = _server;
    if (existing != null) return;

    // Defensive: reject invalid port and partial Basic auth before binding.
    if (port < ServerConstants.minPort || port > ServerConstants.maxPort) {
      throw ArgumentError(
        'Port must be in range ${ServerConstants.minPort}..${ServerConstants.maxPort} (0 = any port), got: $port',
      );
    }
    final hasBasicUser = basicAuthUser != null && basicAuthUser.isNotEmpty;
    final hasBasicPassword =
        basicAuthPassword != null && basicAuthPassword.isNotEmpty;
    if (hasBasicUser != hasBasicPassword) {
      throw ArgumentError(
          'Basic auth requires both basicAuthUser and basicAuthPassword to be set, or neither. Partial configuration is not allowed.');
    }

    // Wrap query with timing instrumentation so all queries are recorded.
    final DriftDebugQuery originalQuery = query;
    _query = (String sql) => _timedQuery(originalQuery, sql);
    _queryCompare = queryCompare;
    _writeQuery = writeQuery;
    _onLog = onLog;
    _onError = onError;
    _corsOrigin = corsOrigin;
    // Store SHA256 hash of token only (require_data_encryption); never store plain token.
    _authTokenHash = (authToken != null && authToken.isNotEmpty)
        ? sha256.convert(utf8.encode(authToken)).bytes
        : null;
    _basicAuthUser = basicAuthUser;
    _basicAuthPassword = basicAuthPassword;
    _getDatabaseBytes = getDatabaseBytes;

    try {
      final address =
          loopbackOnly ? InternetAddress.loopbackIPv4 : InternetAddress.anyIPv4;
      _server = await HttpServer.bind(address, port);
      final server = _server;
      if (server == null) return;
      _serverSubscription = server.listen(_onRequest);

      _log(ServerConstants.bannerTop);
      _log(ServerConstants.bannerTitle);
      _log(ServerConstants.bannerDivider);
      _log(ServerConstants.bannerOpen);
      _log('${ServerConstants.bannerUrlPrefix}$port');
      _log(ServerConstants.bannerBottom);
    } on Object catch (error, stack) {
      _logError(error, stack);
    }
  }

  /// The port the server is bound to, or null if not running. Exposed for tests.
  int? get port => _server?.port;

  /// Stops the server if running and clears stored state so [DriftDebugServer.start] can be called again.
  /// No-op if the server was not started.
  Future<void> dispose() => stop();

  @override
  String toString() =>
      '_DriftDebugServerImpl(port: ${_server?.port}, running: ${_server != null})';

  /// Stops the server if running and clears stored state so [DriftDebugServer.start] can be called again.
  /// No-op if the server was not started.
  Future<void> stop() async {
    final server = _server;
    if (server == null) return;
    await _serverSubscription?.cancel();
    _serverSubscription = null;
    _server = null;
    _query = null;
    _queryCompare = null;
    _snapshot = null;
    _onLog = null;
    _onError = null;
    _corsOrigin = null;
    _authTokenHash = null;
    _basicAuthUser = null;
    _basicAuthPassword = null;
    _getDatabaseBytes = null;
    _lastDataSignature = null;
    _generation = 0;
    _changeCheckInProgress = false;
    _queryTimings.clear();
    await server.close();
  }

  void _log(String message) {
    final callback = _onLog;
    if (callback != null) callback(message);
  }

  void _logError(Object error, StackTrace stack) {
    developer.log(
      error.toString(),
      name: 'DriftDebugServer',
      error: error,
      stackTrace: stack,
    );
    final callback = _onError;
    if (callback != null) callback(error, stack);
  }

  /// Wraps a query call with timing instrumentation. Records duration, row count, and errors.
  Future<List<Map<String, dynamic>>> _timedQuery(
    DriftDebugQuery query,
    String sql,
  ) async {
    final stopwatch = Stopwatch()..start();
    try {
      final result = await query(sql);
      stopwatch.stop();
      _recordTiming(sql, stopwatch.elapsedMilliseconds, result.length, null);
      return result;
    } on Object catch (error) {
      stopwatch.stop();
      _recordTiming(sql, stopwatch.elapsedMilliseconds, 0, error.toString());
      rethrow;
    }
  }

  /// Appends a timing entry; evicts oldest when buffer exceeds [ServerConstants.maxQueryTimings].
  void _recordTiming(String sql, int durationMs, int rowCount, String? error) {
    _queryTimings.add(_QueryTiming(
      sql: sql,
      durationMs: durationMs,
      rowCount: rowCount,
      error: error,
      at: DateTime.now().toUtc(),
    ));
    if (_queryTimings.length > ServerConstants.maxQueryTimings) {
      _queryTimings.removeAt(0);
    }
  }
  /// Returns substring from [start] to [end] (or end of string). Safe for auth header parsing (avoids range errors).
  String _safeSubstring(String s, int start, [int? end]) {
    if (start < 0 || start >= s.length) return '';
    final endIndex = end ?? s.length;
    if (endIndex <= start) return '';
    final safeEnd = endIndex > s.length ? s.length : endIndex;
    if (start >= safeEnd) return '';
    return s.replaceRange(safeEnd, s.length, '').replaceRange(0, start, '');
  }

  /// Constant-time string comparison to reduce timing side channels (e.g. Basic auth user/password).
  bool _secureCompare(String a, String b) {
    if (a.length != b.length) return false;
    int result = 0;
    for (int i = 0; i < a.length; i++) {
      result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return result == 0;
  }

  /// Constant-time comparison of two byte lists (for token hash comparison; avoids timing leaks).
  bool _secureCompareBytes(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    int result = 0;
    for (int i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result == 0;
  }

  /// Returns true if the request has valid token (Bearer header only) or HTTP Basic credentials.
  /// Token in URL is not supported (avoid_token_in_url: tokens in URLs leak via history/logs/referrers).
  /// Token is verified via SHA256 hash comparison (constant-time).
  bool _isAuthenticated(HttpRequest request) {
    final tokenHash = _authTokenHash;
    if (tokenHash != null) {
      final authHeader = request.headers.value(ServerConstants.headerAuthorization);
      if (authHeader != null &&
          authHeader.length > ServerConstants.authSchemeBearer.length &&
          authHeader.startsWith(ServerConstants.authSchemeBearer)) {
        final token = _safeSubstring(authHeader, ServerConstants.authSchemeBearer.length);
        if (token.isEmpty) return false;
        final incomingHash = sha256.convert(utf8.encode(token)).bytes;
        if (_secureCompareBytes(incomingHash, tokenHash)) return true;
      }
    }
    final user = _basicAuthUser;
    final password = _basicAuthPassword;
    if (user != null && user.isNotEmpty && password != null) {
      final authHeader = request.headers.value(ServerConstants.headerAuthorization);
      if (authHeader != null &&
          authHeader.length >= ServerConstants.authSchemeBasic.length &&
          authHeader.startsWith(ServerConstants.authSchemeBasic)) {
        try {
          final basicPayload =
              _safeSubstring(authHeader, ServerConstants.authSchemeBasic.length);
          if (basicPayload.isEmpty) return false;
          final decoded = utf8.decode(base64.decode(basicPayload));
          final colon = decoded.indexOf(':');
          if (colon >= 0 && colon < decoded.length) {
            final userPart = _safeSubstring(decoded, 0, colon);
            final passwordPart = _safeSubstring(decoded, colon + 1);
            if (_secureCompare(userPart, user) &&
                _secureCompare(passwordPart, password)) {
              return true;
            }
          }
        } on Object catch (error, stack) {
          _logError(error, stack);
        }
      }
    }
    return false;
  }

  /// Sends 401 with JSON body; sets WWW-Authenticate for Basic when Basic auth is configured.
  Future<void> _sendUnauthorized(HttpResponse response) async {
    final res = response;
    res.statusCode = HttpStatus.unauthorized;
    if (_basicAuthUser != null && _basicAuthPassword != null) {
      res.headers
          .set(ServerConstants.headerWwwAuthenticate, 'Basic realm="${ServerConstants.realmDriftDebug}"');
    }
    _setJsonHeaders(res);
    res.write(
        jsonEncode(<String, String>{ServerConstants.jsonKeyError: ServerConstants.authRequiredMessage}));
    await res.close();
  }

  /// Main request handler: auth → health/generation (no query) → route by method and path.
  /// All API routes that need DB access require _query; 503 if null. Errors are logged and sent as JSON.
  Future<void> _onRequest(HttpRequest request) async {
    final req = request;
    final res = req.response;
    final String path = req.uri.path;

    // When auth is configured, require it on every request (including health and HTML).
    if (_authTokenHash != null ||
        (_basicAuthUser != null && _basicAuthPassword != null)) {
      if (!_isAuthenticated(req)) {
        await _sendUnauthorized(res);
        return;
      }
    }

    // Health and generation are handled before query check so probes / live-refresh work without DB.
    try {
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiHealth || path == ServerConstants.pathApiHealthAlt)) {
        await _sendHealth(res);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiGeneration || path == ServerConstants.pathApiGenerationAlt)) {
        await _handleGeneration(req);
        return;
      }
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
      return;
    }

    final DriftDebugQuery? query = _query;
    if (query == null) {
      res.statusCode = HttpStatus.serviceUnavailable;
      await res.close();
      return;
    }

    try {
      if (req.method == ServerConstants.methodGet && (path == '/' || path.isEmpty)) {
        await _sendHtml(res, req);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiTables || path == ServerConstants.pathApiTablesAlt)) {
        await _sendTableList(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path.startsWith(ServerConstants.pathApiTablePrefix) ||
              path.startsWith(ServerConstants.pathApiTablePrefixAlt))) {
        final String suffix = path.replaceFirst(RegExp(r'^/?api/table/'), '');
        if (suffix.endsWith(ServerConstants.pathSuffixCount)) {
          final String tableName = suffix.replaceFirst(RegExp(r'/count$'), '');
          await _sendTableCount(res, query, tableName);
          return;
        }
        if (suffix.endsWith(ServerConstants.pathSuffixColumns)) {
          final String tableName =
              suffix.replaceFirst(RegExp(r'/columns$'), '');
          await _sendTableColumns(res, query, tableName);
          return;
        }
        if (suffix.endsWith(ServerConstants.pathSuffixFkMeta)) {
          final String tableName =
              suffix.replaceFirst(RegExp(r'/fk-meta$'), '');
          await _sendTableFkMeta(res, query, tableName);
          return;
        }
        final String tableName = suffix;
        final int limit =
            _parseLimit(req.uri.queryParameters[ServerConstants.queryParamLimit]);
        final int offset =
            _parseOffset(req.uri.queryParameters[ServerConstants.queryParamOffset]);
        await _sendTableData(
            response: res,
            query: query,
            tableName: tableName,
            limit: limit,
            offset: offset);
        return;
      }
      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSqlExplain || path == ServerConstants.pathApiSqlExplainAlt)) {
        await _handleExplainSql(req, query);
        return;
      }
      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSql || path == ServerConstants.pathApiSqlAlt)) {
        await _handleRunSql(req, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchema || path == ServerConstants.pathApiSchemaAlt)) {
        await _sendSchemaDump(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchemaDiagram || path == ServerConstants.pathApiSchemaDiagramAlt)) {
        await _sendSchemaDiagram(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchemaMetadata ||
              path == ServerConstants.pathApiSchemaMetadataAlt)) {
        await _sendSchemaMetadata(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiDump || path == ServerConstants.pathApiDumpAlt)) {
        await _sendFullDump(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiDatabase || path == ServerConstants.pathApiDatabaseAlt)) {
        await _sendDatabaseFile(res);
        return;
      }
      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSnapshot || path == ServerConstants.pathApiSnapshotAlt)) {
        await _handleSnapshotCreate(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSnapshot || path == ServerConstants.pathApiSnapshotAlt)) {
        await _handleSnapshotGet(res);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSnapshotCompare ||
              path == ServerConstants.pathApiSnapshotCompareAlt)) {
        await _handleSnapshotCompare(res, req, query);
        return;
      }
      if (req.method == ServerConstants.methodDelete &&
          (path == ServerConstants.pathApiSnapshot || path == ServerConstants.pathApiSnapshotAlt)) {
        await _handleSnapshotDelete(res);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path.startsWith(ServerConstants.pathApiComparePrefix) ||
              path.startsWith(ServerConstants.pathApiComparePrefixAlt))) {
        await _handleCompareReport(res, req, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiIndexSuggestions ||
              path == ServerConstants.pathApiIndexSuggestionsAlt)) {
        await _handleIndexSuggestions(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiMigrationPreview ||
              path == ServerConstants.pathApiMigrationPreviewAlt)) {
        await _handleMigrationPreview(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsAnomalies ||
              path == ServerConstants.pathApiAnalyticsAnomaliesAlt)) {
        await _handleAnomalyDetection(res, query);
        return;
      }
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsSize ||
              path == ServerConstants.pathApiAnalyticsSizeAlt)) {
        await _handleSizeAnalytics(res, query);
        return;
      }
      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiImport || path == ServerConstants.pathApiImportAlt)) {
        await _handleImport(req);
        return;
      }
      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSessionShare ||
              path == ServerConstants.pathApiSessionShareAlt)) {
        await _handleSessionShare(req);
        return;
      }
      if (path.startsWith(ServerConstants.pathApiSessionPrefix) ||
          path.startsWith(ServerConstants.pathApiSessionPrefixAlt)) {
        final suffix = path.startsWith(ServerConstants.pathApiSessionPrefix)
            ? path.substring(ServerConstants.pathApiSessionPrefix.length)
            : path.substring(ServerConstants.pathApiSessionPrefixAlt.length);
        if (suffix.endsWith(ServerConstants.pathSuffixAnnotate) &&
            req.method == ServerConstants.methodPost) {
          final sessionId =
              suffix.replaceFirst(RegExp(r'/annotate$'), '');
          await _handleSessionAnnotate(req, sessionId);
          return;
        }
        if (req.method == ServerConstants.methodGet) {
          await _handleSessionGet(res, suffix);
          return;
        }
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsPerformance ||
              path == ServerConstants.pathApiAnalyticsPerformanceAlt)) {
        await _handlePerformanceAnalytics(res);
        return;
      }
      if (req.method == ServerConstants.methodDelete &&
          (path == ServerConstants.pathApiAnalyticsPerformance ||
              path == ServerConstants.pathApiAnalyticsPerformanceAlt)) {
        await _clearPerformanceData(res);
        return;
      }

      res.statusCode = HttpStatus.notFound;
      await res.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
    }
  }

  /// Validates that [sql] is read-only: single statement, SELECT or WITH...SELECT only.
  /// Rejects INSERT/UPDATE/DELETE and DDL (CREATE/ALTER/DROP etc.). Used by POST /api/sql only.
  bool _isReadOnlySql(String sql) {
    final trimmed = sql.trim();
    if (trimmed.isEmpty) return false;
    // Remove single-line and block comments so keywords inside comments are ignored.
    final noLineComments = trimmed.replaceAll(RegExp(r'--[^\n]*'), ' ');
    final noBlockComments =
        noLineComments.replaceAll(RegExp(r'/\*[\s\S]*?\*/'), ' ');
    // Replace string literals with placeholders so keywords inside strings (e.g. SELECT 'INSERT') don't trigger.
    final noSingleQuotes =
        noBlockComments.replaceAllMapped(RegExp(r"'(?:[^']|'')*'"), (_) => '?');
    final noStrings =
        noSingleQuotes.replaceAllMapped(RegExp(r'"(?:[^"]|"")*"'), (_) => '?');
    final sqlNoStrings = noStrings.trim();
    // Only one statement (no semicolon in the middle; trailing semicolon allowed).
    final firstSemicolon = sqlNoStrings.indexOf(';');
    if (firstSemicolon >= 0 &&
        firstSemicolon + ServerConstants.indexAfterSemicolon <= sqlNoStrings.length &&
        firstSemicolon < sqlNoStrings.length - ServerConstants.indexAfterSemicolon) {
      final after =
          _safeSubstring(sqlNoStrings, firstSemicolon + ServerConstants.indexAfterSemicolon)
              .trim();
      if (after.isNotEmpty) return false;
    }
    final withoutTrailingSemicolon = sqlNoStrings.endsWith(';')
        ? _safeSubstring(
                sqlNoStrings, 0, sqlNoStrings.length - ServerConstants.indexAfterSemicolon)
            .trim()
        : sqlNoStrings;
    final upper = withoutTrailingSemicolon.toUpperCase();
    const selectPrefix = 'SELECT ';
    const withPrefix = 'WITH ';
    if (!upper.startsWith(selectPrefix) && !upper.startsWith(withPrefix)) {
      return false;
    }
    // Forbidden keywords (word boundary to avoid false positives in identifiers).
    const forbidden = <String>{
      'INSERT',
      'UPDATE',
      'DELETE',
      'REPLACE',
      'TRUNCATE',
      'CREATE',
      'ALTER',
      'DROP',
      'ATTACH',
      'DETACH',
      'PRAGMA',
      'VACUUM',
      'ANALYZE',
      'REINDEX',
    };
    final words = RegExp(r'\b\w+\b');
    for (final match in words.allMatches(upper)) {
      final word = match.group(0);
      if (word != null && forbidden.contains(word)) return false;
    }
    return true;
  }

  /// Reads, parses, and validates a POST SQL request body. Returns the validated read-only SQL
  /// string, or null if validation failed (error response already sent and closed).
  /// Shared by [_handleRunSql] and [_handleExplainSql] to avoid duplicating body-reading,
  /// Content-Type checking, JSON parsing, and read-only validation.
  Future<String?> _readAndValidateSqlBody(HttpRequest request) async {
    final res = request.response;
    String body;
    try {
      final builder = BytesBuilder();
      await for (final chunk in request) {
        builder.add(chunk);
      }
      body = utf8.decode(builder.toBytes());
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(
          <String, String>{ServerConstants.jsonKeyError: ServerConstants.errorInvalidRequestBody}));
      await res.close();
      return null;
    }
    final result = _parseSqlBody(request, body);
    final bodyObj = result.body;
    if (bodyObj == null) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: result.error ?? ServerConstants.errorInvalidJson,
      }));
      await res.close();
      return null;
    }
    final String sql = bodyObj.sql;
    if (!_isReadOnlySql(sql)) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorReadOnlyOnly,
      }));
      await res.close();
      return null;
    }
    return sql;
  }

  /// Handles POST /api/sql: body {"sql": "SELECT ..."}. Validates read-only via _isReadOnlySql; returns {"rows": [...]}.
  Future<void> _handleRunSql(HttpRequest request, DriftDebugQuery query) async {
    final sql = await _readAndValidateSqlBody(request);
    if (sql == null) return;
    final res = request.response;
    try {
      final dynamic raw = await query(sql);
      final List<Map<String, dynamic>> rows = _normalizeRows(raw);
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{ServerConstants.jsonKeyRows: rows}));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles POST /api/sql/explain: body {"sql": "SELECT ..."}. Prepends EXPLAIN QUERY PLAN; returns {"rows": [...], "sql": "EXPLAIN ..."}.
  Future<void> _handleExplainSql(
      HttpRequest request, DriftDebugQuery query) async {
    final sql = await _readAndValidateSqlBody(request);
    if (sql == null) return;
    final res = request.response;
    try {
      final explainSql = 'EXPLAIN QUERY PLAN $sql';
      final dynamic raw = await query(explainSql);
      final rows = _normalizeRows(raw);
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        ServerConstants.jsonKeyRows: rows,
        ServerConstants.jsonKeySql: explainSql,
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Sends a 500 JSON error response and closes the response.
  Future<void> _sendErrorResponse(HttpResponse response, Object error) async {
    final res = response;
    res.statusCode = HttpStatus.internalServerError;
    res.headers.contentType = ContentType.json;
    _setCors(res);
    res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    await res.close();
  }

  /// Parses limit query param; clamps to 1.._maxLimit; default ServerConstants.defaultLimit.
  int _parseLimit(String? value) {
    if (value == null) return ServerConstants.defaultLimit;
    final int? n = int.tryParse(value);
    if (n == null || n < ServerConstants.minLimit) return ServerConstants.defaultLimit;
    return n.clamp(ServerConstants.minLimit, ServerConstants.maxLimit);
  }

  /// Parses offset query param; returns 0 if missing or invalid; caps at [ServerConstants.maxOffset].
  int _parseOffset(String? value) {
    if (value == null) return 0;
    final int? n = int.tryParse(value);
    if (n == null || n < 0) return 0;
    return n > ServerConstants.maxOffset ? ServerConstants.maxOffset : n;
  }

  /// Normalizes raw query result to a list of maps. Handles null, non-List, and non-Map rows defensively.
  static List<Map<String, dynamic>> _normalizeRows(dynamic raw) {
    if (raw == null) return [];
    if (raw is! List) return [];
    final out = <Map<String, dynamic>>[];
    for (final item in raw) {
      if (item is Map) {
        out.add(Map<String, dynamic>.from(item));
      }
    }
    return out;
  }

  /// Extracts COUNT(*) result from a single-row query (column 'c'). Returns 0 if empty or null. Used for table count and diff.
  int _extractCountFromRows(List<Map<String, dynamic>> rows) {
    final firstRow = rows.firstOrNull;
    if (firstRow == null || firstRow[ServerConstants.jsonKeyCountColumn] == null) return 0;
    final countValue = firstRow[ServerConstants.jsonKeyCountColumn];
    return countValue is int
        ? countValue
        : (countValue is num ? countValue.toInt() : 0);
  }

  /// Fetches table names from sqlite_master (type='table', exclude sqlite_*). Used as allow-list for table routes.
  /// Defensively handles query returning null or non-List / non-Map rows.
  Future<List<String>> _getTableNames(DriftDebugQuery query) async {
    final dynamic raw = await query(ServerConstants.sqlTableNames);
    final List<Map<String, dynamic>> rows = _normalizeRows(raw);
    return rows
        .map((row) => row[ServerConstants.jsonKeyName] as String? ?? '')
        .where((nameStr) => nameStr.isNotEmpty)
        .toList();
  }

  /// If [tableName] is not in the allow-list (from sqlite_master), sends 400 and returns false; otherwise returns true.
  Future<bool> _requireKnownTable(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    final List<String> allowed = await _getTableNames(query);
    if (!allowed.contains(tableName)) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: '${ServerConstants.errorUnknownTablePrefix}$tableName',
      }));
      await res.close();
      return false;
    }
    return true;
  }

  /// GET /api/tables — returns JSON array of table names (from sqlite_master, excluding sqlite_*).
  Future<void> _sendTableList(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    await _checkDataChange();
    final List<String> names = await _getTableNames(query);
    _setJsonHeaders(res);
    res.write(jsonEncode(names));
    await res.close();
  }

  /// Returns JSON list of column names for GET `/api/table/<name>/columns` (for SQL autofill).
  Future<void> _sendTableColumns(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _requireKnownTable(res, query, tableName)) return;
    // PRAGMA table_info returns cid, name, type, notnull, dflt_value, pk.
    final dynamic rawInfo = await query('PRAGMA table_info("$tableName")');
    final List<Map<String, dynamic>> rows = _normalizeRows(rawInfo);
    final List<String> columns = rows
        .map((r) => r[ServerConstants.jsonKeyName] as String? ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    _setJsonHeaders(res);
    res.write(jsonEncode(columns));
    await res.close();
  }

  /// Returns FK metadata for GET `/api/table/<name>/fk-meta`.
  Future<void> _sendTableFkMeta(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _requireKnownTable(res, query, tableName)) return;
    try {
      final List<Map<String, dynamic>> fkRows = _normalizeRows(
        await query('PRAGMA foreign_key_list("$tableName")'),
      );
      final List<Map<String, dynamic>> fks = fkRows
          .map((r) {
            final fromCol = r[ServerConstants.pragmaFrom] as String?;
            final toTable = r[ServerConstants.jsonKeyTable] as String?;
            final toCol = r[ServerConstants.pragmaTo] as String?;
            if (fromCol == null || toTable == null || toCol == null) {
              return null;
            }
            return <String, dynamic>{
              ServerConstants.fkFromColumn: fromCol,
              ServerConstants.fkToTable: toTable,
              ServerConstants.fkToColumn: toCol,
            };
          })
          .whereType<Map<String, dynamic>>()
          .toList();
      _setJsonHeaders(res);
      res.write(jsonEncode(fks));
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
    } finally {
      await res.close();
    }
  }

  /// Returns JSON {"count": N} for GET `/api/table/<name>/count`.
  Future<void> _sendTableCount(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final res = response;
    if (!await _requireKnownTable(res, query, tableName)) return;
    final dynamic rawCount =
        await query('SELECT COUNT(*) AS c FROM "$tableName"');
    final List<Map<String, dynamic>> rows = _normalizeRows(rawCount);
    final int count = _extractCountFromRows(rows);
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, int>{ServerConstants.jsonKeyCount: count}));
    await res.close();
  }

  /// GET `/api/table/<name>?limit=&offset=` — returns JSON array of rows. Table name is allow-listed; limit/offset validated.
  Future<void> _sendTableData({
    required HttpResponse response,
    required DriftDebugQuery query,
    required String tableName,
    required int limit,
    required int offset,
  }) async {
    final res = response;
    if (!await _requireKnownTable(res, query, tableName)) return;
    // Table name from allow-list; limit/offset validated so interpolation is safe.
    final dynamic raw =
        await query('SELECT * FROM "$tableName" LIMIT $limit OFFSET $offset');
    final List<Map<String, dynamic>> data = _normalizeRows(raw);
    _setJsonHeaders(res);
    res.write(const JsonEncoder.withIndent('  ').convert(data));
    await res.close();
  }

  /// Fetches schema (CREATE statements) from sqlite_master, no data. Used for export and compare.
  Future<String> _getSchemaSql(DriftDebugQuery query) async {
    final dynamic raw = await query(ServerConstants.sqlSchemaMaster);
    final List<Map<String, dynamic>> rows = _normalizeRows(raw);
    final buffer = StringBuffer();
    for (final row in rows) {
      final stmt = row[ServerConstants.jsonKeySql] as String?;
      if (stmt != null && stmt.isNotEmpty) {
        buffer.writeln(stmt);
        if (!stmt.trimRight().endsWith(';')) buffer.write(';');
        buffer.writeln();
      }
    }
    return buffer.toString();
  }

  /// GET /api/health — returns {"ok": true}. Used by health checks and tunnels.
  Future<void> _sendHealth(HttpResponse response) async {
    final res = response;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{ServerConstants.jsonKeyOk: true}));
    await res.close();
  }

  /// Handles GET /api/generation. Returns current [_generation]. Query parameter `since` triggers long-poll
  /// until generation > since or [ServerConstants.longPollTimeout]; reduces client polling when idle.
  /// Change detection runs on demand (here and in the long-poll loop) to satisfy avoid_work_in_paused_state.
  Future<void> _handleGeneration(HttpRequest request) async {
    final req = request;
    final res = req.response;
    await _checkDataChange();
    final sinceRaw = req.uri.queryParameters[ServerConstants.queryParamSince];
    final int? since = sinceRaw != null ? int.tryParse(sinceRaw) : null;
    if (since != null && since >= 0) {
      final deadline = DateTime.now().toUtc().add(ServerConstants.longPollTimeout);
      while (
          DateTime.now().toUtc().isBefore(deadline) && _generation <= since) {
        await Future<void>.delayed(ServerConstants.longPollCheckInterval);
        await _checkDataChange();
      }
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, int>{ServerConstants.jsonKeyGeneration: _generation}));
    await res.close();
  }

  /// Runs a lightweight fingerprint of table row counts; bumps [_generation] when it changes so clients can refresh.
  /// One COUNT(*) per table per run — acceptable for typical debug DBs; many tables may add latency.
  Future<void> _checkDataChange() async {
    if (_changeCheckInProgress) return;
    final query = _query;
    if (query == null) return;
    _changeCheckInProgress = true;
    try {
      final tables = await _getTableNames(query);
      final parts = <String>[];
      for (final t in tables) {
        final raw = await query('SELECT COUNT(*) AS c FROM "$t"');
        parts.add('$t:${_extractCountFromRows(_normalizeRows(raw))}');
      }
      final signature = parts.join(',');
      if (_lastDataSignature != null && _lastDataSignature != signature) {
        _generation++;
      }
      _lastDataSignature = signature;
    } on Object catch (error, stack) {
      _logError(error, stack);
    } finally {
      _changeCheckInProgress = false;
    }
  }

  /// Sends schema-only SQL dump (CREATE statements from sqlite_master, no data).
  Future<void> _sendSchemaDump(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    final String schema = await _getSchemaSql(query);
    res.statusCode = HttpStatus.ok;
    _setAttachmentHeaders(res, ServerConstants.attachmentSchemaSql);
    res.write(schema);
    await res.close();
  }

  /// Returns diagram data for GET /api/schema/diagram: tables with columns, and foreign keys (PRAGMA foreign_key_list).
  Future<Map<String, dynamic>> _getDiagramData(DriftDebugQuery query) async {
    final List<String> tableNames = await _getTableNames(query);
    final List<Map<String, dynamic>> tables = [];
    final List<Map<String, dynamic>> foreignKeys = [];

    for (final tableName in tableNames) {
      final List<Map<String, dynamic>> infoRows =
          await query('PRAGMA table_info("$tableName")');
      final List<Map<String, dynamic>> columns = infoRows.map((r) {
        final name = r['name'];
        final type = r['type'];
        final pk = r['pk'];
        return <String, dynamic>{
          ServerConstants.jsonKeyName: name is String? ? name ?? '' : '',
          ServerConstants.jsonKeyType: type is String? ? type ?? '' : '',
          ServerConstants.jsonKeyPk: pk is int ? pk != 0 : false,
        };
      }).toList();

      tables.add(<String, dynamic>{
        ServerConstants.jsonKeyName: tableName,
        ServerConstants.jsonKeyColumns: columns,
      });

      try {
        final dynamic rawFk =
            await query('PRAGMA foreign_key_list("$tableName")');
        final List<Map<String, dynamic>> fkRows = _normalizeRows(rawFk);
        for (final r in fkRows) {
          final toTable = r[ServerConstants.jsonKeyTable] as String?;
          final fromCol = r[ServerConstants.pragmaFrom] as String?;
          final toCol = r[ServerConstants.pragmaTo] as String?;
          if (toTable != null &&
              toTable.isNotEmpty &&
              fromCol != null &&
              toCol != null) {
            foreignKeys.add(<String, dynamic>{
              ServerConstants.fkFromTable: tableName,
              ServerConstants.fkFromColumn: fromCol,
              ServerConstants.fkToTable: toTable,
              ServerConstants.fkToColumn: toCol,
            });
          }
        }
      } on Object catch (error, stack) {
        _logError(error, stack);
      }
    }

    return <String, dynamic>{
      ServerConstants.jsonKeyTables: tables,
      ServerConstants.jsonKeyForeignKeys: foreignKeys,
    };
  }

  /// Sends JSON diagram data for GET /api/schema/diagram (tables + columns + foreign keys).
  Future<void> _sendSchemaDiagram(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    try {
      final Map<String, dynamic> data = await _getDiagramData(query);
      _setJsonHeaders(res);
      res.write(const JsonEncoder.withIndent('  ').convert(data));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Sends schema metadata for GET /api/schema/metadata: tables with columns (name, type, pk) and row counts.
  /// Used by the natural-language-to-SQL engine on the client side.
  Future<void> _sendSchemaMetadata(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      final tableNames = await _getTableNames(query);
      final tables = <Map<String, dynamic>>[];
      for (final tableName in tableNames) {
        final infoRows = _normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );
        final columns = infoRows
            .map((r) => <String, dynamic>{
                  ServerConstants.jsonKeyName: r[ServerConstants.jsonKeyName] ?? '',
                  ServerConstants.jsonKeyType: r[ServerConstants.jsonKeyType] ?? '',
                  ServerConstants.jsonKeyPk: (r[ServerConstants.jsonKeyPk] is int) ? r[ServerConstants.jsonKeyPk] != 0 : false,
                })
            .toList();
        final countRows = _normalizeRows(
          await query('SELECT COUNT(*) AS ${ServerConstants.jsonKeyCountColumn} FROM "$tableName"'),
        );
        final count = _extractCountFromRows(countRows);
        tables.add(<String, dynamic>{
          ServerConstants.jsonKeyName: tableName,
          ServerConstants.jsonKeyColumns: columns,
          ServerConstants.jsonKeyRowCount: count,
        });
      }
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{ServerConstants.jsonKeyTables: tables}));
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
    } finally {
      await res.close();
    }
  }

  /// Escapes a value for use in a SQL INSERT literal (no quotes for numbers/null; strings and blobs escaped).
  String _sqlLiteral(Object? value) {
    if (value == null) return 'NULL';
    if (value is num) return value.toString();
    if (value is bool) return value ? '1' : '0';
    if (value is String) {
      return "'${value.replaceAll(r'\', r'\\').replaceAll("'", "''")}'";
    }
    if (value is List<int>) {
      return "X'${value.map((b) => b.toRadixString(ServerConstants.hexRadix).padLeft(ServerConstants.hexBytePadding, '0')).join()}'";
    }
    return "'${value.toString().replaceAll(r'\', r'\\').replaceAll("'", "''")}'";
  }

  /// Builds full dump SQL: schema (CREATEs) plus INSERT statements for every table row.
  /// Table names come from allow-list so interpolation is safe.
  Future<String> _getFullDumpSql(DriftDebugQuery query) async {
    final buffer = StringBuffer();
    final schema = await _getSchemaSql(query);
    buffer.writeln(schema);
    buffer.writeln('-- Data dump');
    final tables = await _getTableNames(query);
    for (final table in tables) {
      final dynamic raw = await query('SELECT * FROM "$table"');
      final List<Map<String, dynamic>> rows = _normalizeRows(raw);
      if (rows.isEmpty) continue;
      final firstRow = rows.firstOrNull;
      if (firstRow == null) continue;
      final keys = firstRow.keys.toList();
      if (keys.isEmpty) continue;
      final colList = keys.map((k) => '"$k"').join(', ');
      for (final row in rows) {
        final values = keys.map((k) => _sqlLiteral(row[k])).join(', ');
        buffer.writeln('INSERT INTO "$table" ($colList) VALUES ($values);');
      }
    }
    return buffer.toString();
  }

  /// Sends full dump (schema + data) as downloadable SQL file. May be slow for large DBs.
  Future<void> _sendFullDump(
      HttpResponse response, DriftDebugQuery query) async {
    final res = response;
    final String dump = await _getFullDumpSql(query);
    res.statusCode = HttpStatus.ok;
    _setAttachmentHeaders(res, ServerConstants.attachmentDumpSql);
    res.write(dump);
    await res.close();
  }

  /// Sends the raw SQLite database file when the server was started with the getDatabaseBytes callback.
  /// Returns 501 Not Implemented if not configured. Used by the UI "Download database (raw .sqlite)" link.
  Future<void> _sendDatabaseFile(HttpResponse response) async {
    final res = response;
    final getBytes = _getDatabaseBytes;
    if (getBytes == null) {
      res.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorDatabaseDownloadNotConfigured,
      }));
      await res.close();
      return;
    }
    try {
      final bytes = await getBytes();
      // Empty list is valid (e.g. in-memory DB); respond 200 with zero-length body.
      res.statusCode = HttpStatus.ok;
      res.headers.contentType = ContentType(
          ServerConstants.contentTypeApplicationOctetStream, ServerConstants.contentTypeOctetStream);
      res.headers.set(ServerConstants.headerContentDisposition, ServerConstants.attachmentDatabaseSqlite);
      _setCors(res);
      res.add(bytes);
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Stable string representation of a row for diffing (sorted keys). Used by snapshot compare to count added/removed/unchanged.
  String _rowSignature(Map<String, dynamic> row) {
    final keys = row.keys.toList()..sort();
    final sorted = <String, dynamic>{};
    for (final k in keys) {
      sorted[k] = row[k];
    }
    return jsonEncode(sorted);
  }

  /// Handles POST /api/snapshot: captures full table data for all tables into in-memory [_snapshot].
  Future<void> _handleSnapshotCreate(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      final tables = await _getTableNames(query);
      final Map<String, List<Map<String, dynamic>>> data = {};
      for (final table in tables) {
        final List<Map<String, dynamic>> rows =
            await query('SELECT * FROM "$table"');
        data[table] = rows.map((r) => Map<String, dynamic>.from(r)).toList();
      }
      final id = DateTime.now().toUtc().toIso8601String();
      final createdAt = DateTime.now().toUtc();
      final created = _Snapshot(id: id, createdAt: createdAt, tables: data);
      _snapshot = created;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        ServerConstants.jsonKeyId: created.id,
        ServerConstants.jsonKeyCreatedAt: created.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyTableCount: created.tables.length,
        ServerConstants.jsonKeyTables: created.tables.keys.toList(),
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles GET /api/snapshot: returns snapshot metadata (id, createdAt, table counts) or null.
  Future<void> _handleSnapshotGet(HttpResponse response) async {
    final res = response;
    final snap = _snapshot;
    if (snap == null) {
      res.statusCode = HttpStatus.ok;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{ServerConstants.jsonKeySnapshot: null}));
      await res.close();
      return;
    }
    final tableCounts = <String, int>{};
    for (final e in snap.tables.entries) {
      tableCounts[e.key] = e.value.length;
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      ServerConstants.jsonKeySnapshot: <String, dynamic>{
        ServerConstants.jsonKeyId: snap.id,
        ServerConstants.jsonKeyCreatedAt: snap.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyTables: snap.tables.keys.toList(),
        ServerConstants.jsonKeyCounts: tableCounts,
      },
    }));
    await res.close();
  }

  /// Handles GET /api/snapshot/compare: diffs current DB vs [_snapshot] (per-table added/removed/unchanged). Optional ?format=download.
  Future<void> _handleSnapshotCompare(
    HttpResponse response,
    HttpRequest request,
    DriftDebugQuery query,
  ) async {
    final res = response;
    final req = request;
    final snap = _snapshot;
    if (snap == null) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorNoSnapshot,
      }));
      await res.close();
      return;
    }
    try {
      final tablesNow = await _getTableNames(query);
      final allTables = <String>{...snap.tables.keys, ...tablesNow};
      final List<Map<String, dynamic>> tableDiffs = [];
      for (final table in allTables.toList()..sort()) {
        final rowsThen = snap.tables[table] ?? [];
        final rowsNowList = tablesNow.contains(table)
            ? _normalizeRows(await query('SELECT * FROM "$table"'))
            : <Map<String, dynamic>>[];
        final setThen = rowsThen.map(_rowSignature).toSet();
        final setNow = rowsNowList.map(_rowSignature).toSet();
        final added = setNow.difference(setThen).length;
        final removed = setThen.difference(setNow).length;
        final inBoth = setThen.intersection(setNow).length;
        tableDiffs.add(<String, dynamic>{
          ServerConstants.jsonKeyTable: table,
          ServerConstants.jsonKeyCountThen: rowsThen.length,
          ServerConstants.jsonKeyCountNow: rowsNowList.length,
          ServerConstants.jsonKeyAdded: added,
          ServerConstants.jsonKeyRemoved: removed,
          ServerConstants.jsonKeyUnchanged: inBoth,
        });
      }
      final body = <String, dynamic>{
        ServerConstants.jsonKeySnapshotId: snap.id,
        ServerConstants.jsonKeySnapshotCreatedAt: snap.createdAt.toUtc().toIso8601String(),
        ServerConstants.jsonKeyComparedAt: DateTime.now().toUtc().toIso8601String(),
        ServerConstants.jsonKeyTables: tableDiffs,
      };
      if (req.uri.queryParameters[ServerConstants.queryParamFormat] == ServerConstants.formatDownload) {
        res.statusCode = HttpStatus.ok;
        res.headers.contentType = ContentType.json;
        res.headers.set(ServerConstants.headerContentDisposition, ServerConstants.attachmentSnapshotDiff);
        _setCors(res);
        res.write(const JsonEncoder.withIndent('  ').convert(body));
      } else {
        _setJsonHeaders(res);
        res.write(const JsonEncoder.withIndent('  ').convert(body));
      }
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles DELETE /api/snapshot: clears the in-memory snapshot.
  Future<void> _handleSnapshotDelete(HttpResponse response) async {
    final res = response;
    _snapshot = null;
    _setJsonHeaders(res);
    res.write(
        jsonEncode(<String, String>{ServerConstants.jsonKeyOk: ServerConstants.messageSnapshotCleared}));
    await res.close();
  }

  /// Handles GET /api/compare/report: schema and per-table row count diff between main [query] and [_queryCompare]. Optional ?format=download.
  Future<void> _handleCompareReport(
    HttpResponse response,
    HttpRequest request,
    DriftDebugQuery query,
  ) async {
    final res = response;
    final req = request;
    final queryB = _queryCompare;
    if (queryB == null) {
      res.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorCompareNotConfigured,
      }));
      await res.close();
      return;
    }
    final path = req.uri.path;
    if (path != ServerConstants.pathApiCompareReport && path != ServerConstants.pathApiCompareReportAlt) {
      res.statusCode = HttpStatus.notFound;
      await res.close();
      return;
    }
    try {
      final schemaA = await _getSchemaSql(query);
      final schemaB = await _getSchemaSql(queryB);
      final tablesA = await _getTableNames(query);
      final tablesB = await _getTableNames(queryB);
      final allTables = <String>{...tablesA, ...tablesB}.toList()..sort();
      final schemaSame = schemaA == schemaB;
      final List<Map<String, dynamic>> countDiffs = [];
      for (final table in allTables) {
        final futures = <Future<List<Map<String, dynamic>>>>[];
        if (tablesA.contains(table)) {
          futures.add(query('SELECT COUNT(*) AS c FROM "$table"'));
        }
        if (tablesB.contains(table)) {
          futures.add(queryB('SELECT COUNT(*) AS c FROM "$table"'));
        }
        final results = futures.isEmpty
            ? <List<Map<String, dynamic>>>[]
            : await Future.wait(futures);
        int countA = 0;
        int countB = 0;
        int idx = 0;
        if (tablesA.contains(table)) {
          countA = _extractCountFromRows(results[idx++]);
        }
        if (tablesB.contains(table)) {
          countB = _extractCountFromRows(results[idx++]);
        }
        countDiffs.add(<String, dynamic>{
          ServerConstants.jsonKeyTable: table,
          ServerConstants.jsonKeyCountA: countA,
          ServerConstants.jsonKeyCountB: countB,
          ServerConstants.jsonKeyDiff: countA - countB,
          ServerConstants.jsonKeyOnlyInA: !tablesB.contains(table),
          ServerConstants.jsonKeyOnlyInB: !tablesA.contains(table),
        });
      }
      final report = <String, dynamic>{
        ServerConstants.jsonKeySchemaSame: schemaSame,
        ServerConstants.jsonKeySchemaDiff: schemaSame
            ? null
            : <String, String>{ServerConstants.jsonKeyA: schemaA, ServerConstants.jsonKeyB: schemaB},
        // JsonEncoder.convert expects List for array values; iterable is not sufficient.
        ServerConstants.jsonKeyTablesOnlyInA:
            tablesA.where((t) => !tablesB.contains(t)).toList(),
        // Same: JSON encoder requires List, not Iterable.
        ServerConstants.jsonKeyTablesOnlyInB:
            tablesB.where((t) => !tablesA.contains(t)).toList(),
        ServerConstants.jsonKeyTableCounts: countDiffs,
        ServerConstants.jsonKeyGeneratedAt: DateTime.now().toUtc().toIso8601String(),
      };
      final format = req.uri.queryParameters[ServerConstants.queryParamFormat];
      if (format == ServerConstants.formatDownload) {
        res.statusCode = HttpStatus.ok;
        res.headers.contentType = ContentType.json;
        res.headers.set(ServerConstants.headerContentDisposition, ServerConstants.attachmentDiffReport);
        _setCors(res);
        res.write(const JsonEncoder.withIndent('  ').convert(report));
      } else {
        _setJsonHeaders(res);
        res.write(const JsonEncoder.withIndent('  ').convert(report));
      }
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Handles GET /api/migration/preview: compares main DB schema against
  /// [_queryCompare] and generates ALTER TABLE / CREATE TABLE / DROP TABLE
  /// DDL statements for migration.
  Future<void> _handleMigrationPreview(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    final queryB = _queryCompare;

    if (queryB == null) {
      res.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: ServerConstants.errorMigrationRequiresCompare,
      }));
      await res.close();
      return;
    }

    try {
      // "A" = current (source), "B" = compare (target/desired state)
      final tablesA = await _getTableNames(query);
      final tablesB = await _getTableNames(queryB);
      final migrations = <String>[];

      await _migrationNewTables(migrations, tablesA, tablesB, queryB);
      _migrationDroppedTables(migrations, tablesA, tablesB);
      await _migrationModifiedTables(
        migrations, tablesA, tablesB, query, queryB,
      );

      final migrationSql = migrations.join('\n');

      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'migrationSql': migrationSql,
        'changeCount': migrations
            .where((l) => !l.startsWith('--') && l.trim().isNotEmpty)
            .length,
        'hasWarnings': migrations.any((l) => l.contains('WARNING')),
        ServerConstants.jsonKeyGeneratedAt: DateTime.now().toUtc().toIso8601String(),
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
    } finally {
      await res.close();
    }
  }

  /// Generates CREATE TABLE statements for tables in [tablesB] not in
  /// [tablesA] (new tables in target schema).
  Future<void> _migrationNewTables(
    List<String> migrations,
    List<String> tablesA,
    List<String> tablesB,
    DriftDebugQuery queryB,
  ) async {
    for (final table in tablesB) {
      if (tablesA.contains(table)) continue;
      final schemaRows = _normalizeRows(
        await queryB(
          "SELECT sql FROM sqlite_master "
          "WHERE type='table' AND name='$table'",
        ),
      );
      final createStmt = schemaRows.isNotEmpty
          ? schemaRows.first['sql'] as String?
          : null;
      if (createStmt != null) {
        migrations.add('-- NEW TABLE: $table');
        migrations.add('$createStmt;');
        migrations.add('');
      }
    }
  }

  /// Generates DROP TABLE statements for tables in [tablesA] not in
  /// [tablesB] (removed tables in target schema).
  static void _migrationDroppedTables(
    List<String> migrations,
    List<String> tablesA,
    List<String> tablesB,
  ) {
    for (final table in tablesA) {
      if (tablesB.contains(table)) continue;
      migrations.add('-- DROPPED TABLE: $table');
      migrations.add('DROP TABLE IF EXISTS "$table";');
      migrations.add('');
    }
  }

  /// Compares columns and indexes for tables present in both schemas,
  /// generating ALTER TABLE ADD/DROP COLUMN and CREATE/DROP INDEX statements.
  Future<void> _migrationModifiedTables(
    List<String> migrations,
    List<String> tablesA,
    List<String> tablesB,
    DriftDebugQuery queryA,
    DriftDebugQuery queryB,
  ) async {
    for (final table in tablesA) {
      if (!tablesB.contains(table)) continue;

      final colMapA = await _migrationColumnMap(queryA, table);
      final colMapB = await _migrationColumnMap(queryB, table);

      final tableChanges = <String>[];

      _migrationAddedColumns(tableChanges, table, colMapA, colMapB);
      _migrationRemovedColumns(tableChanges, table, colMapA, colMapB);
      _migrationChangedColumns(tableChanges, table, colMapA, colMapB);
      await _migrationIndexChanges(
        tableChanges, table, queryA, queryB,
      );

      if (tableChanges.isNotEmpty) {
        migrations.add('-- MODIFIED TABLE: $table');
        migrations.addAll(tableChanges);
        migrations.add('');
      }
    }
  }

  /// Fetches PRAGMA table_info and returns a column-name-keyed map.
  Future<Map<String, Map<String, dynamic>>> _migrationColumnMap(
    DriftDebugQuery query,
    String table,
  ) async {
    final cols = _normalizeRows(
      await query('PRAGMA table_info("$table")'),
    );
    final map = <String, Map<String, dynamic>>{};
    for (final c in cols) {
      map[c['name'] as String? ?? ''] = c;
    }
    return map;
  }

  /// Generates ALTER TABLE ADD COLUMN for columns in [colMapB] not in
  /// [colMapA].
  static void _migrationAddedColumns(
    List<String> changes,
    String table,
    Map<String, Map<String, dynamic>> colMapA,
    Map<String, Map<String, dynamic>> colMapB,
  ) {
    for (final colName in colMapB.keys) {
      if (colMapA.containsKey(colName)) continue;
      final col = colMapB[colName]!;
      final type = col['type'] ?? 'TEXT';
      final notNull = col['notnull'] == 1;
      final dfltValue = col['dflt_value'];

      // SQLite requires DEFAULT for NOT NULL columns in ALTER TABLE ADD
      final dflt = dfltValue != null
          ? ' DEFAULT $dfltValue'
          : (notNull ? " DEFAULT ''" : '');
      final nn = notNull ? ' NOT NULL' : '';

      changes.add(
        'ALTER TABLE "$table" ADD COLUMN "$colName" $type$nn$dflt;',
      );
    }
  }

  /// Generates warning comments and DROP COLUMN for columns in [colMapA]
  /// not in [colMapB].
  static void _migrationRemovedColumns(
    List<String> changes,
    String table,
    Map<String, Map<String, dynamic>> colMapA,
    Map<String, Map<String, dynamic>> colMapB,
  ) {
    for (final colName in colMapA.keys) {
      if (colMapB.containsKey(colName)) continue;
      changes.add(
        '-- WARNING: Column "$colName" removed from "$table".',
      );
      changes.add(
        '-- SQLite < 3.35.0: Use table recreation '
        '(CREATE new, INSERT...SELECT, DROP old, ALTER...RENAME).',
      );
      changes.add('-- SQLite >= 3.35.0:');
      changes.add(
        'ALTER TABLE "$table" DROP COLUMN "$colName";',
      );
    }
  }

  /// Generates warning comments for columns whose type or nullability
  /// changed between schemas.
  static void _migrationChangedColumns(
    List<String> changes,
    String table,
    Map<String, Map<String, dynamic>> colMapA,
    Map<String, Map<String, dynamic>> colMapB,
  ) {
    for (final colName in colMapA.keys) {
      if (!colMapB.containsKey(colName)) continue;
      final a = colMapA[colName]!;
      final b = colMapB[colName]!;
      final typeA = a['type']?.toString() ?? '';
      final typeB = b['type']?.toString() ?? '';
      final nnA = a['notnull'] == 1;
      final nnB = b['notnull'] == 1;

      if (typeA != typeB || nnA != nnB) {
        changes.add(
          '-- WARNING: Column "$colName" in "$table" changed:',
        );
        if (typeA != typeB) {
          changes.add('--   Type: $typeA -> $typeB');
        }
        if (nnA != nnB) {
          changes.add(
            "--   Nullable: ${nnA ? 'NOT NULL' : 'nullable'} "
            "-> ${nnB ? 'NOT NULL' : 'nullable'}",
          );
        }
        changes.add(
          '-- SQLite does not support ALTER COLUMN. '
          'Use table recreation pattern.',
        );
      }
    }
  }

  /// Generates CREATE INDEX / DROP INDEX for index differences between
  /// [queryA] and [queryB] for [table]. Excludes sqlite_autoindex_* indexes.
  Future<void> _migrationIndexChanges(
    List<String> changes,
    String table,
    DriftDebugQuery queryA,
    DriftDebugQuery queryB,
  ) async {
    final idxA = _normalizeRows(
      await queryA('PRAGMA index_list("$table")'),
    );
    final idxB = _normalizeRows(
      await queryB('PRAGMA index_list("$table")'),
    );
    final idxNamesA = idxA
        .map((r) => r['name']?.toString() ?? '')
        .where((n) => n.isNotEmpty && !n.startsWith('sqlite_'))
        .toSet();
    final idxNamesB = idxB
        .map((r) => r['name']?.toString() ?? '')
        .where((n) => n.isNotEmpty && !n.startsWith('sqlite_'))
        .toSet();

    // New indexes
    for (final idxName in idxNamesB) {
      if (idxNamesA.contains(idxName)) continue;
      final idxSqlRows = _normalizeRows(
        await queryB(
          "SELECT sql FROM sqlite_master "
          "WHERE type='index' AND name='$idxName'",
        ),
      );
      final idxSql = idxSqlRows.isNotEmpty
          ? idxSqlRows.first['sql'] as String?
          : null;
      if (idxSql != null) {
        changes.add('$idxSql;');
      }
    }

    // Dropped indexes
    for (final idxName in idxNamesA) {
      if (idxNamesB.contains(idxName)) continue;
      changes.add('DROP INDEX IF EXISTS "$idxName";');
    }
  }

  /// Analyzes table schemas for missing indexes. Checks foreign key columns
  /// without indexes, columns with naming patterns suggesting frequent query
  /// use (*_id, *_at, *_date), and existing index coverage.
  Future<void> _handleIndexSuggestions(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      final tableNames = await _getTableNames(query);
      final suggestions = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        // Get existing indexed columns
        final existingIndexRows = _normalizeRows(
          await query('PRAGMA index_list("$tableName")'),
        );
        final indexedColumns = <String>{};
        for (final idx in existingIndexRows) {
          final idxName = idx['name'] as String?;
          if (idxName == null) continue;
          final idxInfoRows = _normalizeRows(
            await query('PRAGMA index_info("$idxName")'),
          );
          for (final col in idxInfoRows) {
            final colName = col['name'] as String?;
            if (colName != null) indexedColumns.add(colName);
          }
        }

        // Check foreign keys — these columns should always be indexed
        final fkRows = _normalizeRows(
          await query('PRAGMA foreign_key_list("$tableName")'),
        );
        for (final fk in fkRows) {
          final fromCol = fk['from'] as String?;
          if (fromCol != null && !indexedColumns.contains(fromCol)) {
            suggestions.add(<String, dynamic>{
              'table': tableName,
              'column': fromCol,
              'reason':
                  'Foreign key without index (references ${fk['table']}.${fk['to']})',
              'sql':
                  'CREATE INDEX idx_${tableName}_$fromCol ON "$tableName"("$fromCol");',
              'priority': 'high',
            });
          }
        }

        // Check column naming patterns
        final colInfoRows = _normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );
        for (final col in colInfoRows) {
          final colName = col['name'] as String?;
          final pk = col['pk'];
          if (colName == null) continue;
          if (pk is int && pk > 0) continue;
          if (indexedColumns.contains(colName)) continue;

          final alreadySuggested = suggestions.any(
            (s) => s['table'] == tableName && s['column'] == colName,
          );

          // Columns ending in _id likely used in JOINs/WHERE
          if (!alreadySuggested &&
              ServerConstants.reIdSuffix.hasMatch(colName)) {
            suggestions.add(<String, dynamic>{
              'table': tableName,
              'column': colName,
              'reason':
                  'Column ending in _id \u2014 likely used in JOINs/WHERE',
              'sql':
                  'CREATE INDEX idx_${tableName}_$colName ON "$tableName"("$colName");',
              'priority': 'medium',
            });
          }

          // Date/time columns often used in ORDER BY or range queries
          if (!alreadySuggested &&
              ServerConstants.reDateTimeSuffix.hasMatch(colName)) {
            suggestions.add(<String, dynamic>{
              'table': tableName,
              'column': colName,
              'reason':
                  'Date/time column \u2014 often used in ORDER BY or range queries',
              'sql':
                  'CREATE INDEX idx_${tableName}_$colName ON "$tableName"("$colName");',
              'priority': 'low',
            });
          }
        }
      }

      // Sort by priority
      const priorityOrder = <String, int>{
        'high': 0,
        'medium': 1,
        'low': 2,
      };
      suggestions.sort(
        (a, b) => (priorityOrder[a['priority']] ?? 3)
            .compareTo(priorityOrder[b['priority']] ?? 3),
      );

      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'suggestions': suggestions,
        'tablesAnalyzed': tableNames.length,
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  // --- Collaborative session endpoints (delegates to [_sessionStore]) ---

  /// POST /api/session/share — create a shareable session with captured viewer state.
  Future<void> _handleSessionShare(HttpRequest request) async {
    final res = request.response;
    try {
      final builder = BytesBuilder();
      await for (final chunk in request) {
        builder.add(chunk);
      }
      final body = utf8.decode(builder.toBytes());
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      final result = _sessionStore.create(decoded);

      _setJsonHeaders(res);
      res.write(jsonEncode(result));
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(res, error);
    } finally {
      await res.close();
    }
  }

  /// GET /api/session/{id} — retrieve a shared session by ID.
  Future<void> _handleSessionGet(
    HttpResponse response,
    String sessionId,
  ) async {
    final res = response;
    final session = _sessionStore.get(sessionId);

    if (session == null) {
      res.statusCode = HttpStatus.notFound;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: DriftDebugSessionStore.errorNotFound,
      }));
      await res.close();
      return;
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(session));
    await res.close();
  }

  /// POST /api/session/{id}/annotate — add a text annotation to an existing session.
  Future<void> _handleSessionAnnotate(
    HttpRequest request,
    String sessionId,
  ) async {
    final res = request.response;

    final builder = BytesBuilder();
    await for (final chunk in request) {
      builder.add(chunk);
    }
    final body = jsonDecode(utf8.decode(builder.toBytes()))
        as Map<String, dynamic>;

    final added = _sessionStore.annotate(
      sessionId,
      text: (body[DriftDebugSessionStore.keyText] as String?) ?? '',
      author: (body[DriftDebugSessionStore.keyAuthor] as String?) ??
          'anonymous',
    );

    if (!added) {
      res.statusCode = HttpStatus.notFound;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: DriftDebugSessionStore.errorNotFound,
      }));
      await res.close();
      return;
    }

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      DriftDebugSessionStore.keyStatus: 'added',
    }));
    await res.close();
  }

  Future<void> _handleSizeAnalytics(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      int pragmaInt(List<Map<String, dynamic>> rows) {
        if (rows.isEmpty) return 0;
        final v = rows.first.values.first;
        return v is int ? v : int.tryParse('$v') ?? 0;
      }

      final pageSize = pragmaInt(
        _normalizeRows(await query('PRAGMA page_size')),
      );
      final pageCount = pragmaInt(
        _normalizeRows(await query('PRAGMA page_count')),
      );
      final freelistCount = pragmaInt(
        _normalizeRows(await query('PRAGMA freelist_count')),
      );

      final journalModeRows = _normalizeRows(
        await query('PRAGMA journal_mode'),
      );
      final journalMode = journalModeRows.isNotEmpty
          ? (journalModeRows.first.values.first?.toString() ?? 'unknown')
          : 'unknown';

      final totalSizeBytes = pageSize * pageCount;
      final freeSpaceBytes = pageSize * freelistCount;

      final tableNames = await _getTableNames(query);
      final tableStats = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final countRows = _normalizeRows(
          await query(
              'SELECT COUNT(*) AS ${ServerConstants.jsonKeyCountColumn} FROM "$tableName"'),
        );
        final rowCount = _extractCountFromRows(countRows);

        final colInfoRows = _normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );

        final indexRows = _normalizeRows(
          await query('PRAGMA index_list("$tableName")'),
        );
        final indexNames = indexRows
            .map((r) => r[ServerConstants.jsonKeyName]?.toString() ?? '')
            .where((n) => n.isNotEmpty)
            .toList();

        tableStats.add(<String, dynamic>{
          ServerConstants.jsonKeyTable: tableName,
          ServerConstants.jsonKeyRowCount: rowCount,
          'columnCount': colInfoRows.length,
          'indexCount': indexNames.length,
          'indexes': indexNames,
        });
      }

      // Sort tables by row count descending
      tableStats.sort((a, b) =>
          (b[ServerConstants.jsonKeyRowCount] as int).compareTo(a[ServerConstants.jsonKeyRowCount] as int));

      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'pageSize': pageSize,
        'pageCount': pageCount,
        'freelistCount': freelistCount,
        'totalSizeBytes': totalSizeBytes,
        'freeSpaceBytes': freeSpaceBytes,
        'usedSizeBytes': totalSizeBytes - freeSpaceBytes,
        'journalMode': journalMode,
        ServerConstants.jsonKeyTableCount: tableNames.length,
        ServerConstants.jsonKeyTables: tableStats,
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  void _setAttachmentHeaders(HttpResponse response, String filename) {
    final res = response;
    res.headers.contentType =
        ContentType(ServerConstants.contentTypeTextPlain, 'plain', charset: ServerConstants.charsetUtf8);
    res.headers
        .set(ServerConstants.headerContentDisposition, 'attachment; filename="$filename"');
    _setCors(res);
  }

  // --- Anomaly detection ---

  /// Scans all tables for data quality anomalies: NULLs, empty strings,
  /// numeric outliers, orphaned foreign keys, and duplicate rows.
  Future<void> _handleAnomalyDetection(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    final res = response;
    try {
      final tableNames = await _getTableNames(query);
      final anomalies = <Map<String, dynamic>>[];

      for (final tableName in tableNames) {
        final colInfoRows = _normalizeRows(
          await query('PRAGMA table_info("$tableName")'),
        );

        // Query total row count once per table (reused by null-check and
        // duplicate-check to avoid redundant COUNT(*) queries).
        final tableRowCount = _extractCountFromRows(_normalizeRows(
          await query('SELECT COUNT(*) AS c FROM "$tableName"'),
        ));

        for (final col in colInfoRows) {
          final colName = col['name'] as String?;
          final colType = (col['type'] as String?) ?? '';
          final isNullable =
              col['notnull'] is int && (col['notnull'] as int) == 0;
          if (colName == null) continue;

          if (isNullable) {
            await _detectNullValues(
                query, tableName, colName, tableRowCount, anomalies);
          }
          if (_isTextType(colType)) {
            await _detectEmptyStrings(
                query, tableName, colName, anomalies);
          }
          if (_isNumericType(colType)) {
            await _detectNumericOutliers(
                query, tableName, colName, anomalies);
          }
        }

        await _detectOrphanedForeignKeys(
            query, tableName, tableNames, anomalies);
        await _detectDuplicateRows(
            query, tableName, tableRowCount, anomalies);
      }

      _sortAnomaliesBySeverity(anomalies);

      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'anomalies': anomalies,
        'tablesScanned': tableNames.length,
        'analyzedAt': DateTime.now().toUtc().toIso8601String(),
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{ServerConstants.jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  /// Check 1: NULL values in nullable columns. Severity is warning if >50%,
  /// otherwise info. [tableRowCount] is pre-cached to avoid redundant queries.
  Future<void> _detectNullValues(
    DriftDebugQuery query,
    String tableName,
    String colName,
    int tableRowCount,
    List<Map<String, dynamic>> anomalies,
  ) async {
    final nullCount = _extractCountFromRows(_normalizeRows(
      await query(
        'SELECT COUNT(*) AS c FROM "$tableName" WHERE "$colName" IS NULL',
      ),
    ));
    if (nullCount == 0) return;

    final pct =
        tableRowCount > 0 ? (nullCount / tableRowCount * 100) : 0;
    anomalies.add(<String, dynamic>{
      'table': tableName,
      'column': colName,
      'type': 'null_values',
      'severity': pct > 50 ? 'warning' : 'info',
      'count': nullCount,
      'message':
          '$nullCount NULL value(s) in $tableName.$colName (${pct.toStringAsFixed(1)}%)',
    });
  }

  /// Check 2: Empty strings in text columns.
  Future<void> _detectEmptyStrings(
    DriftDebugQuery query,
    String tableName,
    String colName,
    List<Map<String, dynamic>> anomalies,
  ) async {
    final emptyCount = _extractCountFromRows(_normalizeRows(
      await query(
        "SELECT COUNT(*) AS c FROM \"$tableName\" WHERE \"$colName\" = ''",
      ),
    ));
    if (emptyCount == 0) return;

    anomalies.add(<String, dynamic>{
      'table': tableName,
      'column': colName,
      'type': 'empty_strings',
      'severity': 'warning',
      'count': emptyCount,
      'message': '$emptyCount empty string(s) in $tableName.$colName',
    });
  }

  /// Check 3: Numeric outliers where max or min > 10x average.
  Future<void> _detectNumericOutliers(
    DriftDebugQuery query,
    String tableName,
    String colName,
    List<Map<String, dynamic>> anomalies,
  ) async {
    final statsRows = _normalizeRows(await query(
      'SELECT AVG("$colName") AS avg_val, '
      'MIN("$colName") AS min_val, '
      'MAX("$colName") AS max_val '
      'FROM "$tableName" WHERE "$colName" IS NOT NULL',
    ));
    if (statsRows.isEmpty) return;

    final avg = _toDouble(statsRows.first['avg_val']);
    final min = _toDouble(statsRows.first['min_val']);
    final max = _toDouble(statsRows.first['max_val']);
    if (avg == null || min == null || max == null || avg == 0) return;

    if (max.abs() > avg.abs() * 10 || min.abs() > avg.abs() * 10) {
      anomalies.add(<String, dynamic>{
        'table': tableName,
        'column': colName,
        'type': 'potential_outlier',
        'severity': 'info',
        'message': 'Potential outlier in $tableName.$colName: '
            'range [$min, $max], avg ${avg.toStringAsFixed(2)}',
      });
    }
  }

  /// Check 4: Orphaned foreign key references (FK points to non-existent parent).
  Future<void> _detectOrphanedForeignKeys(
    DriftDebugQuery query,
    String tableName,
    List<String> tableNames,
    List<Map<String, dynamic>> anomalies,
  ) async {
    final fkRows = _normalizeRows(
      await query('PRAGMA foreign_key_list("$tableName")'),
    );
    for (final fk in fkRows) {
      final fromCol = fk['from'] as String?;
      final toTable = fk['table'] as String?;
      final toCol = fk['to'] as String?;
      if (fromCol == null || toTable == null || toCol == null) continue;
      if (!tableNames.contains(toTable)) continue;

      final orphanCount = _extractCountFromRows(_normalizeRows(
        await query(
          'SELECT COUNT(*) AS c FROM "$tableName" t '
          'LEFT JOIN "$toTable" r ON t."$fromCol" = r."$toCol" '
          'WHERE t."$fromCol" IS NOT NULL AND r."$toCol" IS NULL',
        ),
      ));
      if (orphanCount > 0) {
        anomalies.add(<String, dynamic>{
          'table': tableName,
          'column': fromCol,
          'type': 'orphaned_fk',
          'severity': 'error',
          'count': orphanCount,
          'message':
              '$orphanCount orphaned FK(s): $tableName.$fromCol -> $toTable.$toCol',
        });
      }
    }
  }

  /// Check 5: Duplicate rows (total count vs distinct count).
  Future<void> _detectDuplicateRows(
    DriftDebugQuery query,
    String tableName,
    List<Map<String, dynamic>> anomalies,
  ) async {
    final totalCount = _extractCountFromRows(_normalizeRows(
      await query('SELECT COUNT(*) AS c FROM "$tableName"'),
    ));
    final distinctCount = _extractCountFromRows(_normalizeRows(
      await query(
        'SELECT COUNT(*) AS c FROM (SELECT DISTINCT * FROM "$tableName")',
      ),
    ));
    if (totalCount > distinctCount) {
      anomalies.add(<String, dynamic>{
        'table': tableName,
        'type': 'duplicate_rows',
        'severity': 'warning',
        'count': totalCount - distinctCount,
        'message':
            '${totalCount - distinctCount} duplicate row(s) in $tableName',
      });
    }
  }

  /// Sorts anomalies in-place: errors first, then warnings, then info.
  static void _sortAnomaliesBySeverity(List<Map<String, dynamic>> anomalies) {
    const severityOrder = <String, int>{
      'error': 0,
      'warning': 1,
      'info': 2,
    };
    anomalies.sort((a, b) => (severityOrder[a['severity']] ?? 3)
        .compareTo(severityOrder[b['severity']] ?? 3));
  }

  static final RegExp _reTextType =
      RegExp(r'TEXT|VARCHAR|CHAR|CLOB|STRING', caseSensitive: false);
  static final RegExp _reNumericType =
      RegExp(r'INT|REAL|NUM|FLOAT|DOUBLE|DECIMAL', caseSensitive: false);

  static bool _isTextType(String type) => _reTextType.hasMatch(type);
  static bool _isNumericType(String type) => _reNumericType.hasMatch(type);

  static double? _toDouble(dynamic value) {
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }

  /// Sets Access-Control-Allow-Origin when a CORS origin was provided at start.
  void _setCors(HttpResponse response) {
    final res = response;
    final origin = _corsOrigin;
    if (origin != null) {
      res.headers.set('Access-Control-Allow-Origin', origin);
    }
  }

  /// Sets Content-Type to JSON and CORS. Used by all JSON API responses.
  void _setJsonHeaders(HttpResponse response) {
    final res = response;
    res.headers.contentType = ContentType.json;
    _setCors(res);
  }

  /// Handles POST /api/import: imports CSV, JSON, or SQL data into a table.
  /// Requires [_writeQuery] to be configured; returns 501 if not.
  Future<void> _handleImport(HttpRequest request) async {
    final res = request.response;
    final writeQuery = _writeQuery;

    if (writeQuery == null) {
      res.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            'Import not configured. Pass writeQuery to DriftDebugServer.start().',
      }));
      await res.close();
      return;
    }

    try {
      final builder = BytesBuilder();
      await for (final chunk in request) {
        builder.add(chunk);
      }
      final body = utf8.decode(builder.toBytes());
      final decoded = jsonDecode(body) as Map<String, dynamic>;
      final format = decoded['format'] as String?;
      final data = decoded['data'] as String?;
      final table = decoded['table'] as String?;

      if (format == null || data == null || table == null) {
        res.statusCode = HttpStatus.badRequest;
        _setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Missing required fields: format, data, table',
        }));
        await res.close();
        return;
      }

      // Validate table exists
      final tableNames = await _getTableNames(_query!);
      if (!tableNames.contains(table)) {
        res.statusCode = HttpStatus.badRequest;
        _setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Table "$table" not found.',
        }));
        await res.close();
        return;
      }

      int imported = 0;
      final errors = <String>[];

      if (format == 'json') {
        final rows = jsonDecode(data) as List<dynamic>;
        for (int i = 0; i < rows.length; i++) {
          final row = rows[i];
          if (row is! Map) {
            errors.add('Row $i: not an object');
            continue;
          }
          try {
            final keys = row.keys.toList();
            final cols = keys.map((k) => '"$k"').join(', ');
            final vals = keys.map((k) => _sqlLiteral(row[k])).join(', ');
            await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
            imported++;
          } on Object catch (e) {
            errors.add('Row $i: $e');
          }
        }
      } else if (format == 'csv') {
        final lines = _parseCsvLines(data);
        if (lines.length < 2) {
          res.statusCode = HttpStatus.badRequest;
          _setJsonHeaders(res);
          res.write(jsonEncode(<String, String>{
            ServerConstants.jsonKeyError:
                'CSV must have a header row and at least one data row.',
          }));
          await res.close();
          return;
        }
        final headers = lines[0];
        for (int i = 1; i < lines.length; i++) {
          try {
            final values = lines[i];
            if (values.length != headers.length) {
              errors.add(
                  'Row $i: column count mismatch (${values.length} vs ${headers.length})');
              continue;
            }
            final cols = headers.map((h) => '"$h"').join(', ');
            final vals = values.map((v) => _sqlLiteral(v)).join(', ');
            await writeQuery('INSERT INTO "$table" ($cols) VALUES ($vals)');
            imported++;
          } on Object catch (e) {
            errors.add('Row $i: $e');
          }
        }
      } else if (format == 'sql') {
        final statements =
            data.split(';').map((s) => s.trim()).where((s) => s.isNotEmpty);
        for (final stmt in statements) {
          try {
            await writeQuery('$stmt;');
            imported++;
          } on Object catch (e) {
            errors.add('Statement error: $e');
          }
        }
      } else {
        res.statusCode = HttpStatus.badRequest;
        _setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Unsupported format: $format. Use json, csv, or sql.',
        }));
        await res.close();
        return;
      }

      // Bump generation so live-refresh picks up new rows immediately.
      await _checkDataChange();

      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'imported': imported,
        'errors': errors,
        'format': format,
        'table': table,
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError: error.toString(),
      }));
    } finally {
      await res.close();
    }
  }

  /// Parses CSV text into a list of rows (each a list of field strings).
  /// Handles quoted fields with embedded commas and escaped quotes ("").
  static List<List<String>> _parseCsvLines(String csv) {
    final result = <List<String>>[];
    final lines = csv.split('\n');
    for (final line in lines) {
      if (line.trim().isEmpty) continue;
      final fields = <String>[];
      var inQuotes = false;
      final current = StringBuffer();
      for (int i = 0; i < line.length; i++) {
        final c = line[i];
        if (c == '"') {
          if (inQuotes && i + 1 < line.length && line[i + 1] == '"') {
            current.write('"');
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (c == ',' && !inQuotes) {
          fields.add(current.toString().trim());
          current.clear();
        } else {
          current.write(c);
        }
      }
      fields.add(current.toString().trim());
      result.add(fields);
    }
    return result;
  }

  /// Serves the single-page viewer UI (table list, SQL runner, schema, snapshot, compare, etc.).
  Future<void> _sendHtml(HttpResponse response, HttpRequest request) async {
    final res = response;
    res.headers.contentType = ContentType.html;
    res.write(_indexHtml);
    await res.close();
  }

  /// Inline HTML/JS/CSS for the viewer. Auth token can be injected by the app (e.g. from ?token=) into DRIFT_VIEWER_AUTH_TOKEN.
  static const String _indexHtml = '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Drift DB</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 1rem; background: var(--bg); color: var(--fg); max-width: 100%; overflow-x: hidden; }
    body.theme-light { --bg: #f5f5f5; --fg: #1a1a1a; --bg-pre: #e8e8e8; --border: #ccc; --muted: #666; --link: #1565c0; --highlight-bg: #fff3cd; --highlight-fg: #856404; }
    body.theme-dark, body { --bg: #1a1a1a; --fg: #e0e0e0; --bg-pre: #252525; --border: #444; --muted: #888; --link: #7eb8da; --highlight-bg: #5a4a32; --highlight-fg: #f0e0c0; }
    h1 { font-size: 1.25rem; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.25rem 0; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .content-wrap { max-width: 100%; min-width: 0; }
    pre { background: var(--bg-pre); padding: 1rem; overflow: auto; font-size: 12px; border-radius: 6px; max-height: 70vh; white-space: pre-wrap; word-break: break-word; margin: 0; color: var(--fg); border: 1px solid var(--border); }
    .meta { color: var(--muted); font-size: 0.875rem; margin-bottom: 0.5rem; }
    .search-bar { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
    .search-bar input, .search-bar select, .search-bar button { padding: 0.35rem 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; }
    .search-bar input { min-width: 12rem; }
    .search-bar label { color: var(--muted); font-size: 0.875rem; }
    .highlight { background: var(--highlight-bg); color: var(--highlight-fg); border-radius: 2px; }
    .search-section { margin-bottom: 1rem; }
    .search-section h2 { font-size: 1rem; color: var(--muted); margin: 0 0 0.25rem 0; }
    .toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .collapsible-header { cursor: pointer; user-select: none; padding: 0.25rem 0; color: var(--link); }
    .collapsible-header:hover { text-decoration: underline; }
    .collapsible-body { margin-top: 0.25rem; }
    .collapsible-body.collapsed { display: none; }
    .sql-runner { margin-bottom: 1rem; }
    .sql-runner .sql-toolbar { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
    .sql-runner .sql-toolbar select, .sql-runner .sql-toolbar button { padding: 0.35rem 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; }
    .sql-runner textarea { width: 100%; min-height: 4rem; font-family: ui-monospace, monospace; font-size: 13px; padding: 0.5rem; background: var(--bg-pre); border: 1px solid var(--border); color: var(--fg); border-radius: 4px; resize: vertical; }
    .sql-runner .sql-result { margin-top: 0.5rem; }
    .sql-runner .sql-result pre { max-height: 50vh; }
    .sql-runner .sql-result table { border-collapse: collapse; width: 100%; font-size: 12px; background: var(--bg-pre); border: 1px solid var(--border); }
    .sql-runner .sql-result th, .sql-runner .sql-result td { border: 1px solid var(--border); padding: 0.35rem 0.5rem; text-align: left; }
    .sql-runner .sql-result th { font-weight: 600; }
    .sql-runner .sql-error { color: #e57373; margin-top: 0.35rem; font-size: 0.875rem; }
    .sql-runner .sql-result, .sql-runner .sql-error { transition: opacity 0.15s ease; }
    .diff-result { transition: opacity 0.2s ease; }
    #live-indicator { font-size: 0.75rem; margin-left: 0.5rem; }
    body.theme-dark #live-indicator { color: #7cb342; }
    body.theme-light #live-indicator { color: #558b2f; }
    #diagram-container { min-height: 200px; }
    .diagram-table rect { fill: var(--bg-pre); stroke: var(--border); stroke-width: 1.5; }
    .diagram-table:hover rect { stroke: var(--link); }
    .diagram-table { cursor: pointer; }
    .diagram-table .diagram-name { font-weight: 600; font-size: 13px; }
    .diagram-table .diagram-col { font-size: 11px; fill: var(--muted); }
    .diagram-link { stroke: var(--muted); stroke-width: 1; fill: none; }
    .chart-bar { fill: var(--link); }
    .chart-bar:hover { fill: var(--fg); }
    .chart-label { font-size: 10px; fill: var(--muted); }
    .chart-axis { stroke: var(--border); stroke-width: 1; }
    .chart-axis-label { font-size: 11px; fill: var(--muted); }
    .chart-line { stroke: var(--link); stroke-width: 2; fill: none; }
    .chart-dot { fill: var(--link); }
    .chart-dot:hover { fill: var(--fg); r: 5; }
    .chart-slice { stroke: var(--bg); stroke-width: 2; cursor: pointer; }
    .chart-slice:hover { opacity: 0.8; }
    .chart-legend { font-size: 11px; fill: var(--fg); }
  </style>
</head>
<body>
  <h1>Drift tables <button type="button" id="theme-toggle" title="Toggle light/dark">Theme</button> <button type="button" id="share-btn" title="Share current view with your team" style="font-size:11px;">Share</button> <span id="live-indicator" class="meta" title="Table view updates when data changes">● Live</span></h1>
  <div class="collapsible-header sql-runner" id="sql-runner-toggle">▼ Run SQL (read-only)</div>
  <div id="sql-runner-collapsible" class="collapsible-body collapsed sql-runner">
    <div class="sql-toolbar">
      <label for="sql-template">Template:</label>
      <select id="sql-template">
        <option value="custom">Custom</option>
        <option value="select-star-limit">SELECT * FROM table LIMIT 10</option>
        <option value="select-star">SELECT * FROM table</option>
        <option value="count">SELECT COUNT(*) FROM table</option>
        <option value="select-fields">SELECT columns FROM table LIMIT 10</option>
      </select>
      <label for="sql-table">Table:</label>
      <select id="sql-table"><option value="">—</option></select>
      <label for="sql-fields">Fields:</label>
      <select id="sql-fields" multiple title="Hold Ctrl/Cmd to pick multiple"><option value="">—</option></select>
      <button type="button" id="sql-apply-template">Apply template</button>
      <button type="button" id="sql-run">Run</button>
      <button type="button" id="sql-explain">Explain</button>
      <label for="sql-history">History:</label>
      <select id="sql-history" title="Recent queries — select to reuse"><option value="">— Recent —</option></select>
    </div>
    <div class="sql-toolbar" style="margin-top:0;">
      <label for="sql-bookmarks">Bookmarks:</label>
      <select id="sql-bookmarks" title="Saved queries" style="max-width:14rem;"><option value="">— Bookmarks —</option></select>
      <button type="button" id="sql-bookmark-save" title="Save current query as bookmark">Save</button>
      <button type="button" id="sql-bookmark-delete" title="Delete selected bookmark">Del</button>
      <button type="button" id="sql-bookmark-export" title="Export bookmarks as JSON">Export</button>
      <button type="button" id="sql-bookmark-import" title="Import bookmarks from JSON">Import</button>
      <label for="sql-result-format">Show as:</label>
      <select id="sql-result-format"><option value="table">Table</option><option value="json">JSON</option></select>
    </div>
    <div class="sql-toolbar" style="margin-bottom:0.35rem;">
      <label for="nl-input">Ask in English:</label>
      <input type="text" id="nl-input" placeholder="e.g. how many users were created today?" style="flex:1;min-width:20rem;" />
      <button type="button" id="nl-convert">Convert to SQL</button>
    </div>
    <textarea id="sql-input" placeholder="SELECT * FROM my_table LIMIT 10"></textarea>
    <div id="sql-error" class="sql-error" style="display: none;"></div>
    <div id="sql-result" class="sql-result" style="display: none;"></div>
    <div id="chart-controls" class="sql-toolbar" style="display:none;margin-top:0.5rem;">
      <label for="chart-type">Chart:</label>
      <select id="chart-type">
        <option value="none">None</option>
        <option value="bar">Bar</option>
        <option value="pie">Pie</option>
        <option value="line">Line / Time series</option>
        <option value="histogram">Histogram</option>
      </select>
      <label for="chart-x">X / Label:</label>
      <select id="chart-x"></select>
      <label for="chart-y">Y / Value:</label>
      <select id="chart-y"></select>
      <button type="button" id="chart-render">Render</button>
    </div>
    <div id="chart-container" style="display:none;margin-top:0.5rem;"></div>
  </div>
  <div class="search-bar">
    <label for="search-input">Search:</label>
    <input type="text" id="search-input" placeholder="Search…" />
    <label for="search-scope">in</label>
    <select id="search-scope">
      <option value="schema">Schema only</option>
      <option value="data">DB data only</option>
      <option value="both">Both</option>
    </select>
    <label for="row-filter">Filter rows:</label>
    <input type="text" id="row-filter" placeholder="Column value…" title="Client-side filter on current table" />
  </div>
  <div id="pagination-bar" class="toolbar" style="display: none;">
    <label>Limit</label>
    <select id="pagination-limit"></select>
    <label>Offset</label>
    <input type="number" id="pagination-offset" min="0" step="200" style="width: 5rem;" />
    <button type="button" id="pagination-prev">Prev</button>
    <button type="button" id="pagination-next">Next</button>
    <button type="button" id="pagination-apply">Apply</button>
  </div>
  <p id="tables-loading" class="meta">Loading tables…</p>
  <p class="meta"><a href="/api/schema" id="export-schema" download="schema.sql">Export schema (no data)</a> · <a href="#" id="export-dump">Export full dump (schema + data)</a><span id="export-dump-status" class="meta"></span> · <a href="#" id="export-database">Download database (raw .sqlite)</a><span id="export-database-status" class="meta"></span> · <a href="#" id="export-csv">Export table as CSV</a><span id="export-csv-status" class="meta"></span></p>
  <div class="collapsible-header" id="snapshot-toggle">▼ Snapshot / time travel</div>
  <div id="snapshot-collapsible" class="collapsible-body collapsed">
    <p class="meta">Capture current DB state, then compare to now to see what changed.</p>
    <div class="toolbar">
      <button type="button" id="snapshot-take">Take snapshot</button>
      <button type="button" id="snapshot-compare" disabled title="Take a snapshot first">Compare to now</button>
      <a href="#" id="snapshot-export-diff" style="display: none;">Export diff (JSON)</a>
      <button type="button" id="snapshot-clear" style="display: none;">Clear snapshot</button>
    </div>
    <p id="snapshot-status" class="meta"></p>
    <pre id="snapshot-compare-result" class="meta diff-result" style="display: none; max-height: 40vh;"></pre>
  </div>
  <div class="collapsible-header" id="compare-toggle">▼ Database diff</div>
  <div id="compare-collapsible" class="collapsible-body collapsed">
    <p class="meta">Compare this DB with another (e.g. staging). Requires queryCompare at startup.</p>
    <div class="toolbar">
      <button type="button" id="compare-view">View diff report</button>
      <a href="/api/compare/report?format=download" id="compare-export">Export diff report</a>
    </div>
    <p id="compare-status" class="meta"></p>
    <pre id="compare-result" class="meta diff-result" style="display: none; max-height: 40vh;"></pre>
  </div>
  <div class="collapsible-header" id="index-toggle">▼ Index suggestions</div>
  <div id="index-collapsible" class="collapsible-body collapsed">
    <p class="meta">Analyze tables for missing indexes based on schema patterns.</p>
    <button type="button" id="index-analyze">Analyze</button>
    <div id="index-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="size-toggle">▼ Database size analytics</div>
  <div class="collapsible-header" id="perf-toggle">▼ Query performance</div>
  <div id="perf-collapsible" class="collapsible-body collapsed">
    <p class="meta">Track query execution times, identify slow queries, and view patterns.</p>
    <div class="toolbar">
      <button type="button" id="perf-refresh">Refresh</button>
      <button type="button" id="perf-clear">Clear</button>
    </div>
    <div id="perf-results" style="display:none;"></div>
  </div>
  <div id="size-collapsible" class="collapsible-body collapsed">
    <p class="meta">Analyze database storage: total size, page stats, and per-table breakdown.</p>
    <button type="button" id="size-analyze">Analyze</button>
    <div id="size-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="anomaly-toggle">▼ Data health</div>
  <div id="anomaly-collapsible" class="collapsible-body collapsed">
    <p class="meta">Scan all tables for data quality issues: NULLs, empty strings, orphaned FKs, duplicates, outliers.</p>
    <button type="button" id="anomaly-analyze">Scan for anomalies</button>
    <div id="anomaly-results" style="display:none;"></div>
  </div>
  <div class="collapsible-header" id="import-toggle">▼ Import data (debug only)</div>
  <div id="import-collapsible" class="collapsible-body collapsed">
    <p class="meta" style="color:#e57373;font-weight:bold;">Warning: This modifies the database. Debug use only.</p>
    <div class="sql-runner">
      <div class="sql-toolbar">
        <label>Table:</label>
        <select id="import-table"></select>
        <label>Format:</label>
        <select id="import-format">
          <option value="json">JSON</option>
          <option value="csv">CSV</option>
          <option value="sql">SQL</option>
        </select>
      </div>
      <div class="sql-toolbar" style="margin-top:0.25rem;">
        <input type="file" id="import-file" accept=".json,.csv,.sql" />
        <button type="button" id="import-run" disabled>Import</button>
      </div>
    </div>
    <pre id="import-preview" class="meta" style="display:none;max-height:15vh;overflow:auto;font-size:11px;"></pre>
    <p id="import-status" class="meta"></p>
  </div>
  <div class="collapsible-header" id="schema-toggle">▼ Schema</div>
  <div id="schema-collapsible" class="collapsible-body collapsed"><pre id="schema-inline-pre" class="meta">Loading…</pre></div>
  <div class="collapsible-header" id="diagram-toggle">▼ Schema diagram</div>
  <div id="diagram-collapsible" class="collapsible-body collapsed">
    <p class="meta">Tables and relationships. Click a table to view its data.</p>
    <div id="diagram-container"></div>
  </div>
  <ul id="tables"></ul>
  <div id="content" class="content-wrap"></div>
  <script>
    var DRIFT_VIEWER_AUTH_TOKEN = "";
    function authOpts(o) {
      o = o || {}; o.headers = o.headers || {};
      if (DRIFT_VIEWER_AUTH_TOKEN) o.headers['Authorization'] = 'Bearer ' + DRIFT_VIEWER_AUTH_TOKEN;
      return o;
    }
    // --- Natural language to SQL ---
    var schemaMeta = null;
    async function loadSchemaMeta() {
      if (schemaMeta) return schemaMeta;
      var r = await fetch('/api/schema/metadata', authOpts());
      if (!r.ok) throw new Error('Failed to load schema metadata (HTTP ' + r.status + ')');
      schemaMeta = await r.json();
      return schemaMeta;
    }
    function nlToSql(question, meta) {
      var q = question.toLowerCase().trim();
      var tables = meta.tables || [];
      var target = null;
      for (var i = 0; i < tables.length; i++) {
        var t = tables[i];
        var name = t.name.toLowerCase();
        var singular = name.endsWith('s') ? name.slice(0, -1) : name;
        if (q.includes(name) || q.includes(singular)) { target = t; break; }
      }
      if (!target && tables.length === 1) target = tables[0];
      if (!target) return { sql: null, error: 'Could not identify a table from your question.' };
      var mentioned = target.columns.filter(function (c) {
        return q.includes(c.name.toLowerCase().replace(/_/g, ' ')) || q.includes(c.name.toLowerCase());
      });
      var selectCols = mentioned.length > 0
        ? mentioned.map(function (c) { return '"' + c.name + '"'; }).join(', ')
        : '*';
      var sql = '';
      var tn = '"' + target.name + '"';
      if (/how many|count|total number/i.test(q)) {
        sql = 'SELECT COUNT(*) FROM ' + tn;
      } else if (/average|avg|mean/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT AVG("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' LIMIT 50';
      } else if (/sum|total\b/i.test(q) && !/total number/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT SUM("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' LIMIT 50';
      } else if (/max|maximum|highest|largest|biggest/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT MAX("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' ORDER BY 1 DESC LIMIT 1';
      } else if (/min|minimum|lowest|smallest/i.test(q)) {
        var numCol = (mentioned.find(function (c) { return /int|real|num|float/i.test(c.type); })) ||
          target.columns.find(function (c) { return /int|real|num|float/i.test(c.type); });
        sql = numCol ? 'SELECT MIN("' + numCol.name + '") FROM ' + tn : 'SELECT * FROM ' + tn + ' ORDER BY 1 ASC LIMIT 1';
      } else if (/distinct|unique/i.test(q)) {
        var col = mentioned[0] || target.columns[1] || target.columns[0];
        sql = 'SELECT DISTINCT "' + col.name + '" FROM ' + tn;
      } else if (/latest|newest|most recent|last (\d+)/i.test(q)) {
        var dateCol = target.columns.find(function (c) { return /date|time|created|updated/i.test(c.name); });
        var match = q.match(/last (\d+)/i);
        var limit = match ? parseInt(match[1]) : 10;
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + (dateCol ? ' ORDER BY "' + dateCol.name + '" DESC' : '') + ' LIMIT ' + limit;
      } else if (/oldest|earliest|first (\d+)/i.test(q)) {
        var dateCol = target.columns.find(function (c) { return /date|time|created|updated/i.test(c.name); });
        var match2 = q.match(/first (\d+)/i);
        var limit = match2 ? parseInt(match2[1]) : 10;
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + (dateCol ? ' ORDER BY "' + dateCol.name + '" ASC' : '') + ' LIMIT ' + limit;
      } else if (/group by|per\s+\w+|by\s+\w+/i.test(q)) {
        var groupCol = mentioned[0] || target.columns[1] || target.columns[0];
        sql = 'SELECT "' + groupCol.name + '", COUNT(*) AS count FROM ' + tn + ' GROUP BY "' + groupCol.name + '" ORDER BY count DESC';
      } else {
        sql = 'SELECT ' + selectCols + ' FROM ' + tn + ' LIMIT 50';
      }
      return { sql: sql, table: target.name };
    }

    function esc(s) {
      if (s == null) return '';
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }
    function escapeRe(s) {
      return s.replace(/[\\\\^\$*+?.()|[\\]{}]/g, '\\\\\$&');
    }
    function highlightText(text, term) {
      if (!term || term.length === 0) return esc(text);
      const re = new RegExp('(' + escapeRe(term) + ')', 'gi');
      var result = '';
      var lastEnd = 0;
      var match;
      while ((match = re.exec(text)) !== null) {
        result += esc(text.slice(lastEnd, match.index)) + '<span class="highlight">' + esc(match[1]) + '</span>';
        lastEnd = re.lastIndex;
      }
      result += esc(text.slice(lastEnd));
      return result;
    }
    const THEME_KEY = 'drift-viewer-theme';
    // SQL runner query history: persist the last N successful SQL statements (not results)
    // so repeat checks are quick while keeping localStorage small.
    const SQL_HISTORY_KEY = 'drift-viewer-sql-history';
    const SQL_HISTORY_MAX = 20;
    const LIMIT_OPTIONS = [50, 200, 500, 1000];
    let cachedSchema = null;
    let currentTableName = null;
    let currentTableJson = null;
    let lastRenderedSchema = null;
    let lastRenderedData = null;
    let limit = 200;
    let offset = 0;
    let tableCounts = {};
    let rowFilter = '';
    let lastGeneration = 0;
    let refreshInFlight = false;
    let sqlHistory = [];
    const BOOKMARKS_KEY = 'drift-viewer-sql-bookmarks';
    let sqlBookmarks = [];

    function loadSqlHistory() {
      sqlHistory = [];
      try {
        const raw = localStorage.getItem(SQL_HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        sqlHistory = parsed
          .map((h) => {
            const sql = h && typeof h.sql === 'string' ? h.sql.trim() : '';
            if (!sql) return null;
            const rowCount = h && typeof h.rowCount === 'number' ? h.rowCount : null;
            const at = h && typeof h.at === 'string' ? h.at : null;
            return { sql: sql, rowCount: rowCount, at: at };
          })
          .filter(Boolean)
          .slice(0, SQL_HISTORY_MAX);
      } catch (e) { sqlHistory = []; }
    }
    function saveSqlHistory() {
      try {
        localStorage.setItem(SQL_HISTORY_KEY, JSON.stringify(sqlHistory));
      } catch (e) {}
    }
    function refreshHistoryDropdown(sel) {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Recent —</option>' + sqlHistory.map((h, i) => {
        const preview = h.sql.length > 50 ? h.sql.slice(0, 47) + '…' : h.sql;
        const rows = h.rowCount != null ? (h.rowCount + ' row(s)') : '';
        const at = h.at ? new Date(h.at).toLocaleString() : '';
        const label = [rows, at, preview].filter(Boolean).join(' · ');
        return '<option value="' + i + '" title="' + esc(h.sql) + '">' + esc(label) + '</option>';
      }).join('');
      if (cur !== '' && parseInt(cur, 10) < sqlHistory.length) sel.value = cur;
    }
    function pushSqlHistory(sql, rowCount) {
      sql = (sql || '').trim();
      if (!sql) return;
      const at = new Date().toISOString();
      sqlHistory = [{ sql: sql, rowCount: rowCount, at: at }].concat(sqlHistory.filter(h => h.sql !== sql));
      sqlHistory = sqlHistory.slice(0, SQL_HISTORY_MAX);
      saveSqlHistory();
    }

    // --- Shared: bind a dropdown so selecting an item loads its .sql into the input ---
    function bindDropdownToInput(sel, items, inputEl) {
      if (!sel || !inputEl) return;
      sel.addEventListener('change', function() {
        const idx = parseInt(this.value, 10);
        if (!isNaN(idx) && items[idx]) inputEl.value = items[idx].sql;
      });
    }

    // --- Bookmarks: localStorage CRUD ---
    function loadBookmarks() {
      sqlBookmarks = [];
      try {
        const raw = localStorage.getItem(BOOKMARKS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return;
        sqlBookmarks = parsed
          .map(function(b) {
            const name = b && typeof b.name === 'string' ? b.name.trim() : '';
            const sql = b && typeof b.sql === 'string' ? b.sql.trim() : '';
            if (!name || !sql) return null;
            const createdAt = b && typeof b.createdAt === 'string' ? b.createdAt : null;
            return { name: name, sql: sql, createdAt: createdAt };
          })
          .filter(Boolean);
      } catch (e) { sqlBookmarks = []; }
    }
    function saveBookmarks() {
      try {
        localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(sqlBookmarks));
      } catch (e) {}
    }
    function refreshBookmarksDropdown(sel) {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— Bookmarks (' + sqlBookmarks.length + ') —</option>' +
        sqlBookmarks.map(function(b, i) {
          return '<option value="' + i + '" title="' + esc(b.sql) + '">' + esc(b.name) + '</option>';
        }).join('');
      if (cur !== '' && parseInt(cur, 10) < sqlBookmarks.length) sel.value = cur;
    }
    function addBookmark(inputEl, bookmarksSel) {
      const sql = inputEl.value.trim();
      if (!sql) return;
      const name = prompt('Bookmark name:', sql.slice(0, 40));
      if (!name) return;
      sqlBookmarks.unshift({ name: name, sql: sql, createdAt: new Date().toISOString() });
      saveBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
    }
    function deleteBookmark(bookmarksSel) {
      const idx = parseInt(bookmarksSel.value, 10);
      if (isNaN(idx) || !sqlBookmarks[idx]) return;
      if (!confirm('Delete bookmark "' + sqlBookmarks[idx].name + '"?')) return;
      sqlBookmarks.splice(idx, 1);
      saveBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
    }
    function exportBookmarks() {
      if (sqlBookmarks.length === 0) { alert('No bookmarks to export.'); return; }
      const blob = new Blob([JSON.stringify(sqlBookmarks, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'drift-viewer-bookmarks.json';
      a.click();
      URL.revokeObjectURL(url);
    }
    function importBookmarks(bookmarksSel) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = function() {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function() {
          try {
            const imported = JSON.parse(reader.result);
            if (!Array.isArray(imported)) throw new Error('Expected JSON array');
            let newCount = 0;
            imported.forEach(function(b) {
              if (b.name && b.sql && !sqlBookmarks.some(function(e) { return e.sql === b.sql; })) {
                sqlBookmarks.push({ name: b.name, sql: b.sql, createdAt: b.createdAt || new Date().toISOString() });
                newCount++;
              }
            });
            saveBookmarks();
            refreshBookmarksDropdown(bookmarksSel);
            alert('Imported ' + newCount + ' new bookmark(s). ' + (imported.length - newCount) + ' duplicate(s) skipped.');
          } catch (e) {
            alert('Invalid bookmark file: ' + e.message);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    }

    function initTheme() {
      const saved = localStorage.getItem(THEME_KEY);
      const dark = saved !== 'light';
      document.body.classList.toggle('theme-light', !dark);
      document.body.classList.toggle('theme-dark', dark);
      document.getElementById('theme-toggle').textContent = dark ? 'Dark' : 'Light';
    }
    document.getElementById('theme-toggle').addEventListener('click', function() {
      const isLight = document.body.classList.contains('theme-light');
      document.body.classList.toggle('theme-light', isLight);
      document.body.classList.toggle('theme-dark', !isLight);
      localStorage.setItem(THEME_KEY, isLight ? 'dark' : 'light');
      document.getElementById('theme-toggle').textContent = isLight ? 'Dark' : 'Light';
    });
    initTheme();

    if (DRIFT_VIEWER_AUTH_TOKEN) {
      var schemaLink = document.getElementById('export-schema');
      if (schemaLink) schemaLink.href = '/api/schema';
    }

    document.getElementById('schema-toggle').addEventListener('click', function() {
      const el = document.getElementById('schema-collapsible');
      const isCollapsed = el.classList.contains('collapsed');
      el.classList.toggle('collapsed', !isCollapsed);
      this.textContent = isCollapsed ? '▲ Schema' : '▼ Schema';
      if (isCollapsed && cachedSchema === null) {
        fetch('/api/schema', authOpts()).then(r => r.text()).then(schema => {
          cachedSchema = schema;
          document.getElementById('schema-inline-pre').textContent = schema;
        }).catch(() => { document.getElementById('schema-inline-pre').textContent = 'Failed to load.'; });
      }
    });

    (function initDiagram() {
      const toggle = document.getElementById('diagram-toggle');
      const collapsible = document.getElementById('diagram-collapsible');
      const container = document.getElementById('diagram-container');
      if (!toggle || !collapsible || !container) return;
      const BOX_W = 200;
      const BOX_H = 160;
      const PAD = 12;
      const COLS = 4;
      let diagramData = null;

      function tablePos(index) {
        const row = Math.floor(index / COLS);
        const col = index % COLS;
        return { x: col * (BOX_W + PAD) + PAD, y: row * (BOX_H + PAD) + PAD };
      }

      function renderDiagram(data) {
        const tables = data.tables || [];
        const fks = data.foreignKeys || [];
        if (tables.length === 0) {
          container.innerHTML = '<p class="meta">No tables.</p>';
          return;
        }
        const rows = Math.ceil(tables.length / COLS);
        const width = COLS * (BOX_W + PAD) + PAD;
        const height = rows * (BOX_H + PAD) + PAD;
        const nameToIndex = {};
        tables.forEach((t, i) => { nameToIndex[t.name] = i; });
        const getCenter = (index, side) => {
          const p = tablePos(index);
          const cx = p.x + BOX_W / 2;
          const cy = p.y + BOX_H / 2;
          if (side === 'right') return { x: p.x + BOX_W, y: cy };
          if (side === 'left') return { x: p.x, y: cy };
          return { x: cx, y: cy };
        };

        let svg = '<svg width="' + width + '" height="' + height + '" xmlns="http://www.w3.org/2000/svg">';
        svg += '<g class="diagram-links">';
        fks.forEach(function(fk) {
          const iFrom = nameToIndex[fk.fromTable];
          const iTo = nameToIndex[fk.toTable];
          if (iFrom == null || iTo == null) return;
          const from = getCenter(iFrom, 'right');
          const to = getCenter(iTo, 'left');
          const mid = (from.x + to.x) / 2;
          svg += '<path class="diagram-link" d="M' + from.x + ',' + from.y + ' C' + mid + ',' + from.y + ' ' + mid + ',' + to.y + ' ' + to.x + ',' + to.y + '" />';
        });
        svg += '</g><g class="diagram-tables">';
        tables.forEach(function(t, i) {
          const p = tablePos(i);
          const cols = (t.columns || []).slice(0, 6);
          const name = esc(t.name);
          let body = cols.map(function(c) {
            const pk = c.pk ? ' <tspan class="diagram-pk">PK</tspan>' : '';
            return '<tspan class="diagram-col" x="' + (p.x + 8) + '" dy="16">' + esc(c.name) + (c.type ? ' ' + esc(c.type) : '') + pk + '</tspan>';
          }).join('');
          if ((t.columns || []).length > 6) body += '<tspan class="diagram-col" x="' + (p.x + 8) + '" dy="16">…</tspan>';
          svg += '<g class="diagram-table" data-table="' + name + '" transform="translate(' + p.x + ',' + p.y + ')">';
          svg += '<rect width="' + BOX_W + '" height="' + BOX_H + '" rx="4"/>';
          svg += '<text class="diagram-name" x="8" y="22" style="fill: var(--link);">' + name + '</text>';
          svg += '<text x="8" y="38">' + body + '</text>';
          svg += '</g>';
        });
        svg += '</g></svg>';
        container.innerHTML = svg;

        container.querySelectorAll('.diagram-table').forEach(function(g) {
          g.addEventListener('click', function() {
            const name = this.getAttribute('data-table');
            if (name) loadTable(name);
          });
        });
      }

      toggle.addEventListener('click', function() {
        const isCollapsed = collapsible.classList.contains('collapsed');
        collapsible.classList.toggle('collapsed', !isCollapsed);
        this.textContent = isCollapsed ? '▲ Schema diagram' : '▼ Schema diagram';
        if (isCollapsed && diagramData === null) {
          container.innerHTML = '<p class="meta">Loading…</p>';
          fetch('/api/schema/diagram', authOpts())
            .then(r => r.json())
            .then(function(data) {
              diagramData = data;
              renderDiagram(data);
            })
            .catch(function(e) {
              container.innerHTML = '<p class="meta">Failed to load diagram: ' + esc(String(e)) + '</p>';
            });
        } else if (isCollapsed && diagramData) {
          renderDiagram(diagramData);
        }
      });
    })();

    (function initSnapshot() {
      const toggle = document.getElementById('snapshot-toggle');
      const collapsible = document.getElementById('snapshot-collapsible');
      const takeBtn = document.getElementById('snapshot-take');
      const compareBtn = document.getElementById('snapshot-compare');
      const exportLink = document.getElementById('snapshot-export-diff');
      const clearBtn = document.getElementById('snapshot-clear');
      const statusEl = document.getElementById('snapshot-status');
      const resultPre = document.getElementById('snapshot-compare-result');
      function updateSnapshotUI(hasSnapshot, createdAt) {
        compareBtn.disabled = !hasSnapshot;
        exportLink.style.display = hasSnapshot ? '' : 'none';
        clearBtn.style.display = hasSnapshot ? '' : 'none';
        if (exportLink.style.display !== 'none' && DRIFT_VIEWER_AUTH_TOKEN) {
          exportLink.href = '/api/snapshot/compare?format=download';
        } else if (hasSnapshot) exportLink.href = '/api/snapshot/compare?format=download';
        statusEl.textContent = hasSnapshot ? ('Snapshot: ' + (createdAt || '')) : 'No snapshot.';
      }
      function refreshSnapshotStatus() {
        fetch('/api/snapshot', authOpts()).then(r => r.json()).then(function(data) {
          const snap = data.snapshot;
          updateSnapshotUI(!!snap, snap ? snap.createdAt : null);
        }).catch(function() { updateSnapshotUI(false); });
      }
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Snapshot / time travel' : '▼ Snapshot / time travel';
          if (isCollapsed) refreshSnapshotStatus();
        });
      }
      if (takeBtn) takeBtn.addEventListener('click', function() {
        takeBtn.disabled = true;
        statusEl.textContent = 'Capturing…';
        fetch('/api/snapshot', authOpts({ method: 'POST' }))
          .then(r => r.json().then(function(d) { return { ok: r.ok, data: d }; }))
          .then(function(o) {
            if (o.ok) {
              updateSnapshotUI(true, o.data.createdAt);
              statusEl.textContent = 'Snapshot saved at ' + o.data.createdAt;
            } else statusEl.textContent = o.data.error || 'Failed';
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { takeBtn.disabled = false; });
      });
      if (compareBtn) compareBtn.addEventListener('click', function() {
        compareBtn.disabled = true;
        resultPre.style.display = 'none';
        statusEl.textContent = 'Comparing…';
        fetch('/api/snapshot/compare', authOpts())
          .then(r => r.json().then(function(d) { return { ok: r.ok, data: d }; }))
          .then(function(o) {
            if (o.ok) {
              resultPre.textContent = JSON.stringify(o.data, null, 2);
              resultPre.style.display = 'block';
              statusEl.textContent = '';
            } else {
              statusEl.textContent = o.data.error || 'Compare failed';
            }
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { compareBtn.disabled = false; });
      });
      if (clearBtn) clearBtn.addEventListener('click', function() {
        clearBtn.disabled = true;
        statusEl.textContent = 'Clearing…';
        fetch('/api/snapshot', authOpts({ method: 'DELETE' }))
          .then(function() { updateSnapshotUI(false); resultPre.style.display = 'none'; refreshSnapshotStatus(); })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { clearBtn.disabled = false; });
      });
      refreshSnapshotStatus();
    })();

    (function initCompare() {
      const toggle = document.getElementById('compare-toggle');
      const collapsible = document.getElementById('compare-collapsible');
      const viewBtn = document.getElementById('compare-view');
      const exportLink = document.getElementById('compare-export');
      const statusEl = document.getElementById('compare-status');
      const resultPre = document.getElementById('compare-result');
      if (DRIFT_VIEWER_AUTH_TOKEN && exportLink) {
        exportLink.href = '/api/compare/report?format=download';
      }
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Database diff' : '▼ Database diff';
        });
      }
      if (viewBtn) viewBtn.addEventListener('click', function() {
        viewBtn.disabled = true;
        resultPre.style.display = 'none';
        statusEl.textContent = 'Loading…';
        fetch('/api/compare/report', authOpts())
          .then(r => r.json().then(function(d) { return { status: r.status, data: d }; }))
          .then(function(o) {
            if (o.status === 501) {
              statusEl.textContent = 'Database compare not configured. Pass queryCompare to DriftDebugServer.start to compare with another DB (e.g. staging).';
            } else if (o.status >= 400) {
              statusEl.textContent = o.data.error || 'Request failed';
            } else {
              resultPre.textContent = JSON.stringify(o.data, null, 2);
              resultPre.style.display = 'block';
              statusEl.textContent = '';
            }
          })
          .catch(function(e) { statusEl.textContent = 'Error: ' + e.message; })
          .finally(function() { viewBtn.disabled = false; });
      });
    })();

    (function initIndexSuggestions() {
      const toggle = document.getElementById('index-toggle');
      const collapsible = document.getElementById('index-collapsible');
      const btn = document.getElementById('index-analyze');
      const container = document.getElementById('index-results');
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Index suggestions' : '▼ Index suggestions';
        });
      }
      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Analyzing…';
        container.style.display = 'none';
        fetch('/api/index-suggestions', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var suggestions = data.suggestions || [];
            if (suggestions.length === 0) {
              container.innerHTML = '<p class="meta" style="color:#7cb342;">No index suggestions — schema looks good!</p>';
              container.style.display = 'block';
              return;
            }
            var priorityColors = { high: '#e57373', medium: '#ffb74d', low: '#7cb342' };
            var html = '<p class="meta">' + suggestions.length + ' suggestion(s) across ' + data.tablesAnalyzed + ' tables:</p>';
            html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
            html += '<tr><th style="border:1px solid var(--border);padding:4px;">Priority</th><th style="border:1px solid var(--border);padding:4px;">Table.Column</th><th style="border:1px solid var(--border);padding:4px;">Reason</th><th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
            suggestions.forEach(function(s) {
              var color = priorityColors[s.priority] || 'var(--fg)';
              html += '<tr>';
              html += '<td style="border:1px solid var(--border);padding:4px;color:' + color + ';font-weight:bold;">' + esc(s.priority).toUpperCase() + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(s.table) + '.' + esc(s.column) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(s.reason) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;"><code style="font-size:11px;cursor:pointer;" title="Click to copy" onclick="navigator.clipboard.writeText(this.textContent)">' + esc(s.sql) + '</code></td>';
              html += '</tr>';
            });
            html += '</table>';
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Analyze';
          });
      });
    })();

    (function initSizeAnalytics() {
      const toggle = document.getElementById('size-toggle');
      const collapsible = document.getElementById('size-collapsible');
      const btn = document.getElementById('size-analyze');
      const container = document.getElementById('size-results');
      function formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
      }
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Database size analytics' : '▼ Database size analytics';
        });
      }
      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Analyzing…';
        container.style.display = 'none';
        fetch('/api/analytics/size', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var html = '<div style="margin:0.5rem 0;">';
            html += '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.5rem;">';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Total Size</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.totalSizeBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Used</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.usedSizeBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Free</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + formatBytes(data.freeSpaceBytes) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Journal</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + esc(data.journalMode) + '</div></div>';
            html += '<div style="padding:0.5rem;border:1px solid var(--border);border-radius:4px;">';
            html += '<div class="meta">Pages</div>';
            html += '<div style="font-size:1.2rem;font-weight:bold;">' + data.pageCount + ' × ' + data.pageSize + '</div></div>';
            html += '</div>';
            html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
            html += '<tr><th style="border:1px solid var(--border);padding:4px;">Table</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Columns</th>';
            html += '<th style="border:1px solid var(--border);padding:4px;">Indexes</th></tr>';
            var maxRows = Math.max.apply(null, (data.tables || []).map(function(t) { return t.rowCount; }).concat([1]));
            (data.tables || []).forEach(function(t) {
              var barWidth = Math.max(1, (t.rowCount / maxRows) * 100);
              html += '<tr>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + esc(t.table) + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">';
              html += '<div style="background:var(--link);height:12px;width:' + barWidth + '%;opacity:0.3;display:inline-block;vertical-align:middle;margin-right:4px;"></div>';
              html += t.rowCount.toLocaleString() + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + t.columnCount + '</td>';
              html += '<td style="border:1px solid var(--border);padding:4px;">' + t.indexCount;
              if (t.indexes.length > 0) html += ' <span class="meta">(' + t.indexes.map(esc).join(', ') + ')</span>';
              html += '</td></tr>';
            });
            html += '</table></div>';
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Analyze';
          });
      });
    })();

    (function initAnomalyDetection() {
      const toggle = document.getElementById('anomaly-toggle');
      const collapsible = document.getElementById('anomaly-collapsible');
      const btn = document.getElementById('anomaly-analyze');
      const container = document.getElementById('anomaly-results');
      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          const isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Data health' : '▼ Data health';
        });
      }
      if (btn) btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = 'Scanning\u2026';
        container.style.display = 'none';
        fetch('/api/analytics/anomalies', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            var anomalies = data.anomalies || [];
            if (anomalies.length === 0) {
              container.innerHTML = '<p class="meta" style="color:#7cb342;">No anomalies detected across ' + data.tablesScanned + ' tables. Data looks clean!</p>';
              container.style.display = 'block';
              return;
            }
            var icons = { error: '!!', warning: '!', info: 'i' };
            var colors = { error: '#e57373', warning: '#ffb74d', info: '#7cb342' };
            var html = '<p class="meta">' + anomalies.length + ' finding(s) across ' + data.tablesScanned + ' tables:</p>';
            anomalies.forEach(function(a) {
              var color = colors[a.severity] || 'var(--fg)';
              var icon = icons[a.severity] || '';
              html += '<div style="padding:0.3rem 0.5rem;margin:0.2rem 0;border-left:3px solid ' + color + ';background:rgba(0,0,0,0.1);">';
              html += '<span style="color:' + color + ';font-weight:bold;">[' + icon + '] ' + esc(a.severity).toUpperCase() + '</span> ';
              html += esc(a.message);
              if (a.count) html += ' <span class="meta">(' + a.count + ')</span>';
              html += '</div>';
            });
            container.innerHTML = html;
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            btn.disabled = false;
            btn.textContent = 'Scan for anomalies';
          });
      });
    })();

    document.getElementById('export-csv').addEventListener('click', function(e) {
      e.preventDefault();
      if (!currentTableName || !currentTableJson || currentTableJson.length === 0) {
        document.getElementById('export-csv-status').textContent = ' Select a table with data first.';
        return;
      }
      const statusEl = document.getElementById('export-csv-status');
      statusEl.textContent = ' Preparing…';
      try {
        const keys = Object.keys(currentTableJson[0]);
        const rowToCsv = (row) => keys.map(k => {
          const v = row[k];
          if (v == null) return '';
          const s = String(v);
          return s.includes(',') || s.includes('"') || s.includes('\\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
        }).join(',');
        const csv = [keys.join(','), ...currentTableJson.map(rowToCsv)].join('\\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = currentTableName + '.csv';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        statusEl.textContent = ' Failed: ' + err.message;
        return;
      }
      statusEl.textContent = '';
    });

    function getScope() { return document.getElementById('search-scope').value; }
    function getSearchTerm() { return (document.getElementById('search-input').value || '').trim(); }
    function getRowFilter() { return (document.getElementById('row-filter').value || '').trim(); }
    function filterRows(data) {
      const term = getRowFilter();
      if (!term || !data || data.length === 0) return data || [];
      const lower = term.toLowerCase();
      return data.filter(row => Object.values(row).some(v => v != null && String(v).toLowerCase().includes(lower)));
    }

    function applySearch() {
      const term = getSearchTerm();
      const scope = getScope();
      const schemaPre = document.getElementById('schema-pre');
      if (schemaPre && lastRenderedSchema !== null && (scope === 'schema' || scope === 'both')) {
        schemaPre.innerHTML = term ? highlightText(lastRenderedSchema, term) : esc(lastRenderedSchema);
      }
      var contentPre = document.getElementById('content-pre');
      if (contentPre && lastRenderedSchema !== null && scope === 'schema') {
        contentPre.innerHTML = term ? highlightText(lastRenderedSchema, term) : esc(lastRenderedSchema);
      }
      var dataTable = document.getElementById('data-table');
      if (dataTable && term && (scope === 'data' || scope === 'both')) {
        dataTable.querySelectorAll('td').forEach(function(td) {
          if (!td.querySelector('.fk-link')) {
            var text = td.textContent || '';
            td.innerHTML = highlightText(text, term);
          }
        });
      }
    }

    document.getElementById('search-input').addEventListener('input', applySearch);
    document.getElementById('search-input').addEventListener('keyup', applySearch);
    document.getElementById('row-filter').addEventListener('input', function() { if (currentTableName && currentTableJson) renderTableView(currentTableName, currentTableJson); });
    document.getElementById('row-filter').addEventListener('keyup', function() { if (currentTableName && currentTableJson) renderTableView(currentTableName, currentTableJson); });
    document.getElementById('search-scope').addEventListener('change', function() {
      const scope = getScope();
      const content = document.getElementById('content');
      const paginationBar = document.getElementById('pagination-bar');
      if (scope === 'both') {
        loadBothView();
        paginationBar.style.display = (currentTableName ? 'flex' : 'none');
      } else if (scope === 'schema') {
        loadSchemaView();
        paginationBar.style.display = 'none';
      } else if (currentTableName) {
        renderTableView(currentTableName, currentTableJson);
        paginationBar.style.display = 'flex';
      } else {
        content.innerHTML = '';
        lastRenderedSchema = null;
        lastRenderedData = null;
        paginationBar.style.display = 'none';
      }
      applySearch();
    });

    document.getElementById('export-dump').addEventListener('click', function(e) {
      e.preventDefault();
      const link = this;
      const statusEl = document.getElementById('export-dump-status');
      const origText = link.textContent;
      link.textContent = 'Preparing dump…';
      statusEl.textContent = '';
      fetch('/api/dump', authOpts())
        .then(r => { if (!r.ok) throw new Error(r.statusText); return r.blob(); })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'dump.sql';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(err => { statusEl.textContent = ' Failed: ' + err.message; })
        .finally(() => { link.textContent = origText; });
    });

    // Download raw SQLite file (GET /api/database). Requires getDatabaseBytes at server start; 501 → show "Not configured".
    document.getElementById('export-database').addEventListener('click', function(e) {
      e.preventDefault();
      const link = this;
      const statusEl = document.getElementById('export-database-status');
      const origText = link.textContent;
      link.textContent = 'Preparing…';
      statusEl.textContent = '';
      fetch('/api/database', authOpts())
        .then(r => {
          if (r.status === 501) return r.json().then(j => { throw new Error(j.error || 'Not configured'); });
          if (!r.ok) throw new Error(r.statusText);
          return r.blob();
        })
        .then(blob => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'database.sqlite';
          a.click();
          URL.revokeObjectURL(url);
        })
        .catch(err => { statusEl.textContent = ' ' + err.message; })
        .finally(() => { link.textContent = origText; });
    });

    function setupPagination() {
      const bar = document.getElementById('pagination-bar');
      const limitSel = document.getElementById('pagination-limit');
      limitSel.innerHTML = LIMIT_OPTIONS.map(n => '<option value="' + n + '"' + (n === limit ? ' selected' : '') + '>' + n + '</option>').join('');
      document.getElementById('pagination-offset').value = offset;
      bar.style.display = getScope() === 'schema' ? 'none' : 'flex';
    }
    document.getElementById('pagination-limit').addEventListener('change', function() { limit = parseInt(this.value, 10); loadTable(currentTableName); });
    document.getElementById('pagination-offset').addEventListener('change', function() { offset = parseInt(this.value, 10) || 0; });
    document.getElementById('pagination-prev').addEventListener('click', function() { offset = Math.max(0, offset - limit); document.getElementById('pagination-offset').value = offset; loadTable(currentTableName); });
    document.getElementById('pagination-next').addEventListener('click', function() { offset = offset + limit; document.getElementById('pagination-offset').value = offset; loadTable(currentTableName); });
    document.getElementById('pagination-apply').addEventListener('click', function() { offset = parseInt(document.getElementById('pagination-offset').value, 10) || 0; loadTable(currentTableName); });

    function loadSchemaView() {
      const content = document.getElementById('content');
      content.innerHTML = '<p class="meta">Loading schema…</p>';
      if (cachedSchema !== null) {
        renderSchemaContent(content, cachedSchema);
        applySearch();
        return;
      }
      fetch('/api/schema', authOpts())
        .then(r => r.text())
        .then(schema => {
          cachedSchema = schema;
          renderSchemaContent(content, schema);
          applySearch();
        })
        .catch(e => { content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>'; });
    }

    function renderSchemaContent(container, schema) {
      lastRenderedData = null;
      lastRenderedSchema = schema;
      const scope = getScope();
      if (scope === 'both') {
        container.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data</h2><p class="meta">Select a table above to load data.</p></div>';
        const dataSection = document.getElementById('both-data-section');
        if (currentTableName && currentTableJson !== null) {
          const filtered = filterRows(currentTableJson);
          const jsonStr = JSON.stringify(filtered, null, 2);
          lastRenderedData = jsonStr;
          const metaText = rowCountText(currentTableName) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + currentTableJson.length + ')' : '');
          var fkMap = {};
          var cachedFks = fkMetaCache[currentTableName] || [];
          cachedFks.forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
          dataSection.innerHTML = '<h2>Table data: ' + esc(currentTableName) + '</h2><p class="meta">' + metaText + '</p>' + buildDataTableHtml(filtered, fkMap);
        }
      } else {
        container.innerHTML = '<p class="meta">Schema</p><pre id="content-pre">' + esc(schema) + '</pre>';
      }
    }

    function loadBothView() {
      const content = document.getElementById('content');
      content.innerHTML = '<p class="meta">Loading…</p>';
      (cachedSchema !== null ? Promise.resolve(cachedSchema) : fetch('/api/schema', authOpts()).then(r => r.text()))
      .then(schema => {
        if (cachedSchema === null) cachedSchema = schema;
        lastRenderedSchema = schema;
        let dataHtml = '';
        if (currentTableName && currentTableJson !== null) {
          const filtered = filterRows(currentTableJson);
          const jsonStr = JSON.stringify(filtered, null, 2);
          lastRenderedData = jsonStr;
          const metaText = rowCountText(currentTableName) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + currentTableJson.length + ')' : '');
          var fkMap = {};
          var cachedFks = fkMetaCache[currentTableName] || [];
          cachedFks.forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
          dataHtml = '<p class="meta">' + metaText + '</p>' + buildDataTableHtml(filtered, fkMap);
        } else {
          lastRenderedData = null;
          dataHtml = '<p class="meta">Select a table above to load data.</p>';
        }
        content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data</h2>' + dataHtml + '</div>';
        applySearch();
      }).catch(e => { content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>'; });
    }

    // --- FK relationship explorer: data, navigation, breadcrumb ---
    const fkMetaCache = {};
    const navHistory = [];

    function loadFkMeta(tableName) {
      if (fkMetaCache[tableName]) return Promise.resolve(fkMetaCache[tableName]);
      return fetch('/api/table/' + encodeURIComponent(tableName) + '/fk-meta', authOpts())
        .then(function(r) { return r.json(); })
        .then(function(fks) { fkMetaCache[tableName] = fks; return fks; })
        .catch(function() { return []; });
    }

    function buildFkSqlValue(value) {
      var isNumeric = !isNaN(value) && value.trim() !== '';
      return isNumeric ? value : "'" + value.replace(/'/g, "''") + "'";
    }

    function navigateToFk(table, column, value) {
      navHistory.push({ table: currentTableName, offset: offset, filter: document.getElementById('row-filter').value });
      var sqlInput = document.getElementById('sql-input');
      sqlInput.value = 'SELECT * FROM "' + table + '" WHERE "' + column + '" = ' + buildFkSqlValue(value);
      var toggle = document.getElementById('sql-runner-toggle');
      var collapsible = document.getElementById('sql-runner-collapsible');
      if (collapsible && collapsible.classList.contains('collapsed')) { toggle.click(); }
      document.getElementById('sql-run').click();
      currentTableName = table;
      renderBreadcrumb();
    }

    function renderBreadcrumb() {
      var el = document.getElementById('nav-breadcrumb');
      if (!el) {
        el = document.createElement('div');
        el.id = 'nav-breadcrumb';
        el.style.cssText = 'font-size:11px;margin:0.3rem 0;color:var(--muted);';
        document.getElementById('content').prepend(el);
      }
      if (navHistory.length === 0) { el.style.display = 'none'; return; }
      var html = '<a href="#" id="nav-back" style="color:var(--link);">&#8592; Back</a> | Path: ';
      html += navHistory.map(function(h) { return esc(h.table); }).join(' &#8594; ');
      html += ' &#8594; <strong>' + esc(currentTableName || '') + '</strong>';
      el.innerHTML = html;
      el.style.display = 'block';
      var backBtn = document.getElementById('nav-back');
      if (backBtn) backBtn.onclick = function(e) {
        e.preventDefault();
        var prev = navHistory.pop();
        if (prev) {
          offset = prev.offset || 0;
          loadTable(prev.table);
          if (prev.filter) document.getElementById('row-filter').value = prev.filter;
          renderBreadcrumb();
        }
      };
    }

    function buildDataTableHtml(filtered, fkMap) {
      if (!filtered || filtered.length === 0) return '<p class="meta">No rows.</p>';
      var keys = Object.keys(filtered[0]);
      var html = '<table id="data-table"><thead><tr>';
      keys.forEach(function(k) {
        var fk = fkMap[k];
        var fkLabel = fk ? ' <span style="color:var(--muted);font-size:10px;" title="FK to ' + esc(fk.toTable) + '.' + esc(fk.toColumn) + '">&#8599;</span>' : '';
        html += '<th>' + esc(k) + fkLabel + '</th>';
      });
      html += '</tr></thead><tbody>';
      filtered.forEach(function(row) {
        html += '<tr>';
        keys.forEach(function(k) {
          var val = row[k];
          var fk = fkMap[k];
          if (fk && val != null) {
            html += '<td><a href="#" class="fk-link" style="color:var(--link);text-decoration:underline;" ';
            html += 'data-table="' + esc(fk.toTable) + '" ';
            html += 'data-column="' + esc(fk.toColumn) + '" ';
            html += 'data-value="' + esc(String(val)) + '">' ;
            html += esc(String(val)) + ' &#8594;</a></td>';
          } else {
            html += '<td>' + esc(val != null ? String(val) : '') + '</td>';
          }
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderTableView(name, data) {
      const content = document.getElementById('content');
      const scope = getScope();
      const filtered = filterRows(data);
      const jsonStr = JSON.stringify(filtered, null, 2);
      lastRenderedData = jsonStr;
      const metaText = rowCountText(name) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + data.length + ')' : '');
      // Show loading hint while FK metadata is being fetched for the first time
      if (!fkMetaCache[name] && scope !== 'both') {
        content.innerHTML = '<p class="meta">' + metaText + '</p><p class="meta">Loading\u2026</p>';
      }
      function renderDataHtml(fkMap) {
        var tableHtml = buildDataTableHtml(filtered, fkMap);
        if (scope === 'both') {
          lastRenderedSchema = cachedSchema;
          if (cachedSchema === null) {
            fetch('/api/schema', authOpts()).then(function(r) { return r.text(); }).then(function(schema) {
              cachedSchema = schema;
              lastRenderedSchema = schema;
              content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p>' + tableHtml + '</div>';
              applySearch();
              renderBreadcrumb();
            });
          } else {
            var dataSection = document.getElementById('both-data-section');
            if (dataSection) {
              dataSection.innerHTML = '<h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p>' + tableHtml;
            }
            applySearch();
            renderBreadcrumb();
          }
        } else {
          lastRenderedSchema = null;
          content.innerHTML = '<p class="meta">' + metaText + '</p>' + tableHtml;
          applySearch();
          renderBreadcrumb();
        }
      }
      loadFkMeta(name).then(function(fks) {
        var fkMap = {};
        (fks || []).forEach(function(fk) { fkMap[fk.fromColumn] = fk; });
        renderDataHtml(fkMap);
      });
    }

    document.addEventListener('click', function(e) {
      var link = e.target.closest('.fk-link');
      if (!link) return;
      e.preventDefault();
      navigateToFk(link.dataset.table, link.dataset.column, link.dataset.value);
    });

    function rowCountText(name) {
      const total = tableCounts[name];
      const len = (currentTableJson && currentTableJson.length) || 0;
      if (total == null) return esc(name) + ' (up to ' + limit + ' rows)';
      const rangeText = len > 0 ? ('showing ' + (offset + 1) + '–' + (offset + len)) : 'no rows in this range';
      return esc(name) + ' (' + total + ' row' + (total !== 1 ? 's' : '') + '; ' + rangeText + ')';
    }

    function loadTable(name) {
      currentTableName = name;
      const content = document.getElementById('content');
      const scope = getScope();
      if (scope === 'both' && cachedSchema !== null) {
        content.innerHTML = '<p class="meta">Loading ' + esc(name) + '…</p>';
      } else if (scope !== 'both') {
        content.innerHTML = '<p class="meta">' + esc(name) + '</p><p class="meta">Loading…</p>';
      }
      fetch('/api/table/' + encodeURIComponent(name) + '?limit=' + limit + '&offset=' + offset, authOpts())
        .then(r => r.json())
        .then(data => {
          if (currentTableName !== name) return;
          currentTableJson = data;
          setupPagination();
          renderTableView(name, data);
          fetch('/api/table/' + encodeURIComponent(name) + '/count', authOpts())
            .then(r => r.json())
            .then(o => {
              if (currentTableName !== name) return;
              tableCounts[name] = o.count;
              renderTableView(name, data);
            })
            .catch(() => {});
        })
        .catch(e => {
          if (currentTableName !== name) return;
          content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>';
        });
    }

    function renderTableList(tables) {
      const ul = document.getElementById('tables');
      ul.innerHTML = '';
      tables.forEach(t => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = '#' + encodeURIComponent(t);
        a.textContent = (tableCounts[t] != null) ? (t + ' (' + tableCounts[t] + ' rows)') : t;
        a.onclick = e => { e.preventDefault(); loadTable(t); };
        li.appendChild(a);
        ul.appendChild(li);
      });
      const sqlTableSel = document.getElementById('sql-table');
      if (sqlTableSel) {
        sqlTableSel.innerHTML = '<option value="">—</option>' + tables.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
      }
      const importTableSel = document.getElementById('import-table');
      if (importTableSel) {
        importTableSel.innerHTML = tables.map(t => '<option value="' + esc(t) + '">' + esc(t) + (tableCounts[t] != null ? ' (' + tableCounts[t] + ' rows)' : '') + '</option>').join('');
      }
    }

    // --- Chart rendering (pure SVG, no dependencies) ---
    var CHART_COLORS = [
      '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
      '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'
    ];

    function renderBarChart(container, data, xKey, yKey) {
      var W = 600, H = 300, PAD = 50;
      var vals = data.map(function(d) { return Number(d[yKey]) || 0; });
      var maxVal = Math.max.apply(null, vals.concat([1]));
      var barW = Math.max(4, (W - PAD * 2) / data.length - 2);
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';
      for (var i = 0; i <= 4; i++) {
        var v = (maxVal / 4 * i).toFixed(maxVal > 100 ? 0 : 1);
        var y = H - PAD - (i / 4) * (H - PAD * 2);
        svg += '<text class="chart-axis-label" x="' + (PAD - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + v + '</text>';
      }
      data.forEach(function(d, i) {
        var val = Number(d[yKey]) || 0;
        var bh = (val / maxVal) * (H - PAD * 2);
        var x = PAD + i * (barW + 2);
        var by = H - PAD - bh;
        svg += '<rect class="chart-bar" x="' + x + '" y="' + by + '" width="' + barW + '" height="' + bh + '">';
        svg += '<title>' + esc(String(d[xKey])) + ': ' + val + '</title></rect>';
        if (data.length <= 20) {
          svg += '<text class="chart-label" x="' + (x + barW / 2) + '" y="' + (H - PAD + 14) + '" text-anchor="middle" transform="rotate(-45,' + (x + barW / 2) + ',' + (H - PAD + 14) + ')">' + esc(String(d[xKey]).slice(0, 12)) + '</text>';
        }
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderPieChart(container, data, labelKey, valueKey) {
      var W = 500, H = 350, R = 130, CX = 200, CY = H / 2;
      var vals = data.map(function(d) { return Math.max(0, Number(d[valueKey]) || 0); });
      var total = vals.reduce(function(a, b) { return a + b; }, 0) || 1;
      var threshold = total * 0.02;
      var significant = [];
      var otherVal = 0;
      data.forEach(function(d, i) {
        if (vals[i] >= threshold) significant.push({ label: d[labelKey], value: vals[i] });
        else otherVal += vals[i];
      });
      if (otherVal > 0) significant.push({ label: 'Other', value: otherVal });
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      var angle = 0;
      significant.forEach(function(d, i) {
        var sweep = (d.value / total) * 2 * Math.PI;
        var color = CHART_COLORS[i % CHART_COLORS.length];
        var pct = (d.value / total * 100).toFixed(1);
        var tip = '<title>' + esc(String(d.label)) + ': ' + d.value + ' (' + pct + '%)</title>';
        if (sweep >= 2 * Math.PI - 0.001) {
          // Full circle — SVG arc degenerates when start ≈ end; use <circle> instead
          svg += '<circle class="chart-slice" cx="' + CX + '" cy="' + CY + '" r="' + R + '" fill="' + color + '">' + tip + '</circle>';
        } else {
          var x1 = CX + R * Math.cos(angle);
          var y1 = CY + R * Math.sin(angle);
          var x2 = CX + R * Math.cos(angle + sweep);
          var y2 = CY + R * Math.sin(angle + sweep);
          var large = sweep > Math.PI ? 1 : 0;
          svg += '<path class="chart-slice" d="M' + CX + ',' + CY + ' L' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '">' + tip + '</path>';
        }
        angle += sweep;
      });
      significant.forEach(function(d, i) {
        var ly = 20 + i * 18;
        var lx = CX + R + 30;
        var color = CHART_COLORS[i % CHART_COLORS.length];
        svg += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="10" height="10" fill="' + color + '"/>';
        svg += '<text class="chart-legend" x="' + (lx + 14) + '" y="' + ly + '">' + esc(String(d.label).slice(0, 20)) + ' (' + d.value + ')</text>';
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderLineChart(container, data, xKey, yKey) {
      var W = 600, H = 300, PAD = 50;
      var vals = data.map(function(d) { return Number(d[yKey]) || 0; });
      var maxVal = Math.max.apply(null, vals.concat([1]));
      var minVal = Math.min.apply(null, vals.concat([0]));
      var range = maxVal - minVal || 1;
      var stepX = (W - PAD * 2) / Math.max(data.length - 1, 1);
      var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
      svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';
      var points = data.map(function(d, i) {
        var x = PAD + i * stepX;
        var y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
        return x + ',' + y;
      });
      svg += '<polygon points="' + PAD + ',' + (H - PAD) + ' ' + points.join(' ') + ' ' + (PAD + (data.length - 1) * stepX) + ',' + (H - PAD) + '" fill="var(--link)" opacity="0.1"/>';
      svg += '<polyline class="chart-line" points="' + points.join(' ') + '"/>';
      data.forEach(function(d, i) {
        var x = PAD + i * stepX;
        var y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
        svg += '<circle class="chart-dot" cx="' + x + '" cy="' + y + '" r="3"><title>' + esc(String(d[xKey])) + ': ' + d[yKey] + '</title></circle>';
      });
      svg += '</svg>';
      container.innerHTML = svg;
      container.style.display = 'block';
    }

    function renderHistogram(container, data, valueKey, bins) {
      bins = bins || 10;
      var vals = data.map(function(d) { return Number(d[valueKey]); }).filter(function(v) { return isFinite(v); });
      if (vals.length === 0) { container.innerHTML = '<p class="meta">No numeric data.</p>'; container.style.display = 'block'; return; }
      var min = Math.min.apply(null, vals);
      var max = Math.max.apply(null, vals);
      var binWidth = (max - min) / bins || 1;
      var counts = new Array(bins).fill(0);
      vals.forEach(function(v) {
        var idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
        counts[idx]++;
      });
      var histData = counts.map(function(c, i) {
        return { label: (min + i * binWidth).toFixed(1) + '-' + (min + (i + 1) * binWidth).toFixed(1), value: c };
      });
      renderBarChart(container, histData, 'label', 'value');
    }

    document.getElementById('chart-render').addEventListener('click', function() {
      var type = document.getElementById('chart-type').value;
      var xKey = document.getElementById('chart-x').value;
      var yKey = document.getElementById('chart-y').value;
      var container = document.getElementById('chart-container');
      var rows = window._chartRows || [];
      if (type === 'none' || rows.length === 0) { container.style.display = 'none'; return; }
      var chartData = rows;
      if (rows.length > 500) {
        var nth = Math.ceil(rows.length / 500);
        chartData = rows.filter(function(_, i) { return i % nth === 0; });
      }
      if (type === 'bar') renderBarChart(container, chartData, xKey, yKey);
      else if (type === 'pie') renderPieChart(container, chartData, xKey, yKey);
      else if (type === 'line') renderLineChart(container, chartData, xKey, yKey);
      else if (type === 'histogram') renderHistogram(container, chartData, yKey);
    });

    (function initSqlRunner() {
      const toggle = document.getElementById('sql-runner-toggle');
      const collapsible = document.getElementById('sql-runner-collapsible');
      const templateSel = document.getElementById('sql-template');
      const tableSel = document.getElementById('sql-table');
      const fieldsSel = document.getElementById('sql-fields');
      const applyBtn = document.getElementById('sql-apply-template');
      const runBtn = document.getElementById('sql-run');
      const explainBtn = document.getElementById('sql-explain');
      const historySel = document.getElementById('sql-history');
      const formatSel = document.getElementById('sql-result-format');
      const inputEl = document.getElementById('sql-input');
      const errorEl = document.getElementById('sql-error');
      const resultEl = document.getElementById('sql-result');
      const bookmarksSel = document.getElementById('sql-bookmarks');
      const bookmarkSaveBtn = document.getElementById('sql-bookmark-save');
      const bookmarkDeleteBtn = document.getElementById('sql-bookmark-delete');
      const bookmarkExportBtn = document.getElementById('sql-bookmark-export');
      const bookmarkImportBtn = document.getElementById('sql-bookmark-import');
      loadSqlHistory();
      refreshHistoryDropdown(historySel);
      loadBookmarks();
      refreshBookmarksDropdown(bookmarksSel);
      bindDropdownToInput(historySel, sqlHistory, inputEl);
      bindDropdownToInput(bookmarksSel, sqlBookmarks, inputEl);
      if (bookmarkSaveBtn) bookmarkSaveBtn.addEventListener('click', function() { addBookmark(inputEl, bookmarksSel); });
      if (bookmarkDeleteBtn) bookmarkDeleteBtn.addEventListener('click', function() { deleteBookmark(bookmarksSel); });
      if (bookmarkExportBtn) bookmarkExportBtn.addEventListener('click', exportBookmarks);
      if (bookmarkImportBtn) bookmarkImportBtn.addEventListener('click', function() { importBookmarks(bookmarksSel); });

      if (!toggle || !collapsible) return;

      toggle.addEventListener('click', function() {
        const isCollapsed = collapsible.classList.contains('collapsed');
        collapsible.classList.toggle('collapsed', !isCollapsed);
        this.textContent = isCollapsed ? '▲ Run SQL (read-only)' : '▼ Run SQL (read-only)';
      });

      const TEMPLATES = {
        'select-star-limit': function(t, cols) { return 'SELECT * FROM "' + t + '" LIMIT 10'; },
        'select-star': function(t, cols) { return 'SELECT * FROM "' + t + '"'; },
        'count': function(t, cols) { return 'SELECT COUNT(*) FROM "' + t + '"'; },
        'select-fields': function(t, cols) {
          const list = (cols && cols.length) ? cols.map(c => '"' + c + '"').join(', ') : '*';
          return 'SELECT ' + list + ' FROM "' + t + '" LIMIT 10';
        }
      };

      function getSelectedFields() {
        const opts = fieldsSel ? Array.from(fieldsSel.selectedOptions || []) : [];
        return opts.map(o => o.value).filter(Boolean);
      }

      function applyTemplate() {
        const table = (tableSel && tableSel.value) || '';
        const templateId = (templateSel && templateSel.value) || 'custom';
        if (templateId === 'custom') return;
        const fn = TEMPLATES[templateId];
        if (!fn) return;
        const cols = getSelectedFields();
        const sql = table ? fn(table, cols) : ('SELECT * FROM "' + (table || 'table_name') + '" LIMIT 10');
        if (inputEl) inputEl.value = sql;
      }

      if (applyBtn) applyBtn.addEventListener('click', applyTemplate);
      if (templateSel) templateSel.addEventListener('change', applyTemplate);

      if (tableSel) {
        tableSel.addEventListener('change', function() {
          const name = this.value;
          fieldsSel.innerHTML = '<option value="">—</option>';
          if (!name) return;
          fieldsSel.innerHTML = '<option value="">Loading…</option>';
          const requestedTable = name;
          fetch('/api/table/' + encodeURIComponent(name) + '/columns', authOpts())
            .then(r => r.json())
            .then(cols => {
              if (tableSel.value !== requestedTable) return;
              if (Array.isArray(cols)) {
                fieldsSel.innerHTML = '<option value="">—</option>' + cols.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
              } else {
                fieldsSel.innerHTML = '<option value="">—</option>';
              }
            })
            .catch(() => {
              if (tableSel.value !== requestedTable) return;
              fieldsSel.innerHTML = '<option value="">—</option>';
            });
        });
      }

      // Shared: clear previous results and hide chart controls before any SQL operation.
      function clearSqlResults() {
        errorEl.style.display = 'none';
        resultEl.style.display = 'none';
        resultEl.innerHTML = '';
        document.getElementById('chart-controls').style.display = 'none';
        document.getElementById('chart-container').style.display = 'none';
      }
      // Shared: disable both Run and Explain buttons to prevent concurrent requests.
      function setSqlButtonsDisabled(disabled) {
        if (runBtn) runBtn.disabled = disabled;
        if (explainBtn) explainBtn.disabled = disabled;
      }

      if (runBtn && inputEl && errorEl && resultEl) {
        runBtn.addEventListener('click', function() {
          const sql = inputEl.value.trim();
          clearSqlResults();
          if (!sql) {
            errorEl.textContent = 'Enter a SELECT query.';
            errorEl.style.display = 'block';
            return;
          }
          const runBtnOrigText = runBtn.textContent;
          runBtn.textContent = 'Running\u2026';
          setSqlButtonsDisabled(true);
          fetch('/api/sql', authOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: sql })
          }))
            .then(r => r.json().then(data => ({ ok: r.ok, data: data })))
            .then(({ ok, data }) => {
              if (!ok) {
                errorEl.textContent = data.error || 'Request failed';
                errorEl.style.display = 'block';
                return;
              }
              const rows = data.rows || [];
              const asTable = formatSel && formatSel.value === 'table';
              if (asTable && rows.length > 0) {
                const keys = Object.keys(rows[0]);
                let html = '<p class="meta">' + rows.length + ' row(s)</p><table><thead><tr>' + keys.map(k => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>';
                rows.forEach(row => {
                  html += '<tr>' + keys.map(k => '<td>' + esc(row[k] != null ? String(row[k]) : '') + '</td>').join('') + '</tr>';
                });
                html += '</tbody></table>';
                resultEl.innerHTML = html;
              } else {
                resultEl.innerHTML = '<p class="meta">' + rows.length + ' row(s)</p><pre>' + esc(JSON.stringify(rows, null, 2)) + '</pre>';
              }
              resultEl.style.display = 'block';
              // Show chart controls when results available
              var chartControls = document.getElementById('chart-controls');
              if (rows.length > 0) {
                var keys2 = Object.keys(rows[0]);
                var xSel = document.getElementById('chart-x');
                var ySel = document.getElementById('chart-y');
                xSel.innerHTML = keys2.map(function(k) { return '<option>' + esc(k) + '</option>'; }).join('');
                ySel.innerHTML = keys2.map(function(k) { return '<option>' + esc(k) + '</option>'; }).join('');
                chartControls.style.display = 'flex';
                window._chartRows = rows;
              } else {
                chartControls.style.display = 'none';
                document.getElementById('chart-container').style.display = 'none';
              }
              pushSqlHistory(sql, rows.length);
              refreshHistoryDropdown(historySel);
            })
            .catch(e => {
              errorEl.textContent = e.message || String(e);
              errorEl.style.display = 'block';
            })
            .finally(() => {
              setSqlButtonsDisabled(false);
              runBtn.textContent = runBtnOrigText;
            });
        });
      }
      if (explainBtn && inputEl && errorEl && resultEl) {
        explainBtn.addEventListener('click', function() {
          const sql = inputEl.value.trim();
          clearSqlResults();
          if (!sql) {
            errorEl.textContent = 'Enter a SELECT query.';
            errorEl.style.display = 'block';
            return;
          }
          const explainOrigText = explainBtn.textContent;
          explainBtn.textContent = 'Explaining\u2026';
          setSqlButtonsDisabled(true);
          fetch('/api/sql/explain', authOpts({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: sql })
          }))
            .then(r => r.json().then(d => ({ ok: r.ok, data: d })))
            .then(({ ok, data }) => {
              if (!ok) {
                errorEl.textContent = data.error || 'Request failed';
                errorEl.style.display = 'block';
                return;
              }
              const rows = data.rows || [];
              // Build parent-to-depth map for tree indentation
              var depthMap = {};
              rows.forEach(function(r) {
                var pid = r.parent || 0;
                depthMap[r.id] = (depthMap[pid] != null ? depthMap[pid] + 1 : 0);
              });
              let html = '<p class="meta" style="font-weight:bold;">EXPLAIN QUERY PLAN</p>';
              html += '<pre style="font-family:monospace;font-size:12px;line-height:1.6;">';
              let hasScan = false;
              let hasIndex = false;
              rows.forEach(function(r) {
                const detail = r.detail || JSON.stringify(r);
                const depth = depthMap[r.id] || 0;
                const indent = '  '.repeat(depth);
                let icon = '   ';
                let style = '';
                if (/\\bSCAN\\b/.test(detail)) {
                  icon = '!! ';
                  style = ' style="color:#e57373;"';
                  hasScan = true;
                } else if (/\\bSEARCH\\b.*\\bINDEX\\b/.test(detail)) {
                  icon = 'OK ';
                  style = ' style="color:#7cb342;"';
                  hasIndex = true;
                } else if (/\\bUSING\\b.*\\bINDEX\\b/.test(detail)) {
                  icon = 'OK ';
                  style = ' style="color:#7cb342;"';
                  hasIndex = true;
                }
                html += '<span' + style + '>' + icon + indent + esc(detail) + '</span>\\n';
              });
              html += '</pre>';
              if (hasScan) {
                html += '<p class="meta" style="color:#e57373;margin-top:0.3rem;">';
                html += 'Warning: Full table scan detected. Consider adding an index on the filtered/sorted column.</p>';
              }
              if (hasIndex && !hasScan) {
                html += '<p class="meta" style="color:#7cb342;margin-top:0.3rem;">';
                html += 'Good: Query uses index(es) for efficient lookup.</p>';
              }
              resultEl.innerHTML = html;
              resultEl.style.display = 'block';
            })
            .catch(e => {
              errorEl.textContent = e.message || String(e);
              errorEl.style.display = 'block';
            })
            .finally(() => {
              setSqlButtonsDisabled(false);
              explainBtn.textContent = explainOrigText;
            });
        });
      }
    })();

    // Shared: render table list and kick off count fetches (used by initial load and live refresh).
    function applyTableListAndCounts(tables) {
      renderTableList(tables);
      tables.forEach(t => {
        fetch('/api/table/' + encodeURIComponent(t) + '/count', authOpts())
          .then(r => r.json())
          .then(o => { tableCounts[t] = o.count; renderTableList(tables); })
          .catch(() => {});
      });
    }
    function refreshOnGenerationChange() {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const liveEl = document.getElementById('live-indicator');
      if (liveEl) liveEl.textContent = 'Updating…';
      fetch('/api/tables', authOpts())
        .then(r => r.json())
        .then(tables => {
          applyTableListAndCounts(tables);
          if (currentTableName) loadTable(currentTableName);
        })
        .catch(() => {})
        .finally(() => {
          refreshInFlight = false;
          if (liveEl) liveEl.textContent = '● Live';
        });
    }
    // Long-poll /api/generation?since=N; when generation changes, refresh table list and current table.
    function pollGeneration() {
      fetch('/api/generation?since=' + lastGeneration, authOpts())
        .then(r => r.json())
        .then(data => {
          const g = data.generation;
          if (g !== lastGeneration) {
            lastGeneration = g;
            refreshOnGenerationChange();
          }
          pollGeneration();
        })
        .catch(() => { setTimeout(pollGeneration, 2000); });
    }
    // --- NL-to-SQL event handlers ---
    document.getElementById('nl-convert').addEventListener('click', async function () {
      var question = document.getElementById('nl-input').value.trim();
      if (!question) return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Converting...';
      try {
        var meta = await loadSchemaMeta();
        var result = nlToSql(question, meta);
        if (result.sql) {
          document.getElementById('sql-input').value = result.sql;
          document.getElementById('sql-error').style.display = 'none';
        } else {
          document.getElementById('sql-error').textContent = result.error || 'Could not convert to SQL.';
          document.getElementById('sql-error').style.display = 'block';
        }
      } catch (err) {
        document.getElementById('sql-error').textContent = 'Error: ' + (err.message || err);
        document.getElementById('sql-error').style.display = 'block';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Convert to SQL';
      }
    });
    document.getElementById('nl-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('nl-convert').click();
    });

    fetch('/api/tables', authOpts())
      .then(r => r.json())
      .then(tables => {
        const loadingEl = document.getElementById('tables-loading');
        loadingEl.style.display = 'none';
        applyTableListAndCounts(tables);
        pollGeneration();
        // Deep link: URL hash #TableName (e.g. from IDE extension) auto-loads that table.
        var hash = '';
        if (location.hash && location.hash.length > 1) {
          try { hash = decodeURIComponent(location.hash.slice(1)); } catch (e) { }
        }
        if (hash && tables.indexOf(hash) >= 0) loadTable(hash);
      })
      .catch(e => { document.getElementById('tables-loading').textContent = 'Failed to load tables: ' + e; });

    // --- Collaborative session: capture, share, restore ---
    function captureViewerState() {
      return {
        currentTable: currentTableName,
        sqlInput: document.getElementById('sql-input').value,
        searchTerm: document.getElementById('search-input')
          ? document.getElementById('search-input').value
          : '',
        theme: localStorage.getItem(THEME_KEY),
        limit: limit,
        offset: offset,
        timestamp: new Date().toISOString(),
      };
    }

    document.getElementById('share-btn').addEventListener('click', function () {
      var note = prompt('Add a note for your team (optional):');
      if (note === null) return;
      var state = captureViewerState();
      if (note) state.note = note;

      fetch('/api/session/share', authOpts({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          var shareUrl = location.origin + location.pathname + data.url;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(shareUrl)
              .then(function () {
                alert('Share URL copied to clipboard!\\n\\n' + shareUrl +
                  '\\n\\nExpires: ' + new Date(data.expiresAt).toLocaleString());
              })
              .catch(function () {
                prompt('Copy this share URL:', shareUrl);
              });
          } else {
            prompt('Copy this share URL:', shareUrl);
          }
        })
        .catch(function (e) {
          alert('Failed to create share: ' + e.message);
        });
    });

    (function restoreSession() {
      var params = new URLSearchParams(location.search);
      var sessionId = params.get('session');
      if (!sessionId) return;

      fetch('/api/session/' + encodeURIComponent(sessionId), authOpts())
        .then(function (r) {
          if (!r.ok) throw new Error('Session expired or not found');
          return r.json();
        })
        .then(function (data) {
          var state = data.state || {};

          if (state.currentTable) {
            setTimeout(function () { loadTable(state.currentTable); }, 500);
          }
          if (state.sqlInput) {
            document.getElementById('sql-input').value = state.sqlInput;
          }
          if (state.searchTerm && document.getElementById('search-input')) {
            document.getElementById('search-input').value = state.searchTerm;
          }
          if (state.limit) limit = state.limit;
          if (state.offset) offset = state.offset;

          var infoBar = document.createElement('div');
          infoBar.style.cssText =
            'background:var(--link);color:var(--bg);padding:0.3rem 0.5rem;font-size:12px;text-align:center;';
          var info = 'Shared session';
          if (state.note) info += ': "' + esc(state.note) + '"';
          info += ' (created ' + new Date(data.createdAt).toLocaleString() + ')';
          infoBar.textContent = info;
          document.body.prepend(infoBar);

          var annotations = data.annotations || [];
          if (annotations.length > 0) {
            var annoEl = document.createElement('div');
            annoEl.style.cssText =
              'background:var(--bg-pre);padding:0.3rem 0.5rem;font-size:11px;border-left:3px solid var(--link);margin:0.3rem 0;';
            var annoHtml = '<strong>Annotations:</strong><br>';
            annotations.forEach(function (a) {
              annoHtml += '<span class="meta">[' + esc(a.author) + ' at ' +
                new Date(a.at).toLocaleTimeString() + ']</span> ' +
                esc(a.text) + '<br>';
            });
            annoEl.innerHTML = annoHtml;
            document.body.children[1]
              ? document.body.insertBefore(annoEl, document.body.children[1])
              : document.body.appendChild(annoEl);
          }
        })
        .catch(function (e) {
          console.warn('Session restore failed:', e.message);
        });
    })();
  </script>
</body>
</html>''';
}

// --- Public API ---
// Single instance so one server per process; avoid_static_state is satisfied by instance-based state in _DriftDebugServerImpl.

/// Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web viewer.
///
/// Use [start] to bind the server (default port 8642); open http://127.0.0.1:8642 in a browser.
/// Only one server can run per process; use [stop] to shut down before calling [start] again.
///
/// See the package README for API endpoints and optional features (snapshots, compare, download).
mixin DriftDebugServer {
  /// Lazy singleton without [late]: avoids avoid_late_keyword while keeping one server per process.
  static _DriftDebugServerImpl? _instanceStorage;
  static _DriftDebugServerImpl get _instance {
    final existing = _instanceStorage;
    if (existing != null) return existing;
    final created = _DriftDebugServerImpl();
    _instanceStorage = created;
    return created;
  }

  /// Starts the debug server if [enabled] is true and [query] is provided.
  ///
  /// No-op if [enabled] is false or the server is already running.
  /// Throws [ArgumentError] if [port] is out of range or Basic auth is partially configured.
  static Future<void> start({
    required DriftDebugQuery query,
    bool enabled = true,
    int port = _DriftDebugServerImpl._defaultPort,
    bool loopbackOnly = false,
    String? corsOrigin = '*',
    String? authToken,
    String? basicAuthUser,
    String? basicAuthPassword,

    (function initPerformance() {
      var toggle = document.getElementById('perf-toggle');
      var collapsible = document.getElementById('perf-collapsible');
      var refreshBtn = document.getElementById('perf-refresh');
      var clearBtn = document.getElementById('perf-clear');
      var container = document.getElementById('perf-results');

      if (toggle && collapsible) {
        toggle.addEventListener('click', function() {
          var isCollapsed = collapsible.classList.contains('collapsed');
          collapsible.classList.toggle('collapsed', !isCollapsed);
          this.textContent = isCollapsed ? '▲ Query performance' : '▼ Query performance';
        });
      }

      function renderPerformance(data) {
        var html = '<div style="display:flex;gap:1rem;flex-wrap:wrap;margin:0.3rem 0;">';
        html += '<div class="meta">Total: ' + data.totalQueries + ' queries</div>';
        html += '<div class="meta">Total time: ' + data.totalDurationMs + ' ms</div>';
        html += '<div class="meta">Avg: ' + data.avgDurationMs + ' ms</div>';
        html += '</div>';

        if (data.slowQueries && data.slowQueries.length > 0) {
          html += '<p class="meta" style="color:#e57373;font-weight:bold;">Slow queries (&gt;100ms):</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">Duration</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Time</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
          data.slowQueries.forEach(function(q) {
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;color:#e57373;font-weight:bold;">' + q.durationMs + ' ms</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + q.rowCount + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;font-size:11px;">' + esc(q.at) + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(q.sql) + '">' + esc(q.sql.length > 80 ? q.sql.slice(0, 80) + '…' : q.sql) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        if (data.queryPatterns && data.queryPatterns.length > 0) {
          html += '<p class="meta" style="margin-top:0.5rem;">Most time-consuming patterns:</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">Total ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Count</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Avg ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Max ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Pattern</th></tr>';
          data.queryPatterns.forEach(function(p) {
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + p.totalMs + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + p.count + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + p.avgMs + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + p.maxMs + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;" title="' + esc(p.pattern) + '">' + esc(p.pattern.length > 60 ? p.pattern.slice(0, 60) + '…' : p.pattern) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        if (data.recentQueries && data.recentQueries.length > 0) {
          html += '<p class="meta" style="margin-top:0.5rem;">Recent queries (newest first):</p>';
          html += '<table style="border-collapse:collapse;width:100%;font-size:12px;">';
          html += '<tr><th style="border:1px solid var(--border);padding:4px;">ms</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">Rows</th>';
          html += '<th style="border:1px solid var(--border);padding:4px;">SQL</th></tr>';
          data.recentQueries.forEach(function(q) {
            var color = q.durationMs > 100 ? '#e57373' : (q.durationMs > 50 ? '#ffb74d' : 'var(--fg)');
            html += '<tr>';
            html += '<td style="border:1px solid var(--border);padding:4px;color:' + color + ';">' + q.durationMs + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;">' + q.rowCount + '</td>';
            html += '<td style="border:1px solid var(--border);padding:4px;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(q.sql) + '">' + esc(q.sql.length > 80 ? q.sql.slice(0, 80) + '…' : q.sql) + '</td>';
            html += '</tr>';
          });
          html += '</table>';
        }

        return html;
      }

      if (refreshBtn) refreshBtn.addEventListener('click', function() {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading…';
        container.style.display = 'none';
        fetch('/api/analytics/performance', authOpts())
          .then(function(r) {
            if (!r.ok) return r.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
            return r.json();
          })
          .then(function(data) {
            if (data.totalQueries === 0) {
              container.innerHTML = '<p class="meta">No queries recorded yet. Browse some tables, then refresh.</p>';
            } else {
              container.innerHTML = renderPerformance(data);
            }
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh';
          });
      });

      if (clearBtn) clearBtn.addEventListener('click', function() {
        clearBtn.disabled = true;
        fetch('/api/analytics/performance', authOpts({ method: 'DELETE' }))
          .then(function() {
            container.innerHTML = '<p class="meta">Cleared.</p>';
            container.style.display = 'block';
          })
          .catch(function(e) {
            container.innerHTML = '<p class="meta" style="color:#e57373;">Error: ' + esc(e.message) + '</p>';
            container.style.display = 'block';
          })
          .finally(function() { clearBtn.disabled = false; });
      });
    })();
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    DriftDebugQuery? queryCompare,
    DriftDebugWriteQuery? writeQuery,
    DriftDebugOnLog? onLog,
    DriftDebugOnError? onError,
  }) =>
      _instance.start(
        query: query,
        enabled: enabled,
        port: port,
        loopbackOnly: loopbackOnly,
        corsOrigin: corsOrigin,
        authToken: authToken,
        basicAuthUser: basicAuthUser,
        basicAuthPassword: basicAuthPassword,
        getDatabaseBytes: getDatabaseBytes,
        queryCompare: queryCompare,
        writeQuery: writeQuery,
        onLog: onLog,
        onError: onError,
      );

  /// The port the server is bound to, or null if not running.
  static int? get port => _instance.port;

  /// Stops the server and releases the port. No-op if not running.
  static Future<void> stop() => _instance.stop();
}
