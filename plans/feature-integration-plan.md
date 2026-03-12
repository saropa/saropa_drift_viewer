# Feature Integration Plan

**Goal:** Transform 44 disparate features into a cohesive, intelligent database toolkit where features leverage each other's data and capabilities.

**Status:** Last updated March 12, 2026

---

## Current Status Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Foundation — Shared Intelligence Layer | ✅ Complete |
| Phase 2 | Health Score as Command Center | 🟡 Partial (2.1 done, 2.2 pending) |
| Phase 3 | Smart Data Generation | ✅ Complete |
| Phase 4 | Schema Workflow Pipeline | 🟡 Partial (4.1 done, 4.2 pending) |
| Phase 5 | Context-Aware Annotations | ✅ Complete |
| Phase 6 | Unified Timelines | ⬜ Not Started |
| Phase 7 | Learning & Suggestions | ✅ Complete |

**Overall Progress:** 10/13 integrations complete (77%)

---

## Executive Summary

The current feature set operates as independent tools. This plan introduces **3 integration hubs** and **12 specific integrations** that create compound value by connecting features that share concepts, data, or workflows.

### Integration Principles

1. **No feature isolation** — Every feature should either consume or produce data for another feature
2. **Diagnosis → Action → Verification** — Problems found should link to fixes, fixes should be verifiable
3. **Intelligence accumulation** — Usage patterns should improve suggestions over time
4. **Single source of truth** — Shared concepts (FK relationships, schema metadata) use one engine

---

## Phase 1: Foundation — Shared Intelligence Layer ✅

**Scope:** Create reusable engines that multiple features consume.

**Status:** All three intelligence hubs implemented in `extension/src/engines/`.

### 1.1 Unified Relationship Engine ✅

**Problem:** Three features walk FK relationships independently:
- Row Impact Analysis (23) — finds dependents for deletion safety
- Lineage Tracer (46) — traces data origins/destinations
- Data Breakpoints (19) — monitors relationship changes

**Solution:** Extract a single `RelationshipEngine` that all three consume.

```
┌─────────────────────────────────────────────────────┐
│               RelationshipEngine                    │
├─────────────────────────────────────────────────────┤
│ • walkUpstream(table, pk) → parent chain            │
│ • walkDownstream(table, pk) → dependent tree        │
│ • getAffectedTables(table, pk) → flat set           │
│ • generateSafeDeleteSQL(table, pk) → ordered SQL    │
│ • onRelationshipChange(callback) → subscription     │
└─────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │              │              │
   ┌─────┴─────┐  ┌─────┴─────┐  ┌─────┴─────┐
   │  Impact   │  │  Lineage  │  │   Data    │
   │  Analysis │  │  Tracer   │  │Breakpoints│
   └───────────┘  └───────────┘  └───────────┘
```

**Files affected:**
- New: `src/engines/relationship-engine.ts`
- Modify: `impact-analyzer.ts`, `lineage-tracer.ts`, `data-breakpoints.ts`

**Effort:** Medium (consolidation, not new logic)

**Implementation:** `extension/src/engines/relationship-engine.ts` — exports `walkUpstream`, `walkDownstream`, `getAffectedTables`, `generateSafeDeleteSQL`.

---

### 1.2 Schema Intelligence Cache ✅

**Problem:** Multiple features parse/query schema metadata independently:
- Schema Diff, Schema Linter, Migration Generator, Docs Generator
- CodeLens, Peek Definition, Hover Preview
- Column Profiler, Anomaly Detection

**Solution:** Single `SchemaIntelligence` service with:
- Cached schema metadata (tables, columns, FKs, indexes)
- Change detection (invalidate on generation change)
- Derived insights (missing indexes, type patterns, naming conventions)

