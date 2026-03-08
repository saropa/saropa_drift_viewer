// Session handler extracted from _DriftDebugServerImpl.
// Handles collaborative debug session endpoints.

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:saropa_drift_viewer/src/drift_debug_session.dart';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles collaborative session API endpoints.
final class SessionHandler {
  /// Creates a [SessionHandler] with the given [ServerContext]
  /// and [DriftDebugSessionStore].
  SessionHandler(this._ctx, this._sessionStore);

  final ServerContext _ctx;
  final DriftDebugSessionStore _sessionStore;

  /// POST /api/session/share — create a shareable session.
  Future<void> handleSessionShare(HttpRequest request) async {
    final res = request.response;

    try {
      final builder = BytesBuilder();

      await for (final chunk in request) {
        builder.add(chunk);
      }

      final body = utf8.decode(builder.toBytes());
      final decoded = ServerContext.parseJsonMap(body);

      if (decoded == null) {
        res.statusCode = HttpStatus.badRequest;
        _ctx.setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError: 'Invalid JSON body',
        }));
        await res.close();
        return;
      }

      final result = _sessionStore.create(decoded);

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(result));
      await res.close();
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);
    }
  }

  /// GET /api/session/{id} — retrieve a shared session by ID.
  Future<void> handleSessionGet(
    HttpResponse response,
    String sessionId,
  ) async {
    final res = response;
    final session = _sessionStore.get(sessionId);

    if (session == null) {
      res.statusCode = HttpStatus.notFound;
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        ServerConstants.jsonKeyError:
            DriftDebugSessionStore.errorNotFound,
      }));
      await res.close();
      return;
    }

    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(session));
    await res.close();
  }

  /// POST /api/session/{id}/annotate — add an annotation.
  Future<void> handleSessionAnnotate(
    HttpRequest request,
    String sessionId,
  ) async {
    final res = request.response;

    try {
      final builder = BytesBuilder();

      await for (final chunk in request) {
        builder.add(chunk);
      }

      final body =
          ServerContext.parseJsonMap(
              utf8.decode(builder.toBytes())) ??
          <String, dynamic>{};

      final added = _sessionStore.annotate(
        sessionId,
        text:
            (body[DriftDebugSessionStore.keyText] as String?) ??
                '',
        author:
            (body[DriftDebugSessionStore.keyAuthor] as String?) ??
                'anonymous',
      );

      if (!added) {
        res.statusCode = HttpStatus.notFound;
        _ctx.setJsonHeaders(res);
        res.write(jsonEncode(<String, String>{
          ServerConstants.jsonKeyError:
              DriftDebugSessionStore.errorNotFound,
        }));
        await res.close();
        return;
      }

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{
        DriftDebugSessionStore.keyStatus: 'added',
      }));
      await res.close();
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);
    }
  }
}
