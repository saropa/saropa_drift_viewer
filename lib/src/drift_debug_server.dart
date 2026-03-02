import 'dart:async';
import 'dart:convert';
import 'dart:io';

/// Callback that runs a single SQL query and returns rows as list of maps (column name → value).
///
/// Used by [DriftDebugServer.start] to list tables and fetch table data. Implement with
/// your Drift database's `customSelect` or any SQLite executor. The server only sends
/// allow-listed queries (e.g. table names from sqlite_master, SELECT with limit/offset).
typedef DriftDebugQuery = Future<List<Map<String, dynamic>>> Function(String sql);

/// Optional callback for log messages (e.g. startup banner).
/// Pass as the `onLog` parameter to [DriftDebugServer.start].
typedef DriftDebugOnLog = void Function(String message);

/// Optional callback for errors (and optional stack trace).
/// Pass as the `onError` parameter to [DriftDebugServer.start].
typedef DriftDebugOnError = void Function(Object error, StackTrace stack);

/// Optional callback that returns the raw SQLite database file bytes.
/// Pass as [getDatabaseBytes] to [DriftDebugServer.start] to enable "Download database"
/// in the UI (GET /api/database). Use e.g. `() => File(yourDbPath).readAsBytes()`.
typedef DriftDebugGetDatabaseBytes = Future<List<int>> Function();

/// In-memory snapshot of table state (for time-travel compare).
class _Snapshot {
  _Snapshot({required this.id, required this.createdAt, required this.tables});
  final String id;
  final DateTime createdAt;
  final Map<String, List<Map<String, dynamic>>> tables;
}

/// Debug-only HTTP server that exposes SQLite/Drift table data as JSON and a minimal web viewer.
///
/// Works with any database: pass a [query] callback that runs SQL and returns rows as maps.
/// Use [start] to bind the server (default port 8642); open http://127.0.0.1:8642 in a browser.
/// Only one server can run per process; use [stop] to shut down before calling [start] again.
/// Optional auth for secure dev tunnels (e.g. ngrok). When set, all requests
/// require either [authToken] (Bearer or query param `token`) or HTTP Basic
/// ([basicAuthUser] + [basicAuthPassword]). Use one or both.
abstract final class DriftDebugServer {
  static HttpServer? _server;
  static DriftDebugQuery? _query;
  static DriftDebugOnLog? _onLog;
  static DriftDebugOnError? _onError;
  static String? _corsOrigin;
  static String? _authToken;
  static String? _basicAuthUser;
  static String? _basicAuthPassword;
  static DriftDebugGetDatabaseBytes? _getDatabaseBytes;
  static DriftDebugQuery? _queryCompare;
  static Timer? _changeCheckTimer;
  static int _generation = 0;
  static String? _lastDataSignature;
  static bool _changeCheckInProgress = false;

  /// In-memory snapshot: id, createdAt, and full table data per table.
  static _Snapshot? _snapshot;