```
┌─────────────────────────────────────────────────────┐
│               SchemaIntelligence                    │
├─────────────────────────────────────────────────────┤
│ • tables: TableMeta[]                               │
│ • getTable(name) → TableMeta                        │
│ • getColumn(table, col) → ColumnMeta                │
│ • getForeignKeys(table) → FK[]                      │
│ • getMissingIndexes() → IndexSuggestion[]           │
│ • getSchemaIssues() → SchemaIssue[]                 │
│ • onSchemaChange(callback) → subscription           │
└─────────────────────────────────────────────────────┘
```

**Files affected:**
- New: `src/engines/schema-intelligence.ts`
- Modify: All schema-consuming features to use this cache

**Effort:** Medium

**Implementation:** `extension/src/engines/schema-intelligence.ts` — provides cached table/column metadata, FK lookups, and schema change subscriptions.

---

### 1.3 Query Intelligence Service ✅

**Problem:** Query-related features don't share insights:
- Query Performance tracks slow queries
- Query Cost Analyzer explains individual queries
- SQL Notebook has history but no suggestions
- Index Suggestions exist but aren't proactive

**Solution:** `QueryIntelligence` service that:
- Accumulates query patterns from Performance tracking
- Auto-analyzes slow queries with Cost Analyzer
- Suggests indexes based on accumulated WHERE/JOIN patterns
- Improves autocomplete based on query history

```
┌─────────────────────────────────────────────────────┐
│               QueryIntelligence                     │
├─────────────────────────────────────────────────────┤
│ • recordQuery(sql, duration, rows)                  │
│ • getSlowPatterns() → QueryPattern[]                │
│ • getSuggestedIndexes() → IndexSuggestion[]         │
│ • getFrequentTables() → string[] (for autocomplete) │
│ • getFrequentJoins() → JoinPattern[]                │
│ • analyzeAndSuggest(sql) → Suggestion[]             │
└─────────────────────────────────────────────────────┘
```

**Effort:** Medium

**Implementation:** `extension/src/engines/query-intelligence.ts` — tracks query patterns, suggests indexes based on WHERE/JOIN analysis, provides frequent tables for autocomplete.

---

## Phase 2: Health Score as Command Center 🟡

**Scope:** Transform Health Score (30) from passive dashboard to active command center.

**Status:** 2.1 implemented (metric actions), 2.2 pending (Pre-Launch bridge).

### 2.1 Actionable Health Metrics ✅

**Current:** Health Score shows letter grades but users must manually find/use fix tools.

**Proposed:** Each metric card becomes a mini-workflow:

| Metric | Current | Integrated |
|--------|---------|------------|
| Index Coverage | Shows % | "Fix" → opens Index Suggestions with pre-selected missing indexes |
| FK Integrity | Shows orphan count | "Fix" → opens Anomaly viewer filtered to orphans, with DELETE SQL |
| Null Density | Shows % | "Analyze" → opens Column Profiler for worst columns |
| Query Performance | Shows slow % | "Optimize" → opens Cost Analyzer with slowest query pre-loaded |
| Schema Quality | Shows issues | "Fix" → opens Schema Linter with quick-fix actions |

**Implementation:**

```typescript
// health-score-panel.ts
interface HealthMetricAction {
  label: string;
  command: string;
  args: unknown;
}

// Example: Index Coverage metric
{
  metric: 'indexCoverage',
  score: 0.65,
  grade: 'D',
  actions: [
    { label: 'View Missing Indexes', command: 'driftViewer.showIndexSuggestions', args: { filter: 'missing' } },
    { label: 'Create All Indexes', command: 'driftViewer.createIndexes', args: { indexes: missingIndexes } },
  ]
}
```

**Effort:** Low-Medium (UI changes + command wiring)

**Implementation:** `IMetricAction` interface in `health-types.ts`, action buttons rendered in Health Score panel. Each metric card includes fix actions (e.g., "Generate Migration", "View Missing Indexes", "Generate Anomaly Fixes").

---

### 2.2 Health Score → Pre-Launch Tasks Bridge ⬜

**Current:** Pre-launch tasks (13) and Health Score (30) both check health but don't share logic.

