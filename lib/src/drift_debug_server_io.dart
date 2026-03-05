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

// --- Snapshot (time-travel) ---

/// In-memory snapshot of table state (for time-travel compare). Captured by POST /api/snapshot;
/// GET /api/snapshot/compare diffs current DB vs this snapshot (per-table added/removed/unchanged).
class _Snapshot {
  const _Snapshot({required this.id, required this.createdAt, required this.tables});
  final String id;
  final DateTime createdAt;
  final Map<String, List<Map<String, dynamic>>> tables;

  @override
  String toString() =>
      '_Snapshot(id: $id, createdAt: $createdAt, tables: ${tables.length} tables)';
}

/// Validated POST /api/sql request body (prefer_extension_type_for_wrapper, require_api_response_validation).
extension type _SqlRequestBody(String _sql) implements Object {
  /// Validated SQL string (exposed getter; representation is private per prefer_private_extension_type_field).
  String get sql => _sql;

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

  /// Monotonically incremented when table row counts change; used for live refresh and long-poll.
  int _generation = 0;

  /// Fingerprint "table1:count1,table2:count2,..." to detect changes without storing full data.
  String? _lastDataSignature;
  bool _changeCheckInProgress = false;

  /// In-memory snapshot: id, createdAt, and full table data per table (for GET /api/snapshot/compare).
  _Snapshot? _snapshot;

  static const int _defaultPort = 8642;
  static const int _minPort = 0;
  static const int _maxPort = 65535;
  static const int _maxLimit = 1000;
  static const int _defaultLimit = 200;
  // Digit separators (2_000_000) require SDK 3.6+; package supports SDK 3.0+. Rule disabled in analysis_options_custom.yaml.
  static const int _maxOffset = 2000000;
  static const Duration _longPollTimeout = Duration(seconds: 30);
  static const Duration _longPollCheckInterval =
      Duration(milliseconds: 300); // Poll interval during long-poll wait

  // --- Route constants (method + path; alt forms allow path without leading slash) ---
  static const String _methodGet = 'GET';
  static const String _methodPost = 'POST';
  static const String _methodDelete = 'DELETE';
  static const String _pathApiHealth = '/api/health';
  static const String _pathApiHealthAlt = 'api/health';
  static const String _pathApiGeneration = '/api/generation';
  static const String _pathApiGenerationAlt = 'api/generation';
  static const String _pathApiTables = '/api/tables';
  static const String _pathApiTablesAlt = 'api/tables';
  static const String _pathApiTablePrefix = '/api/table/';
  static const String _pathApiTablePrefixAlt = 'api/table/';
  static const String _pathSuffixCount = '/count';
  static const String _pathSuffixColumns = '/columns';
  static const String _pathApiSql = '/api/sql';
  static const String _pathApiSqlAlt = 'api/sql';
  static const String _pathApiSchema = '/api/schema';
  static const String _pathApiSchemaAlt = 'api/schema';
  static const String _pathApiSchemaDiagram = '/api/schema/diagram';
  static const String _pathApiSchemaDiagramAlt = 'api/schema/diagram';
  static const String _pathApiDump = '/api/dump';
  static const String _pathApiDumpAlt = 'api/dump';
  static const String _pathApiDatabase = '/api/database';
  static const String _pathApiDatabaseAlt = 'api/database';
  static const String _pathApiSnapshot = '/api/snapshot';
  static const String _pathApiSnapshotAlt = 'api/snapshot';
  static const String _pathApiSnapshotCompare = '/api/snapshot/compare';
  static const String _pathApiSnapshotCompareAlt = 'api/snapshot/compare';
  static const String _pathApiComparePrefix = '/api/compare/';
  static const String _pathApiComparePrefixAlt = 'api/compare/';
  static const String _queryParamLimit = 'limit';
  static const String _queryParamOffset = 'offset';
  static const String _queryParamSince = 'since';
  static const String _queryParamFormat = 'format';
  static const String _formatDownload = 'download';
  static const String _jsonKeyError = 'error';
  static const String _jsonKeyRows = 'rows';
  static const String _jsonKeySql = 'sql';