  static const int _defaultPort = 8642;
  static const int _maxLimit = 1000;
  static const int _defaultLimit = 200;
  static const Duration _changeCheckInterval = Duration(seconds: 2);
  static const Duration _longPollTimeout = Duration(seconds: 30);
  static const Duration _longPollCheckInterval = Duration(milliseconds: 300);

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
  /// * [authToken] — Optional. When set, requests must include `Authorization: Bearer <token>` or `?token=<token>`.
  /// * [basicAuthUser] and [basicAuthPassword] — Optional. When both set, HTTP Basic auth is accepted as an alternative.
  /// * [getDatabaseBytes] — Optional. When set, GET /api/database serves the raw SQLite file for download (e.g. open in DB Browser). Use e.g. `() => File(dbPath).readAsBytes()`.
  /// * [queryCompare] — Optional. When set, enables database diff: compare this DB (main [query]) with another (e.g. staging) via GET /api/compare/report. Same schema check and per-table row count diff; export diff report.
  /// * [onLog] — Optional callback for startup banner and log messages.
  /// * [onError] — Optional callback for errors (e.g. [DriftDebugErrorLogger.errorCallback]).
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
  /// ## Example (with [DriftDebugErrorLogger])
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
  static Future<void> start({
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
    if (_server != null) return;

    _query = query;
    _queryCompare = queryCompare;
    _onLog = onLog;
    _onError = onError;
    _corsOrigin = corsOrigin;
    // Only enable token auth when a non-empty token is provided.
    _authToken = (authToken != null && authToken.isNotEmpty) ? authToken : null;
    _basicAuthUser = basicAuthUser;
    _basicAuthPassword = basicAuthPassword;
    _getDatabaseBytes = getDatabaseBytes;

    try {
      final address = loopbackOnly ? InternetAddress.loopbackIPv4 : InternetAddress.anyIPv4;
      _server = await HttpServer.bind(address, port);
      _server!.listen(_onRequest);
      _startChangeCheckTimer();

      _log('╔══════════════════════════════════════════════════════════════╗');
      _log('║                   DRIFT DEBUG SERVER                         ║');
      _log('╟──────────────────────────────────────────────────────────────╢');
      _log('║  Open in browser to view SQLite/Drift data as JSON:           ║');
      _log('║  http://127.0.0.1:$port');
      _log('╚══════════════════════════════════════════════════════════════╝');
    } on Object catch (error, stack) {
      _onError?.call(error, stack);
    }
  }

  /// The port the server is bound to, or null if not running. Exposed for tests.
  static int? get port => _server?.port;

  /// Stops the server if running and clears stored state so [start] can be called again.
  /// No-op if the server was not started.
  static Future<void> stop() async {
    final server = _server;
    if (server == null) return;
    _server = null;
    _query = null;
    _queryCompare = null;
    _snapshot = null;
    _onLog = null;
    _onError = null;
    _corsOrigin = null;
    _authToken = null;
    _basicAuthUser = null;
    _basicAuthPassword = null;
    _getDatabaseBytes = null;
    _changeCheckTimer?.cancel();
    _changeCheckTimer = null;
    _lastDataSignature = null;
    _generation = 0;
    _changeCheckInProgress = false;
    await server.close();
  }

  static void _log(String message) {
    _onLog?.call(message);
  }

  static void _logError(Object error, StackTrace stack) {
    _onError?.call(error, stack);
  }

  /// Constant-time string comparison to reduce timing side channels.
  static bool _secureCompare(String a, String b) {
    if (a.length != b.length) return false;
    int result = 0;
    for (int i = 0; i < a.length; i++) {
      result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return result == 0;
  }

  /// Returns true if the request has valid token (Bearer or ?token=) or HTTP Basic credentials.
  static bool _isAuthenticated(HttpRequest request) {
    final token = _authToken;
    if (token != null && token.isNotEmpty) {
      final authHeader = request.headers.value('authorization');
      if (authHeader != null &&
          authHeader.startsWith('Bearer ') &&
          _secureCompare(authHeader.substring(7), token)) {
        return true;
      }
      final queryToken = request.uri.queryParameters['token'];
      if (queryToken != null && _secureCompare(queryToken, token)) {
        return true;
      }
    }
    final user = _basicAuthUser;
    final password = _basicAuthPassword;
    if (user != null && user.isNotEmpty && password != null) {
      final authHeader = request.headers.value('authorization');
      if (authHeader != null && authHeader.startsWith('Basic ')) {
        try {
          final decoded = utf8.decode(base64.decode(authHeader.substring(6)));
          final colon = decoded.indexOf(':');
          if (colon >= 0) {
            final u = decoded.substring(0, colon);
            final p = decoded.substring(colon + 1);
            if (_secureCompare(u, user) && _secureCompare(p, password)) {
              return true;
            }
          }
        } on Object {
          // ignore decode errors
        }
      }
    }
    return false;
  }

  /// Sends 401 with JSON body; sets WWW-Authenticate for Basic when Basic auth is configured.
  static Future<void> _sendUnauthorized(HttpResponse response) async {
    response.statusCode = HttpStatus.unauthorized;
    if (_basicAuthUser != null && _basicAuthPassword != null) {
      response.headers.set('WWW-Authenticate', 'Basic realm="Drift Debug Viewer"');
    }
    _setJsonHeaders(response);
    response.write(jsonEncode(<String, String>{
      'error': 'Authentication required. Use Authorization: Bearer <token>, ?token=<token>, or HTTP Basic.',
    }));
    await response.close();
  }

  static Future<void> _onRequest(HttpRequest request) async {
    final String path = request.uri.path;

    // When auth is configured, require it on every request (including health and HTML).
    if (_authToken != null || (_basicAuthUser != null && _basicAuthPassword != null)) {
      if (!_isAuthenticated(request)) {
        await _sendUnauthorized(request.response);
        return;
      }
    }

    // Health and generation are handled before query check so probes / live-refresh work.
    try {
      if (request.method == 'GET' && (path == '/api/health' || path == 'api/health')) {
        await _sendHealth(request.response);
        return;
      }
      if (request.method == 'GET' && (path == '/api/generation' || path == 'api/generation')) {
        await _handleGeneration(request);
        return;
      }
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(request.response, error);
      return;
    }

    final DriftDebugQuery? query = _query;
    if (query == null) {
      request.response.statusCode = HttpStatus.serviceUnavailable;
      await request.response.close();
      return;
    }

    try {
      if (request.method == 'GET' && (path == '/' || path.isEmpty)) {
        await _sendHtml(request.response, request);
        return;
      }
      if (request.method == 'GET' && (path == '/api/tables' || path == 'api/tables')) {
        await _sendTableList(request.response, query);
        return;
      }
      if (request.method == 'GET' &&
          (path.startsWith('/api/table/') || path.startsWith('api/table/'))) {
        final String suffix =
            path.replaceFirst(RegExp(r'^/?api/table/'), '');
        // GET /api/table/<name>/count returns {"count": N}; limit/offset via query params for table data.
        if (suffix.endsWith('/count')) {
          final String tableName = suffix.replaceFirst(RegExp(r'/count$'), '');
          await _sendTableCount(request.response, query, tableName);
          return;
        }
        // GET /api/table/<name>/columns returns list of column names for autofill.
        if (suffix.endsWith('/columns')) {
          final String tableName = suffix.replaceFirst(RegExp(r'/columns$'), '');
          await _sendTableColumns(request.response, query, tableName);
          return;
        }
        final String tableName = suffix;
        final int limit = _parseLimit(request.uri.queryParameters['limit']);
        final int offset = _parseOffset(request.uri.queryParameters['offset']);
        await _sendTableData(request.response, query, tableName, limit, offset);
        return;
      }
      if (request.method == 'POST' && (path == '/api/sql' || path == 'api/sql')) {
        await _handleRunSql(request, query);
        return;
      }
      if (request.method == 'GET' && (path == '/api/schema' || path == 'api/schema')) {
        await _sendSchemaDump(request.response, query);
        return;
      }
      if (request.method == 'GET' && (path == '/api/dump' || path == 'api/dump')) {
        await _sendFullDump(request.response, query);
        return;
      }
      if (request.method == 'GET' && (path == '/api/database' || path == 'api/database')) {
        await _sendDatabaseFile(request.response);
        return;
      }
      if (request.method == 'POST' && (path == '/api/snapshot' || path == 'api/snapshot')) {
        await _handleSnapshotCreate(request.response, query);
        return;
      }
      if (request.method == 'GET' && (path == '/api/snapshot' || path == 'api/snapshot')) {
        await _handleSnapshotGet(request.response);
        return;
      }
      if (request.method == 'GET' &&
          (path == '/api/snapshot/compare' || path == 'api/snapshot/compare')) {
        await _handleSnapshotCompare(request.response, request, query);
        return;
      }
      if (request.method == 'DELETE' && (path == '/api/snapshot' || path == 'api/snapshot')) {
        await _handleSnapshotDelete(request.response);
        return;
      }
      if (request.method == 'GET' &&
          (path.startsWith('/api/compare/') || path.startsWith('api/compare/'))) {
        await _handleCompareReport(request.response, request, query);
        return;
      }

      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(request.response, error);
    }
  }

  /// Validates that [sql] is read-only: single statement, SELECT or WITH...SELECT only.
  /// Rejects INSERT/UPDATE/DELETE and DDL (CREATE/ALTER/DROP etc.).
  static bool _isReadOnlySql(String sql) {
    String s = sql.trim();
    if (s.isEmpty) return false;
    // Remove single-line and block comments so keywords inside comments are ignored.
    s = s.replaceAll(RegExp(r'--[^\n]*'), ' ');
    s = s.replaceAll(RegExp(r'/\*[\s\S]*?\*/'), ' ');
    // Replace string literals with placeholders so keywords inside strings don't trigger.
    // SQLite escapes single quote as ''; double-quoted identifiers allow "".
    s = s.replaceAllMapped(RegExp(r"'(?:[^']|'')*'"), (_) => '?');
    s = s.replaceAllMapped(RegExp(r'"(?:[^"]|"")*"'), (_) => '?');
    s = s.trim();
    // Only one statement (no semicolon in the middle; trailing semicolon allowed).
    final firstSemicolon = s.indexOf(';');
    if (firstSemicolon >= 0 && firstSemicolon < s.length - 1) {
      final after = s.substring(firstSemicolon + 1).trim();
      if (after.isNotEmpty) return false;
    }
    if (s.endsWith(';')) s = s.substring(0, s.length - 1).trim();
    final upper = s.toUpperCase();
    if (!upper.startsWith('SELECT ') && !upper.startsWith('WITH ')) return false;
    // Forbidden keywords (word boundary to avoid false positives in identifiers).
    const forbidden = [
      'INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'TRUNCATE',
      'CREATE', 'ALTER', 'DROP', 'ATTACH', 'DETACH',
      'PRAGMA', 'VACUUM', 'ANALYZE', 'REINDEX',
    ];
    final words = RegExp(r'\b\w+\b');
    for (final match in words.allMatches(upper)) {
      if (forbidden.contains(match.group(0))) return false;
    }
    return true;
  }

  /// Handles POST /api/sql: body {"sql": "SELECT ..."}, runs read-only SQL, returns rows.
  static Future<void> _handleRunSql(HttpRequest request, DriftDebugQuery query) async {
    final HttpResponse response = request.response;
    String body;
    try {
      // Read body once; request stream is single-use.
      final bytes = <int>[];
      await for (final chunk in request) {
        bytes.addAll(chunk);
      }
      body = utf8.decode(bytes);
    } on Object catch (e, st) {
      _logError(e, st);
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{'error': 'Invalid request body'}));
      await response.close();
      return;
    }
    final Map<String, dynamic>? map;
    try {
      map = jsonDecode(body) as Map<String, dynamic>?;
    } on Object catch (e, st) {
      _logError(e, st);
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{'error': 'Invalid JSON'}));
      await response.close();
      return;
    }
    final String sql = (map?['sql'] as String?)?.trim() ?? '';
    if (sql.isEmpty) {
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{'error': 'Missing or empty sql'}));
      await response.close();
      return;
    }
    if (!_isReadOnlySql(sql)) {
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{
        'error': 'Only read-only SQL is allowed (SELECT or WITH ... SELECT). '
            'INSERT/UPDATE/DELETE and DDL are rejected.',
      }));
      await response.close();
      return;
    }
    try {
      final List<Map<String, dynamic>> rows = await query(sql);
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, dynamic>{'rows': rows}));
      await response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      response.statusCode = HttpStatus.internalServerError;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{'error': error.toString()}));
      await response.close();
    }
  }

  /// Sends a 500 JSON error response and closes the response.
  static Future<void> _sendErrorResponse(HttpResponse response, Object error) async {
    response.statusCode = HttpStatus.internalServerError;
    response.headers.contentType = ContentType.json;
    _setCors(response);
    response.write(jsonEncode(<String, String>{'error': error.toString()}));
    await response.close();
  }

  static int _parseLimit(String? value) {
    if (value == null) return _defaultLimit;
    final int? n = int.tryParse(value);
    if (n == null || n < 1) return _defaultLimit;
    return n.clamp(1, _maxLimit);
  }

  /// Parses offset query param; returns 0 if missing or invalid.
  static int _parseOffset(String? value) {
    if (value == null) return 0;
    final int? n = int.tryParse(value);
    if (n == null || n < 0) return 0;
    return n;
  }

  /// Extracts COUNT(*) result from a single-row query (column 'c'). Returns 0 if empty or null.
  static int _extractCountFromRows(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty || rows.first['c'] == null) return 0;
    final v = rows.first['c'];
    return v is int ? v : (v as num).toInt();
  }

  static Future<List<String>> _getTableNames(DriftDebugQuery query) async {
    const String sql =
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name";
    final List<Map<String, dynamic>> rows = await query(sql);
    return rows.map((r) => r['name'] as String? ?? '').where((s) => s.isNotEmpty).toList();
  }

  /// If [tableName] is not in the allow-list, sends 400 and returns false; otherwise returns true.
  static Future<bool> _requireKnownTable(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    final List<String> allowed = await _getTableNames(query);
    if (!allowed.contains(tableName)) {
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{'error': 'Unknown table: $tableName'}));
      await response.close();
      return false;
    }
    return true;
  }

  static Future<void> _sendTableList(HttpResponse response, DriftDebugQuery query) async {
    final List<String> names = await _getTableNames(query);
    _setJsonHeaders(response);
    response.write(jsonEncode(names));
    await response.close();
  }

  /// Returns JSON list of column names for GET /api/table/<name>/columns (for SQL autofill).
  static Future<void> _sendTableColumns(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    if (!await _requireKnownTable(response, query, tableName)) return;
    // PRAGMA table_info returns cid, name, type, notnull, dflt_value, pk.
    final List<Map<String, dynamic>> rows =
        await query('PRAGMA table_info("$tableName")');
    final List<String> columns = rows
        .map((r) => r['name'] as String? ?? '')
        .where((s) => s.isNotEmpty)
        .toList();
    _setJsonHeaders(response);
    response.write(jsonEncode(columns));
    await response.close();
  }

  /// Returns JSON {"count": N} for GET /api/table/<name>/count.
  static Future<void> _sendTableCount(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
  ) async {
    if (!await _requireKnownTable(response, query, tableName)) return;
    final List<Map<String, dynamic>> rows =
        await query('SELECT COUNT(*) AS c FROM "$tableName"');
    final int count = _extractCountFromRows(rows);
    _setJsonHeaders(response);
    response.write(jsonEncode(<String, int>{'count': count}));
    await response.close();
  }

  static Future<void> _sendTableData(
    HttpResponse response,
    DriftDebugQuery query,
    String tableName,
    int limit,
    int offset,
  ) async {
    if (!await _requireKnownTable(response, query, tableName)) return;
    // Table name from allow-list; limit/offset validated.
    final List<Map<String, dynamic>> data =
        await query('SELECT * FROM "$tableName" LIMIT $limit OFFSET $offset');
    _setJsonHeaders(response);
    response.write(const JsonEncoder.withIndent('  ').convert(data));
    await response.close();
  }

  /// Fetches schema (CREATE statements) from sqlite_master, no data.
  static Future<String> _getSchemaSql(DriftDebugQuery query) async {
    const String sql = "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name";
    final List<Map<String, dynamic>> rows = await query(sql);
    final buffer = StringBuffer();
    for (final row in rows) {
      final stmt = row['sql'] as String?;
      if (stmt != null && stmt.isNotEmpty) {
        buffer.writeln(stmt);
        if (!stmt.trimRight().endsWith(';')) buffer.write(';');
        buffer.writeln();
      }
    }
    return buffer.toString();
  }

  static Future<void> _sendHealth(HttpResponse response) async {
    _setJsonHeaders(response);
    response.write(jsonEncode(<String, dynamic>{'ok': true}));
    await response.close();
  }

  /// Handles GET /api/generation. Returns current [_generation]. Query param [since] triggers long-poll
  /// until generation > since or [_longPollTimeout]; reduces client polling when idle.
  static Future<void> _handleGeneration(HttpRequest request) async {
    final sinceRaw = request.uri.queryParameters['since'];
    final int? since = sinceRaw != null ? int.tryParse(sinceRaw) : null;
    if (since != null && since >= 0) {
      final deadline = DateTime.now().add(_longPollTimeout);
      while (DateTime.now().isBefore(deadline) && _generation <= since) {
        await Future<void>.delayed(_longPollCheckInterval);
      }
    }
    _setJsonHeaders(request.response);
    request.response.write(jsonEncode(<String, int>{'generation': _generation}));
    await request.response.close();
  }

  static void _startChangeCheckTimer() {
    _changeCheckTimer?.cancel();
    _changeCheckTimer = Timer.periodic(_changeCheckInterval, (_) => _checkDataChange());
  }

  /// Runs a lightweight fingerprint of table row counts; bumps [_generation] when it changes.
  /// One COUNT(*) per table per run — acceptable for typical debug DBs; many tables may add latency.
  static Future<void> _checkDataChange() async {
    if (_changeCheckInProgress) return;
    final query = _query;
    if (query == null) return;
    _changeCheckInProgress = true;
    try {
      final tables = await _getTableNames(query);
      final parts = <String>[];
      for (final t in tables) {
        final rows = await query('SELECT COUNT(*) AS c FROM "$t"');
        parts.add('$t:${_extractCountFromRows(rows)}');
      }
      final signature = parts.join(',');
      if (_lastDataSignature != null && _lastDataSignature != signature) {
        _generation++;
      }
      _lastDataSignature = signature;
    } on Object catch (_) {
      // Ignore errors (e.g. DB busy); will retry next interval.
    } finally {
      _changeCheckInProgress = false;
    }
  }

  /// Sends schema-only SQL dump (CREATE statements from sqlite_master, no data).
  static Future<void> _sendSchemaDump(HttpResponse response, DriftDebugQuery query) async {
    final String schema = await _getSchemaSql(query);
    response.statusCode = HttpStatus.ok;
    _setAttachmentHeaders(response, 'schema.sql');
    response.write(schema);
    await response.close();
  }

  /// Escapes a value for use in a SQL INSERT literal (no quotes for numbers/null).
  static String _sqlLiteral(Object? value) {
    if (value == null) return 'NULL';
    if (value is num) return value.toString();
    if (value is bool) return value ? '1' : '0';
    if (value is String) {
      return "'${value.replaceAll(r'\', r'\\').replaceAll("'", "''")}'";
    }
    if (value is List<int>) {
      return "X'${value.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}'";
    }
    return "'${value.toString().replaceAll(r'\', r'\\').replaceAll("'", "''")}'";
  }

  /// Builds full dump SQL: schema (CREATEs) plus INSERT statements for every table row.
  /// Table names come from allow-list so interpolation is safe.
  static Future<String> _getFullDumpSql(DriftDebugQuery query) async {
    final buffer = StringBuffer();
    buffer.writeln(await _getSchemaSql(query));
    buffer.writeln('-- Data dump');
    final tables = await _getTableNames(query);
    for (final table in tables) {
      final rows = await query('SELECT * FROM "$table"');
      if (rows.isEmpty) continue;
      final keys = rows.first.keys.toList();
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
  static Future<void> _sendFullDump(HttpResponse response, DriftDebugQuery query) async {
    final String dump = await _getFullDumpSql(query);
    response.statusCode = HttpStatus.ok;
    _setAttachmentHeaders(response, 'dump.sql');
    response.write(dump);
    await response.close();
  }

  /// Sends the raw SQLite database file when [getDatabaseBytes] was provided at startup.
  /// Returns 501 Not Implemented if not configured. Used by the UI "Download database (raw .sqlite)" link.
  static Future<void> _sendDatabaseFile(HttpResponse response) async {
    final getBytes = _getDatabaseBytes;
    if (getBytes == null) {
      response.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{
        'error': 'Database download not configured. Pass getDatabaseBytes to DriftDebugServer.start (e.g. () => File(dbPath).readAsBytes()).',
      }));
      await response.close();
      return;
    }
    try {
      final bytes = await getBytes();
      response.statusCode = HttpStatus.ok;
      response.headers.contentType = ContentType('application', 'octet-stream');
      response.headers.set('Content-Disposition', 'attachment; filename="database.sqlite"');
      _setCors(response);
      response.add(bytes);
      await response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(response, error);
    }
  }

  /// Stable string representation of a row for diffing (sorted keys). Used by snapshot compare.
  static String _rowSignature(Map<String, dynamic> row) {
    final keys = row.keys.toList()..sort();
    final sorted = <String, dynamic>{};
    for (final k in keys) {
      sorted[k] = row[k];
    }
    return jsonEncode(sorted);
  }

  /// Handles POST /api/snapshot: captures full table data for all tables into in-memory [_snapshot].
  static Future<void> _handleSnapshotCreate(
    HttpResponse response,
    DriftDebugQuery query,
  ) async {
    try {
      final tables = await _getTableNames(query);
      final Map<String, List<Map<String, dynamic>>> data = {};
      for (final table in tables) {
        final rows = await query('SELECT * FROM "$table"');
        data[table] = rows.map((r) => Map<String, dynamic>.from(r)).toList();
      }
      final id = DateTime.now().toUtc().toIso8601String();
      _snapshot = _Snapshot(id: id, createdAt: DateTime.now().toUtc(), tables: data);
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, dynamic>{
        'id': _snapshot!.id,
        'createdAt': _snapshot!.createdAt.toIso8601String(),
        'tableCount': _snapshot!.tables.length,
        'tables': _snapshot!.tables.keys.toList(),
      }));
      await response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(response, error);
    }
  }

  /// Handles GET /api/snapshot: returns snapshot metadata (id, createdAt, table counts) or null.
  static Future<void> _handleSnapshotGet(HttpResponse response) async {
    final snap = _snapshot;
    if (snap == null) {
      response.statusCode = HttpStatus.ok;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, dynamic>{'snapshot': null}));
      await response.close();
      return;
    }
    final tableCounts = <String, int>{};
    for (final e in snap.tables.entries) {
      tableCounts[e.key] = e.value.length;
    }
    _setJsonHeaders(response);
    response.write(jsonEncode(<String, dynamic>{
      'snapshot': <String, dynamic>{
        'id': snap.id,
        'createdAt': snap.createdAt.toIso8601String(),
        'tables': snap.tables.keys.toList(),
        'counts': tableCounts,
      },
    }));
    await response.close();
  }

  /// Handles GET /api/snapshot/compare: diffs current DB vs [_snapshot] (per-table added/removed/unchanged). Optional ?format=download.
  static Future<void> _handleSnapshotCompare(
    HttpResponse response,
    HttpRequest request,
    DriftDebugQuery query,
  ) async {
    final snap = _snapshot;
    if (snap == null) {
      response.statusCode = HttpStatus.badRequest;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{
        'error': 'No snapshot. POST /api/snapshot first to capture state.',
      }));
      await response.close();
      return;
    }
    try {
      final tablesNow = await _getTableNames(query);
      final allTables = <String>{...snap.tables.keys, ...tablesNow};
      final List<Map<String, dynamic>> tableDiffs = [];
      for (final table in allTables.toList()..sort()) {
        final rowsThen = snap.tables[table] ?? [];
        List<Map<String, dynamic>> rowsNowList = [];
        if (tablesNow.contains(table)) {
          rowsNowList = await query('SELECT * FROM "$table"');
        }
        final setThen = rowsThen.map(_rowSignature).toSet();
        final setNow = rowsNowList.map(_rowSignature).toSet();
        final added = setNow.difference(setThen).length;
        final removed = setThen.difference(setNow).length;
        final inBoth = setThen.intersection(setNow).length;
        tableDiffs.add(<String, dynamic>{
          'table': table,
          'countThen': rowsThen.length,
          'countNow': rowsNowList.length,
          'added': added,
          'removed': removed,
          'unchanged': inBoth,
        });
      }
      final body = <String, dynamic>{
        'snapshotId': snap.id,
        'snapshotCreatedAt': snap.createdAt.toIso8601String(),
        'comparedAt': DateTime.now().toUtc().toIso8601String(),
        'tables': tableDiffs,
      };
      if (request.uri.queryParameters['format'] == 'download') {
        response.statusCode = HttpStatus.ok;
        response.headers.contentType = ContentType.json;
        response.headers.set(
          'Content-Disposition',
          'attachment; filename="snapshot-diff.json"',
        );
        _setCors(response);
        response.write(const JsonEncoder.withIndent('  ').convert(body));
        await response.close();
        return;
      }
      _setJsonHeaders(response);
      response.write(const JsonEncoder.withIndent('  ').convert(body));
      await response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(response, error);
    }
  }

  /// Handles DELETE /api/snapshot: clears the in-memory snapshot.
  static Future<void> _handleSnapshotDelete(HttpResponse response) async {
    _snapshot = null;
    _setJsonHeaders(response);
    response.write(jsonEncode(<String, String>{'ok': 'Snapshot cleared.'}));
    await response.close();
  }

  /// Handles GET /api/compare/report: schema and per-table row count diff between main [query] and [_queryCompare]. Optional ?format=download.
  static Future<void> _handleCompareReport(
    HttpResponse response,
    HttpRequest request,
    DriftDebugQuery query,
  ) async {
    final queryB = _queryCompare;
    if (queryB == null) {
      response.statusCode = HttpStatus.notImplemented;
      _setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{
        'error': 'Database compare not configured. Pass queryCompare to DriftDebugServer.start.',
      }));
      await response.close();
      return;
    }
    final path = request.uri.path;
    if (path != '/api/compare/report' && path != 'api/compare/report') {
      response.statusCode = HttpStatus.notFound;
      await response.close();
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
        if (tablesA.contains(table)) countA = _extractCountFromRows(results[idx++]);
        if (tablesB.contains(table)) countB = _extractCountFromRows(results[idx++]);
        countDiffs.add(<String, dynamic>{
          'table': table,
          'countA': countA,
          'countB': countB,
          'diff': countA - countB,
          'onlyInA': !tablesB.contains(table),
          'onlyInB': !tablesA.contains(table),
        });
      }
      final report = <String, dynamic>{
        'schemaSame': schemaSame,
        'schemaDiff': schemaSame ? null : <String, String>{'a': schemaA, 'b': schemaB},
        'tablesOnlyInA': tablesA.where((t) => !tablesB.contains(t)).toList(),
        'tablesOnlyInB': tablesB.where((t) => !tablesA.contains(t)).toList(),
        'tableCounts': countDiffs,
        'generatedAt': DateTime.now().toUtc().toIso8601String(),
      };
      final format = request.uri.queryParameters['format'];
      if (format == 'download') {
        response.statusCode = HttpStatus.ok;
        response.headers.contentType = ContentType.json;
        response.headers.set(
          'Content-Disposition',
          'attachment; filename="diff-report.json"',
        );
        _setCors(response);
        response.write(const JsonEncoder.withIndent('  ').convert(report));
        await response.close();
        return;
      }
      _setJsonHeaders(response);
      response.write(const JsonEncoder.withIndent('  ').convert(report));
      await response.close();
    } on Object catch (error, stack) {
      _logError(error, stack);
      await _sendErrorResponse(response, error);
    }
  }

  static void _setAttachmentHeaders(HttpResponse response, String filename) {
    response.headers.contentType = ContentType('text', 'plain', charset: 'utf-8');
    response.headers.set('Content-Disposition', 'attachment; filename="$filename"');
    _setCors(response);
  }

  static void _setCors(HttpResponse response) {
    final origin = _corsOrigin;
    if (origin != null) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
  }

  static void _setJsonHeaders(HttpResponse response) {
    response.headers.contentType = ContentType.json;
    _setCors(response);
  }

  static Future<void> _sendHtml(HttpResponse response, HttpRequest request) async {
    String html = _indexHtml;
    // Inject auth token into page so client-side fetch() can send Bearer header on all API calls.
    final authToken = _authToken;
    final tokenToInject = (authToken != null && authToken.isNotEmpty)
        ? _escapeJsString(authToken)
        : '';
    html = html.replaceFirst('__DRIFT_AUTH_TOKEN__', tokenToInject);
    response.headers.contentType = ContentType.html;
    response.write(html);
    await response.close();
  }

  /// Escapes a string for safe use inside a JavaScript string literal (quoted).
  static String _escapeJsString(String s) {
    return s
        .replaceAll(r'\', r'\\')
        .replaceAll('"', r'\"')
        .replaceAll('\n', r'\n')
        .replaceAll('\r', r'\r');
  }

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
  <ul id="tables"></ul>
  <div id="content" class="content-wrap"></div>
  <script>
    var DRIFT_VIEWER_AUTH_TOKEN = "__DRIFT_AUTH_TOKEN__";
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
      if (schemaLink) schemaLink.href = '/api/schema?token=' + encodeURIComponent(DRIFT_VIEWER_AUTH_TOKEN);
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
          exportLink.href = '/api/snapshot/compare?format=download&token=' + encodeURIComponent(DRIFT_VIEWER_AUTH_TOKEN);
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
        exportLink.href = '/api/compare/report?format=download&token=' + encodeURIComponent(DRIFT_VIEWER_AUTH_TOKEN);
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
      const formatSel = document.getElementById('sql-result-format');
      const inputEl = document.getElementById('sql-input');
      const errorEl = document.getElementById('sql-error');
      const resultEl = document.getElementById('sql-result');

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