**Proposed:** 
- Pre-launch tasks use Health Score engine internally
- Task output includes Health Score grade
- Failed pre-launch links to Health Score panel for details

```
┌─────────────────┐     ┌─────────────────┐
│  Pre-Launch     │────▶│  Health Score   │
│  Task Runner    │     │  Engine         │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
   Terminal Output         Webview Panel
   "Health: C (68%)"       Full breakdown
   "3 errors, 5 warnings"  + Fix actions
```

**Effort:** Low (share scoring logic)

**Status:** Not yet implemented. Pre-launch tasks do not currently consume Health Score engine.

---

## Phase 3: Smart Data Generation ✅

**Scope:** Connect analysis features to data generation features.

**Status:** Both integrations complete.

### 3.1 Column Profiler → Seeder Integration ✅

**Problem:** Seeder (20) generates random data. Column Profiler (29) knows actual data distributions.

**Proposed:** Seeder uses Profiler data when available:

| Column Type | Current Seeder | Profiler-Informed Seeder |
|-------------|----------------|--------------------------|
| `email` | `faker.email()` | Matches domain distribution from existing data |
| `status` | Random enum | Weighted by actual value frequency |
| `created_at` | Random timestamp | Matches temporal distribution |
| `price` | Random decimal | Uses actual min/max/mean/stddev |

**Implementation:**

```typescript
// seeder-generator.ts
async function generateColumnValue(table: string, column: string): Promise<unknown> {
  const profile = await columnProfiler.getProfile(table, column);
  
  if (profile) {
    // Use profile-informed generation
    if (profile.type === 'numeric') {
      return generateNumericInDistribution(profile.min, profile.max, profile.mean, profile.stddev);
    }
    if (profile.topValues.length > 0) {
      return weightedRandomPick(profile.topValues);
    }
  }
  
  // Fall back to semantic generation
  return generateByColumnName(column);
}
```

**Effort:** Medium

**Implementation:** `extension/src/seeder/profile-informed-generator.ts` — `ProfileInformedGenerator` class uses column profiles for realistic data generation. Enabled via `driftViewer.useProfileData` setting.

---

### 3.2 Anomaly Detection → Data Editing Integration ✅

**Problem:** Anomaly Detection finds issues. Data Editing (16) can fix them. No connection.

**Proposed:** Anomaly viewer includes "Fix" actions that open Data Editing with pre-populated changes:

| Anomaly Type | Fix Action |
|--------------|------------|
| Orphaned FK | "Delete orphan rows" → opens Pending Changes with DELETE statements |
| Duplicate rows | "Remove duplicates" → opens Pending Changes with DELETE (keeping first) |
| Empty strings | "Set to NULL" → opens Pending Changes with UPDATE statements |
| NULL in required field | "Set default" → prompts for value, opens Pending Changes |

**Effort:** Low-Medium

**Implementation:** `driftViewer.generateAnomalyFixes` command in `health-commands.ts` generates fix SQL for anomalies. Health Score cards include "Fix" actions that invoke anomaly fix generation.

---

## Phase 4: Schema Workflow Pipeline 🟡

**Scope:** Connect schema analysis → diff → migration into a pipeline.

**Status:** 4.1 implemented (CodeAction), 4.2 pending (Evolution → Migration).

### 4.1 Schema Linter → Migration Generator Pipeline ✅

**Current flow (manual):**
1. Schema Linter shows diagnostics
2. User reads diagnostic, understands issue
3. User manually opens Migration Generator
4. User manually writes migration

**Proposed flow (integrated):**
1. Schema Linter shows diagnostics with "Generate Migration" quick-fix
2. Quick-fix invokes Migration Generator with issue context
3. Migration code is generated and opened in editor

```
Schema Linter Diagnostic:
  ⚠️ Column 'users.email' has no index but is used in WHERE clauses

  Quick Actions:
  • [Generate CREATE INDEX migration]  ← one click
  • [Add index directly (SQL)]
  • [Ignore for this column]
```

