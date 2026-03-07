# Saropa Drift Viewer — WOW Features Roadmap

14 planned features to transform the debug viewer into a best-in-class database inspection tool.

## Feature Summary

| # | Feature | Effort | Priority | Deps |
|---|---------|--------|----------|------|
| [01](01-vscode-webview-panel.md) | VS Code Webview Panel | M | 4 | — |
| [02](02-natural-language-to-sql.md) | Natural Language to SQL | M | 10 | #10 metadata endpoint |
| [03](03-data-charts.md) | Data Charts & Visualizations | L | 12 | — | DONE |
| [04](04-explain-plan-viewer.md) | Query EXPLAIN Plan Viewer | S | 1 | — |
| [05](05-smart-index-suggestions.md) | Smart Index Suggestions | M | 6 | — |
| [06](06-data-bookmarks.md) | Data Bookmarks & Saved Queries | S | 2 | — |
| [07](07-row-level-diff.md) | Row-Level Diff (Time Travel) | M | 8 | Existing snapshot |
| [08](08-interactive-relationships.md) | Interactive Table Relationships | M | 5 | — |
| [09](09-data-import.md) | Data Import (Debug Only) | L | 14 | New writeQuery API |
| [10](10-database-size-analytics.md) | Database Size Analytics | S | 3 | — |
| [11](11-anomaly-detection.md) | AI Data Anomaly Detection | L | 13 | — |
| [12](12-migration-diff-preview.md) | Migration Diff Preview | M | 11 | Existing queryCompare |
| [13](13-query-performance-monitor.md) | Live Query Performance Monitor | M | 7 | — |
| [14](14-collaborative-sessions.md) | Collaborative Debug Sessions | M | 9 | — |

## Recommended Implementation Order

**Sprint 1 — Quick wins (S-size, 1-2 days each):**
1. #04 EXPLAIN Plan Viewer
2. #06 Data Bookmarks & Saved Queries
3. #10 Database Size Analytics

**Sprint 2 — Core enhancements (M-size, 2-3 days each):**
4. #01 VS Code Webview Panel
5. #08 Interactive Table Relationships
6. #05 Smart Index Suggestions
7. #13 Live Query Performance Monitor

**Sprint 3 — Advanced features (M-size, 2-3 days each):**
8. #07 Row-Level Diff
9. #14 Collaborative Debug Sessions
10. #02 Natural Language to SQL
11. #12 Migration Diff Preview

**Sprint 4 — Major features (L-size, 3-5 days each):**
12. #03 Data Charts & Visualizations
13. #11 AI Data Anomaly Detection
14. #09 Data Import

## Key Files Affected

| File | Features |
|------|----------|
| `lib/src/drift_debug_server_io.dart` | All except #01, #06 |
| `extension/src/extension.ts` | #01 |
| `extension/src/panel.ts` (new) | #01 |
| `extension/package.json` | #01 |
| `lib/src/drift_debug_server_stub.dart` | #09 |
| `test/drift_debug_server_test.dart` | All server-side features |

## Architecture Notes

- **Server**: All-in-one Dart file with embedded HTML/JS (~2536 lines). Routes in `_onRequest()` (line 583). Web UI as `_indexHtml` (line 1510).
- **Pattern**: Each new feature adds: route constant, handler method, HTML section in `_indexHtml`, JS logic in `<script>` block.
- **Zero-dep policy**: All new features use vanilla JS and inline SVG. No external libraries.
- **Testing pattern**: Start server with `port: 0`, use `HttpClient` to make requests, assert on status codes and JSON bodies.
