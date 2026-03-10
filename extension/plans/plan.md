# Feature Roadmap — 30 New Features

## Overview

Thirty "WOW" features for saropa_drift_viewer, organized into three tiers by server-side dependency. All 30 features have detailed implementation plans in this directory.

## Feature List

### Tier 1: Extension-Only (no Dart package changes)

| # | Feature | Summary |
|---|---------|---------|
| 18 | [Natural Language to SQL](18-natural-language-sql.md) | Type English, get SQL via LLM. Schema-aware, history-tracked. |
| 19 | [Data Breakpoints](19-data-breakpoints.md) | **IMPLEMENTED.** Pause the debugger when data conditions are met. |
| 20a | [Data Management](20a-data-management.md) | **IMPLEMENTED.** Reset, Import, Export, Table Groups — prerequisite for 20, 28, 37, 46, 47. |
| 20 | [Test Data Seeder](20-test-data-seeder.md) | **IMPLEMENTED.** Auto-generate realistic test data respecting FK relationships. Depends on 20a. |
| 21 | [Visual Query Builder](21-visual-query-builder.md) | Drag-and-drop SQL builder with live preview. |
| 24 | [Drift Migration Generator](24-drift-migration-generator.md) | **IMPLEMENTED.** Generate Dart migration code from schema diffs. |
| 27 | [Data Invariant Checker](27-data-invariant-checker.md) | Define and continuously verify data integrity rules. |
| 29 | [Smart Column Profiler](29-column-profiler.md) | Click a column → full statistics: distribution, nulls, top values, histogram. |
| 30 | [Database Health Score](30-health-score.md) | Single-pane dashboard with A–F grade: index coverage, FK integrity, anomalies. |
| 31 | [Regression Test Generator](31-regression-test-generator.md) | Auto-generate Dart test files from current data state. Can use 20a for test fixtures. |
| 32 | [Schema Documentation Generator](32-schema-docs.md) | Auto-generate HTML/Markdown docs from live schema. |
| 33 | [Row Comparator](33-row-comparator.md) | Side-by-side diff of any two rows across any tables. |
| 34 | [Snapshot Changelog Narrative](34-snapshot-changelog.md) | Human-readable story of what changed between two snapshots. |
| 36 | [Custom Dashboard Builder](36-dashboard-builder.md) | Drag-and-drop widget layout for personalized debug dashboards. |
| 38 | [Entity Relationship Diagram](38-er-diagram.md) | Interactive ER diagram auto-generated from live FK metadata. |
| 39 | [Cross-Table Global Search](39-cross-table-search.md) | Search for any value across every table and column simultaneously. |
| 40 | [SQL Snippet Library](40-sql-snippet-library.md) | Save, tag, parameterize, and reuse frequently-used queries. |
| 41 | [Schema Evolution Timeline](41-schema-evolution-timeline.md) | Visual history of schema changes across generations. |
| 42 | [Data Annotations & Bookmarks](42-data-annotations.md) | Pin notes to tables, columns, and rows; export for team sharing. |
| 43 | [Query Cost Analyzer](43-query-cost-analyzer.md) | SQLite EXPLAIN visualization with index suggestions. |
| 44 | [Constraint Wizard](44-constraint-wizard.md) | Visual constraint designer with live validation and migration codegen. |
| 45 | [Data Sampling Explorer](45-data-sampling-explorer.md) | Stratified samples, percentile slicing, cohort comparison. |
| 46 | [Automated Data Lineage](46-data-lineage.md) | Trace a value's origin and downstream dependencies across FK chains. Can use 20a for FK sort. |

### Tier 2: Requires New Server Endpoints

| # | Feature | Summary | Server Changes |
|---|---------|---------|----------------|
| 22 | [Real-time Mutation Stream](22-realtime-mutation-stream.md) | Live feed of every INSERT/UPDATE/DELETE as it happens. | `mutation_tracker.dart`, `mutation_handler.dart` |
| 23 | [Row Impact Analysis](23-row-impact-analysis.md) | Click a row → see all FK-dependent rows across all tables. | `impact_handler.dart`, reverse FK endpoint |
| 25 | [Portable Snapshot Report](25-portable-snapshot-report.md) | Export self-contained HTML file with all data baked in. | `report_handler.dart` (optional) |
| 26 | [Query Replay DVR](26-query-replay-dvr.md) | Record every query, scrub through timeline, inspect state. | `query_recorder.dart`, `dvr_handler.dart` |
| 28 | [Data Masking / PII Anonymizer](28-pii-anonymizer.md) | One-click anonymize PII before sharing snapshots. Depends on 20a. | Anonymization endpoint or extension-side only |
| 35 | [Multi-Server Federation](35-multi-server-federation.md) | Unified dashboard across multiple running debug servers. | None (extension manages multiple clients) |
| 37 | [Git-style Data Branching](37-data-branching.md) | Named data branches, experiment, diff, merge via SQL. Depends on 20a. | Snapshot fork/restore endpoints |
| 47 | [Bulk Edit Grid](47-bulk-edit-grid.md) | Spreadsheet-style inline editing with batch commit. Depends on 20a. | `writeQuery` callback required |

## Ranking by Wow Factor vs Effort

