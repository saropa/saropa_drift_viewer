# Extension File Modularization Plan

## Overview

This plan addresses 36 files that exceed the 300-line limit, organized by priority and module area.

**Goal**: Break down large files into focused modules under 300 lines each while maintaining cohesion and minimizing import complexity.

---

## Summary by Category

| Category | Files | Total Lines | Target After Split |
|----------|-------|-------------|-------------------|
| Dashboard | 3 | 1,296 | 10+ modules |
| Import | 5 | 2,058 | 9+ modules |
| Diagnostics | 5 | 1,754 | 20+ modules |
| Tests | 13 | 4,539 | 16+ test files + 5 fixtures |
| Other Source | 10 | 3,654 | 25+ modules |
| **Total** | **36** | **~13,300** | **~85 focused modules** |

---

## Phase 1: High-Impact Extractions (CSS/JS/Types)

These are mechanical extractions with clear boundaries and no logic changes.

### 1.1 Extract Embedded Styles

Files with large embedded CSS that can be extracted to `*-styles.ts` files:

| Source File | Lines | Extract To | Est. Lines |
|-------------|-------|------------|------------|
| `dashboard/dashboard-html.ts` | 625 | `dashboard-css.ts` | ~300 |
| `er-diagram/er-diagram-html.ts` | 495 | `er-diagram-styles.ts` | ~160 |
| `import/clipboard-import-html.ts` | 436 | `clipboard-import-styles.ts` | ~130 |
| `invariants/invariant-html.ts` | 403 | `invariant-styles.ts` | ~195 |
| `narrator/narrator-html.ts` | 318 | `narrator-styles.ts` | ~160 |
| `query-cost/query-cost-html.ts` | 317 | `query-cost-styles.ts` | ~110 |

**Pattern**: Each extraction follows this pattern:

```typescript
// dashboard-css.ts
export function getDashboardCss(): string {
  return `
    /* CSS content extracted from dashboard-html.ts */
  `;
}
```

### 1.2 Extract Embedded Scripts

For files with significant client-side JavaScript:

| Source File | Extract To | Est. Lines |
|-------------|------------|------------|
| `dashboard/dashboard-html.ts` | `dashboard-scripts.ts` | ~220 |
| `er-diagram/er-diagram-html.ts` | `er-diagram-script.ts` | ~290 |
| `import/clipboard-import-html.ts` | `clipboard-import-scripts.ts` | ~50 |

### 1.3 Extract Type Definitions

Move interfaces to dedicated type files:

| Source File | Extract To | Types to Move |
|-------------|------------|---------------|
| `query-intelligence.ts` | `query-intelligence-types.ts` | `IQueryPattern`, `IPatternIndexSuggestion`, `IJoinPattern` |
| `relationship-engine.ts` | `relationship-types.ts` | `IRelationshipNode`, `IRelationshipChain`, etc. |
| `import/clipboard-import-panel.ts` | `clipboard-import-messages.ts` | Message interface types |

**Phase 1 Estimated Impact**: ~10 new files, original files reduced by 40-60%

---

## Phase 2: Extract Utility Functions

### 2.1 Shared Utilities

Create reusable utility modules from duplicated code:

| New Module | Contents | Used By |
|------------|----------|---------|
| `diagnostics/utils/sql-utils.ts` | `extractTableFromSql`, `truncateSql`, `areSimilarQueries` | PerformanceProvider, others |
| `diagnostics/utils/dart-file-utils.ts` | `findDartFileForTable` | PerformanceProvider, SchemaProvider |
| `narrator/narrator-utils.ts` | `singularize`, `capitalize`, `formatValue`, `sqlLiteral` | DataNarrator, tests |
| `health/health-utils.ts` | `toGrade`, `sqlId` | HealthScorer, tests |

### 2.2 Import Module Utilities

| New Module | Contents | Est. Lines |
|------------|----------|------------|
| `import/import-sql-helpers.ts` | `escapeSqlValue`, `buildInsertSQL`, `buildUpdateSQL`, `buildSelectSQL` | ~120 |
| `import/import-fk-validator.ts` | `validateForeignKeys` (standalone function) | ~80 |

**Phase 2 Estimated Impact**: ~6 new utility files, improving code reuse

---

## Phase 3: Split Large Classes

### 3.1 Dashboard Panel Decomposition

**Current**: `dashboard-panel.ts` (304 lines)

