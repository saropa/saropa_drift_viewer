// VM Service extension bridge for Plan 68.
// Registers ext.saropa.drift.* RPCs that delegate to the same logic as HTTP handlers
// so the VS Code extension can connect via the Dart VM Service when debugging.

import 'dart:convert';
import 'dart:developer' as developer;

import 'router.dart';
import 'server_constants.dart';

/// Prefix for all Drift VM service extension methods (isolate-scoped).
const String _kExtPrefix = 'ext.saropa.drift.';

/// Registers VM Service extension RPCs and delegates to [Router].
/// Call [register] after the server starts; call [clear] before stop so
/// handlers do not use a stale router.
final class VmServiceBridge {
  VmServiceBridge(this._router);

  Router? _router;

  /// Registers all ext.saropa.drift.* methods. Call once when server starts.
  void register() {
    developer.registerExtension(
      '${_kExtPrefix}getHealth',
      _handleGetHealth,
    );
    developer.registerExtension(
      '${_kExtPrefix}getSchemaMetadata',
      _handleGetSchemaMetadata,
    );
    developer.registerExtension(
      '${_kExtPrefix}getTableFkMeta',
      _handleGetTableFkMeta,
    );
    developer.registerExtension(
      '${_kExtPrefix}runSql',
      _handleRunSql,
    );
    developer.registerExtension(
      '${_kExtPrefix}getGeneration',
      _handleGetGeneration,
    );
    developer.registerExtension(
      '${_kExtPrefix}getPerformance',
      _handleGetPerformance,
    );
    developer.registerExtension(
      '${_kExtPrefix}clearPerformance',
      _handleClearPerformance,
    );
    developer.registerExtension(
      '${_kExtPrefix}getAnomalies',
      _handleGetAnomalies,
    );
    developer.registerExtension(
      '${_kExtPrefix}explainSql',
      _handleExplainSql,
    );
    developer.registerExtension(
      '${_kExtPrefix}getIndexSuggestions',
      _handleGetIndexSuggestions,
    );
  }

  /// Clears the router reference so handlers no longer run after server stop.
  void clear() {
    _router = null;
  }

  Future<developer.ServiceExtensionResponse> _handleGetHealth(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    final body = <String, dynamic>{
      ServerConstants.jsonKeyOk: true,
      ServerConstants.jsonKeyExtensionConnected: true,
    };
    return developer.ServiceExtensionResponse.result(jsonEncode(body));
  }

  Future<developer.ServiceExtensionResponse> _handleGetSchemaMetadata(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      final tables = await router.getSchemaMetadataList();
      final body = <String, dynamic>{
        ServerConstants.jsonKeyTables: tables,
      };
      return developer.ServiceExtensionResponse.result(jsonEncode(body));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleGetTableFkMeta(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    final tableName = params['tableName'];
    if (tableName == null || tableName.isEmpty) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Missing tableName parameter',
      );
    }
    try {
      final fks = await router.getTableFkMetaList(tableName);
      return developer.ServiceExtensionResponse.result(jsonEncode(fks));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleRunSql(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    final sql = params['sql'];
    if (sql == null || sql.isEmpty) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        ServerConstants.errorMissingSql,
      );
    }
    try {
      final result = await router.runSqlResult(sql);
      return developer.ServiceExtensionResponse.result(jsonEncode(result));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleGetGeneration(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      final gen = await router.getGeneration();
      final body = <String, dynamic>{ServerConstants.jsonKeyGeneration: gen};
      return developer.ServiceExtensionResponse.result(jsonEncode(body));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleGetPerformance(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      final data = await router.getPerformanceData();
      return developer.ServiceExtensionResponse.result(jsonEncode(data));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleClearPerformance(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      router.clearPerformance();
      return developer.ServiceExtensionResponse.result(
        jsonEncode(<String, String>{'status': 'cleared'}),
      );
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleGetAnomalies(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      final data = await router.getAnomaliesResult();
      return developer.ServiceExtensionResponse.result(jsonEncode(data));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleExplainSql(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    final sql = params['sql'];
    if (sql == null || sql.isEmpty) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        ServerConstants.errorMissingSql,
      );
    }
    try {
      final result = await router.explainSqlResult(sql);
      return developer.ServiceExtensionResponse.result(jsonEncode(result));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }

  Future<developer.ServiceExtensionResponse> _handleGetIndexSuggestions(
    String method,
    Map<String, String> params,
  ) async {
    final router = _router;
    if (router == null) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        'Drift server not running',
      );
    }
    try {
      final list = await router.getIndexSuggestionsList();
      return developer.ServiceExtensionResponse.result(jsonEncode(list));
    } on Object catch (e) {
      return developer.ServiceExtensionResponse.error(
        developer.ServiceExtensionResponse.extensionErrorMin,
        e.toString(),
      );
    }
  }
}