**Effort:** Low (CodeAction provider + command)

**Implementation:** `schema-diagnostics.ts` and `schema-provider.ts` provide "Generate Migration Code" CodeAction. `driftViewer.generateMigration` command generates Dart migration code via `migration-codegen.ts`.

---

### 4.2 Schema Evolution Timeline → Migration Generator ⬜

**Problem:** Schema Evolution Timeline (41) tracks changes but doesn't help generate migrations.

**Proposed:** 
- "Generate migration from X to Y" action in timeline
- Auto-detects what changed between two schema snapshots
- Generates migration code for the diff

```
Schema Evolution Timeline:
  ┌─────────────────────────────────────────────┐
  │ Mar 10, 2026 14:32 │ +orders.tracking_id    │
  │                    │ +orders.shipped_at     │
  │                    │ [Generate Migration ▶] │ ← New action
  ├─────────────────────────────────────────────┤
  │ Mar 09, 2026 09:15 │ +users table           │
  │                    │ [Generate Migration ▶] │
  └─────────────────────────────────────────────┘
```

**Effort:** Medium

**Status:** Not yet implemented. Schema Evolution Timeline does not currently offer "Generate Migration" action.

---

## Phase 5: Context-Aware Annotations ✅

**Scope:** Make Annotations (42) appear everywhere the annotated item appears.

**Status:** AnnotationService implemented with integration hooks for Hover, CodeLens, and Tree views.

### 5.1 Annotations Surface in Multiple Views ✅

**Current:** Annotations are visible only in the Annotations panel.

**Proposed:** Annotations appear in context:

| Where Item Appears | How Annotation Shows |
|--------------------|---------------------|
| Tree View (table/column) | Icon decoration + tooltip |
| Hover Preview | Note text in hover card |
| CodeLens | "📝 2 notes" indicator |
| Schema Diagram | Annotation icon on table box |
| Data Editing | Warning if editing annotated column |
| SQL Notebook autocomplete | Note in completion item detail |

**Implementation:** `AnnotationService` that other features query:

```typescript
class AnnotationService {
  getAnnotations(table: string, column?: string): Annotation[];
  hasAnnotations(table: string, column?: string): boolean;
  getAnnotationSummary(table: string): string; // "2 notes, 1 warning"
}
```

**Effort:** Medium (touches many features)

**Implementation:** `extension/src/annotations/annotation-service.ts` provides `AnnotationService` with:
- `formatForHover()` — markdown for hover cards
- `formatForCodeLens()` — summary string with icons
- `formatForTreeTooltip()` — multiline tooltip text
- `onDidChange()` — subscription for live updates

Hover provider (`drift-hover-provider.ts`) integrates with AnnotationService.

---

## Phase 6: Unified Timelines ⬜

**Scope:** Merge parallel timeline concepts into one coherent history.

**Status:** Not started. This is a P3 priority item requiring significant architectural work.

### 6.1 Unified Change Timeline ⬜

**Problem:** Three separate timelines:
- Snapshot Timeline (12) — data state at points in time
- Schema Evolution Timeline (41) — schema changes over time  
- Snapshot Changelog Narrative (34) — prose summaries of changes

**Proposed:** One unified timeline with multiple event types:

```
┌─────────────────────────────────────────────────────────────┐
│                    Database Timeline                        │
├─────────────────────────────────────────────────────────────┤
│ Mar 11, 15:42 │ 📊 DATA │ +3 users, +12 orders             │
│               │         │ [View Snapshot] [Compare] [Prose]│
├─────────────────────────────────────────────────────────────┤
│ Mar 11, 14:30 │ 🏗️ SCHEMA │ +orders.tracking_id column     │
│               │           │ [View Diff] [Generate Migration]│
├─────────────────────────────────────────────────────────────┤
│ Mar 11, 10:15 │ 📊 DATA │ Modified 5 user.email values     │
│               │         │ [View Snapshot] [Compare]         │
└─────────────────────────────────────────────────────────────┘
```

