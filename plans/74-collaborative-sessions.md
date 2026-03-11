# Feature 14: Collaborative Debug Sessions

**Effort:** M (Medium) | **Priority:** 9

## Overview

Generate shareable URLs that encode the current viewer state (selected table, SQL query, filters, etc.) with optional text annotations. Teammates can open the URL to see the same view. Annotations are stored server-side in memory during the session with auto-expiry.

**User value:** "Hey, look at this weird data in the orders table" — share a link instead of a screenshot. Teammate sees the exact same view with your notes.

## Architecture

### Server-side (Dart)

Add three endpoints:

- `POST /api/session/share` — Create a session with captured state
- `GET /api/session/{id}` — Retrieve session state
- `POST /api/session/{id}/annotate` — Add a text annotation

Sessions stored in an in-memory map with 1-hour auto-expiry and max 50 sessions.

### Client-side (JS)

Add a "Share" button in the header. Captures current state, creates session, copies URL to clipboard. On page load, checks for `?session=` parameter and restores state.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### Server-side Session Storage

```dart
static const Duration _sessionExpiry = Duration(hours: 1);
static const int _maxSessions = 50;

final Map<String, Map<String, dynamic>> _sharedSessions = {};

static const String _pathApiSessionShare = '/api/session/share';
static const String _pathApiSessionShareAlt = 'api/session/share';
static const String _pathApiSessionPrefix = '/api/session/';
static const String _pathApiSessionPrefixAlt = 'api/session/';
```

### Create Session: `POST /api/session/share`

```dart
Future<void> _handleSessionShare(HttpRequest request) async {
  final res = request.response;
  try {
    final builder = BytesBuilder();
    await for (final chunk in request) {
      builder.add(chunk);
    }
    final body = utf8.decode(builder.toBytes());
    final decoded = jsonDecode(body) as Map<String, dynamic>;

    // Generate short ID
    final id = DateTime.now().toUtc().millisecondsSinceEpoch
        .toRadixString(36);

    // Clean expired sessions
    _cleanExpiredSessions();

    // Enforce max sessions (evict oldest)
    while (_sharedSessions.length >= _maxSessions) {
      _sharedSessions.remove(_sharedSessions.keys.first);
    }

    final now = DateTime.now().toUtc();
    _sharedSessions[id] = <String, dynamic>{
      'state': decoded,
      'createdAt': now.toIso8601String(),
      'expiresAt': now.add(_sessionExpiry).toIso8601String(),
      'annotations': <Map<String, dynamic>>[],
    };

    _setJsonHeaders(res);
    res.write(jsonEncode(<String, dynamic>{
      'id': id,
      'url': '/?session=$id',
      'expiresAt': now.add(_sessionExpiry).toIso8601String(),
    }));
  } on Object catch (error, stack) {
    _logError(error, stack);
    await _sendErrorResponse(res, error);
  } finally {
    await res.close();
  }
}

void _cleanExpiredSessions() {
  final now = DateTime.now().toUtc();
  _sharedSessions.removeWhere((_, v) {
    final expiresAt = DateTime.tryParse(
      v['expiresAt'] as String? ?? '',
    );
    return expiresAt == null || now.isAfter(expiresAt);
  });
}
```

### Retrieve Session: `GET /api/session/{id}`

```dart
Future<void> _handleSessionGet(
  HttpResponse response,
  String sessionId,
) async {
  final res = response;
  _cleanExpiredSessions();
  final session = _sharedSessions[sessionId];
  if (session == null) {
    res.statusCode = HttpStatus.notFound;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: 'Session not found or expired.',
    }));
    await res.close();

   return;
  }
  _setJsonHeaders(res);
  res.write(jsonEncode(session));
  await res.close();
}
```

### Add Annotation: `POST /api/session/{id}/annotate`

