# Feature 26: Query Replay DVR

## What It Does

Record every SQL query your app executes during a debug session — with timestamps, parameters, execution time, and affected rows. Then scrub through them like a video timeline, stepping forward and back to see the database state at each point. Find "which query corrupted this row?" instantly.

## User Experience

### 1. Recording

1. Start a debug session — recording begins automatically (configurable)
2. A status bar item shows: "DVR: Recording (47 queries)"
3. Click the status bar item → opens the DVR panel

### 2. DVR Panel

```
╔═══════════════════════════════════════════════════════════╗
║  QUERY REPLAY DVR                    [⏸ Pause] [⏹ Stop]  ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Timeline: ◀ ││◀ [====|====================] ▶│││ ▶      ║
║            #23 of 147 queries          10:42:31.004       ║
║                                                           ║
║  ┌─ Current Query ──────────────────────────────────────┐║
║  │  #23  10:42:31.004  (2.1ms)  UPDATE                  ║
║  │                                                       ║
║  │  UPDATE "users" SET "name" = 'Alice Smith'            ║
║  │  WHERE "id" = 42                                      ║
║  │                                                       ║
║  │  Affected: 1 row                                      ║
║  └───────────────────────────────────────────────────────┘║
║                                                           ║
║  ┌─ State at this point ────────────────────────────────┐║
║  │  users: 1,250 rows  │  orders: 3,401 rows            ║
║  │                                                       ║
║  │  Changed row (users.id=42):                           ║
║  │    name: "Alice" → "Alice Smith"  ← this query        ║
║  │    email: alice@example.com       (unchanged)         ║
║  └───────────────────────────────────────────────────────┘║
║                                                           ║
║  ┌─ Search ─────────────────────────────────────────────┐║
║  │  [Find query that changed users.id=42.name          ]║
║  └───────────────────────────────────────────────────────┘║
║                                                           ║
║  [Export Recording]  [Open in SQL Notebook]               ║
╚═══════════════════════════════════════════════════════════╝
```

### 3. Navigation

- **Step forward/back**: Arrow keys or `◀ ▶` buttons move one query at a time
- **Jump to start/end**: `Home`/`End` keys
- **Scrub**: Click anywhere on the timeline bar
- **Search**: "Find the query that changed `users.id=42.name`" — jumps to the exact query
- **Filter**: Show only writes (INSERT/UPDATE/DELETE) or only reads, or only specific tables

### 4. State Inspection

At each query position, the panel shows:
- The SQL that was executed
- Execution time
- Number of affected rows
- Before/after state for the affected rows (for writes)
- Table row counts at that point in time

## New Files

### Server-Side (Dart)

```
lib/src/server/
  dvr_handler.dart            # GET /api/dvr/* endpoints
lib/src/
  query_recorder.dart         # Records all queries passing through the callback
```

### Extension-Side (TypeScript)

```
extension/src/
  dvr/
    dvr-panel.ts              # Webview panel with timeline UI
    dvr-html.ts               # HTML/CSS/JS template
    dvr-client.ts             # Fetches recording data from server
    dvr-types.ts              # Shared interfaces
    dvr-search.ts             # Search/filter logic over recorded queries
extension/src/test/
  dvr-search.test.ts
```

## Dependencies

- Server: `server_context.dart` — intercepts `instrumentedQuery` and `writeQuery`
- Extension: `api-client.ts` — new DVR endpoints
- Extension: `generation-watcher.ts` — triggers panel refresh

## Architecture

### Server-Side: Query Recorder

Wraps both read and write query callbacks to capture every query:

