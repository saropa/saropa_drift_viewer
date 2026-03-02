import 'dart:developer' as developer;
import 'dart:io';

/// Best-practice error and message logger for the Drift debug server.
///
/// Uses [developer.log] for errors (with optional stack traces) so IDEs and
/// debugging tools can display them. The error callback is defensive (never
/// throws) so it is safe to use from catch blocks.
///
/// Example:
/// ```dart
/// DriftDebugServer.start(
///   query: runQuery,
///   onLog: DriftDebugErrorLogger.logCallback(prefix: 'DriftDebug'),
///   onError: DriftDebugErrorLogger.errorCallback(prefix: 'DriftDebug'),
/// );
/// ```
abstract final class DriftDebugErrorLogger {
  DriftDebugErrorLogger._();

  /// Default prefix used in log messages when none is provided.
  static const String defaultPrefix = 'DriftDebug';

  /// Creates a [DriftDebugOnLog]-compatible callback that logs messages.
  ///
  /// [prefix] is prepended to messages for easier filtering. If [useDeveloperLog]
  /// is true (default), uses [developer.log]; otherwise writes to [stderr]
  /// (avoids [print] for linter compliance). Logging never throws.
  static void Function(String message) logCallback({
    String prefix = defaultPrefix,
    bool useDeveloperLog = true,
  }) {
    return (String message) {
      try {
        final String line = prefix.isEmpty ? message : '[$prefix] $message';
        if (useDeveloperLog) {
          developer.log(line, name: prefix.isEmpty ? 'DriftDebug' : prefix);
        } else {
          stderr.writeln(line);
        }
      } on Object catch (_) {
        // Defensive: never let logging throw.
      }
    };
  }

  /// Creates a [DriftDebugOnError]-compatible callback that logs errors and
  /// optionally stack traces.
  ///
  /// [prefix] is included in the log name for filtering. When [includeStack]
  /// is true (default), the stack trace is passed to [developer.log] so
  /// tools can display it. Logging never throws.
  static void Function(Object error, StackTrace stack) errorCallback({
    String prefix = defaultPrefix,
    bool includeStack = true,
    bool useDeveloperLog = true,
  }) {
    return (Object error, StackTrace stack) {
      try {
        final String name = prefix.isEmpty ? 'DriftDebug' : prefix;
        if (useDeveloperLog) {
          developer.log(
            error.toString(),
            name: name,
            level: 1000, // SEVERE
            error: error,
            stackTrace: includeStack ? stack : null,
          );
        } else {
          // Use stderr (not print) for avoid_print linter compliance.
          final buffer = StringBuffer();
          buffer.writeln('[$name] $error');
          if (includeStack) buffer.writeln(stack);
          stderr.writeln(buffer);
        }
      } on Object catch (_) {
        // Defensive: never let logging throw.
      }
    };
  }

  /// Convenience: both [logCallback] and [errorCallback] with the same [prefix].
  static ({void Function(String) log, void Function(Object, StackTrace) error}) callbacks({
    String prefix = defaultPrefix,
    bool includeStack = true,
    bool useDeveloperLog = true,
  }) {
    return (
      log: logCallback(prefix: prefix, useDeveloperLog: useDeveloperLog),
      error: errorCallback(
        prefix: prefix,
        includeStack: includeStack,
        useDeveloperLog: useDeveloperLog,
      ),
    );
  }
}
