// Request router extracted from _DriftDebugServerImpl._onRequest.
// Dispatches HTTP requests to the appropriate handler.

import 'dart:io';

import 'package:saropa_drift_viewer/src/drift_debug_session.dart';

import 'analytics_handler.dart';
import 'auth_handler.dart';
import 'compare_handler.dart';
import 'generation_handler.dart';
import 'import_handler.dart';
import 'performance_handler.dart';
import 'schema_handler.dart';
import 'server_constants.dart';
import 'server_context.dart';
import 'session_handler.dart';
import 'snapshot_handler.dart';
import 'sql_handler.dart';
import 'table_handler.dart';

/// Routes incoming HTTP requests to the appropriate handler.
final class Router {
  /// Creates a [Router] with the given [ServerContext] and
  /// [DriftDebugSessionStore].
  Router(ServerContext ctx, DriftDebugSessionStore sessionStore)
      : _ctx = ctx,
        _auth = AuthHandler(ctx),
        _generation = GenerationHandler(ctx),
        _table = TableHandler(ctx),
        _sql = SqlHandler(ctx),
        _schema = SchemaHandler(ctx),
        _snapshot = SnapshotHandler(ctx),
        _compare = CompareHandler(ctx),
        _analytics = AnalyticsHandler(ctx),
        _performance = PerformanceHandler(ctx),
        _session = SessionHandler(ctx, sessionStore),
        _import = ImportHandler(ctx);

  final ServerContext _ctx;
  final AuthHandler _auth;
  final GenerationHandler _generation;
  final TableHandler _table;
  final SqlHandler _sql;
  final SchemaHandler _schema;
  final SnapshotHandler _snapshot;
  final CompareHandler _compare;
  final AnalyticsHandler _analytics;
  final PerformanceHandler _performance;
  final SessionHandler _session;
  final ImportHandler _import;