```dart
class QueryRecorder {
  final List<RecordedQuery> _queries = [];
  bool _recording = false;
  int _nextId = 0;
  static const int _maxQueries = 5000;

  bool get isRecording => _recording;
  int get queryCount => _queries.length;

  void startRecording() {
    _recording = true;
    _queries.clear();
    _nextId = 0;
  }

  void stopRecording() {
    _recording = false;
  }

  /// Wraps a read query to record it.
  Future<List<Map<String, dynamic>>> recordRead(
    String sql,
    DriftDebugQuery originalQuery,
  ) async {
    final start = DateTime.now();
    final result = await originalQuery(sql);
    final elapsed = DateTime.now().difference(start);

    if (_recording) {
      _record(RecordedQuery(
        id: _nextId++,
        sql: sql,
        type: _classifySql(sql),
        timestamp: start,
        durationMs: elapsed.inMicroseconds / 1000.0,
        rowCount: result.length,
        resultPreview: result.take(5).toList(),
      ));
    }

    return result;
  }

  /// Wraps a write query to record it with before/after state.
  Future<List<Map<String, dynamic>>> recordWrite(
    String sql,
    DriftDebugWriteQuery originalWrite,
    DriftDebugQuery readQuery,
  ) async {
    List<Map<String, dynamic>>? beforeState;
    final parsed = _parseMutation(sql);

    // Capture before state
    if (_recording && parsed != null && parsed.type != QueryType.insert) {
      try {
        beforeState = await readQuery(
          'SELECT * FROM "${parsed.table}" WHERE ${parsed.whereClause} LIMIT 10',
        );
      } catch (_) {
        // Best effort — don't fail the write
      }
    }

    final start = DateTime.now();
    final result = await originalWrite(sql);
    final elapsed = DateTime.now().difference(start);

    List<Map<String, dynamic>>? afterState;
    if (_recording && parsed != null && parsed.type != QueryType.delete) {
      try {
        if (parsed.type == QueryType.insert) {
          afterState = await readQuery(
            'SELECT * FROM "${parsed.table}" ORDER BY rowid DESC LIMIT 1',
          );
        } else {
          afterState = await readQuery(
            'SELECT * FROM "${parsed.table}" WHERE ${parsed.whereClause} LIMIT 10',
          );
        }
      } catch (_) {}
    }

    if (_recording) {
      _record(RecordedQuery(
        id: _nextId++,
        sql: sql,
        type: _classifySql(sql),
        timestamp: start,
        durationMs: elapsed.inMicroseconds / 1000.0,
        rowCount: result.length,
        beforeState: beforeState,
        afterState: afterState,
        table: parsed?.table,
      ));
    }

    return result;
  }

  void _record(RecordedQuery query) {
    _queries.add(query);
    if (_queries.length > _maxQueries) {
      _queries.removeAt(0);
    }
  }
}
```

### Server-Side: DVR Handler

```dart
class DvrHandler {
  final QueryRecorder _recorder;

  /// GET /api/dvr/status
  /// Returns { recording: bool, queryCount: int }
  Future<void> handleStatus(HttpRequest request, HttpResponse response) async {
    _ctx.setJsonHeaders(response);
    response.write(jsonEncode({
      'recording': _recorder.isRecording,
      'queryCount': _recorder.queryCount,
    }));
    await response.close();
  }

  /// POST /api/dvr/start
  Future<void> handleStart(HttpRequest request, HttpResponse response) async {
    _recorder.startRecording();
    response.statusCode = HttpStatus.ok;
    await response.close();
  }

  /// POST /api/dvr/stop
  Future<void> handleStop(HttpRequest request, HttpResponse response) async {
    _recorder.stopRecording();
    response.statusCode = HttpStatus.ok;
    await response.close();
  }

  /// GET /api/dvr/queries?from=0&to=100
  /// Returns a page of recorded queries.
  Future<void> handleQueries(HttpRequest request, HttpResponse response) async {
    final from = int.tryParse(request.uri.queryParameters['from'] ?? '0') ?? 0;
    final to = int.tryParse(request.uri.queryParameters['to'] ?? '100') ?? 100;

    final queries = _recorder.queriesRange(from, to);
    _ctx.setJsonHeaders(response);
    response.write(jsonEncode({
      'queries': queries.map((q) => q.toJson()).toList(),
      'total': _recorder.queryCount,
    }));
    await response.close();
  }

  /// GET /api/dvr/query/:id
  /// Returns a single query with full before/after state.
  Future<void> handleQuery(HttpRequest request, HttpResponse response, int id) async {
    final query = _recorder.queryById(id);
    if (query == null) {
      response.statusCode = HttpStatus.notFound;
      await response.close();
      return;
    }
    _ctx.setJsonHeaders(response);
    response.write(jsonEncode(query.toJson()));
    await response.close();
  }
}
```

### Extension-Side: DVR Search