**Implementation:**
- New `TimelineService` aggregates events from multiple sources
- Single VS Code Timeline provider with event type filtering
- Each event type links to its specialized view

**Effort:** High (architectural consolidation)

**Status:** Not yet implemented. Would require a new `TimelineService` to aggregate events from Snapshot Timeline, Schema Evolution, and Snapshot Changelog.

---

## Phase 7: Learning & Suggestions ✅

**Scope:** Features learn from usage and improve suggestions.

**Status:** Both integrations complete.

### 7.1 Query Autocomplete from History ✅

**Current:** Autocomplete suggests table/column names from schema.

**Proposed:** Autocomplete also suggests:
- Recently used table combinations (JOIN patterns)
- Common WHERE clause patterns
- Frequently used column aliases

```typescript
// Enhanced autocomplete
completions.push(
  ...schemaCompletions,           // tables, columns
  ...historyCompletions,          // recent queries
  ...patternCompletions,          // "users JOIN orders ON..."
  ...savedFilterCompletions,      // reusable WHERE clauses
);
```

**Effort:** Low-Medium

**Implementation:** `sql-notebook-autocomplete.ts` tracks `frequentTables` from QueryIntelligence and prioritizes them in autocomplete suggestions.

---

### 7.2 Saved Filters → Global Search ✅

**Current:** Saved Filters (52) are per-table. Global Search (39) searches everywhere.

**Proposed:** 
- Global Search can save searches as "Global Filters"
- Saved table filters appear as suggestions in Global Search
- "Search all tables with this pattern" action on table filters

**Effort:** Low

**Implementation:** `extension/src/engines/filter-search-bridge.ts` — `FilterSearchBridge` class provides:
- `getSuggestedFilters(query)` — suggests saved filters matching search
- `createFilterFromSearch(result)` — converts search results to saved filter
- `searchWithFilterPattern(filter)` — runs filter WHERE clause across all tables
- `getApplicableFilters(result)` — finds filters for tables in search results

---

## Integration Priority Matrix

| Integration | Value | Effort | Dependencies | Priority | Status |
|-------------|-------|--------|--------------|----------|--------|
| 2.1 Actionable Health Metrics | High | Low | None | **P0** | ✅ Done |
| 3.2 Anomaly → Data Editing | High | Low | None | **P0** | ✅ Done |
| 4.1 Linter → Migration Gen | High | Low | None | **P0** | ✅ Done |
| 1.2 Schema Intelligence Cache | High | Medium | None | **P1** | ✅ Done |
| 1.3 Query Intelligence | High | Medium | None | **P1** | ✅ Done |
| 3.1 Profiler → Seeder | Medium | Medium | 1.2 | **P1** | ✅ Done |
| 2.2 Health → Pre-Launch | Medium | Low | 2.1 | **P1** | ⬜ Pending |
| 1.1 Relationship Engine | Medium | Medium | None | **P2** | ✅ Done |
| 5.1 Annotations Everywhere | Medium | Medium | None | **P2** | ✅ Done |
| 7.1 Autocomplete from History | Low | Low | None | **P2** | ✅ Done |
| 7.2 Filters → Global Search | Low | Low | None | **P2** | ✅ Done |
| 4.2 Evolution → Migration | Medium | Medium | 1.2 | **P3** | ⬜ Pending |
| 6.1 Unified Timeline | Medium | High | Multiple | **P3** | ⬜ Pending |

---

## Implementation Roadmap

### Sprint 1: Quick Wins (P0) ✅ Complete
- [x] 2.1 Add action buttons to Health Score metrics
- [x] 3.2 Add "Fix" buttons in Anomaly viewer → Data Editing
- [x] 4.1 Add "Generate Migration" CodeAction to Schema Linter

### Sprint 2: Intelligence Layer (P1) ✅ Complete
- [x] 1.2 Extract SchemaIntelligence service
- [x] 1.3 Extract QueryIntelligence service
- [x] Migrate existing features to use shared services