**Split Into**:
```
dashboard/
├── panel/
│   ├── message-handler.ts      (~70 lines)  - Message routing
│   ├── widget-layout.ts        (~60 lines)  - Grid calculations
│   └── widget-crud.ts          (~80 lines)  - Widget CRUD operations
└── dashboard-panel.ts          (~100 lines) - Core panel lifecycle
```

### 3.2 Widget Registry Decomposition

**Current**: `widget-registry.ts` (367 lines)

**Split Into**:
```
dashboard/
├── widgets/
│   ├── widget-renderers.ts     (~100 lines) - renderMiniTable, renderSvgChart
│   ├── data-widgets.ts         (~70 lines)  - tableStats, tablePreview, rowCount
│   ├── query-widgets.ts        (~45 lines)  - queryResult, chart
│   ├── monitoring-widgets.ts   (~100 lines) - healthScore, invariantStatus, dvrStatus, watchDiff
│   └── utility-widgets.ts      (~20 lines)  - customText
└── widget-registry.ts          (~50 lines)  - Compose registry, exports
```

### 3.3 Diagnostic Manager Decomposition

**Current**: `diagnostic-manager.ts` (367 lines)

**Split Into**:
```
diagnostics/
├── dart-file-parser.ts         (~50 lines)  - Dart file parsing with caching
├── diagnostic-config.ts        (~60 lines)  - Configuration loading
├── code-action-provider.ts     (~30 lines)  - VS Code code action provider
└── diagnostic-manager.ts       (~230 lines) - Core manager (slimmed)
```

### 3.4 Diagnostic Codes Decomposition

**Current**: `diagnostic-codes.ts` (384 lines)

**Split Into**:
```
diagnostics/codes/
├── index.ts                    (~50 lines)  - Re-exports + lookup functions
├── schema-codes.ts             (~90 lines)
├── performance-codes.ts        (~55 lines)
├── data-quality-codes.ts       (~65 lines)
├── best-practice-codes.ts      (~80 lines)
├── naming-codes.ts             (~60 lines)  - Includes SQL_RESERVED_WORDS
└── runtime-codes.ts            (~40 lines)
```

### 3.5 Invariant Panel Decomposition

**Current**: `invariant-panel.ts` (340 lines)

**Split Into**:
```
invariants/
├── invariant-prompts.ts        (~175 lines) - Rule wizard functions
└── invariant-panel.ts          (~165 lines) - Panel management
```

### 3.6 Import Executor Decomposition

**Current**: `import-executor.ts` (464 lines)

**Split Into**:
```
import/
├── import-sql-helpers.ts       (~120 lines) - SQL building utilities
├── import-undo.ts              (~70 lines)  - undoImport functionality
└── import-executor.ts          (~280 lines) - Core execute/dryRun logic
```

**Phase 3 Estimated Impact**: ~20 new modules from 8 large classes

---

## Phase 4: Provider Checkers

Extract checker logic from diagnostic providers into focused modules.

### 4.1 Performance Provider Checkers

**Current**: `performance-provider.ts` (314 lines)

**Split Into**:
```
diagnostics/checkers/
├── slow-query-checker.ts       (~50 lines)
├── n-plus-one-checker.ts       (~55 lines)
└── query-pattern-checker.ts    (~55 lines)

providers/
└── performance-provider.ts     (~100 lines) - Orchestration + code actions
```

### 4.2 Schema Provider Checkers

**Current**: `schema-provider.ts` (368 lines)

**Split Into**:
```
diagnostics/checkers/
├── table-checker.ts            (~55 lines)  - Missing/extra tables
├── column-checker.ts           (~80 lines)  - Column drift
├── pk-checker.ts               (~50 lines)  - PK issues
├── fk-checker.ts               (~50 lines)  - FK index issues
└── anomaly-checker.ts          (~45 lines)  - Anomaly conversion

providers/
└── schema-provider.ts          (~100 lines) - Orchestration + code actions
```

### 4.3 Runtime Provider Decomposition

**Current**: `runtime-provider.ts` (321 lines)

**Split Into**:
```
diagnostics/runtime/
├── runtime-event-store.ts      (~50 lines)  - Event queue management
├── event-converter.ts          (~60 lines)  - Event to diagnostic conversion
└── connection-checker.ts       (~40 lines)  - Connection health checks

providers/
└── runtime-provider.ts         (~180 lines) - Provider orchestration
```

**Phase 4 Estimated Impact**: ~11 checker modules from 3 providers

---

## Phase 5: Extension Entry Point

### 5.1 Main Extension Decomposition

**Current**: `extension.ts` (410 lines)