  /// Validated POST /api/sql request body. Checks Content-Type then decodes and validates (require_content_type_validation, require_api_response_validation).
  ({_SqlRequestBody? body, String? error}) _parseSqlBody(
      HttpRequest request, String body) {
    if (request.headers.contentType?.mimeType != 'application/json') {
      return (body: null, error: 'Content-Type must be application/json');
    }
    Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on Object catch (error, stack) {
      _logError(error, stack);
      return (body: null, error: _errorInvalidJson);
    }
    final bodyObj = _SqlRequestBody.fromJson(decoded);
    if (bodyObj == null) {
      return (body: null, error: _errorMissingSql);
    }
    return (body: bodyObj, error: null);
  }
  static const String _jsonKeyCount = 'count';
  static const String _jsonKeyOk = 'ok';
  static const String _jsonKeyGeneration = 'generation';
  static const String _jsonKeySnapshot = 'snapshot';
  static const String _jsonKeyId = 'id';
  static const String _jsonKeyCreatedAt = 'createdAt';
  static const String _jsonKeyTableCount = 'tableCount';
  static const String _jsonKeyTables = 'tables';
  static const String _jsonKeyName = 'name';
  static const String _jsonKeyColumns = 'columns';
  static const String _jsonKeyTable = 'table';
  static const String _jsonKeyCountThen = 'countThen';
  static const String _jsonKeyCountNow = 'countNow';
  static const String _jsonKeyAdded = 'added';
  static const String _jsonKeyRemoved = 'removed';
  static const String _jsonKeyUnchanged = 'unchanged';
  static const String _jsonKeyCountA = 'countA';
  static const String _jsonKeyCountB = 'countB';
  static const String _jsonKeyDiff = 'diff';
  static const String _jsonKeyOnlyInA = 'onlyInA';
  static const String _jsonKeyOnlyInB = 'onlyInB';
  static const String _headerAuthorization = 'authorization';
  static const String _authSchemeBearer = 'Bearer ';
  static const String _authSchemeBasic = 'Basic ';
  static const String _headerContentDisposition = 'Content-Disposition';
  static const String _headerWwwAuthenticate = 'WWW-Authenticate';
  static const String _realmDriftDebug = 'Drift Debug Viewer';
  static const String _sqlSchemaMaster =
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
  static const String _authRequiredMessage =
      'Authentication required. Use Authorization header with Bearer scheme or HTTP Basic.';
  static const String _errorInvalidRequestBody = 'Invalid request body';
  static const String _errorInvalidJson = 'Invalid JSON';
  static const String _errorMissingSql = 'Missing or empty sql';
  static const String _errorReadOnlyOnly =
      'Only read-only SQL is allowed (SELECT or WITH ... SELECT). INSERT/UPDATE/DELETE and DDL are rejected.';
  static const String _errorUnknownTablePrefix = 'Unknown table: ';
  static const String _errorNoSnapshot =
      'No snapshot. POST /api/snapshot first to capture state.';
  static const String _errorDatabaseDownloadNotConfigured =
      'Database download not configured. Pass getDatabaseBytes to DriftDebugServer.start (e.g. () => File(dbPath).readAsBytes()).';
  static const String _errorCompareNotConfigured =
      'Database compare not configured. Pass queryCompare to DriftDebugServer.start.';
  static const String _pathApiCompareReport = '/api/compare/report';
  static const String _pathApiCompareReportAlt = 'api/compare/report';
  static const String _jsonKeyCountColumn = 'c';
  static const String _attachmentDatabaseSqlite =
      'attachment; filename="database.sqlite"';
  static const String _attachmentSnapshotDiff =
      'attachment; filename="snapshot-diff.json"';
  static const String _attachmentDiffReport =
      'attachment; filename="diff-report.json"';
  static const String _messageSnapshotCleared = 'Snapshot cleared.';
  static const String _sqlTableNames =
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
  // Banner (no_magic_string)
  static const String _bannerTop =
      '╔══════════════════════════════════════════════════════════════╗';
  static const String _bannerTitle =
      '║                   DRIFT DEBUG SERVER                         ║';
  static const String _bannerDivider =
      '╟──────────────────────────────────────────────────────────────╢';
  static const String _bannerOpen =
      '║  Open in browser to view SQLite/Drift data as JSON:           ║';
  static const String _bannerUrlPrefix = '║  http://127.0.0.1:';
  static const String _bannerBottom =
      '╚══════════════════════════════════════════════════════════════╝';
  static const String _jsonKeyCounts = 'counts';
  static const String _jsonKeyType = 'type';
  static const String _jsonKeyPk = 'pk';
  static const String _pragmaFrom = 'from';
  static const String _pragmaTo = 'to';
  static const String _fkFromTable = 'fromTable';
  static const String _fkFromColumn = 'fromColumn';
  static const String _fkToTable = 'toTable';
  static const String _fkToColumn = 'toColumn';
  static const String _jsonKeyForeignKeys = 'foreignKeys';
  static const String _jsonKeySnapshotId = 'snapshotId';
  static const String _jsonKeySnapshotCreatedAt = 'snapshotCreatedAt';
  static const String _jsonKeyComparedAt = 'comparedAt';
  static const String _jsonKeySchemaSame = 'schemaSame';
  static const String _jsonKeySchemaDiff = 'schemaDiff';
  static const String _jsonKeyTablesOnlyInA = 'tablesOnlyInA';
  static const String _jsonKeyTablesOnlyInB = 'tablesOnlyInB';
  static const String _jsonKeyTableCounts = 'tableCounts';
  static const String _jsonKeyGeneratedAt = 'generatedAt';
  static const String _jsonKeyA = 'a';
  static const String _jsonKeyB = 'b';
  static const int _indexAfterSemicolon = 1;
  static const int _minLimit = 1;

