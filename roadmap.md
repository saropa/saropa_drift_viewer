# Feature Roadmap

## Overview

63 features for saropa_drift_advisor. **34 implemented**, 29 remaining. Plans are in `extension/plans/`.

## Remaining Features

### Tier 1: Extension-Only (no Dart package changes)

| # | Feature | Wow | Effort | Summary |
|---|---------|:---:|:------:|---------|
| 49 | [Table Pinning](extension/plans/49-table-pinning.md) | 3 | Low | Pin frequently-used tables to top of tree view. Persists per workspace. |
| 51 | [FK Hyperlinks](extension/plans/51-fk-hyperlinks.md) | 3 | Low | Click any FK value in table data to jump to the referenced row. |
| 54 | [Schema Search](extension/plans/54-schema-search.md) | 3 | Low | Search table/column names and types. Column cross-reference for missing FKs. |
| 50 | [Query History Search](extension/plans/50-query-history-search.md) | 3 | Low | Persistent, searchable SQL notebook history across sessions. |
| 52 | [Saved Filters](extension/plans/52-saved-filters.md) | 3 | Low | Named filter/sort/column configs per table. |
| 53 | [Multi-Format Export](extension/plans/53-multi-format-export.md) | 3 | Low | Export as JSON, CSV, SQL INSERT, Dart map literals, or Markdown. |
| 55 | [Clipboard Import](extension/plans/55-clipboard-import.md) | 3 | Medium | Paste from Excel, Google Sheets, TSV directly into a table. |
| 38 | [ER Diagram + FK Wiring](extension/plans/38-er-diagram.md) | 4 | Medium | Interactive ER diagram with drag-to-create FK relationships. |
| 59 | [AI Schema Reviewer](extension/plans/59-ai-schema-reviewer.md) | 5 | Medium | LLM analyzes schema → normalization issues, anti-patterns, migration fixes. |
| 62 | [Data Story Narrator](extension/plans/62-data-story-narrator.md) | 5 | Medium | Select a row → English narrative following FK chains. |
| 60 | [Time-Travel Data Slider](extension/plans/60-time-travel-data-slider.md) | 5 | Medium | Scrub a slider to see table data at any snapshot point. |
| 18 | [Natural Language to SQL](extension/plans/18-natural-language-sql.md) | 5 | Medium | Type English, get SQL via LLM. Schema-aware, history-tracked. |
| 64 | [Schema Compliance Ruleset](extension/plans/64-schema-compliance-ruleset.md) | 4 | Medium | Team rules in `.drift-rules.json`: naming, required columns, FK patterns. |
| 61 | [Migration Rollback Generator](extension/plans/61-migration-rollback-generator.md) | 5 | Medium | Auto-generate reverse migration (rollback Dart + SQL). |
| 43 | [Query Cost Analyzer](extension/plans/43-query-cost-analyzer.md) | 4 | Medium | SQLite EXPLAIN visualization with index suggestions. |
| 63 | [Query Perf Regression Detector](extension/plans/63-query-perf-regression-detector.md) | 5 | Medium | Track query times across sessions. Alert on regressions. |
| 27 | [Data Invariant Checker](extension/plans/27-data-invariant-checker.md) | 4 | Medium | Define and continuously verify data integrity rules. |
| 30 | [Database Health Score](extension/plans/30-health-score.md) | 4 | Medium | A–F grade dashboard: index coverage, FK integrity, anomalies. |
| 66 | [Drift Refactoring Engine](extension/plans/66-drift-refactoring-engine.md) | 5 | High | Suggest refactorings: normalize, split, merge. Multi-step migration plan. |
| 21 | [Visual Query Builder](extension/plans/21-visual-query-builder.md) | 4 | High | Drag-and-drop SQL builder with live preview. |
| 36 | [Custom Dashboard Builder](extension/plans/36-dashboard-builder.md) | 4 | High | Drag-and-drop widget layout for personalized debug dashboards. |

### Tier 2: Requires New Server Endpoints