```dart
Future<void> _handleSessionAnnotate(
  HttpRequest request,
  String sessionId,
) async {
  final res = request.response;
  final session = _sharedSessions[sessionId];
  if (session == null) {
    res.statusCode = HttpStatus.notFound;
    _setJsonHeaders(res);
    res.write(jsonEncode(<String, String>{
      _jsonKeyError: 'Session not found or expired.',
    }));
    await res.close();

   return;
  }

  final builder = BytesBuilder();
  await for (final chunk in request) {
    builder.add(chunk);
  }
  final body = jsonDecode(utf8.decode(builder.toBytes()))
      as Map<String, dynamic>;

  final annotations = session['annotations'] as List<Map<String, dynamic>>;
  annotations.add(<String, dynamic>{
    'text': body['text'] ?? '',
    'author': body['author'] ?? 'anonymous',
    'at': DateTime.now().toUtc().toIso8601String(),
  });

  _setJsonHeaders(res);
  res.write(jsonEncode(<String, String>{'status': 'added'}));
  await res.close();
}
```

### Route Registration

```dart
// In _onRequest():
if (req.method == _methodPost && (path == _pathApiSessionShare || path == _pathApiSessionShareAlt)) {
  await _handleSessionShare(req);
  return;
}
if (path.startsWith(_pathApiSessionPrefix) || path.startsWith(_pathApiSessionPrefixAlt)) {
  final suffix = path.startsWith(_pathApiSessionPrefix)
      ? path.substring(_pathApiSessionPrefix.length)
      : path.substring(_pathApiSessionPrefixAlt.length);
  if (suffix.endsWith('/annotate') && req.method == _methodPost) {
    final sessionId = suffix.replaceFirst(RegExp(r'/annotate$'), '');
    await _handleSessionAnnotate(req, sessionId);

   return;
  }
  if (req.method == _methodGet) {
    await _handleSessionGet(res, suffix);

   return;
  }
}
```

### Response Shapes

**Create session:**

```json
{
  "id": "m5k2a7b",
  "url": "/?session=m5k2a7b",
  "expiresAt": "2026-03-07T13:00:00.000Z"
}
```

**Retrieve session:**

```json
{
  "state": {
    "currentTable": "orders",
    "sqlInput": "SELECT * FROM orders WHERE total > 100",
    "searchTerm": "",
    "theme": "dark",
    "limit": 50,
    "offset": 0,
    "note": "Check these high-value orders"
  },
  "createdAt": "2026-03-07T12:00:00.000Z",
  "expiresAt": "2026-03-07T13:00:00.000Z",
  "annotations": [
    {
      "text": "user_id 42 looks suspicious",
      "author": "Craig",
      "at": "2026-03-07T12:05:00.000Z"
    }
  ]
}
```

### Client-side State Capture and Sharing

```javascript
// Capture current viewer state
function captureViewerState() {
  return {
    currentTable: currentTableName,
    sqlInput: document.getElementById("sql-input").value,
    searchTerm: document.getElementById("search-input")
      ? document.getElementById("search-input").value
      : "",
    theme: localStorage.getItem(THEME_KEY),
    limit: limit,
    offset: offset,
    timestamp: new Date().toISOString(),
  };
}

// Share button
document.getElementById("share-btn").addEventListener("click", function () {
  var note = prompt("Add a note for your team (optional):");
  var state = captureViewerState();
  if (note) state.note = note;

  fetch(
    "/api/session/share",
    authOpts({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }),
  )
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      var shareUrl = location.origin + location.pathname + data.url;
      navigator.clipboard
        .writeText(shareUrl)
        .then(function () {
          alert(
            "Share URL copied to clipboard!\n\n" +
              shareUrl +
              "\n\nExpires: " +
              new Date(data.expiresAt).toLocaleString(),
          );
        })
        .catch(function () {
          prompt("Copy this share URL:", shareUrl);
        });
    })
    .catch(function (e) {
      alert("Failed to create share: " + e.message);
    });
});
```

### Session Restoration on Page Load