  /// Number of hex digits per byte in SQL X'...' literal (no_magic_number).
  static const int _hexBytePadding = 2;

  /// Radix for hex in SQL X'...' literal (no_magic_number).
  static const int _hexRadix = 16;
  static const String _attachmentSchemaSql = 'schema.sql';
  static const String _attachmentDumpSql = 'dump.sql';
  static const String _contentTypeApplicationOctetStream = 'application';
  static const String _contentTypeOctetStream = 'octet-stream';
  static const String _contentTypeTextPlain = 'text';
  static const String _charsetUtf8 = 'utf-8';

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
    int port = _defaultPort,
    bool loopbackOnly = false,
    String? corsOrigin = '*',
    String? authToken,
    String? basicAuthUser,
    String? basicAuthPassword,
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    DriftDebugQuery? queryCompare,
    DriftDebugOnLog? onLog,
    DriftDebugOnError? onError,
  }) async {
    if (!enabled) return;
    final existing = _server;
    if (existing != null) return;

    // Defensive: reject invalid port and partial Basic auth before binding.
    if (port < _minPort || port > _maxPort) {
      throw ArgumentError(
        'Port must be in range $_minPort..$_maxPort (0 = any port), got: $port',
      );
    }
    final hasBasicUser = basicAuthUser != null && basicAuthUser.isNotEmpty;
    final hasBasicPassword =
        basicAuthPassword != null && basicAuthPassword.isNotEmpty;
    if (hasBasicUser != hasBasicPassword) {
      throw ArgumentError(
          'Basic auth requires both basicAuthUser and basicAuthPassword to be set, or neither. Partial configuration is not allowed.');
    }

    _query = query;
    _queryCompare = queryCompare;
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

      _log(_bannerTop);
      _log(_bannerTitle);
      _log(_bannerDivider);
      _log(_bannerOpen);
      _log('$_bannerUrlPrefix$port');
      _log(_bannerBottom);
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
      final authHeader = request.headers.value(_headerAuthorization);
      if (authHeader != null &&
          authHeader.length > _authSchemeBearer.length &&
          authHeader.startsWith(_authSchemeBearer)) {
        final token = _safeSubstring(authHeader, _authSchemeBearer.length);
        if (token.isEmpty) return false;
        final incomingHash = sha256.convert(utf8.encode(token)).bytes;
        if (_secureCompareBytes(incomingHash, tokenHash)) return true;
      }
    }
    final user = _basicAuthUser;
    final password = _basicAuthPassword;
    if (user != null && user.isNotEmpty && password != null) {
      final authHeader = request.headers.value(_headerAuthorization);
      if (authHeader != null &&
          authHeader.length >= _authSchemeBasic.length &&
          authHeader.startsWith(_authSchemeBasic)) {
        try {
          final basicPayload =
              _safeSubstring(authHeader, _authSchemeBasic.length);
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
          .set(_headerWwwAuthenticate, 'Basic realm="$_realmDriftDebug"');
    }
    _setJsonHeaders(res);
    res.write(
        jsonEncode(<String, String>{_jsonKeyError: _authRequiredMessage}));
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
      if (req.method == _methodGet &&
          (path == _pathApiHealth || path == _pathApiHealthAlt)) {
        await _sendHealth(res);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiGeneration || path == _pathApiGenerationAlt)) {
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
      if (req.method == _methodGet && (path == '/' || path.isEmpty)) {
        await _sendHtml(res, req);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiTables || path == _pathApiTablesAlt)) {
        await _sendTableList(res, query);
        return;
      }
      if (req.method == _methodGet &&
          (path.startsWith(_pathApiTablePrefix) ||
              path.startsWith(_pathApiTablePrefixAlt))) {
        final String suffix = path.replaceFirst(RegExp(r'^/?api/table/'), '');
        if (suffix.endsWith(_pathSuffixCount)) {
          final String tableName = suffix.replaceFirst(RegExp(r'/count$'), '');
          await _sendTableCount(res, query, tableName);
          return;
        }
        if (suffix.endsWith(_pathSuffixColumns)) {
          final String tableName =
              suffix.replaceFirst(RegExp(r'/columns$'), '');
          await _sendTableColumns(res, query, tableName);
          return;
        }
        final String tableName = suffix;
        final int limit =
            _parseLimit(req.uri.queryParameters[_queryParamLimit]);
        final int offset =
            _parseOffset(req.uri.queryParameters[_queryParamOffset]);
        await _sendTableData(
            response: res,
            query: query,
            tableName: tableName,
            limit: limit,
            offset: offset);
        return;
      }
      if (req.method == _methodPost &&
          (path == _pathApiSql || path == _pathApiSqlAlt)) {
        await _handleRunSql(req, query);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiSchema || path == _pathApiSchemaAlt)) {
        await _sendSchemaDump(res, query);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiSchemaDiagram || path == _pathApiSchemaDiagramAlt)) {
        await _sendSchemaDiagram(res, query);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiDump || path == _pathApiDumpAlt)) {
        await _sendFullDump(res, query);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiDatabase || path == _pathApiDatabaseAlt)) {
        await _sendDatabaseFile(res);
        return;
      }
      if (req.method == _methodPost &&
          (path == _pathApiSnapshot || path == _pathApiSnapshotAlt)) {
        await _handleSnapshotCreate(res, query);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiSnapshot || path == _pathApiSnapshotAlt)) {
        await _handleSnapshotGet(res);
        return;
      }
      if (req.method == _methodGet &&
          (path == _pathApiSnapshotCompare ||
              path == _pathApiSnapshotCompareAlt)) {
        await _handleSnapshotCompare(res, req, query);
        return;
      }
      if (req.method == _methodDelete &&
          (path == _pathApiSnapshot || path == _pathApiSnapshotAlt)) {
        await _handleSnapshotDelete(res);
        return;
      }
      if (req.method == _methodGet &&
          (path.startsWith(_pathApiComparePrefix) ||
              path.startsWith(_pathApiComparePrefixAlt))) {
        await _handleCompareReport(res, req, query);
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
        firstSemicolon + _indexAfterSemicolon <= sqlNoStrings.length &&
        firstSemicolon < sqlNoStrings.length - _indexAfterSemicolon) {
      final after =
          _safeSubstring(sqlNoStrings, firstSemicolon + _indexAfterSemicolon)
              .trim();
      if (after.isNotEmpty) return false;
    }
    final withoutTrailingSemicolon = sqlNoStrings.endsWith(';')
        ? _safeSubstring(
                sqlNoStrings, 0, sqlNoStrings.length - _indexAfterSemicolon)
            .trim()
        : sqlNoStrings;
    final upper = withoutTrailingSemicolon.toUpperCase();
    const selectPrefix = 'SELECT ';
    const withPrefix = 'WITH ';
    if (!upper.startsWith(selectPrefix) && !upper.startsWith(withPrefix))
      return false;
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

  /// Handles POST /api/sql: body {"sql": "SELECT ..."}. Validates read-only via _isReadOnlySql; returns {"rows": [...]}.
  /// Content-Type is checked before parsing (require_content_type_validation); body shape validated before use (require_api_response_validation).
  Future<void> _handleRunSql(HttpRequest request, DriftDebugQuery query) async {
    final req = request;
    final res = req.response;
    String body;
    try {
      final builder = BytesBuilder();
      await for (final chunk in req) {
        builder.add(chunk);
      }
      body = utf8.decode(builder.toBytes());
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(
          <String, String>{_jsonKeyError: _errorInvalidRequestBody}));
      await res.close();
      return;
    }
    final result = _parseSqlBody(req, body);
    final bodyObj = result.body;
    if (bodyObj == null) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        _jsonKeyError: result.error ?? _errorInvalidJson,
      }));
      await res.close();
      return;
    }
    final String sql = bodyObj.sql;
    if (!_isReadOnlySql(sql)) {
      res.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        _jsonKeyError: _errorReadOnlyOnly,
      }));
      await res.close();
      return;
    }
    try {
      final dynamic raw = await query(sql);
      final List<Map<String, dynamic>> rows = _normalizeRows(raw);
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{_jsonKeyRows: rows}));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      _setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
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
    res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
    await res.close();
  }

  /// Parses limit query param; clamps to 1.._maxLimit; default _defaultLimit.
  int _parseLimit(String? value) {
    if (value == null) return _defaultLimit;
    final int? n = int.tryParse(value);
    if (n == null || n < _minLimit) return _defaultLimit;
    return n.clamp(_minLimit, _maxLimit);
  }

  /// Parses offset query param; returns 0 if missing or invalid; caps at [_maxOffset].
  int _parseOffset(String? value) {
    if (value == null) return 0;
    final int? n = int.tryParse(value);
    if (n == null || n < 0) return 0;
    return n > _maxOffset ? _maxOffset : n;
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
    if (firstRow == null || firstRow[_jsonKeyCountColumn] == null) return 0;
    final countValue = firstRow[_jsonKeyCountColumn];
    return countValue is int
        ? countValue
        : (countValue is num ? countValue.toInt() : 0);
  }

  /// Fetches table names from sqlite_master (type='table', exclude sqlite_*). Used as allow-list for table routes.
  /// Defensively handles query returning null or non-List / non-Map rows.
  Future<List<String>> _getTableNames(DriftDebugQuery query) async {
    final dynamic raw = await query(_sqlTableNames);
    final List<Map<String, dynamic>> rows = _normalizeRows(raw);
    return rows
        .map((row) => row[_jsonKeyName] as String? ?? '')
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
        _jsonKeyError: '$_errorUnknownTablePrefix$tableName',
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

  /// Returns JSON list of column names for GET /api/table/<name>/columns (for SQL autofill).
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
        .map((r) => r[_jsonKeyName] as String? ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    _setJsonHeaders(res);
    res.write(jsonEncode(columns));
    await res.close();
  }

  /// Returns JSON {"count": N} for GET /api/table/<name>/count.
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
    res.write(jsonEncode(<String, int>{_jsonKeyCount: count}));
    await res.close();
  }

  /// GET /api/table/<name>?limit=&offset= — returns JSON array of rows. Table name is allow-listed; limit/offset validated.
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
    final dynamic raw = await query(_sqlSchemaMaster);
    final List<Map<String, dynamic>> rows = _normalizeRows(raw);
    final buffer = StringBuffer();
    for (final row in rows) {
      final stmt = row[_jsonKeySql] as String?;
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
    res.write(jsonEncode(<String, dynamic>{_jsonKeyOk: true}));
    await res.close();
  }

  /// Handles GET /api/generation. Returns current [_generation]. Query parameter `since` triggers long-poll
  /// until generation > since or [_longPollTimeout]; reduces client polling when idle.
  /// Change detection runs on demand (here and in the long-poll loop) to satisfy avoid_work_in_paused_state.
  Future<void> _handleGeneration(HttpRequest request) async {
    final req = request;
    final res = req.response;
    await _checkDataChange();
    final sinceRaw = req.uri.queryParameters[_queryParamSince];
    final int? since = sinceRaw != null ? int.tryParse(sinceRaw) : null;
    if (since != null && since >= 0) {
      final deadline = DateTime.now().toUtc().add(_longPollTimeout);
      while (
          DateTime.now().toUtc().isBefore(deadline) && _generation <= since) {
        await Future<void>.delayed(_longPollCheckInterval);
        await _checkDataChange();
      }
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, int>{_jsonKeyGeneration: _generation}));
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
    _setAttachmentHeaders(res, _attachmentSchemaSql);
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
          _jsonKeyName: name is String? ? name ?? '' : '',
          _jsonKeyType: type is String? ? type ?? '' : '',
          _jsonKeyPk: pk is int ? pk != 0 : false,
        };
      }).toList();

      tables.add(<String, dynamic>{
        _jsonKeyName: tableName,
        _jsonKeyColumns: columns,
      });

      try {
        final dynamic rawFk =
            await query('PRAGMA foreign_key_list("$tableName")');
        final List<Map<String, dynamic>> fkRows = _normalizeRows(rawFk);
        for (final r in fkRows) {
          final toTable = r[_jsonKeyTable] as String?;
          final fromCol = r[_pragmaFrom] as String?;
          final toCol = r[_pragmaTo] as String?;
          if (toTable != null &&
              toTable.isNotEmpty &&
              fromCol != null &&
              toCol != null) {
            foreignKeys.add(<String, dynamic>{
              _fkFromTable: tableName,
              _fkFromColumn: fromCol,
              _fkToTable: toTable,
              _fkToColumn: toCol,
            });
          }
        }
      } on Object catch (error, stack) {
        _logError(error, stack);
      }
    }

    return <String, dynamic>{
      _jsonKeyTables: tables,
      _jsonKeyForeignKeys: foreignKeys,
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
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
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
      return "X'${value.map((b) => b.toRadixString(_hexRadix).padLeft(_hexBytePadding, '0')).join()}'";
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
    _setAttachmentHeaders(res, _attachmentDumpSql);
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
        _jsonKeyError: _errorDatabaseDownloadNotConfigured,
      }));
      await res.close();
      return;
    }
    try {
      final bytes = await getBytes();
      // Empty list is valid (e.g. in-memory DB); respond 200 with zero-length body.
      res.statusCode = HttpStatus.ok;
      res.headers.contentType = ContentType(
          _contentTypeApplicationOctetStream, _contentTypeOctetStream);
      res.headers.set(_headerContentDisposition, _attachmentDatabaseSqlite);
      _setCors(res);
      res.add(bytes);
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
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
        _jsonKeyId: created.id,
        _jsonKeyCreatedAt: created.createdAt.toUtc().toIso8601String(),
        _jsonKeyTableCount: created.tables.length,
        _jsonKeyTables: created.tables.keys.toList(),
      }));
    } on Object catch (error, stack) {
      _logError(error, stack);
      res.statusCode = HttpStatus.internalServerError;
      res.headers.contentType = ContentType.json;
      _setCors(res);
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
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
      res.write(jsonEncode(<String, dynamic>{_jsonKeySnapshot: null}));
      await res.close();
      return;
    }
    final tableCounts = <String, int>{};
    for (final e in snap.tables.entries) {
      tableCounts[e.key] = e.value.length;
    }
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      _jsonKeySnapshot: <String, dynamic>{
        _jsonKeyId: snap.id,
        _jsonKeyCreatedAt: snap.createdAt.toUtc().toIso8601String(),
        _jsonKeyTables: snap.tables.keys.toList(),
        _jsonKeyCounts: tableCounts,
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
        _jsonKeyError: _errorNoSnapshot,
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
          _jsonKeyTable: table,
          _jsonKeyCountThen: rowsThen.length,
          _jsonKeyCountNow: rowsNowList.length,
          _jsonKeyAdded: added,
          _jsonKeyRemoved: removed,
          _jsonKeyUnchanged: inBoth,
        });
      }
      final body = <String, dynamic>{
        _jsonKeySnapshotId: snap.id,
        _jsonKeySnapshotCreatedAt: snap.createdAt.toUtc().toIso8601String(),
        _jsonKeyComparedAt: DateTime.now().toUtc().toIso8601String(),
        _jsonKeyTables: tableDiffs,
      };
      if (req.uri.queryParameters[_queryParamFormat] == _formatDownload) {
        res.statusCode = HttpStatus.ok;
        res.headers.contentType = ContentType.json;
        res.headers.set(_headerContentDisposition, _attachmentSnapshotDiff);
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
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
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
        jsonEncode(<String, String>{_jsonKeyOk: _messageSnapshotCleared}));
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
        _jsonKeyError: _errorCompareNotConfigured,
      }));
      await res.close();
      return;
    }
    final path = req.uri.path;
    if (path != _pathApiCompareReport && path != _pathApiCompareReportAlt) {
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
        if (tablesA.contains(table))
          countA = _extractCountFromRows(results[idx++]);
        if (tablesB.contains(table))
          countB = _extractCountFromRows(results[idx++]);
        countDiffs.add(<String, dynamic>{
          _jsonKeyTable: table,
          _jsonKeyCountA: countA,
          _jsonKeyCountB: countB,
          _jsonKeyDiff: countA - countB,
          _jsonKeyOnlyInA: !tablesB.contains(table),
          _jsonKeyOnlyInB: !tablesA.contains(table),
        });
      }
      final report = <String, dynamic>{
        _jsonKeySchemaSame: schemaSame,
        _jsonKeySchemaDiff: schemaSame
            ? null
            : <String, String>{_jsonKeyA: schemaA, _jsonKeyB: schemaB},
        // JsonEncoder.convert expects List for array values; iterable is not sufficient.
        _jsonKeyTablesOnlyInA:
            tablesA.where((t) => !tablesB.contains(t)).toList(),
        // Same: JSON encoder requires List, not Iterable.
        _jsonKeyTablesOnlyInB:
            tablesB.where((t) => !tablesA.contains(t)).toList(),
        _jsonKeyTableCounts: countDiffs,
        _jsonKeyGeneratedAt: DateTime.now().toUtc().toIso8601String(),
      };
      final format = req.uri.queryParameters[_queryParamFormat];
      if (format == _formatDownload) {
        res.statusCode = HttpStatus.ok;
        res.headers.contentType = ContentType.json;
        res.headers.set(_headerContentDisposition, _attachmentDiffReport);
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
      res.write(jsonEncode(<String, String>{_jsonKeyError: error.toString()}));
    } finally {
      await res.close();
    }
  }

  void _setAttachmentHeaders(HttpResponse response, String filename) {
    final res = response;
    res.headers.contentType =
        ContentType(_contentTypeTextPlain, 'plain', charset: _charsetUtf8);
    res.headers
        .set(_headerContentDisposition, 'attachment; filename="$filename"');
    _setCors(res);
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
  </style>
</head>
<body>
  <h1>Drift tables <button type="button" id="theme-toggle" title="Toggle light/dark">Theme</button> <span id="live-indicator" class="meta" title="Table view updates when data changes">● Live</span></h1>
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
      <label for="sql-history">History:</label>
      <select id="sql-history" title="Recent queries — select to reuse"><option value="">— Recent —</option></select>
      <label for="sql-result-format">Show as:</label>
      <select id="sql-result-format"><option value="table">Table</option><option value="json">JSON</option></select>
    </div>
    <textarea id="sql-input" placeholder="SELECT * FROM my_table LIMIT 10"></textarea>
    <div id="sql-error" class="sql-error" style="display: none;"></div>
    <div id="sql-result" class="sql-result" style="display: none;"></div>
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
      const dataPre = document.getElementById('data-pre');
      if (schemaPre && lastRenderedSchema !== null && (scope === 'schema' || scope === 'both')) {
        schemaPre.innerHTML = term ? highlightText(lastRenderedSchema, term) : esc(lastRenderedSchema);
      }
      if (dataPre && lastRenderedData !== null && (scope === 'data' || scope === 'both')) {
        dataPre.innerHTML = term ? highlightText(lastRenderedData, term) : esc(lastRenderedData);
      }
      const singlePre = document.getElementById('content-pre');
      if (singlePre && (lastRenderedSchema !== null || lastRenderedData !== null)) {
        const raw = lastRenderedData !== null ? lastRenderedData : lastRenderedSchema;
        singlePre.innerHTML = term ? highlightText(raw, term) : esc(raw);
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
          dataSection.innerHTML = '<h2>Table data: ' + esc(currentTableName) + '</h2><p class="meta">' + metaText + '</p><pre id="data-pre">' + esc(jsonStr) + '</pre>';
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
          dataHtml = '<p class="meta">' + metaText + '</p><pre id="data-pre">' + esc(jsonStr) + '</pre>';
        } else {
          lastRenderedData = null;
          dataHtml = '<p class="meta">Select a table above to load data.</p>';
        }
        content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data</h2>' + dataHtml + '</div>';
        applySearch();
      }).catch(e => { content.innerHTML = '<p class="meta">Error</p><pre>' + esc(String(e)) + '</pre>'; });
    }

    function rowCountText(name) {
      const total = tableCounts[name];
      const len = (currentTableJson && currentTableJson.length) || 0;
      if (total == null) return esc(name) + ' (up to ' + limit + ' rows)';
      const rangeText = len > 0 ? ('showing ' + (offset + 1) + '–' + (offset + len)) : 'no rows in this range';
      return esc(name) + ' (' + total + ' row' + (total !== 1 ? 's' : '') + '; ' + rangeText + ')';
    }
    function renderTableView(name, data) {
      const content = document.getElementById('content');
      const scope = getScope();
      const filtered = filterRows(data);
      const jsonStr = JSON.stringify(filtered, null, 2);
      lastRenderedData = jsonStr;
      const metaText = rowCountText(name) + (getRowFilter() ? ' (filtered: ' + filtered.length + ' of ' + data.length + ')' : '');
      if (scope === 'both') {
        lastRenderedSchema = cachedSchema;
        if (cachedSchema === null) {
          fetch('/api/schema', authOpts()).then(r => r.text()).then(schema => {
            cachedSchema = schema;
            lastRenderedSchema = schema;
            content.innerHTML = '<div class="search-section"><h2>Schema</h2><pre id="schema-pre">' + esc(schema) + '</pre></div><div class="search-section" id="both-data-section"><h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p><pre id="data-pre">' + esc(jsonStr) + '</pre></div>';
            applySearch();
          });
        } else {
          const dataSection = document.getElementById('both-data-section');
          if (dataSection) {
            dataSection.innerHTML = '<h2>Table data: ' + esc(name) + '</h2><p class="meta">' + metaText + '</p><pre id="data-pre">' + esc(jsonStr) + '</pre>';
          }
          applySearch();
        }
      } else {
        lastRenderedSchema = null;
        content.innerHTML = '<p class="meta">' + metaText + '</p><pre id="content-pre">' + esc(jsonStr) + '</pre>';
        applySearch();
      }
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
    }

    (function initSqlRunner() {
      const toggle = document.getElementById('sql-runner-toggle');
      const collapsible = document.getElementById('sql-runner-collapsible');
      const templateSel = document.getElementById('sql-template');
      const tableSel = document.getElementById('sql-table');
      const fieldsSel = document.getElementById('sql-fields');
      const applyBtn = document.getElementById('sql-apply-template');
      const runBtn = document.getElementById('sql-run');
      const historySel = document.getElementById('sql-history');
      const formatSel = document.getElementById('sql-result-format');
      const inputEl = document.getElementById('sql-input');
      const errorEl = document.getElementById('sql-error');
      const resultEl = document.getElementById('sql-result');
      loadSqlHistory();
      refreshHistoryDropdown(historySel);
      if (historySel && inputEl) {
        historySel.addEventListener('change', function() {
          const v = this.value;
          if (v !== '') {
            const idx = parseInt(v, 10);
            if (idx >= 0 && sqlHistory[idx]) inputEl.value = sqlHistory[idx].sql;
          }
        });
      }

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

      if (runBtn && inputEl && errorEl && resultEl) {
        runBtn.addEventListener('click', function() {
          const sql = inputEl.value.trim();
          errorEl.style.display = 'none';
          resultEl.style.display = 'none';
          resultEl.innerHTML = '';
          if (!sql) {
            errorEl.textContent = 'Enter a SELECT query.';
            errorEl.style.display = 'block';
            return;
          }
          const runBtnOrigText = runBtn.textContent;
          runBtn.textContent = 'Running…';
          runBtn.disabled = true;
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
              pushSqlHistory(sql, rows.length);
              refreshHistoryDropdown(historySel);
            })
            .catch(e => {
              errorEl.textContent = e.message || String(e);
              errorEl.style.display = 'block';
            })
            .finally(() => {
              runBtn.disabled = false;
              runBtn.textContent = runBtnOrigText;
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
    DriftDebugGetDatabaseBytes? getDatabaseBytes,
    DriftDebugQuery? queryCompare,
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
        onLog: onLog,
        onError: onError,
      );

  /// The port the server is bound to, or null if not running.
  static int? get port => _instance.port;

  /// Stops the server and releases the port. No-op if not running.
  static Future<void> stop() => _instance.stop();
}
