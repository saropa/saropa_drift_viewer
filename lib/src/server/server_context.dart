// Shared state + utility methods extracted from
// _DriftDebugServerImpl to reduce file size.
// See drift_debug_server_io.dart for usage.

import 'dart:convert';
import 'dart:developer' as developer;
import 'dart:io';


import 'server_constants.dart';
import 'server_types.dart';

// --- Typedefs (mirrored to avoid circular imports) ---

/// Callback that runs a single SQL query and returns
/// rows as list of maps.
typedef DriftDebugQuery = Future<List<Map<String, dynamic>>> Function(
  String sql,
);

/// Optional callback for log messages.
typedef DriftDebugOnLog = void Function(String message);

/// Optional callback for errors (and optional stack
/// trace).
typedef DriftDebugOnError = void Function(
  Object error,
  StackTrace stack,
);

/// Optional callback that returns the raw SQLite
/// database file bytes.
typedef DriftDebugGetDatabaseBytes = Future<List<int>> Function();

/// Optional callback for write queries
/// (INSERT/UPDATE/DELETE).
typedef DriftDebugWriteQuery = Future<void> Function(String sql);

/// Shared state and utility methods for the Drift
/// Debug Server.
///
/// Holds query callbacks, auth state, CORS config,
/// snapshot, generation tracking, and query timing
/// buffer. Methods that don't depend on instance state
/// are [static].
final class ServerContext {
  /// Creates a new [ServerContext] with the given
  /// query callback and optional configuration.
  ///
  /// The [query] callback is wrapped with timing
  /// instrumentation so all queries are recorded.
  ServerContext({
    required DriftDebugQuery query,
    this.corsOrigin,
    this.onLog,
    this.onError,
    this.authTokenHash,
    this.basicAuthUser,
    this.basicAuthPassword,
    this.getDatabaseBytes,
    this.queryCompare,
    this.writeQuery,
  }) : queryRaw = query;

  /// The raw (unwrapped) query callback, before timing
  /// instrumentation.
  final DriftDebugQuery queryRaw;

  /// Instrumented query callback that wraps [queryRaw]
  /// with timing. Each call records duration, row count,
  /// and errors in [queryTimings].
  ///
  /// Returns the query result rows from [queryRaw]
  /// after recording timing information.
  Future<List<Map<String, dynamic>>> instrumentedQuery(
    String sql,
  ) =>
      timedQuery(queryRaw, sql);

  /// Value for Access-Control-Allow-Origin header; null
  /// omits the header.
  final String? corsOrigin;

  /// Optional log callback (startup banner, info
  /// messages).
  final DriftDebugOnLog? onLog;

  /// Optional error callback.
  final DriftDebugOnError? onError;

  /// SHA256 hash of auth token (stored instead of plain
  /// token for require_data_encryption).
  final List<int>? authTokenHash;

  /// HTTP Basic auth user (dev-tunnel use only).
  final String? basicAuthUser;

  /// HTTP Basic auth password (dev-tunnel use only).
  final String? basicAuthPassword;

  /// Optional callback that returns the raw SQLite
  /// database file bytes.
  final DriftDebugGetDatabaseBytes? getDatabaseBytes;

  /// Second query callback for DB diff (main query vs
  /// [queryCompare]).
  final DriftDebugQuery? queryCompare;

  /// Optional write-query callback for import endpoint;
  /// null = import disabled (501).
  final DriftDebugWriteQuery? writeQuery;

  /// In-memory snapshot: id, createdAt, and full table
  /// data per table.
  Snapshot? snapshot;

  /// Monotonically incremented when table row counts
  /// change; used for live refresh and long-poll.
  int generation = 0;

  /// Fingerprint "table1:count1,table2:count2,..." to
  /// detect changes without storing full data.
  String? lastDataSignature;

  /// Guard to prevent concurrent change-check runs.
  bool isChangeCheckInProgress = false;

  /// UTC timestamp of the last request bearing a
  /// VS Code extension client header.
  DateTime? _lastExtensionSeen;

  /// Records that the VS Code extension sent a request.
  void markExtensionSeen() {
    _lastExtensionSeen = DateTime.now().toUtc();
  }

  /// Whether the extension has been seen within
  /// [ServerConstants.longPollTimeout].
  bool get isExtensionConnected {
    final last = _lastExtensionSeen;
    if (last == null) {
      return false;
    }
    return DateTime.now().toUtc().difference(last).inSeconds <
        ServerConstants.longPollTimeout.inSeconds;
  }

