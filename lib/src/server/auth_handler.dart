// Authentication handler extracted from _DriftDebugServerImpl.
// Handles Bearer token and HTTP Basic auth verification.

import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';

import 'server_constants.dart';
import 'server_context.dart';

/// Handles authentication for the Drift Debug Server.
///
/// Supports Bearer token (SHA256 hash comparison) and HTTP Basic auth.
/// All comparisons are constant-time to mitigate timing side channels.
final class AuthHandler {
  /// Creates an [AuthHandler] with the given [ServerContext].
  AuthHandler(this._ctx);

  final ServerContext _ctx;

  /// Returns true if the request has valid token (Bearer header only) or
  /// HTTP Basic credentials. Token in URL is not supported
  /// (avoid_token_in_url).
  bool isAuthenticated(HttpRequest request) {
    final tokenHash = _ctx.authTokenHash;
    if (tokenHash != null) {
      final authHeader =
          request.headers.value(ServerConstants.headerAuthorization);
      if (authHeader != null &&
          authHeader.length > ServerConstants.authSchemeBearer.length &&
          authHeader.startsWith(ServerConstants.authSchemeBearer)) {
        final token = ServerContext.safeSubstring(
            authHeader, ServerConstants.authSchemeBearer.length);
        if (token.isEmpty) return false;
        final incomingHash = sha256.convert(utf8.encode(token)).bytes;
        if (_secureCompareBytes(incomingHash, tokenHash)) return true;
      }
    }
    final user = _ctx.basicAuthUser;
    final password = _ctx.basicAuthPassword;
    if (user != null && user.isNotEmpty && password != null) {
      final authHeader =
          request.headers.value(ServerConstants.headerAuthorization);
      if (authHeader != null &&
          authHeader.length >= ServerConstants.authSchemeBasic.length &&
          authHeader.startsWith(ServerConstants.authSchemeBasic)) {
        try {
          final basicPayload = ServerContext.safeSubstring(
              authHeader, ServerConstants.authSchemeBasic.length);
          if (basicPayload.isEmpty) return false;
          final decoded = utf8.decode(base64.decode(basicPayload));
          final colon = decoded.indexOf(':');
          if (colon >= 0 && colon < decoded.length) {
            final userPart = ServerContext.safeSubstring(decoded, 0, colon);
            final passwordPart =
                ServerContext.safeSubstring(decoded, colon + 1);
            if (_secureCompare(userPart, user) &&
                _secureCompare(passwordPart, password)) {
              return true;
            }
          }
        } on Object catch (error, stack) {
          _ctx.logError(error, stack);
        }
      }
    }
    return false;
  }

  /// Sends 401 with JSON body; sets WWW-Authenticate for Basic when
  /// Basic auth is configured.
  Future<void> sendUnauthorized(HttpResponse response) async {
    final res = response;
    res.statusCode = HttpStatus.unauthorized;
    if (_ctx.basicAuthUser != null && _ctx.basicAuthPassword != null) {
      res.headers.set(ServerConstants.headerWwwAuthenticate,
          'Basic realm="${ServerConstants.realmDriftDebug}"');
    }
    _ctx.setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      ServerConstants.jsonKeyError: ServerConstants.authRequiredMessage,
    }));
    await res.close();
  }

  /// Constant-time string comparison to reduce timing side channels.
  bool _secureCompare(String a, String b) {
    if (a.length != b.length) return false;
    int result = 0;
    for (int i = 0; i < a.length; i++) {
      result |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return result == 0;
  }

  /// Constant-time comparison of two byte lists (for token hash comparison).
  bool _secureCompareBytes(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    int result = 0;
    for (int i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result == 0;
  }
}
