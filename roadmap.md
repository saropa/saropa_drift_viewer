# Feature Roadmap

## Overview

63 features for saropa_drift_advisor. **44 implemented**, 19 remaining. Plans are in `extension/plans/`.

## Integration Architecture

All remaining features integrate through **3 shared intelligence hubs** (see `plans/feature-integration-plan.md`):

1. **RelationshipEngine** — FK traversal shared by Impact Analysis, Lineage, Breakpoints, Narrator
2. **SchemaIntelligence** — Cached schema metadata consumed by all schema-aware features  
3. **QueryIntelligence** — Query patterns improve autocomplete, detect regressions, optimize indexes

Every feature below includes cross-feature actions and Health Score contributions.

## Remaining Features

### Tier 1: Extension-Only (no Dart package changes)

| # | Feature | Wow | Effort | Summary | Integration Boost |
|---|---------|:---:|:------:|---------|-------------------|
| 55 | [Clipboard Import](plans/55-clipboard-import.md) | 3→4 | Medium | Paste from Excel/Sheets directly into tables. | → Bulk Edit, smart column mapping |
| 38 | [ER Diagram](plans/38-er-diagram.md) | 4→5 | Medium | Interactive ER with health coloring, annotations. | ← Health Score, → all table actions |
| 59 | [AI Schema Reviewer](plans/59-ai-schema-reviewer.md) | 5→6 | Medium | LLM analyzes schema with Health/Query context. | ← Health/Query Intelligence, → Migration Gen |
| 62 | [Data Story Narrator](plans/62-data-story-narrator.md) | 5→6 | Medium | Row narrative using RelationshipEngine traversal. | ← RelationshipEngine, Annotations |
| 60 | [Time-Travel Data Slider](plans/60-time-travel-data-slider.md) | 5→6 | Medium | Scrub slider syncs with DVR and Unified Timeline. | ↔ DVR, Branching, Timeline |
| 18 | [Natural Language to SQL](plans/18-natural-language-sql.md) | 5→6 | Medium | Schema-aware LLM queries feed QueryIntelligence. | ← SchemaIntelligence, → Visual Builder |
| 64 | [Schema Compliance Ruleset](plans/64-schema-compliance-ruleset.md) | 4→5 | Medium | Team rules in `.drift-rules.json` with Health integration. | → Health Score, Pre-Launch, Migration Gen |
| 61 | [Migration Rollback Generator](plans/61-migration-rollback-generator.md) | 5 | Medium | Auto-reverse migrations, integrates with Schema Timeline. | ← Schema Evolution, → Branching |
| 63 | [Query Perf Regression Detector](plans/63-query-perf-regression-detector.md) | 5→6 | Medium | Cross-session regression alerts with auto-fix suggestions. | ← QueryIntelligence, → Health Score, Index |
| 27 | [Data Invariant Checker](plans/27-data-invariant-checker.md) | 4→6 | Medium | Continuous integrity checks with one-click fixes. | → Health Score, Bulk Edit, Pre-Launch |
| 66 | [Drift Refactoring Engine](plans/66-drift-refactoring-engine.md) | 5→7 | High | Schema refactorings with AI + Profiler intelligence. | ← AI Review, Profiler, → Migration Gen |
| 21 | [Visual Query Builder](plans/21-visual-query-builder.md) | 4→5 | High | Drag-drop SQL with RelationshipEngine auto-joins. | ← QueryIntelligence, → Notebook, Dashboard |

### Tier 2: Requires New Server Endpoints

