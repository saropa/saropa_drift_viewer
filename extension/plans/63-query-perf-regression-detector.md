# Feature 63: Query Performance Regression Detector

## What It Does

Track query execution times across debug sessions and alert when a query gets measurably slower after a code change. Builds on the existing Debug Performance feature (Feature 15) by persisting performance baselines and comparing against them. Shows inline trend charts per query so you can see if performance is improving or degrading over time.

## User Experience

1. Extension silently records query performance data during each debug session
2. At session end, performance data is persisted as a baseline
3. During next session, queries are compared against baseline
4. If a query regresses (>2x slower), a warning notification appears
5. Performance tree view shows trend indicators (↑ faster, ↓ slower, → stable)

```
╔══════════════════════════════════════════════════════════════╗
║  QUERY PERFORMANCE                                           ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ⚠ 2 regressions detected                                   ║
║                                                              ║
║  ↓ SELECT * FROM orders WHERE user_id = ?                   ║
║    Current: 45ms  Baseline: 12ms  (+275%)                    ║
║    Trend: ▁▂▂▃▅▇  (6 sessions)                              ║
║    Last good: session 4 (yesterday)                          ║
║    [Show EXPLAIN] [Set New Baseline]                         ║
║                                                              ║
║  ↓ SELECT COUNT(*) FROM audit_log                            ║
║    Current: 320ms  Baseline: 85ms  (+276%)                   ║
║    Trend: ▂▂▃▃▅▇  (6 sessions)                              ║
║    [Show EXPLAIN] [Set New Baseline]                         ║
║                                                              ║
║  → SELECT * FROM users WHERE id = ?                          ║
║    Current: 3ms  Baseline: 2ms  (stable)                     ║
║    Trend: ▂▂▂▂▂▂  (6 sessions)                              ║
║                                                              ║
║  ↑ SELECT * FROM products                                    ║
║    Current: 8ms  Baseline: 15ms  (-47%, faster)              ║
║    Trend: ▇▅▃▂▂▁  (6 sessions)                              ║
║                                                              ║
║  [Export Report] [Reset All Baselines]                        ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/perf-regression/
  perf-baseline-store.ts      # Persist and compare performance baselines
  perf-regression-types.ts    # Interfaces
extension/src/test/
  perf-baseline-store.test.ts
```

## Modified Files

```
extension/src/performance/performance-tree-provider.ts  # Add trend indicators
extension/src/extension.ts    # Register baseline capture on debug session end
extension/package.json         # Commands + configuration
```

## Dependencies

- `PerformanceTreeProvider` (Feature 15) — existing query timing data
- `api-client.ts` — `performance()` endpoint
- `vscode.Memento` (workspace state) — baseline persistence
- `vscode.debug.onDidTerminateDebugSession` — trigger baseline capture

## Architecture

### Baseline Store

Persists per-query performance data across sessions:

```typescript
interface IQueryBaseline {
  sqlNormalized: string;      // SQL with literals replaced by ?
  sessions: ISessionTiming[];  // Last N sessions
  baselineMs: number;          // Median of first 3 sessions
}

interface ISessionTiming {
  timestamp: number;
  avgMs: number;
  callCount: number;
  maxMs: number;
}

const BASELINE_KEY = 'driftViewer.perfBaselines';
const MAX_SESSIONS = 20;

class PerfBaselineStore {
  private readonly _onDidDetectRegression = new vscode.EventEmitter<IRegression[]>();
  readonly onDidDetectRegression = this._onDidDetectRegression.event;

  constructor(private readonly _state: vscode.Memento) {}

  getBaselines(): Map<string, IQueryBaseline> {
    const data = this._state.get<Record<string, IQueryBaseline>>(BASELINE_KEY, {});
    return new Map(Object.entries(data));
  }

  async recordSession(queries: IQueryPerformance[]): Promise<IRegression[]> {
    const baselines = this.getBaselines();
    const regressions: IRegression[] = [];

    for (const query of queries) {
      const key = normalizeQuery(query.sql);
      const baseline = baselines.get(key) ?? {
        sqlNormalized: key,
        sessions: [],
        baselineMs: query.avgMs,
      };

      baseline.sessions.push({
        timestamp: Date.now(),
        avgMs: query.avgMs,
        callCount: query.callCount,
        maxMs: query.maxMs,
      });

      // Trim to max sessions
      if (baseline.sessions.length > MAX_SESSIONS) {
        baseline.sessions = baseline.sessions.slice(-MAX_SESSIONS);
      }

      // Set baseline from first 3 sessions (median)
      if (baseline.sessions.length <= 3) {
        const sorted = baseline.sessions.map(s => s.avgMs).sort((a, b) => a - b);
        baseline.baselineMs = sorted[Math.floor(sorted.length / 2)];
      }

      // Detect regression (>2x baseline)
      if (query.avgMs > baseline.baselineMs * 2 && baseline.sessions.length >= 3) {
        regressions.push({
          sql: key,
          currentMs: query.avgMs,
          baselineMs: baseline.baselineMs,
          changePercent: Math.round((query.avgMs / baseline.baselineMs - 1) * 100),
          trend: baseline.sessions.map(s => s.avgMs),
        });
      }

      baselines.set(key, baseline);
    }

    await this._state.update(BASELINE_KEY, Object.fromEntries(baselines));

    if (regressions.length > 0) {
      this._onDidDetectRegression.fire(regressions);
    }

    return regressions;
  }

  async resetBaseline(sqlNormalized: string): Promise<void> {
    const baselines = this.getBaselines();
    const baseline = baselines.get(sqlNormalized);
    if (baseline && baseline.sessions.length > 0) {
      const latest = baseline.sessions[baseline.sessions.length - 1];
      baseline.baselineMs = latest.avgMs;
      baselines.set(sqlNormalized, baseline);
      await this._state.update(BASELINE_KEY, Object.fromEntries(baselines));
    }
  }

  async resetAll(): Promise<void> {
    await this._state.update(BASELINE_KEY, {});
  }
}
```

