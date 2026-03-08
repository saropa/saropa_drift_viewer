// VM-only implementation: this file is selected by conditional export when
// dart.library.io is available. The stub (drift_debug_server_stub.dart) is
// used on web.
//
// Architecture: [_DriftDebugServerImpl] creates a [ServerContext] and [Router]
// on start; the router dispatches to handler classes in lib/src/server/.
// All DB access goes through [DriftDebugQuery] callbacks only.
import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:saropa_drift_viewer/src/drift_debug_session.dart';

import 'server/router.dart';
import 'server/server_constants.dart';
import 'server/server_context.dart';

// Public API typedefs are defined in server/server_context.dart
// and re-exported here so the barrel export chain is preserved.
export 'server/server_context.dart'
    show
        DriftDebugQuery,
        DriftDebugOnLog,
        DriftDebugOnError,
        DriftDebugGetDatabaseBytes,
        DriftDebugWriteQuery;

/// Internal implementation; state is instance-based to satisfy
/// avoid_static_state. Database access is via [DriftDebugQuery]
/// callbacks only; this class does not hold sqflite or any DB
/// reference.
class _DriftDebugServerImpl {
  HttpServer? _server;
  StreamSubscription<HttpRequest>? _serverSubscription;

  /// Router for dispatching requests; null when server is not running.
  Router? _router;

  /// In-memory shared sessions for collaborative debug.
  final DriftDebugSessionStore _sessionStore = DriftDebugSessionStore();

  /// Starts the debug server if [enabled] is true and [query] is provided.
  ///
  /// No-op if [enabled] is false or the server is already running. [query]
  /// must execute the given SQL and return rows as a list of maps. The server
  /// serves a web UI and JSON APIs for table listing and table data; see the
  /// package README for endpoints.
  ///
  /// Parameters:
  /// * [query] — Required. Executes SQL and returns rows.
  /// * [enabled] — If false, the server is not started (default true).
  /// * [port] — Port to bind (default 8642).
  /// * [loopbackOnly] — If true, bind to 127.0.0.1 only.
  /// * [corsOrigin] — Value for Access-Control-Allow-Origin.
  /// * [authToken] — Optional Bearer token for auth.
  /// * [basicAuthUser] and [basicAuthPassword] — Optional HTTP Basic auth.
  /// * [getDatabaseBytes] — Optional callback for raw .sqlite download.
  /// * [queryCompare] — Optional second query for DB diff.
  /// * [writeQuery] — Optional write callback for import endpoint.
  /// * [onLog] — Optional log callback.
  /// * [onError] — Optional error callback.
  ///
  /// Throws [ArgumentError] for invalid port or partial Basic auth.
  ///
  /// ## Example (callback-based)
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

    // Defensive: reject invalid port and partial Basic auth.
    if (port < ServerConstants.minPort || port > ServerConstants.maxPort) {
      throw ArgumentError(
        'Port must be in range '
        '${ServerConstants.minPort}..${ServerConstants.maxPort} '
        '(0 = any port), got: $port',
      );
    }

    final hasBasicUser = basicAuthUser != null && basicAuthUser.isNotEmpty;
    final hasBasicPassword =
        basicAuthPassword != null && basicAuthPassword.isNotEmpty;

    if (hasBasicUser != hasBasicPassword) {
      throw ArgumentError(
        'Basic auth requires both basicAuthUser and basicAuthPassword '
        'to be set, or neither. Partial configuration is not allowed.',
      );
    }

    // Store SHA256 hash of token only (require_data_encryption).
    final List<int>? tokenHash = (authToken != null && authToken.isNotEmpty)
        ? sha256.convert(utf8.encode(authToken)).bytes
        : null;

    final ctx = ServerContext(
      query: query,
      corsOrigin: corsOrigin,
      onLog: onLog,
      onError: onError,
      authTokenHash: tokenHash,
      basicAuthUser: basicAuthUser,
      basicAuthPassword: basicAuthPassword,
      getDatabaseBytes: getDatabaseBytes,
      queryCompare: queryCompare,
      writeQuery: writeQuery,
    );

    _router = Router(ctx, _sessionStore);

    try {
      final address =
          loopbackOnly ? InternetAddress.loopbackIPv4 : InternetAddress.anyIPv4;

      _server = await HttpServer.bind(address, port);
      final server = _server;
      if (server == null) return;

      _serverSubscription = server.listen(_router!.onRequest);

      ctx.log(ServerConstants.bannerTop);
      ctx.log(ServerConstants.bannerTitle);
      ctx.log(ServerConstants.bannerDivider);
      ctx.log(ServerConstants.bannerOpen);
      ctx.log('${ServerConstants.bannerUrlPrefix}$port');
      ctx.log(ServerConstants.bannerBottom);
    } on Object catch (error, stack) {
      ctx.logError(error, stack);
    }
  }

  /// The port the server is bound to, or null if not running.
  int? get port => _server?.port;

  /// Stops the server if running and clears stored state.
  Future<void> stop() async {
    final server = _server;
    if (server == null) return;

    await _serverSubscription?.cancel();
    _serverSubscription = null;
    _server = null;
    _router = null;
    await server.close();
  }

  @override
  String toString() => '_DriftDebugServerImpl(port: ${_server?.port}, '
      'running: ${_server != null})';
}

// --- Public API ---
// Single instance so one server per process; avoid_static_state is
// satisfied by instance-based state in _DriftDebugServerImpl.

/// Debug-only HTTP server that exposes SQLite/Drift table data as JSON
/// and a minimal web viewer.
///
/// Use [start] to bind the server (default port 8642); open
/// http://127.0.0.1:8642 in a browser. Only one server can run per
/// process; use [stop] to shut down before calling [start] again.
///
/// See the package README for API endpoints and optional features.
mixin DriftDebugServer {
  /// Lazy singleton without [late]: avoids avoid_late_keyword while
  /// keeping one server per process.
  static _DriftDebugServerImpl? _instanceStorage;

  static _DriftDebugServerImpl get _instance {
    final existing = _instanceStorage;
    if (existing != null) return existing;

    final created = _DriftDebugServerImpl();
    _instanceStorage = created;

    return created;
  }

  /// Starts the debug server if [enabled] is true and [query] is
  /// provided.
  ///
  /// No-op if [enabled] is false or the server is already running.
  /// Throws [ArgumentError] if [port] is out of range or Basic auth
  /// is partially configured.
  static Future<void> start({
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