**Split Into**:
```
src/
├── extension.ts                (~80 lines)  - Main activate/deactivate
├── extension-providers.ts      (~100 lines) - Tree, language, file decoration providers
├── extension-diagnostics.ts    (~90 lines)  - Diagnostic manager setup
├── extension-editing.ts        (~80 lines)  - Editing infrastructure
└── extension-commands.ts       (~60 lines)  - Command registration
```

**Implementation Notes**:
- Create setup functions that accept `ExtensionContext` and `DriftApiClient`
- Each module exports a single setup function
- Main extension calls each in sequence

```typescript
// extension.ts
export async function activate(context: ExtensionContext) {
  const client = await setupClient(context);
  
  setupProviders(context, client);
  setupDiagnostics(context, client);
  setupEditing(context, client);
  registerAllCommands(context, client);
}
```

---

## Phase 6: Test File Organization

### 6.1 Create Shared Test Fixtures

| New Fixture File | Contents | Est. Lines |
|------------------|----------|------------|
| `test/fixtures/diagnostic-test-fixtures.ts` | `createContext`, `createDartFile`, `createMockProvider`, `createMockIssue` | ~150 |
| `test/fixtures/health-test-fixtures.ts` | `makeClient`, `stubPerfectDb` | ~60 |
| `test/fixtures/import-test-fixtures.ts` | `createMockClient` | ~90 |

### 6.2 Split Large Test Files

| Test File | Current Lines | Split Strategy |
|-----------|---------------|----------------|
| `health-scorer.test.ts` | 460 | → `health-scorer-grade.test.ts` (~60), `health-panel.test.ts` (~70), `health-scorer.test.ts` (~250) |
| `data-narrator.test.ts` | 389 | → Extract utility tests to `narrator-utils.test.ts` (~70) |

### 6.3 Enhance Existing Test Helpers

| File | Enhancement |
|------|-------------|
| `health-check-helpers.ts` | Move mock functions from `health-check-runner.test.ts` (~93 lines) |

**Phase 6 Estimated Impact**: 3 fixture files, 2 test file splits, reduced duplication

---

## Phase 7: Remaining Files

### 7.1 Health Scorer Metrics

**Current**: `health-scorer.ts` (390 lines)

**Option A - Individual Metric Files**:
```
health/
├── health-scorer.ts            (~100 lines) - Orchestration
├── health-utils.ts             (~25 lines)  - toGrade, sqlId
└── metrics/
    ├── index-coverage.ts       (~50 lines)
    ├── fk-integrity.ts         (~40 lines)
    ├── null-density.ts         (~70 lines)
    ├── query-performance.ts    (~50 lines)
    ├── table-balance.ts        (~60 lines)
    └── schema-quality.ts       (~55 lines)
```

**Option B - Combined Metrics File** (simpler):
```
health/
├── health-scorer.ts            (~100 lines) - Orchestration
├── health-metrics.ts           (~270 lines) - All 6 scorers
└── health-utils.ts             (~25 lines)  - Utilities
```

**Recommendation**: Option B for simplicity unless metrics need independent testing/extension.

### 7.2 Engine Files

| File | Split Strategy | Result |
|------|----------------|--------|
| `query-intelligence.ts` (330) | Extract types + SQL parser | 3 files (~35, 90, 205) |
| `relationship-engine.ts` (358) | Extract types + SQL helpers | 3 files (~30, 70, 260) |

---

## Implementation Order

### Batch 1: Mechanical Extractions (Low Risk)
1. Extract all CSS to `*-styles.ts` files
2. Extract embedded scripts to `*-scripts.ts` files
3. Extract type definitions to `*-types.ts` files

### Batch 2: Test Infrastructure (Enables Better Testing)
1. Create shared test fixtures
2. Split largest test file (`health-scorer.test.ts`)
3. Consolidate test utilities

### Batch 3: Diagnostic System (High Value)
1. Split diagnostic codes into category files
2. Extract checker logic from providers
3. Decompose diagnostic manager

### Batch 4: Dashboard System
1. Split widget registry into widget definition files
2. Extract panel helpers
3. Consolidate widget renderers

### Batch 5: Import System
1. Extract SQL helpers
2. Split import executor
3. Consolidate validation utilities

### Batch 6: Entry Point & Remaining
1. Decompose extension.ts
2. Split health scorer
3. Handle remaining engine files

---

## File Count Summary