| # | Feature | Wow | Effort | ROI | Unique? |
|---|---------|:---:|:------:|:---:|---------|
| 20 | Test Data Seeder | 4 | Low | **Very High** | Medium | **DONE** |
| 39 | Cross-Table Global Search | 4 | Low | **Very High** | High | **DONE** |
| 29 | Smart Column Profiler | 4 | Low | **High** | Medium | **DONE** |
| 34 | Snapshot Changelog Narrative | 4 | Low | **High** | High | **DONE** |
| 32 | Schema Documentation Generator | 4 | Low | **High** | Medium | **DONE** |
| 20a | Data Management | 3 | Low | **Very High** | Medium | **DONE** |
| 33 | Row Comparator | 3 | Low | **Very High** | Medium | **DONE** |
| 42 | Data Annotations & Bookmarks | 3 | Low | **High** | Medium | **DONE** |
| 45 | Data Sampling Explorer | 3 | Low | **High** | Medium |
| 40 | SQL Snippet Library | 3 | Low | **High** | Low |
| 24 | Drift Migration Generator | 5 | Medium | **High** | High | **DONE** |
| 19 | Data Breakpoints | 5 | Medium | **High** | Very High | **DONE** |
| 28 | Data Masking / PII Anonymizer | 5 | Medium | **High** | High |
| 31 | Regression Test Generator | 5 | Medium | **High** | Very High |
| 18 | Natural Language to SQL | 5 | Medium | **High** | Medium |
| 46 | Automated Data Lineage | 5 | Medium | **High** | Very High |
| 23 | Row Impact Analysis | 5 | Medium | **Medium** | High |
| 38 | Entity Relationship Diagram | 4 | Medium | **High** | Medium |
| 41 | Schema Evolution Timeline | 4 | Medium | **High** | Very High |
| 44 | Constraint Wizard | 4 | Medium | **High** | Very High | **DONE** |
| 43 | Query Cost Analyzer | 4 | Medium | **Medium** | High |
| 27 | Data Invariant Checker | 4 | Medium | **Medium** | High |
| 30 | Database Health Score | 4 | Medium | **Medium** | High |
| 25 | Portable Snapshot Report | 4 | Medium | **Medium** | High |
| 22 | Real-time Mutation Stream | 4 | Medium | **Medium** | High |
| 26 | Query Replay DVR | 5 | High | **Medium** | Very High |
| 35 | Multi-Server Federation | 5 | High | **Medium** | Very High |
| 37 | Git-style Data Branching | 5 | High | **Medium** | Extremely High |
| 47 | Bulk Edit Grid | 5 | High | **Medium** | Medium |
| 21 | Visual Query Builder | 4 | High | **Low** | Low |
| 36 | Custom Dashboard Builder | 4 | High | **Low** | Low |

## Suggested Implementation Order

### Phase 1 — Quick Wins (Low effort, high ROI)

1. ~~**20a — Data Management** — Reset/Import/Export foundation (prerequisite for seeder)~~ **DONE**
2. ~~**20 — Test Data Seeder** — Fast to build, every Drift user wants it~~ **DONE**
3. **33 — Row Comparator** — Dead simple, immediately useful
4. **39 — Cross-Table Global Search** — Ctrl+Shift+F for your database
5. **29 — Smart Column Profiler** — Builds on existing schema metadata
6. **34 — Snapshot Changelog Narrative** — Builds on existing snapshot diff
7. **32 — Schema Documentation Generator** — Reuses schema + FK metadata
8. **42 — Data Annotations & Bookmarks** — Lightweight, immediately useful
9. **40 — SQL Snippet Library** — Saves users time every day
10. **45 — Data Sampling Explorer** — Smart exploration beyond LIMIT N

### Phase 2 — Differentiators (Medium effort, unique value)

11. ~~**24 — Drift Migration Generator** — Every Drift user, every day~~ **DONE**
12. **19 — Data Breakpoints** — No competitor has this
13. **46 — Automated Data Lineage** — Click any cell, see everything connected
14. **38 — Entity Relationship Diagram** — Visual map everyone wants
15. **44 — Constraint Wizard** — Design constraints before writing migration code
16. **28 — Data Masking / PII Anonymizer** — Essential for team workflows
17. **31 — Regression Test Generator** — Bridges debug to CI
18. **41 — Schema Evolution Timeline** — Watch your schema evolve in real time
19. **18 — Natural Language to SQL** — High wow, LLM does the heavy lifting
20. **43 — Query Cost Analyzer** — EXPLAIN made visual

### Phase 3 — Power Features (Medium effort, targeted value)

21. **27 — Data Invariant Checker** — Data quality guardrails
22. **30 — Database Health Score** — Gamified overview
23. **25 — Portable Snapshot Report** — Great for QA and bug reports
24. **23 — Row Impact Analysis** — Complex schemas love this
25. **22 — Real-time Mutation Stream** — Debug writes in real time

### Phase 4 — Ambitious (High effort, very high wow)

26. **26 — Query Replay DVR** — Time-travel debugging for data
27. **35 — Multi-Server Federation** — Microservice debugging
28. **37 — Git-style Data Branching** — Completely novel concept
29. **47 — Bulk Edit Grid** — Spreadsheet-style data editing
30. **21 — Visual Query Builder** — Significant UI work
31. **36 — Custom Dashboard Builder** — Significant UI work
