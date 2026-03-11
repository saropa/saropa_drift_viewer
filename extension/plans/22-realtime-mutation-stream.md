# Feature 22: Real-time Mutation Stream

## What It Does

A live scrolling feed of every INSERT, UPDATE, and DELETE happening in the database, as they happen. Filterable by table, operation type, and column. Each event links back to the affected row in the table viewer. It's `tail -f` for your database.

## User Experience

1. Command palette → "Saropa Drift Advisor: Open Mutation Stream" or click the stream icon in the tree view toolbar
2. A webview panel opens showing a real-time feed:

```
╔═══════════════════════════════════════════════════════════╗
║  MUTATION STREAM                     [Filter ▼] [⏸ Pause]║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  10:42:31.004  INSERT  users      id=142                 ║
║    + name: "Eve Chen"                                     ║
║    + email: "eve@example.com"                             ║
║    + created_at: "2026-03-10T10:42:31Z"                  ║
║                                                           ║
║  10:42:31.127  UPDATE  orders     id=89                  ║
║    ~ status: "pending" → "shipped"                       ║
║    ~ updated_at: "…30Z" → "…31Z"                         ║
║                                                           ║
║  10:42:31.203  DELETE  sessions   id=7                   ║
║    - user_id: 42                                          ║
║    - token: "abc…"                                        ║
║                                                           ║
║  10:42:31.450  INSERT  orders     id=201                 ║
║    + user_id: 142                                         ║
║    + total: 49.99                                         ║
║                                                           ║
║  ──── 47 events captured, 12 filtered ────               ║
╚═══════════════════════════════════════════════════════════╝
```

3. Color coding: green for INSERT, yellow for UPDATE, red for DELETE
4. Click any event → opens the affected row in the table data viewer
5. Filter bar: select tables, operation types, or search column values
6. Pause/Resume button to freeze the stream while inspecting
7. "Export" button to save captured events as JSON

## New Files

### Server-Side (Dart)

```
lib/src/server/
  mutation_handler.dart       # GET /api/mutations endpoint (SSE or polling)
lib/src/
  mutation_tracker.dart       # Wraps write callback to capture mutations
```

### Extension-Side (TypeScript)

```
extension/src/
  mutation-stream/
    mutation-stream-panel.ts  # Webview panel lifecycle
    mutation-stream-html.ts   # HTML/CSS/JS template
    mutation-client.ts        # Consumes mutation events from server
    mutation-types.ts         # Shared event interfaces
extension/src/test/
  mutation-client.test.ts
```

## Dependencies

- Server: `server_context.dart` — needs `writeQuery` callback wrapping
- Extension: `api-client.ts` — new `mutations()` endpoint
- Extension: `generation-watcher.ts` — fallback polling trigger

## Architecture

### Server-Side: Mutation Tracker

The core challenge: SQLite doesn't expose an `update_hook` via the Drift callback interface. Instead, we wrap the `writeQuery` callback to capture before/after state:

```dart
class MutationTracker {
  final List<MutationEvent> _events = [];
  static const int _maxEvents = 500;

  /// Wraps a write query to detect mutations.
  /// Called by the router when writeQuery is available.
  Future<List<Map<String, dynamic>>> trackingWrite(
    String sql,
    DriftDebugWriteQuery originalWrite,
    DriftDebugQuery readQuery,
  ) async {
    final parsed = _parseMutation(sql);
    if (parsed == null) {
      return originalWrite(sql);
    }

    // Capture before state (for UPDATE/DELETE)
    List<Map<String, dynamic>>? beforeRows;
    if (parsed.type != MutationType.insert) {
      beforeRows = await readQuery(
        'SELECT * FROM "${parsed.table}" WHERE ${parsed.whereClause}',
      );
    }

    // Execute the mutation
    final result = await originalWrite(sql);

    // Capture after state (for INSERT/UPDATE)
    List<Map<String, dynamic>>? afterRows;
    if (parsed.type != MutationType.delete) {
      if (parsed.type == MutationType.insert) {
        afterRows = await readQuery(
          'SELECT * FROM "${parsed.table}" WHERE rowid = last_insert_rowid()',
        );
      } else {
        afterRows = await readQuery(
          'SELECT * FROM "${parsed.table}" WHERE ${parsed.whereClause}',
        );
      }
    }

    _events.add(MutationEvent(
      type: parsed.type,
      table: parsed.table,
      beforeRows: beforeRows,
      afterRows: afterRows,
      sql: sql,
      timestamp: DateTime.now(),
    ));

    if (_events.length > _maxEvents) {
      _events.removeRange(0, _events.length - _maxEvents);
    }

    return result;
  }
}
```