| Phase | New Modules | Files Affected | Risk Level |
|-------|-------------|----------------|------------|
| Phase 1 | ~10 | 6 | Low |
| Phase 2 | ~6 | 4 | Low |
| Phase 3 | ~20 | 8 | Medium |
| Phase 4 | ~11 | 3 | Medium |
| Phase 5 | ~5 | 1 | Medium |
| Phase 6 | ~5 | 13 | Low |
| Phase 7 | ~8 | 3 | Low |
| **Total** | **~65** | **38** | - |

---

## Success Criteria

After modularization:
- [ ] No source file exceeds 300 lines (excluding auto-generated)
- [ ] Test files may exceed 300 lines if they test a single cohesive unit
- [ ] All existing tests pass
- [ ] No circular dependencies introduced
- [ ] Import paths remain clean (max 3 levels deep)

---

## Notes

### Files to Keep As-Is
- `import-history.ts` (318 lines) - Cohesive single responsibility, borderline
- `vscode-mock-classes.ts` (337 lines) - Test infrastructure, stable
- `vscode-mock.ts` (315 lines) - Test infrastructure, stable

### Patterns to Follow
1. **Style Extraction**: Export a function returning CSS string, not a const
2. **Type Files**: Use `*-types.ts` suffix for pure type definitions
3. **Barrel Exports**: Use `index.ts` for re-exports when creating subfolders
4. **Test Fixtures**: Place in `test/fixtures/` with `*-fixtures.ts` suffix

---

## Implementation Progress

**Batch 1 (Phase 1) — done**

- **1.1 Extract CSS**
  - ✅ `dashboard/dashboard-css.ts` — `getDashboardCss()`; `dashboard-html.ts` now ~110 lines
  - ✅ `er-diagram/er-diagram-styles.ts` — `getErDiagramCss()`; `er-diagram-html.ts` now ~72 lines
  - ✅ `import/clipboard-import-styles.ts` — `getClipboardImportCss()`
  - ✅ `invariants/invariant-styles.ts` — `getInvariantStyles()`
  - ✅ `narrator/narrator-styles.ts` — `getNarratorCss()`
  - ✅ `query-cost/query-cost-styles.ts` — `getQueryCostCss()`
- **1.2 Extract scripts**
  - ✅ `dashboard/dashboard-scripts.ts` — `getDashboardJs(widgetTypesJson, layoutJson)`
  - ✅ `er-diagram/er-diagram-script.ts` — `getErDiagramScript(nodesJson, edgesJson)`
  - ✅ `import/clipboard-import-scripts.ts` — `getClipboardImportScript()`
- **1.3 Extract types**
  - ✅ `engines/query-intelligence-types.ts` — `IQueryPattern`, `IPatternIndexSuggestion`, `IJoinPattern`
  - ✅ `engines/relationship-types.ts` — `IRelationshipNode`, `IRelationshipChain`, `IAffectedTable`, `IDeletePlan`
  - ✅ `import/clipboard-import-messages.ts` — panel message interfaces and `PanelMessage`

**Batch 2 (Phase 2 — Extract utility functions) — done**

- **2.1 Shared utilities**
  - ✅ `diagnostics/utils/sql-utils.ts` — `extractTableFromSql`, `truncateSql`, `areSimilarQueries`; used by PerformanceProvider and performance-items
  - ✅ `diagnostics/utils/dart-file-utils.ts` — `findDartFileForTable`; used by PerformanceProvider, BestPracticeProvider, DataQualityProvider
  - ✅ `narrator/narrator-utils.ts` — `singularize`, `capitalize`, `formatValue`, `sqlLiteral`; DataNarrator and narrator index use them
  - ✅ `health/health-utils.ts` — `toGrade`, `sqlId`; HealthScorer uses them, toGrade re-exported from health-scorer
- **2.2 Import utilities**
  - ✅ `import/import-fk-validator.ts` — `validateForeignKeys`; import-validator re-exports it
  - ⬜ `import/import-sql-helpers.ts` — deferred (would require refactoring import-executor inline SQL)

**Batch 3 (Phase 3 — Split large classes) — partially done**

- **3.1 Dashboard panel** — ✅
  - `dashboard/panel/widget-layout.ts` — `findNextGridX`, `findNextGridY`, `generateId`
  - `dashboard/panel/widget-crud.ts` — `addWidget`, `removeWidget`, `swapWidgets`, `resizeWidget`, `editWidget`
  - `dashboard/panel/message-handler.ts` — `handleDashboardMessage`; panel uses it and slimmed to ~185 lines