| # | Feature | Wow | Effort | Summary | Server Changes |
|---|---------|:---:|:------:|---------|----------------|
| 28 | [Data Masking / PII Anonymizer](extension/plans/28-pii-anonymizer.md) | 5 | Medium | One-click anonymize PII before sharing snapshots. | Anonymization endpoint |
| 23 | [Row Impact Analysis](extension/plans/23-row-impact-analysis.md) | 5 | Medium | Click a row → see all FK-dependent rows across all tables. | `impact_handler.dart` |
| 25 | [Portable Snapshot Report](extension/plans/25-portable-snapshot-report.md) | 4 | Medium | Export self-contained HTML file with all data baked in. | `report_handler.dart` |
| 22 | [Real-time Mutation Stream](extension/plans/22-realtime-mutation-stream.md) | 4 | Medium | Live mutation feed with animated data flow on schema graph. | `mutation_tracker.dart` |
| 26 | [Query Replay DVR](extension/plans/26-query-replay-dvr.md) | 5 | High | Record queries, scrub timeline, replay sessions to reproduce bugs. | `query_recorder.dart` |
| 35 | [Multi-Server Federation](extension/plans/35-multi-server-federation.md) | 5 | High | Unified dashboard across multiple running debug servers. | Multiple clients |
| 37 | [Git-style Data Branching](extension/plans/37-data-branching.md) | 5 | High | Named data branches, experiment, diff, merge via SQL. | Fork/restore endpoints |
| 47 | [Bulk Edit Grid](extension/plans/47-bulk-edit-grid.md) | 5 | High | Spreadsheet-style inline editing with batch commit. | `writeQuery` callback |

## Completed Features (33)

| # | Feature | Plan |
|---|---------|------|
| 1 | Database Explorer Tree View | [plan](extension/plans/history/20260309/01-tree-view.md) |
| 2 | CodeLens | [plan](extension/plans/history/20260309/02-codelens.md) |
| 3 | SQL Notebook | [plan](extension/plans/history/20260309/03-sql-notebook.md) |
| 4 | Live Watch | [plan](extension/plans/history/20260309/04-live-watch.md) |
| 5 | Schema Diff | [plan](extension/plans/history/20260309/05-schema-diff.md) |
| 6 | Auto-Discovery | [plan](extension/plans/history/20260309/06-auto-discovery.md) |
| 7 | Schema Linter | [plan](extension/plans/history/20260309/07-schema-linter.md) |
| 8 | Explain Visualization | [plan](extension/plans/history/20260309/08-explain-visualization.md) |
| 9 | Hover Preview | [plan](extension/plans/history/20260309/09-hover-preview.md) |
| 10 | Terminal Links | [plan](extension/plans/history/20260309/10-terminal-links.md) |
| 11 | File Badges | [plan](extension/plans/history/20260309/11-file-badges.md) |
| 12 | Snapshot Timeline | [plan](extension/plans/history/20260309/12-snapshot-timeline.md) |
| 13 | Pre-Launch Tasks | [plan](extension/plans/history/20260309/13-prelaunch-tasks.md) |
| 14 | Peek Definition | [plan](extension/plans/history/20260309/14-peek-definition.md) |
| 15 | Debug Performance | [plan](extension/plans/history/20260309/15-debug-performance.md) |
| 16 | Data Editing | [plan](extension/plans/history/20260309/16-data-editing.md) |
| 17 | Dart from Schema | [plan](extension/plans/history/20260309/17-dart-from-schema.md) |
| 19 | Data Breakpoints | [plan](extension/plans/history/20260310/19-data-breakpoints.md) |
| 20 | Test Data Seeder | [plan](extension/plans/history/20260310/20-test-data-seeder.md) |
| 20a | Data Management | [plan](extension/plans/history/20260310/20a-data-management.md) |
| 24 | Drift Migration Generator | [plan](extension/plans/history/20260310/24-drift-migration-generator.md) |
| 29 | Smart Column Profiler | [plan](extension/plans/history/20260310/29-column-profiler.md) |
| 31 | Regression Test Generator | [plan](extension/plans/history/20260310/31-regression-test-generator.md) |
| 32 | Schema Documentation Generator | [plan](extension/plans/history/20260310/32-schema-docs.md) |
| 33 | Row Comparator | [plan](extension/plans/history/20260310/33-row-comparator.md) |
| 34 | Snapshot Changelog Narrative | [plan](extension/plans/history/20260310/34-snapshot-changelog.md) |
| 39 | Cross-Table Global Search | [plan](extension/plans/history/20260310/39-cross-table-search.md) |
| 41 | Schema Evolution Timeline | [plan](extension/plans/history/20260310/41-schema-evolution-timeline.md) |
| 42 | Data Annotations & Bookmarks | [plan](extension/plans/history/20260310/42-data-annotations.md) |
| 44 | Constraint Wizard | [plan](extension/plans/history/20260310/44-constraint-wizard.md) |
| 45 | Data Sampling Explorer | [plan](extension/plans/history/20260310/45-data-sampling-explorer.md) |
| 46 | Automated Data Lineage | [plan](extension/plans/history/20260310/46-data-lineage.md) |
| 40 | SQL Snippet Library | [plan](extension/plans/history/20260310/40-sql-snippet-library.md) |
| 48 | Isar-to-Drift Schema Generator | [plan](extension/plans/history/20260310/48-isar-to-drift-schema.md) |