### Server-Side: Mutation Event

```dart
enum MutationType { insert, update, delete }

class MutationEvent {
  final MutationType type;
  final String table;
  final List<Map<String, dynamic>>? beforeRows;
  final List<Map<String, dynamic>>? afterRows;
  final String sql;
  final DateTime timestamp;
  final int id;  // monotonic counter

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type.name,
    'table': table,
    'before': beforeRows,
    'after': afterRows,
    'sql': sql,
    'timestamp': timestamp.toIso8601String(),
  };
}
```

### Server-Side: Mutation Handler

```dart
class MutationHandler {
  final MutationTracker _tracker;

  /// GET /api/mutations?since=N
  /// Returns events with id > N. Long-polls if no new events (up to 30s).
  Future<void> handle(HttpRequest request, HttpResponse response) async {
    final since = int.tryParse(
      request.uri.queryParameters['since'] ?? '0',
    ) ?? 0;

    final events = _tracker.eventsSince(since);
    if (events.isEmpty) {
      // Long-poll: wait up to 30s for new events
      await _tracker.waitForEvent(timeout: Duration(seconds: 30));
      events = _tracker.eventsSince(since);
    }

    response
      ..headers.contentType = ContentType.json
      ..write(jsonEncode({
        'events': events.map((e) => e.toJson()).toList(),
        'cursor': _tracker.latestId,
      }));
    await response.close();
  }
}
```

### Extension-Side: Mutation Client

Polls the mutation endpoint, processes events:

```typescript
interface IMutationEvent {
  id: number;
  type: 'insert' | 'update' | 'delete';
  table: string;
  before: Record<string, unknown>[] | null;
  after: Record<string, unknown>[] | null;
  sql: string;
  timestamp: string;
}

class MutationClient implements vscode.Disposable {
  private _cursor = 0;
  private _polling = false;
  private _onEvent = new vscode.EventEmitter<IMutationEvent[]>();
  readonly onEvent = this._onEvent.event;

  async startPolling(): Promise<void> {
    this._polling = true;
    while (this._polling) {
      try {
        const resp = await this._client.mutations(this._cursor);
        if (resp.events.length > 0) {
          this._cursor = resp.cursor;
          this._onEvent.fire(resp.events);
        }
      } catch {
        await this._delay(2000); // back off on error
      }
    }
  }

  stopPolling(): void { this._polling = false; }
}
```

### Data Flow

```
App writes to DB
    │
    ▼
MutationTracker.trackingWrite()
    │
    ├── Capture before state (SELECT)
    ├── Execute original write
    ├── Capture after state (SELECT)
    ├── Store MutationEvent in ring buffer
    │
    ▼
GET /api/mutations?since=N  (long-poll)
    │
    ▼
MutationClient.onEvent
    │
    ▼
MutationStreamPanel renders event cards
```

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.openMutationStream",
        "title": "Saropa Drift Advisor: Open Mutation Stream",
        "icon": "$(pulse)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.openMutationStream",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.mutationStream.maxEvents": {
          "type": "number",
          "default": 500,
          "description": "Maximum events to display in the mutation stream."
        },
        "driftViewer.mutationStream.autoScroll": {
          "type": "boolean",
          "default": true,
          "description": "Auto-scroll to latest events."
        }
      }
    }
  }
}
```

## Wiring in extension.ts

```typescript
const mutationClient = new MutationClient(client);

context.subscriptions.push(
  mutationClient,
  vscode.commands.registerCommand('driftViewer.openMutationStream', () => {
    MutationStreamPanel.createOrShow(context.extensionUri, mutationClient);
    if (!mutationClient.isPolling) {
      mutationClient.startPolling();
    }
  })
);
```

## Testing

### Dart Tests
- `mutation_tracker_test.dart`: test that INSERT/UPDATE/DELETE are captured with correct before/after state
- Test ring buffer eviction when exceeding `_maxEvents`
- Test SQL parsing for table and WHERE clause extraction

### Extension Tests
- `mutation-client.test.ts`: test cursor advancement, event deduplication, reconnection on error

## Known Limitations

- Requires `writeQuery` callback — if the app uses read-only mode, no mutations are captured
- Before/after capture adds two extra SELECT queries per write operation — performance overhead
- SQL parsing is regex-based — complex INSERT/UPDATE/DELETE with subqueries may not parse correctly
- Ring buffer (500 events) means old events are lost — no persistent storage
- Long-poll timeout (30s) means up to 30s delay if no events occur (not a real-time issue)
- Bulk operations (INSERT...SELECT, multi-row INSERT) may appear as a single event
- No support for DDL mutations (CREATE TABLE, ALTER TABLE) — data mutations only