  /// Ring buffer of recent query timings for the
  /// performance monitor.
  final List<QueryTiming> queryTimings = [];

  // -------------------------------------------------
  // Instance methods (depend on state fields)
  // -------------------------------------------------

  /// Logs an info message via the [onLog] callback
  /// (if set).
  void log(String message) {
    final callback = onLog;

    if (callback != null) callback(message);
  }

  /// Logs an error via dart:developer and the [onError]
  /// callback (if set).
  void logError(Object error, StackTrace stack) {
    developer.log(
      error.toString(),
      name: 'DriftDebugServer',
      error: error,
      stackTrace: stack,
    );

    final callback = onError;

    if (callback != null) callback(error, stack);
  }

  /// Wraps a query call with timing instrumentation.
  ///
  /// Returns the query result rows after recording
  /// duration, row count, and any errors.
  Future<List<Map<String, dynamic>>> timedQuery(
    DriftDebugQuery fn,
    String sql,
  ) async {
    final stopwatch = Stopwatch()..start();

    try {
      final result = await fn(sql);

      stopwatch.stop();
      recordTiming(
        sql: sql,
        durationMs: stopwatch.elapsedMilliseconds,
        rowCount: result.length,
      );

      return result;
    } on Object catch (error) {
      stopwatch.stop();
      recordTiming(
        sql: sql,
        durationMs: stopwatch.elapsedMilliseconds,
        rowCount: 0,
        error: error.toString(),
      );
      rethrow;
    }
  }

  /// Appends a timing entry; evicts oldest when buffer
  /// exceeds [ServerConstants.maxQueryTimings].
  void recordTiming({
    required String sql,
    required int durationMs,
    required int rowCount,
    String? error,
  }) {
    queryTimings.add(QueryTiming(
      sql: sql,
      durationMs: durationMs,
      rowCount: rowCount,
      error: error,
      at: DateTime.now().toUtc(),
    ));

    if (queryTimings.length > ServerConstants.maxQueryTimings) {
      queryTimings.removeAt(0);
    }
  }

  /// Sets Access-Control-Allow-Origin when a CORS
  /// origin was provided at start.
  void setCors(HttpResponse response) {
    final origin = corsOrigin;

    if (origin != null) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
  }

  /// Sets Content-Type to JSON and CORS. Used by all
  /// JSON API responses.
  void setJsonHeaders(HttpResponse response) {
    response.headers.contentType = ContentType.json;
    setCors(response);
  }

  /// Sends a 500 JSON error response and closes the
  /// response.
  Future<void> sendErrorResponse(
    HttpResponse response,
    Object error,
  ) async {
    response.statusCode = HttpStatus.internalServerError;
    response.headers.contentType = ContentType.json;
    setCors(response);
    response.write(jsonEncode(<String, String>{
      ServerConstants.jsonKeyError: error.toString(),
    }));
    await response.close();
  }

  /// Sets Content-Disposition (attachment) and
  /// Content-Type headers for file downloads.
  void setAttachmentHeaders(
    HttpResponse response,
    String filename,
  ) {
    response.headers.contentType = ContentType(
      ServerConstants.contentTypeTextPlain,
      'plain',
      charset: ServerConstants.charsetUtf8,
    );
    response.headers.set(
      ServerConstants.headerContentDisposition,
      'attachment; filename="$filename"',
    );
    setCors(response);
  }

  /// Runs a lightweight fingerprint of table row
  /// counts; bumps [generation] when it changes.
  Future<void> checkDataChange() async {
    if (isChangeCheckInProgress) {
      return;
    }
    isChangeCheckInProgress = true;
    try {
      final tables = await getTableNames(instrumentedQuery);
      final parts = <String>[];

      for (final t in tables) {
        final raw = await instrumentedQuery(
          'SELECT COUNT(*) AS c FROM "$t"',
        );

        parts.add(
          '$t:${extractCountFromRows(normalizeRows(raw))}',
        );
      }

      final signature = parts.join(',');

      if (lastDataSignature != null && lastDataSignature != signature) {
        generation++;
      }
      lastDataSignature = signature;
    } on Object catch (error, stack) {
      logError(error, stack);
    } finally {
      isChangeCheckInProgress = false;
    }
  }

