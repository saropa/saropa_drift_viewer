/// In-memory session store for collaborative debug sessions.
///
/// Provides create / get / annotate / cleanup semantics with a configurable
/// expiry ([sessionExpiry]) and a hard cap on stored sessions ([maxSessions]).
/// Sessions are keyed by a base-36 timestamp ID and auto-evicted when
/// expired or when the cap is reached.
final class DriftDebugSessionStore {
  /// How long a session is valid after creation.
  static const Duration sessionExpiry = Duration(hours: 1);

  /// Maximum number of sessions stored simultaneously.
  static const int maxSessions = 50;

  static const int _radixBase36 = 36;

  // --- JSON keys (session payload contract) ---
  static const String keyState = 'state';
  static const String keyCreatedAt = 'createdAt';
  static const String keyExpiresAt = 'expiresAt';
  static const String keyAnnotations = 'annotations';
  static const String keyId = 'id';
  static const String keyUrl = 'url';
  static const String keyStatus = 'status';
  static const String keyText = 'text';
  static const String keyAuthor = 'author';
  static const String keyAt = 'at';
  static const String keyError = 'error';

  /// Human-readable error returned when a session ID is not found or expired.
  static const String errorNotFound = 'Session not found or expired.';

  final Map<String, Map<String, dynamic>> _sessions = {};

  /// Number of sessions currently stored (visible for testing).
  int get length => _sessions.length;

  /// Removes all sessions whose [keyExpiresAt] is in the past.
  void cleanExpired() {
    final now = DateTime.now().toUtc();

    _sessions.removeWhere((_, v) {
      final expiresAt = DateTime.tryParse(
        v[keyExpiresAt] as String? ?? '',
      );

      return expiresAt == null || now.isAfter(expiresAt);
    });
  }

  /// Creates a new session with the given [state] map.
  ///
  /// Returns `{id, url, expiresAt}` on success.
  Map<String, dynamic> create(Map<String, dynamic> state) {
    final id = DateTime.now()
        .toUtc()
        .millisecondsSinceEpoch
        .toRadixString(_radixBase36);

    cleanExpired();

    // Evict oldest sessions when at capacity.
    while (_sessions.length >= maxSessions) {
      final oldest = _sessions.keys.isEmpty ? null : _sessions.keys.first;
      if (oldest == null) {
        break;
      }
      _sessions.remove(oldest);
    }

    final now = DateTime.now().toUtc();
    final expiresAt = now.add(sessionExpiry).toIso8601String();

    _sessions[id] = <String, dynamic>{
      keyState: state,
      keyCreatedAt: now.toIso8601String(),
      keyExpiresAt: expiresAt,
      keyAnnotations: <Map<String, dynamic>>[],
    };

    return <String, dynamic>{
      keyId: id,
      keyUrl: '/?session=$id',
      keyExpiresAt: expiresAt,
    };
  }

  /// Returns the session for [id], or `null` if not found / expired.
  Map<String, dynamic>? get(String id) {
    cleanExpired();

    return _sessions[id];
  }

  /// Appends an annotation to the session identified by [id].
  ///
  /// Returns `true` if the session was found and annotated, `false` otherwise.
  bool annotate(
    String id, {
    required String text,
    required String author,
  }) {
    final session = _sessions[id];
    if (session == null) {
      return false;
    }

    final annotations = session[keyAnnotations];

    if (annotations is! List<Map<String, dynamic>>) {
      return false;
    }

    annotations.add(<String, dynamic>{
      keyText: text,
      keyAuthor: author,
      keyAt: DateTime.now().toUtc().toIso8601String(),
    });

    return true;
  }

  @override
  String toString() => 'DriftDebugSessionStore(sessions: ${_sessions.length})';
}