### Sprint 3: Smart Generation (P1) 🟡 In Progress
- [x] 3.1 Seeder reads Column Profiler data
- [ ] 2.2 Pre-launch tasks use Health Score engine

### Sprint 4: Relationship & Context (P2) ✅ Complete
- [x] 1.1 Extract RelationshipEngine
- [x] 5.1 AnnotationService + surface annotations in Tree/Hover/CodeLens

### Sprint 5: Learning (P2) ✅ Complete
- [x] 7.1 Query autocomplete from history/patterns
- [x] 7.2 Saved Filters ↔ Global Search

### Sprint 6: Consolidation (P3) ⬜ Not Started
- [ ] 4.2 Schema Evolution → Migration Generator
- [ ] 6.1 Unified Timeline (if still valuable after earlier work)

---

## Success Metrics

| Metric | Baseline | Current | Target |
|--------|----------|---------|--------|
| Features with no outbound connections | ~30 | ~8 | <5 |
| Health Score issues with one-click fix | 0% | ~80% | 100% |
| Steps to fix a schema linter issue | 5+ | 2 | 2 ✅ |
| Seeder data realism (manual rating) | 3/10 | 7/10 | 8/10 |
| Cross-feature navigation paths | ~5 | ~15 | 20+ |

---

## Appendix: Feature Connection Map

### Implemented State (March 2026)
```
                    ┌───────────────────────────────────────┐
                    │         Shared Intelligence           │
                    │  ┌─────────────────────────────────┐  │
                    │  │ RelationshipEngine              │  │
                    │  │ SchemaIntelligence              │  │
                    │  │ QueryIntelligence               │  │
                    │  └─────────────────────────────────┘  │
                    └──────────────────┬────────────────────┘
                                       │
        ┌──────────┬──────────┬────────┼────────┬──────────┬──────────┐
        ▼          ▼          ▼        ▼        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Impact │ │Lineage │ │ Health │ │ Seeder │ │ Filter │ │ Hover  │ │ Auto-  │
   │Analysis│ │ Tracer │ │ Score  │ │        │ │ Bridge │ │Provider│ │complete│
   └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └────────┘
       │          │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Break- │ │ Data   │ │Anomaly │ │Profiler│ │ Global │ │Annotate│
   │ points │ │Editing │ │  Fix   │ │  Data  │ │ Search │ │Service │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### Target State (with remaining integrations)
```
                         ┌─────────────────┐
                         │  Health Score   │
                         │  (Command Hub)  │
                         └────────┬────────┘
                                  │
        ┌──────────┬──────────┬───┴───┬──────────┬──────────┐
        ▼          ▼          ▼       ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │ Index  │ │Anomaly │ │ Query  │ │ Schema │ │ Data   │ │Profiler│
   │Suggest │ │Detect  │ │ Perf   │ │ Linter │ │Quality │ │        │
   └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘ └───┬────┘
       │          │          │          │          │          │
       ▼          ▼          ▼          ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
   │Create  │ │ Data   │ │ Cost   │ │Migrate │ │ Data   │ │ Seeder │
   │Index   │ │Editing │ │Analyzer│ │ Gen    │ │Editing │ │        │
   └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

---

## Remaining Work

### High Priority (P1)
1. **2.2 Health Score → Pre-Launch Bridge**
   - Modify pre-launch tasks to consume Health Score engine
   - Display health grade in terminal output
   - Link failed checks to Health Score panel

### Medium Priority (P3)
2. **4.2 Schema Evolution → Migration Generator**
   - Add "Generate Migration" action to schema evolution timeline entries
   - Auto-detect changes between two schema snapshots

3. **6.1 Unified Timeline**
   - Create `TimelineService` to aggregate events
   - Merge Snapshot Timeline, Schema Evolution, and Changelog Narrative
   - Implement event type filtering in VS Code Timeline provider
