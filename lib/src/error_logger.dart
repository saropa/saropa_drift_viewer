import 'dart:developer' as developer;

/// True when not a product build; used to avoid emitting stack traces in release (avoid_stack_trace_in_production).
bool _isDebugEnvironment() =>
    !bool.fromEnvironment('dart.vm.product', defaultValue: false);

/// Logger name used when the log/error callback itself throws (so failures are visible in dev tools).
const String _kLoggerFailureName = 'DriftDebugErrorLogger';

/// Type for the pair of log and error callbacks returned by [DriftDebugErrorLogger.callbacks].
typedef DriftDebugLoggerCallbacks = ({
  void Function(String message) log,
  void Function(Object error, StackTrace stack) error,
});

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
  const DriftDebugErrorLogger._();

  /// Default prefix used in log messages when none is provided.
  static const String defaultPrefix = 'DriftDebug';

  /// Creates a [DriftDebugOnLog]-compatible callback that logs messages.
  ///
  /// [prefix] is prepended to messages for easier filtering. Uses [developer.log]
  /// so IDEs and debugging tools can display output. Logging never throws.
  /// Empty [message] is allowed (logged as-is). Empty [prefix] uses the default prefix constant for the log name.
  /// [useDeveloperLog] is reserved for future use; logging always uses [developer.log].
  ///
  /// Returns a function that logs the given [message] with optional [prefix].
  static void Function(String message) logCallback({
    String prefix = defaultPrefix,
    bool useDeveloperLog = true,
  }) {
    return (String message) {
      try {
        final String line = prefix.isEmpty ? message : '[$prefix] $message';
        final String name = prefix.isEmpty ? defaultPrefix : prefix;
        developer.log(line, name: name);
      } on Object catch (e, st) {
        // Defensive: if the logging call fails (e.g. encoding), report it without rethrowing.
        developer.log(
          'Log callback failed',
          name: _kLoggerFailureName,
          error: e,
          stackTrace: _isDebugEnvironment() ? st : null,
        );
      }
    };
  }

  /// Log level for error entries (SEVERE) so dev tools can treat them as errors.
  static const int _severityLevel = 1000;

  /// Creates a [DriftDebugOnError]-compatible callback that logs errors and
  /// optionally stack traces.
  ///
  /// [prefix] is included in the log name for filtering. When [includeStack]
  /// is true (default), the stack trace is passed to [developer.log] only in
  /// debug builds (avoid_stack_trace_in_production). Logging never throws.
  /// Empty [prefix] uses the default prefix constant for the log name.
  /// [useDeveloperLog] is reserved for future use.
  ///
  /// Returns a function that logs the given [error] and [stack] with optional [prefix].
  static void Function(Object error, StackTrace stack) errorCallback({
    String prefix = defaultPrefix,
    bool includeStack = true,
    bool useDeveloperLog = true,
  }) {
    return (Object error, StackTrace stack) {
      try {
        final String name = prefix.isEmpty ? defaultPrefix : prefix;
        final bool includeTrace =
            includeStack && _isDebugEnvironment();
        developer.log(
          error.toString(),
          name: name,
          level: _severityLevel,
          error: error,
          stackTrace: includeTrace ? stack : null,
        );
      } on Object catch (e, st) {
        // Defensive: error callback must not throw so server catch blocks stay safe.
        developer.log(
          'Error callback failed',
          name: _kLoggerFailureName,
          error: e,
          stackTrace: _isDebugEnvironment() ? st : null,
        );
      }
    };
  }

  /// Convenience: returns both log and error callbacks with the same [prefix],
  /// [includeStack], and [useDeveloperLog] options.
  static DriftDebugLoggerCallbacks callbacks({
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