```typescript
interface IDvrSearchResult {
  queryId: number;
  matchType: 'table' | 'column' | 'value' | 'sql';
  highlight: string;
}

class DvrSearch {
  search(queries: IRecordedQuery[], term: string): IDvrSearchResult[] {
    const results: IDvrSearchResult[] = [];
    const lower = term.toLowerCase();

    for (const q of queries) {
      // Match in SQL text
      if (q.sql.toLowerCase().includes(lower)) {
        results.push({ queryId: q.id, matchType: 'sql', highlight: q.sql });
      }

      // Match in table name
      if (q.table?.toLowerCase().includes(lower)) {
        results.push({ queryId: q.id, matchType: 'table', highlight: q.table });
      }

      // Match in before/after state values
      for (const row of [...(q.beforeState ?? []), ...(q.afterState ?? [])]) {
        for (const [col, val] of Object.entries(row)) {
          if (String(val).toLowerCase().includes(lower) || col.toLowerCase().includes(lower)) {
            results.push({ queryId: q.id, matchType: 'value', highlight: `${col}: ${val}` });
            break; // one match per row is enough
          }
        }
      }
    }

    return results;
  }
}
```

### Data Flow

```
App executes SQL query
    │
    ▼
QueryRecorder.recordRead() / recordWrite()
    │
    ├── Capture before state (writes only)
    ├── Execute original query
    ├── Capture after state (writes only)
    ├── Store RecordedQuery in ring buffer
    │
    ▼
GET /api/dvr/queries?from=N&to=M
    │
    ▼
DVR Panel renders timeline
    │
    ├── User scrubs to query #23
    │
    ▼
GET /api/dvr/query/23
    │
    ▼
Panel shows SQL + before/after state
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.openDvr",
        "title": "Saropa Drift Advisor: Open Query Replay DVR",
        "icon": "$(record)"
      },
      {
        "command": "driftViewer.dvrStartRecording",
        "title": "Saropa Drift Advisor: Start DVR Recording"
      },
      {
        "command": "driftViewer.dvrStopRecording",
        "title": "Saropa Drift Advisor: Stop DVR Recording"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.openDvr",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected && inDebugMode",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.dvr.autoRecord": {
          "type": "boolean",
          "default": true,
          "description": "Automatically start recording when a debug session begins."
        },
        "driftViewer.dvr.maxQueries": {
          "type": "number",
          "default": 5000,
          "description": "Maximum number of queries to store in the DVR buffer."
        },
        "driftViewer.dvr.captureBeforeAfter": {
          "type": "boolean",
          "default": true,
          "description": "Capture row state before and after write queries (adds overhead)."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.openDvr', () => {
    DvrPanel.createOrShow(context.extensionUri, client);
  }),

  vscode.commands.registerCommand('driftViewer.dvrStartRecording', async () => {
    await client.dvrStart();
    dvrStatusBarItem.text = '$(record) DVR: Recording';
  }),

  vscode.commands.registerCommand('driftViewer.dvrStopRecording', async () => {
    await client.dvrStop();
    dvrStatusBarItem.text = '$(circle-slash) DVR: Stopped';
  })
);

// Status bar item
const dvrStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
dvrStatusBarItem.command = 'driftViewer.openDvr';
context.subscriptions.push(dvrStatusBarItem);

// Auto-record on debug start
if (vscode.workspace.getConfiguration('driftViewer.dvr').get('autoRecord', true)) {
  context.subscriptions.push(
    vscode.debug.onDidStartDebugSession(async () => {
      try {
        await client.dvrStart();
        dvrStatusBarItem.text = '$(record) DVR: Recording';
        dvrStatusBarItem.show();
      } catch { /* server not connected */ }
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      dvrStatusBarItem.hide();
    })
  );
}
```

## Testing

### Dart Tests
- `query_recorder_test.dart`:
  - Read queries are recorded with correct SQL, timestamp, duration
  - Write queries capture before/after state
  - Ring buffer evicts oldest queries at max capacity
  - Recording can be started/stopped independently
  - Queries during non-recording state are not captured
  - SQL classification (SELECT/INSERT/UPDATE/DELETE) is correct

### Extension Tests
- `dvr-search.test.ts`:
  - Search by SQL text
  - Search by table name
  - Search by column value in before/after state
  - No matches returns empty array
  - Case-insensitive matching

## Known Limitations

- Before/after state capture adds 2 extra queries per write — noticeable performance overhead
- Ring buffer (5000 queries) means early queries are lost in long sessions
- No persistent storage — recording is lost when the server stops
- SQL parsing for table/WHERE extraction is regex-based — may fail on complex queries
- Before/after state is limited to 10 rows per query — bulk operations show partial state
- Internal queries (from the debug server itself) are also recorded — may add noise
- No grouping of related queries (e.g., a transaction's queries aren't linked)
- Timeline scrubbing requires fetching full query details — may lag with slow network
- No "replay" of queries against a fresh database — it's observation only, not execution
