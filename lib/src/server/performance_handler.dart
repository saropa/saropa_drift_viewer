// Performance handler extracted from _DriftDebugServerImpl.
// Handles query performance analytics.

import 'dart:convert';
import 'dart:io';

import 'server_context.dart';
import 'server_types.dart';

/// Handles performance analytics API endpoints.
final class PerformanceHandler {
  /// Creates a [PerformanceHandler] with the given [ServerContext].
  PerformanceHandler(this._ctx);

  final ServerContext _ctx;

  /// GET /api/analytics/performance — returns query timing stats,
  /// slow queries, and patterns.
  Future<void> handlePerformanceAnalytics(HttpResponse response) async {
    final res = response;

    try {
      final timings = List<QueryTiming>.of(_ctx.queryTimings);
      final totalQueries = timings.length;
      final totalDuration = timings.fold<int>(
        0,
        (sum, t) => sum + t.durationMs,
      );
      final avgDuration =
          totalQueries > 0 ? (totalDuration / totalQueries).round() : 0;

      // Slow queries (> 100ms), sorted by duration desc.
      final slowQueries = timings.where((t) => t.durationMs > 100).toList()
        ..sort((a, b) => b.durationMs.compareTo(a.durationMs));

      // Group by SQL pattern (first 60 chars) for frequency.
      final queryGroups = <String, List<QueryTiming>>{};

      for (final t in timings) {
        final key = t.sql.trim().length > 60
            ? t.sql.trim().substring(0, 60)
            : t.sql.trim();

        queryGroups.putIfAbsent(key, () => []).add(t);
      }

      final patterns = queryGroups.entries.map((e) {
        final durations = e.value.map((t) => t.durationMs).toList();
        final total = durations.fold<int>(0, (a, b) => a + b);
        final avg = total / durations.length;
        final max = durations.fold<int>(0, (a, b) => a > b ? a : b);

        return <String, dynamic>{
          'pattern': e.key,
          'count': durations.length,
          'avgMs': avg.round(),
          'maxMs': max,
          'totalMs': total,
        };
      }).toList()
        ..sort((a, b) => ((b['totalMs'] as int?) ?? 0)
            .compareTo((a['totalMs'] as int?) ?? 0));

      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, dynamic>{
        'totalQueries': totalQueries,
        'totalDurationMs': totalDuration,
        'avgDurationMs': avgDuration,
        'slowQueries': slowQueries.take(20).map((t) => t.toJson()).toList(),
        'queryPatterns': patterns.take(20).toList(),
        'recentQueries':
            timings.reversed.take(50).map((t) => t.toJson()).toList(),
      }));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);

      return;
    }

    await res.close();
  }

  /// DELETE /api/analytics/performance — clears all recorded query
  /// timings.
  Future<void> clearPerformanceData(HttpResponse response) async {
    final res = response;

    try {
      _ctx.queryTimings.clear();
      _ctx.setJsonHeaders(res);
      res.write(jsonEncode(<String, String>{'status': 'cleared'}));
    } on Object catch (error, stack) {
      _ctx.logError(error, stack);
      await _ctx.sendErrorResponse(res, error);

      return;
    }

    await res.close();
  }
}