- **3.2 Widget registry** — ✅
  - `dashboard/widgets/widget-renderers.ts` — `renderMiniTable`, `renderSvgChart`
  - `dashboard/widgets/data-widgets.ts` — tableStats, tablePreview, rowCount
  - `dashboard/widgets/query-widgets.ts` — queryResult, chart
  - `dashboard/widgets/monitoring-widgets.ts` — healthScore, invariantStatus, dvrStatus, watchDiff
  - `dashboard/widgets/utility-widgets.ts` — customText
  - `dashboard/widget-registry.ts` — composes and exports; `IWidgetDefinition` moved to dashboard-types
- **3.3 Diagnostic manager** — ✅
  - `diagnostics/dart-file-parser.ts` — `parseDartFilesInWorkspace()`
  - `diagnostics/diagnostic-config.ts` — `loadDiagnosticConfig()`
  - `diagnostics/code-action-provider.ts` — `DiagnosticCodeActionProvider`; diagnostic-manager re-exports it
- **3.4 Diagnostic codes** — ✅
  - `diagnostics/codes/schema-codes.ts`, `performance-codes.ts`, `data-quality-codes.ts`, `best-practice-codes.ts`, `naming-codes.ts` (with `SQL_RESERVED_WORDS`, `isSqlReservedWord`, `isSnakeCase`), `runtime-codes.ts`
  - `diagnostics/codes/index.ts` — composes `DIAGNOSTIC_CODES`, re-exports lookup helpers; `diagnostic-codes.ts` re-exports from `./codes`
- **3.5 Invariant panel** — ✅
  - `invariants/invariant-prompts.ts` — `promptAddRule`, `promptCustomRule`, `promptEditRule`, `promptRemoveRule`; panel uses `_getPromptContext()` and calls them
- **3.6 Import executor** — ✅
  - `import/import-undo.ts` — `undoImport(client, table, insertedIds, updatedRows, pkColumn)`; `ImportExecutor.undoImport` delegates to it
  - `import-sql-helpers` — still deferred

**Batch 4 (Phase 4 — Provider checkers) — done**

- **4.1 Performance provider**
  - `diagnostics/checkers/slow-query-checker.ts` — `checkSlowQueries(issues, perfData, dartFiles)`
  - `diagnostics/checkers/n-plus-one-checker.ts` — `checkNPlusOnePatterns(issues, perfData, dartFiles)`
  - `diagnostics/checkers/query-pattern-checker.ts` — `checkQueryPatterns(issues, suggestions, dartFiles)`; performance-provider orchestrates + code actions (~115 lines)
- **4.2 Schema provider**
  - `diagnostics/checkers/table-checker.ts` — `checkMissingTableInDb`, `checkExtraTablesInDb`
  - `diagnostics/checkers/column-checker.ts` — `checkColumnDrift`
  - `diagnostics/checkers/pk-checker.ts` — `checkMissingPrimaryKey`, `checkTextPrimaryKey`
  - `diagnostics/checkers/fk-checker.ts` — `checkMissingFkIndexes`
  - `diagnostics/checkers/anomaly-checker.ts` — `checkAnomalies`; schema-provider orchestrates + code actions (~135 lines)
- **4.3 Runtime provider**
  - `diagnostics/runtime/runtime-event-store.ts` — `IRuntimeEvent`, `RuntimeEventStore` (addEvent, prune, clear, hasRecentConnectionError)
  - `diagnostics/runtime/event-converter.ts` — `eventToIssue(event, workspaceUri)`
  - `diagnostics/runtime/connection-checker.ts` — `checkConnection(client, issues, workspaceUri, hasRecentConnectionError)`; runtime-provider uses store + converter + checker (~195 lines)

**Batch 5 (Phase 5 — Extension entry point) — done**

- **5.1 Main extension decomposition**
  - `extension-diagnostics.ts` — `setupDiagnostics(context, client, schemaIntel, queryIntel)` → `{ diagnosticManager }`; registers 6 providers + disable/clear/copy commands + DiagnosticCodeActionProvider
  - `extension-providers.ts` — `setupProviders(context, client, annotationStore)` → tree view, definition/codelens/hover, legacy linter, file decorations, timeline, watch manager, dbp, task/terminal, log bridge
  - `extension-editing.ts` — `setupEditing(context, client)` → change tracker, editing bridge, FK navigator, filter store/bridge, pending changes view
  - `extension-commands.ts` — `registerAllCommands(context, client, deps)`; `CommandRegistrationDeps` extends provider + editing results
  - `extension.ts` — activate: client + discovery + annotationStore; calls setupProviders, setupDiagnostics, setupEditing; wires watcher + status bar + changeTracker.onDidChange; then registerAllCommands (~125 lines)

**Batch 6** — not started. All tests pass after Batch 5.