  /// Validates that [tableName] exists in the
  /// allow-list (from sqlite_master). Sends 400 and
  /// returns false if unknown; otherwise returns true.
  Future<bool> requireKnownTable({
    required HttpResponse response,
    required DriftDebugQuery queryFn,
    required String tableName,
  }) async {
    final List<String> allowed = await getTableNames(queryFn);

    if (!allowed.contains(tableName)) {
      response.statusCode = HttpStatus.badRequest;
      setJsonHeaders(response);
      response.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            '${ServerConstants.errorUnknownTablePrefix}$tableName',
      }));
      await response.close();

      return false;
    }

    return true;
  }

  // -------------------------------------------------
  // Static methods (no instance state)
  // -------------------------------------------------

  /// Normalizes raw query result to a list of maps.
  ///
  /// Returns an empty list when [raw] is null or not a
  /// [List]. Non-Map items are silently skipped.
  static List<Map<String, dynamic>> normalizeRows(
    dynamic raw,
  ) {
    if (raw == null) {
      return [];
    }
    if (raw is! List) {
      return [];
    }

    final out = <Map<String, dynamic>>[];

    for (final item in raw) {
      if (item is Map) {
        out.add(Map<String, dynamic>.from(item));
      }
    }

    return out;
  }

  /// Extracts COUNT(*) result from a single-row query
  /// (column 'c').
  ///
  /// Returns 0 if [rows] is empty or the count column
  /// is null.
  static int extractCountFromRows(
    List<Map<String, dynamic>> rows,
  ) {
    final firstRow = rows.isEmpty ? null : rows.first;

    if (firstRow == null ||
        firstRow[ServerConstants.jsonKeyCountColumn] == null) {
      return 0;
    }

    final countValue = firstRow[ServerConstants.jsonKeyCountColumn];

    return countValue is int
        ? countValue
        : (countValue is num ? countValue.toInt() : 0);
  }

  /// Fetches table names from sqlite_master
  /// (type='table', exclude sqlite_*).
  ///
  /// Returns a sorted list of non-empty table name
  /// strings.
  static Future<List<String>> getTableNames(
    DriftDebugQuery queryFn,
  ) async {
    final dynamic raw = await queryFn(ServerConstants.sqlTableNames);

    final List<Map<String, dynamic>> rows = normalizeRows(raw);

    return rows
        .map(
          (row) => row[ServerConstants.jsonKeyName] as String? ?? '',
        )
        .where((nameStr) => nameStr.isNotEmpty)
        .toList();
  }

  /// Parses limit query param; clamps to 1..maxLimit.
  ///
  /// Returns [ServerConstants.defaultLimit] when
  /// [value] is null or not a valid positive integer.
  static int parseLimit(String? value) {
    if (value == null) {
      return ServerConstants.defaultLimit;
    }

    final int? n = int.tryParse(value);

    if (n == null || n < ServerConstants.minLimit) {
      return ServerConstants.defaultLimit;
    }

    return n.clamp(
      ServerConstants.minLimit,
      ServerConstants.maxLimit,
    );
  }

  /// Parses offset query param.
  ///
  /// Returns 0 if [value] is null or not a valid
  /// non-negative integer; caps at
  /// [ServerConstants.maxOffset].
  static int parseOffset(String? value) {
    if (value == null) {
      return 0;
    }

    final int? n = int.tryParse(value);

    if (n == null || n < 0) {
      return 0;
    }

    return n > ServerConstants.maxOffset ? ServerConstants.maxOffset : n;
  }

  /// Escapes a value for use in a SQL INSERT literal.
  ///
  /// Returns a SQL-safe string representation: NULL for
  /// null, unquoted for numbers, quoted for strings,
  /// and X'...' for byte lists.
  static String sqlLiteral(Object? value) {
    if (value == null) {
      return 'NULL';
    }
    if (value is num) {
      return value.toString();
    }
    if (value is bool) {
      return value ? '1' : '0';
    }

    if (value is String) {
      final escaped = value.replaceAll(r'\', r'\\').replaceAll("'", "''");

      return "'$escaped'";
    }

    if (value is List<int>) {
      final hex = value
          .map(
            (b) => b.toRadixString(ServerConstants.hexRadix).padLeft(
                  ServerConstants.hexBytePadding,
                  '0',
                ),
          )
          .join();

      return "X'$hex'";
    }

    final escaped =
        value.toString().replaceAll(r'\', r'\\').replaceAll("'", "''");

    return "'$escaped'";
  }

  /// Returns substring from [start] to [end] safely.
  ///
  /// Avoids RangeError by clamping indices. Returns
  /// empty string when bounds are invalid.
  static String safeSubstring(
    String s, {
    required int start,
    int? end,
  }) {
    if (start < 0 || start >= s.length) {
      return '';
    }

    final endIndex = end ?? s.length;

    if (endIndex <= start) {
      return '';
    }

    final safeEnd = endIndex > s.length ? s.length : endIndex;

    if (start >= safeEnd) {
      return '';
    }

    return s.replaceRange(safeEnd, s.length, '').replaceRange(0, start, '');
  }

  /// Stable JSON string representation of a row for
  /// diffing (sorted keys).
  ///
  /// Returns a deterministic JSON encoding of [row]
  /// with keys in alphabetical order.
  static String rowSignature(Map<String, dynamic> row) {
    final keys = row.keys.toList()..sort();

    final sorted = <String, dynamic>{};

    for (final k in keys) {
      sorted[k] = row[k];
    }

    return jsonEncode(sorted);
  }

  /// Builds a composite primary key string for [row]
  /// by joining values of [pkColumns] with `|`.
  ///
  /// Returns a pipe-delimited string of PK column values
  /// used to match rows across snapshots by identity.
  static String compositePkKey(
    List<String> pkColumns,
    Map<String, dynamic> row,
  ) =>
      pkColumns.map((c) => '${row[c]}').join('|');

  /// Fetches schema (CREATE statements) from
  /// sqlite_master, no data.
  ///
  /// Returns the schema DDL as a single string with
  /// each statement on its own line, terminated by a
  /// semicolon.
  static Future<String> getSchemaSql(
    DriftDebugQuery queryFn,
  ) async {
    final dynamic raw = await queryFn(ServerConstants.sqlSchemaMaster);

    final List<Map<String, dynamic>> rows = normalizeRows(raw);

    final buffer = StringBuffer();

    for (final row in rows) {
      final stmt = row[ServerConstants.jsonKeySql] as String?;

      if (stmt != null && stmt.isNotEmpty) {
        buffer.writeln(stmt);
        if (!stmt.trimRight().endsWith(';')) {
          buffer.write(';');
        }
        buffer.writeln();
      }
    }

    return buffer.toString();
  }

  /// Decodes a JSON string and returns it as a map,
  /// or null if the input is not a valid JSON object.
  static Map<String, dynamic>? parseJsonMap(String body) {
    final Object? decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException catch (e) {
      developer.log(
        'parseJsonMap: $e',
        name: 'DriftDebugServer',
      );
      return null;
    }

    return decoded is Map<String, dynamic> ? decoded : null;
  }

  static final RegExp _reTextType = RegExp(
    r'TEXT|VARCHAR|CHAR|CLOB|STRING',
    caseSensitive: false,
  );

  static final RegExp _reNumericType = RegExp(
    r'INT|REAL|NUM|FLOAT|DOUBLE|DECIMAL',
    caseSensitive: false,
  );

  /// Returns true if [type] is a SQLite TEXT type.
  static bool isTextType(String type) => _reTextType.hasMatch(type);

  /// Returns true if [type] is a SQLite numeric type.
  static bool isNumericType(String type) => _reNumericType.hasMatch(type);

  /// Safe double conversion from dynamic [value].
  ///
  /// Returns null when [value] is not a number or
  /// parseable string.
  static double? toDouble(Object? value) {
    if (value is double) {
      return value;
    }
    if (value is int) {
      return value.toDouble();
    }
    if (value is String) {
      return double.tryParse(value);
    }

    return null;
  }

  /// Parses CSV text into a list of rows (each a list
  /// of field strings).
  ///
  /// Returns a list where each element is one parsed
  /// row. Handles quoted fields with embedded commas
  /// and escaped quotes ("").
  static List<List<String>> parseCsvLines(String csv) {
    final result = <List<String>>[];
    final lines = csv.split('\n');
    final current = StringBuffer();

    for (final line in lines) {
      if (line.trim().isNotEmpty) {
        final fields = <String>[];
        var inQuotes = false;

        current.clear();

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
    }

    return result;
  }

  /// Severity sort order fallback for unknown values.
  static const int _unknownSeverityOrder = 3;

  /// Sorts anomalies in-place: errors first, then
  /// warnings, then info.
  static void sortAnomaliesBySeverity(
    List<Map<String, dynamic>> anomalies,
  ) {
    const severityOrder = <String, int>{
      'error': 0,
      'warning': 1,
      'info': 2,
    };

    anomalies.sort(
      (a, b) =>
          (severityOrder[a['severity']] ?? _unknownSeverityOrder).compareTo(
        severityOrder[b['severity']] ?? _unknownSeverityOrder,
      ),
    );
  }

  @override
  String toString() => 'ServerContext(generation: $generation)';
}