  /// Main request handler: auth -> health/generation -> route by
  /// method and path.
  Future<void> onRequest(HttpRequest request) async {
    final req = request;
    final res = req.response;
    final String path = req.uri.path;

    // When auth is configured, require it on every request.
    if (_ctx.authTokenHash != null ||
        (_ctx.basicAuthUser != null && _ctx.basicAuthPassword != null)) {
      if (!_auth.isAuthenticated(req)) {
        await _auth.sendUnauthorized(res);

        return;
      }
    }

    // Track VS Code extension client header.
    final driftClient = req.headers.value(ServerConstants.headerDriftClient);
    if (driftClient == ServerConstants.clientVscode) {
      _ctx.markExtensionSeen();
    }

    // Health and generation are checked before the
    // DB query so probes / live-refresh work.
    try {
      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiHealth ||
              path == ServerConstants.pathApiHealthAlt)) {
        await _generation.sendHealth(res);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiGeneration ||
              path == ServerConstants.pathApiGenerationAlt)) {
        await _generation.handleGeneration(req);

        return;
      }
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);

      return;
    }

    final DriftDebugQuery query = _ctx.instrumentedQuery;

    try {
      if (req.method == ServerConstants.methodGet &&
          (path == '/' || path.isEmpty)) {
        await _generation.sendHtml(res, req);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiTables ||
              path == ServerConstants.pathApiTablesAlt)) {
        await _table.sendTableList(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path.startsWith(ServerConstants.pathApiTablePrefix) ||
              path.startsWith(ServerConstants.pathApiTablePrefixAlt))) {
        final String suffix = path.replaceFirst(RegExp(r'^/?api/table/'), '');

        if (suffix.endsWith(ServerConstants.pathSuffixCount)) {
          final String tableName = suffix.replaceFirst(RegExp(r'/count$'), '');

          await _table.sendTableCount(
              response: res, query: query, tableName: tableName);

          return;
        }
        if (suffix.endsWith(ServerConstants.pathSuffixColumns)) {
          final String tableName =
              suffix.replaceFirst(RegExp(r'/columns$'), '');

          await _table.sendTableColumns(
              response: res, query: query, tableName: tableName);

          return;
        }
        if (suffix.endsWith(ServerConstants.pathSuffixFkMeta)) {
          final String tableName =
              suffix.replaceFirst(RegExp(r'/fk-meta$'), '');

          await _table.sendTableFkMeta(
              response: res, query: query, tableName: tableName);

          return;
        }

        final String tableName = suffix;
        final int limit = ServerContext.parseLimit(
            req.uri.queryParameters[ServerConstants.queryParamLimit]);
        final int offset = ServerContext.parseOffset(
            req.uri.queryParameters[ServerConstants.queryParamOffset]);

        await _table.sendTableData(
            response: res,
            query: query,
            tableName: tableName,
            limit: limit,
            offset: offset);

        return;
      }

      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSqlExplain ||
              path == ServerConstants.pathApiSqlExplainAlt)) {
        await _sql.handleExplainSql(req, query);

        return;
      }

      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSql ||
              path == ServerConstants.pathApiSqlAlt)) {
        await _sql.handleRunSql(req, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchema ||
              path == ServerConstants.pathApiSchemaAlt)) {
        await _schema.sendSchemaDump(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchemaDiagram ||
              path == ServerConstants.pathApiSchemaDiagramAlt)) {
        await _schema.sendSchemaDiagram(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSchemaMetadata ||
              path == ServerConstants.pathApiSchemaMetadataAlt)) {
        await _schema.sendSchemaMetadata(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiDump ||
              path == ServerConstants.pathApiDumpAlt)) {
        await _schema.sendFullDump(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiDatabase ||
              path == ServerConstants.pathApiDatabaseAlt)) {
        await _schema.sendDatabaseFile(res);

        return;
      }

      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSnapshot ||
              path == ServerConstants.pathApiSnapshotAlt)) {
        await _snapshot.handleSnapshotCreate(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSnapshot ||
              path == ServerConstants.pathApiSnapshotAlt)) {
        await _snapshot.handleSnapshotGet(res);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiSnapshotCompare ||
              path == ServerConstants.pathApiSnapshotCompareAlt)) {
        await _snapshot.handleSnapshotCompare(
            response: res, request: req, query: query);

        return;
      }

      if (req.method == ServerConstants.methodDelete &&
          (path == ServerConstants.pathApiSnapshot ||
              path == ServerConstants.pathApiSnapshotAlt)) {
        await _snapshot.handleSnapshotDelete(res);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path.startsWith(ServerConstants.pathApiComparePrefix) ||
              path.startsWith(ServerConstants.pathApiComparePrefixAlt))) {
        await _compare.handleCompareReport(
          response: res,
          request: req,
          query: query,
        );

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiIndexSuggestions ||
              path == ServerConstants.pathApiIndexSuggestionsAlt)) {
        await _analytics.handleIndexSuggestions(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiMigrationPreview ||
              path == ServerConstants.pathApiMigrationPreviewAlt)) {
        await _compare.handleMigrationPreview(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsAnomalies ||
              path == ServerConstants.pathApiAnalyticsAnomaliesAlt)) {
        await _analytics.handleAnomalyDetection(res, query);

        return;
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsSize ||
              path == ServerConstants.pathApiAnalyticsSizeAlt)) {
        await _analytics.handleSizeAnalytics(res, query);

        return;
      }

      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiImport ||
              path == ServerConstants.pathApiImportAlt)) {
        await _import.handleImport(req);

        return;
      }

      if (req.method == ServerConstants.methodPost &&
          (path == ServerConstants.pathApiSessionShare ||
              path == ServerConstants.pathApiSessionShareAlt)) {
        await _session.handleSessionShare(req);

        return;
      }

      if (path.startsWith(ServerConstants.pathApiSessionPrefix) ||
          path.startsWith(ServerConstants.pathApiSessionPrefixAlt)) {
        final suffix = path.startsWith(ServerConstants.pathApiSessionPrefix)
            ? path.substring(ServerConstants.pathApiSessionPrefix.length)
            : path.substring(ServerConstants.pathApiSessionPrefixAlt.length);

        if (suffix.endsWith(ServerConstants.pathSuffixAnnotate) &&
            req.method == ServerConstants.methodPost) {
          final sessionId = suffix.replaceFirst(RegExp(r'/annotate$'), '');

          await _session.handleSessionAnnotate(req, sessionId);

          return;
        }
        if (req.method == ServerConstants.methodGet) {
          await _session.handleSessionGet(res, suffix);

          return;
        }
      }

      if (req.method == ServerConstants.methodGet &&
          (path == ServerConstants.pathApiAnalyticsPerformance ||
              path == ServerConstants.pathApiAnalyticsPerformanceAlt)) {
        await _performance.handlePerformanceAnalytics(res);

        return;
      }

      if (req.method == ServerConstants.methodDelete &&
          (path == ServerConstants.pathApiAnalyticsPerformance ||
              path == ServerConstants.pathApiAnalyticsPerformanceAlt)) {
        await _performance.clearPerformanceData(res);

        return;
      }

      res.statusCode = HttpStatus.notFound;
      await res.close();
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);
    }
  }

  @override
  String toString() => 'Router()';
}