```javascript
(function restoreSession() {
  var params = new URLSearchParams(location.search);
  var sessionId = params.get("session");
  if (!sessionId) return;

  fetch("/api/session/" + encodeURIComponent(sessionId), authOpts())
    .then(function (r) {
      if (!r.ok) throw new Error("Session expired or not found");
      return r.json();
    })
    .then(function (data) {
      var state = data.state || {};

      // Restore UI state
      if (state.currentTable) {
        // Wait for table list to load, then select table
        setTimeout(function () {
          loadTable(state.currentTable);
        }, 500);
      }

      if (state.sqlInput) {
        document.getElementById("sql-input").value = state.sqlInput;
      }

      if (state.searchTerm && document.getElementById("search-input")) {
        document.getElementById("search-input").value = state.searchTerm;
      }

      if (state.limit) limit = state.limit;
      if (state.offset) offset = state.offset;

      // Show session info bar
      var infoBar = document.createElement("div");
      infoBar.style.cssText =
        "background:var(--link);color:var(--bg);padding:0.3rem 0.5rem;font-size:12px;text-align:center;";
      var info = "Shared session";
      if (state.note) info += ': "' + state.note + '"';
      info += " (created " + new Date(data.createdAt).toLocaleString() + ")";
      infoBar.textContent = info;
      document.body.prepend(infoBar);

      // Show annotations
      var annotations = data.annotations || [];
      if (annotations.length > 0) {
        var annoEl = document.createElement("div");
        annoEl.style.cssText =
          "background:var(--bg-pre);padding:0.3rem 0.5rem;font-size:11px;border-left:3px solid var(--link);margin:0.3rem 0;";
        var annoHtml = "<strong>Annotations:</strong><br>";
        annotations.forEach(function (a) {
          annoHtml +=
            '<span class="meta">[' +
            esc(a.author) +
            " at " +
            new Date(a.at).toLocaleTimeString() +
            "]</span> " +
            esc(a.text) +
            "<br>";
        });
        annoEl.innerHTML = annoHtml;
        document.body.children[1]
          ? document.body.insertBefore(annoEl, document.body.children[1])
          : document.body.appendChild(annoEl);
      }
    })
    .catch(function (e) {
      console.warn("Session restore failed:", e.message);
    });
})();
```

### UI: Share Button (in header, ~line 1567)

```html
<button
  type="button"
  id="share-btn"
  title="Share current view with your team"
  style="font-size:11px;"
>
  Share
</button>
```

## Effort Estimate

**M (Medium)**

- Server: ~80 lines (3 endpoints + session storage + cleanup)
- Client: ~80 lines JS (state capture, sharing, restoration, annotations display)
- HTML: ~3 lines
- In-memory storage keeps it simple

## Dependencies & Risks

- **Sessions are in-memory**: Lost on server restart. Acceptable for a debug tool — sessions are ephemeral by design.
- **Same server required**: All participants must reach the same server instance. Works naturally for local dev; for remote, the existing ngrok/tunnel + auth support enables this.
- **Clipboard API**: Requires HTTPS or localhost. The default `127.0.0.1` satisfies this.
- **State restoration timing**: Table list must load before restoring `currentTable`. The `setTimeout` is a pragmatic workaround; a more robust approach would use a callback.
- **Max 50 sessions with 1-hour expiry**: Prevents memory leaks. 50 sessions with typical state data (~1 KB each) uses ~50 KB.
- **No authentication on session retrieval**: Anyone with the session ID can read the state. Acceptable since the debug server itself may have auth, and sessions contain no sensitive data (just table names, SQL, UI state).

## Testing Strategy

1. **Round-trip**: POST /api/session/share with state, GET /api/session/{id} — verify state matches
2. **Expiry**: Create session, wait (or mock time), verify 404 on GET
3. **Max sessions**: Create 51 sessions — verify oldest is evicted
4. **Annotations**: Add annotation to session, retrieve — verify it's included
5. **404**: GET /api/session/nonexistent — verify 404 with error message
6. **Manual workflow**:
   - Open viewer, navigate to a table, write SQL, click Share
   - Copy URL, open in new tab
   - Verify same table and SQL are shown
   - Add annotation from second tab, refresh — verify annotation appears
7. **Clipboard**: Verify URL is copied on Share click (test with clipboard API available and unavailable)