| # | Feature | Wow | Effort | Summary | Integration Boost | Server Changes |
|---|---------|:---:|:------:|---------|-------------------|----------------|
| 28 | [PII Anonymizer](plans/28-pii-anonymizer.md) | 5→6 | Medium | One-click PII masking with Profiler intelligence. | ← Profiler, → Report, Branching | Anonymization endpoint |
| 25 | [Portable Report](plans/25-portable-snapshot-report.md) | 4→5 | Medium | Self-contained HTML with Health/Invariants/Diagram. | ← Health, Invariants, ER Diagram | `report_handler.dart` |
| 22 | [Mutation Stream](plans/22-realtime-mutation-stream.md) | 4→5 | Medium | Live mutations feed Timeline, DVR, Breakpoints. | → Timeline, DVR, Dashboard | `mutation_tracker.dart` |
| 26 | [Query Replay DVR](plans/26-query-replay-dvr.md) | 5→7 | High | Timeline scrubbing syncs with Time-Travel slider. | ↔ Time-Travel, QueryIntelligence | `query_recorder.dart` |
| 35 | [Multi-Server Federation](plans/35-multi-server-federation.md) | 5→6 | High | Unified dashboard with per-server Health Scores. | ← Health Score, → Dashboard | Multiple clients |
| 37 | [Data Branching](plans/37-data-branching.md) | 5→7 | High | Git-style branches with safety prompts everywhere. | ↔ Timeline, Bulk Edit, Report | Fork/restore endpoints |
| 47 | [Bulk Edit Grid](plans/47-bulk-edit-grid.md) | 5→7 | High | Spreadsheet editing with pre-commit validation. | ← Invariants, Anomaly, → Branching | `writeQuery` callback |

## Wow Factor Key

| Score | Meaning |
|-------|---------|
| 3 | Nice to have |
| 4 | Useful for many users |
| 5 | Compelling differentiator |
| 6 | Wow — competitors don't have this |
| 7 | Industry-leading integration |

## Integration Priority

Features that serve as **integration hubs** should be implemented early:

1. **Dashboard Builder (36)** — becomes command center for all features
2. **Data Invariant Checker (27)** — feeds Health Score, blocks Pre-Launch, guards edits
3. **Query Replay DVR (26)** — syncs with Time-Travel, feeds QueryIntelligence
4. **Data Branching (37)** — safety net for all destructive operations

## Completed Features (43)

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
| 23 | Row Impact Analysis | [plan](extension/plans/history/20260311/23-row-impact-analysis.md) |
| 24 | Drift Migration Generator | [plan](extension/plans/history/20260310/24-drift-migration-generator.md) |
| 29 | Smart Column Profiler | [plan](extension/plans/history/20260310/29-column-profiler.md) |
| 30 | Database Health Score | [plan](extension/plans/history/20260311/30-health-score.md) |
| 31 | Regression Test Generator | [plan](extension/plans/history/20260310/31-regression-test-generator.md) |
| 32 | Schema Documentation Generator | [plan](extension/plans/history/20260310/32-schema-docs.md) |
| 33 | Row Comparator | [plan](extension/plans/history/20260310/33-row-comparator.md) |
| 34 | Snapshot Changelog Narrative | [plan](extension/plans/history/20260310/34-snapshot-changelog.md) |
| 39 | Cross-Table Global Search | [plan](extension/plans/history/20260310/39-cross-table-search.md) |
| 40 | SQL Snippet Library | [plan](extension/plans/history/20260310/40-sql-snippet-library.md) |
| 41 | Schema Evolution Timeline | [plan](extension/plans/history/20260310/41-schema-evolution-timeline.md) |
| 42 | Data Annotations & Bookmarks | [plan](extension/plans/history/20260310/42-data-annotations.md) |
| 43 | Query Cost Analyzer | [plan](extension/plans/history/20260311/43-query-cost-analyzer.md) |
| 44 | Constraint Wizard | [plan](extension/plans/history/20260310/44-constraint-wizard.md) |
| 45 | Data Sampling Explorer | [plan](extension/plans/history/20260310/45-data-sampling-explorer.md) |
| 46 | Automated Data Lineage | [plan](extension/plans/history/20260310/46-data-lineage.md) |
| 48 | Isar-to-Drift Schema Generator | [plan](extension/plans/history/20260310/48-isar-to-drift-schema.md) |
| 49 | Table Pinning | [plan](extension/plans/history/20260310/49-table-pinning.md) |
| 50 | Query History Search | [plan](extension/plans/history/20260310/50-query-history-search.md) |
| 51 | FK Hyperlinks | [plan](extension/plans/history/20260310/51-fk-hyperlinks.md) |
| 52 | Saved Filters | [plan](extension/plans/history/20260311/52-saved-filters.md) |
| 53 | Multi-Format Export | [plan](extension/plans/history/20260310/53-multi-format-export.md) |
| 54 | Schema Search | [plan](extension/plans/history/20260310/54-schema-search.md) |
| 36 | Custom Dashboard Builder | [plan](extension/plans/history/20260312/36-dashboard-builder.md) |