### Query Normalization

Strips literals to group equivalent queries:

```typescript
function normalizeQuery(sql: string): string {
  return sql
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/'[^']*'/g, '?')       // String literals → ?
    .replace(/\b\d+\b/g, '?')       // Numeric literals → ?
    .replace(/\?\s*,\s*\?/g, '?, ?'); // Clean up multiple ?
}
```

### Trend Visualization

Generates a spark-line string using Unicode block characters:

```typescript
function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const blocks = '▁▂▃▄▅▆▇█';
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  return values.map(v => {
    const idx = Math.round(((v - min) / range) * (blocks.length - 1));
    return blocks[idx];
  }).join('');
}

function trendDirection(baseline: IQueryBaseline): '↑' | '↓' | '→' {
  if (baseline.sessions.length < 2) return '→';
  const latest = baseline.sessions[baseline.sessions.length - 1].avgMs;
  const ratio = latest / baseline.baselineMs;
  if (ratio > 1.5) return '↓';  // Slower (regression)
  if (ratio < 0.67) return '↑'; // Faster (improvement)
  return '→';                    // Stable
}
```

### Debug Session Integration

Capture baseline at end of each debug session:

```typescript
// In extension.ts
vscode.debug.onDidTerminateDebugSession(async () => {
  if (!client.isConnected) return;
  try {
    const perfData = await client.performance();
    const regressions = await baselineStore.recordSession(perfData.queries);
    if (regressions.length > 0) {
      vscode.window.showWarningMessage(
        `${regressions.length} query performance regression${regressions.length > 1 ? 's' : ''} detected.`,
        'Show Details'
      ).then(choice => {
        if (choice === 'Show Details') {
          vscode.commands.executeCommand('driftViewer.refreshPerformance');
        }
      });
    }
  } catch {
    // Server may have shut down — ignore
  }
});
```

## Server-Side Changes

None. Uses existing `/api/analytics/performance` endpoint.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.resetPerfBaseline",
        "title": "Drift Viewer: Reset Performance Baseline"
      },
      {
        "command": "driftViewer.resetAllPerfBaselines",
        "title": "Drift Viewer: Reset All Performance Baselines"
      }
    ],
    "configuration": {
      "properties": {
        "driftViewer.perfRegression.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Track query performance across sessions and alert on regressions."
        },
        "driftViewer.perfRegression.threshold": {
          "type": "number",
          "default": 2.0,
          "minimum": 1.2,
          "maximum": 10.0,
          "description": "Regression multiplier threshold (2.0 = alert when query is 2x slower than baseline)."
        }
      }
    }
  }
}
```

## Testing

- `perf-baseline-store.test.ts`:
  - First session → sets baseline, no regression
  - Second session within threshold → no regression
  - Session 2x slower → regression detected
  - Regression event fires with correct data
  - Baseline uses median of first 3 sessions
  - Sessions trimmed to max 20
  - `resetBaseline` updates baseline to latest timing
  - `resetAll` clears all baselines
  - Query normalization: string literals, numbers, whitespace
  - Sparkline renders correct block characters
  - Trend direction: faster (↑), slower (↓), stable (→)
  - Debug session end triggers baseline capture
  - Server disconnected at session end → no crash

## Known Limitations

- Baseline only captured at debug session end — if the session crashes, data is lost
- Query normalization is heuristic — `WHERE id = 1` and `WHERE id = 2` are the same query, but `WHERE id = 1 AND name = 'foo'` and `WHERE name = 'foo' AND id = 1` are different
- Performance data comes from the server's 500-entry ring buffer — queries that fell out of the buffer aren't tracked
- No correlation with code changes — regressions show timing data but don't identify which code change caused the slowdown
- Timing includes network overhead to the debug server — not pure SQLite execution time
- First 3 sessions establish baseline — regressions can't be detected until session 4
