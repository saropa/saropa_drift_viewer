# Feature 34: Snapshot Changelog Narrative

## What It Does

Generate a human-readable story of what changed between two snapshots. Instead of raw diff tables, produce prose that anyone can understand: "Between 10:30 and 10:45: 3 users were created, 12 orders changed status from 'pending' to 'shipped', 1 product was deleted." Exportable as Markdown for bug reports or standup notes.

## User Experience

1. Open the Timeline panel → select two snapshots → "Generate Changelog"
2. Or: command palette → "Saropa Drift Advisor: Generate Snapshot Changelog" → pick two snapshots
3. A Markdown document opens:

```markdown
# Database Changelog

**From:** Snapshot "before-deploy" (2026-03-10 10:30:15)
**To:** Snapshot "after-deploy" (2026-03-10 10:45:22)
**Duration:** 15 minutes

## Summary

- **5 inserts** across 2 tables
- **13 updates** across 2 tables
- **1 delete** in 1 table
- **3 tables unchanged**

## Changes by Table

### users — 4 changes

- **3 rows created:**
  - id=140: name="Eve Chen", email="eve@example.com", role="user"
  - id=141: name="Frank Li", email="frank@example.com", role="user"
  - id=142: name="Grace Kim", email="grace@example.com", role="admin"

- **1 row updated:**
  - id=42: `name` changed from "Alice" → "Alice Smith"

### orders — 14 changes

- **2 rows created:**
  - id=200: user_id=140, total=$49.99, status="pending"
  - id=201: user_id=142, total=$129.00, status="pending"

- **12 rows updated:**
  - `status` changed from "pending" → "shipped" (ids: 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112)

### products — 1 change

- **1 row deleted:**
  - id=7: name="Widget Pro", price=$29.99, category="gadgets"

### sessions, audit_log, roles — no changes
```

4. Click "Copy to Clipboard" or "Save as Markdown"

## New Files

```
extension/src/
  changelog/
    changelog-generator.ts     # Computes narrative from snapshot diff
    changelog-renderer.ts      # Renders diff as Markdown prose
    changelog-types.ts         # Shared interfaces
extension/src/test/
  changelog-generator.test.ts
  changelog-renderer.test.ts
```

## Dependencies

- `api-client.ts` — `sql()` for fetching snapshot data
- `watch/watch-diff.ts` — reuse `computeDiff()` for row-level diff calculation
- `timeline/snapshot-store.ts` — access stored snapshots

## Architecture

### Changelog Generator

Takes two snapshot states and produces a structured changelog:

```typescript
interface IChangelogEntry {
  table: string;
  inserts: IInsertedRow[];
  updates: IUpdatedRow[];
  deletes: IDeletedRow[];
}

interface IInsertedRow {
  pk: unknown;
  preview: Record<string, unknown>;   // first 4–5 columns for display
}

interface IUpdatedRow {
  pk: unknown;
  changes: { column: string; oldValue: unknown; newValue: unknown }[];
}

interface IDeletedRow {
  pk: unknown;
  preview: Record<string, unknown>;
}

interface IChangelog {
  fromSnapshot: { name: string; timestamp: string };
  toSnapshot: { name: string; timestamp: string };
  entries: IChangelogEntry[];
  summary: {
    totalInserts: number;
    totalUpdates: number;
    totalDeletes: number;
    tablesChanged: number;
    tablesUnchanged: number;
  };
}

class ChangelogGenerator {
  async generate(
    snapshotA: ISnapshotData,
    snapshotB: ISnapshotData,
    meta: TableMetadata[],
  ): Promise<IChangelog> {
    const entries: IChangelogEntry[] = [];
    let totalInserts = 0, totalUpdates = 0, totalDeletes = 0;

    for (const table of meta) {
      if (table.name.startsWith('sqlite_')) continue;

      const rowsA = snapshotA.tables.get(table.name) ?? [];
      const rowsB = snapshotB.tables.get(table.name) ?? [];

      const pkCol = table.columns.find(c => c.pk)?.name ?? 'id';
      const diff = this._diffRows(rowsA, rowsB, pkCol, table.columns);

      if (diff.inserts.length === 0 && diff.updates.length === 0 && diff.deletes.length === 0) {
        continue;
      }

      entries.push({
        table: table.name,
        inserts: diff.inserts,
        updates: diff.updates,
        deletes: diff.deletes,
      });

      totalInserts += diff.inserts.length;
      totalUpdates += diff.updates.length;
      totalDeletes += diff.deletes.length;
    }

    const tablesChanged = entries.length;
    const tablesUnchanged = meta.filter(t => !t.name.startsWith('sqlite_')).length - tablesChanged;

    return {
      fromSnapshot: snapshotA.meta,
      toSnapshot: snapshotB.meta,
      entries,
      summary: { totalInserts, totalUpdates, totalDeletes, tablesChanged, tablesUnchanged },
    };
  }

  private _diffRows(
    rowsA: Record<string, unknown>[],
    rowsB: Record<string, unknown>[],
    pkCol: string,
    columns: ColumnMetadata[],
  ): { inserts: IInsertedRow[]; updates: IUpdatedRow[]; deletes: IDeletedRow[] } {
    const mapA = new Map(rowsA.map(r => [String(r[pkCol]), r]));
    const mapB = new Map(rowsB.map(r => [String(r[pkCol]), r]));
    const previewCols = columns.slice(0, 5).map(c => c.name);

    const inserts: IInsertedRow[] = [];
    const updates: IUpdatedRow[] = [];
    const deletes: IDeletedRow[] = [];

    // Inserts: in B but not A
    for (const [pk, row] of mapB) {
      if (!mapA.has(pk)) {
        inserts.push({
          pk: row[pkCol],
          preview: Object.fromEntries(previewCols.map(c => [c, row[c]])),
        });
      }
    }

    // Deletes: in A but not B
    for (const [pk, row] of mapA) {
      if (!mapB.has(pk)) {
        deletes.push({
          pk: row[pkCol],
          preview: Object.fromEntries(previewCols.map(c => [c, row[c]])),
        });
      }
    }

    // Updates: in both but different
    for (const [pk, rowB] of mapB) {
      const rowA = mapA.get(pk);
      if (!rowA) continue;

      const changes: { column: string; oldValue: unknown; newValue: unknown }[] = [];
      for (const col of columns) {
        if (col.name === pkCol) continue;
        if (!this._eq(rowA[col.name], rowB[col.name])) {
          changes.push({ column: col.name, oldValue: rowA[col.name], newValue: rowB[col.name] });
        }
      }
      if (changes.length > 0) {
        updates.push({ pk: rowA[pkCol], changes });
      }
    }

    return { inserts, updates, deletes };
  }

  private _eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
```

### Changelog Renderer

Renders the structured changelog as readable Markdown:

```typescript
class ChangelogRenderer {
  render(changelog: IChangelog): string {
    const lines: string[] = [
      '# Database Changelog',
      '',
      `**From:** Snapshot "${changelog.fromSnapshot.name}" (${changelog.fromSnapshot.timestamp})`,
      `**To:** Snapshot "${changelog.toSnapshot.name}" (${changelog.toSnapshot.timestamp})`,
      '',
      '## Summary',
      '',
    ];

    const { totalInserts, totalUpdates, totalDeletes, tablesChanged, tablesUnchanged } = changelog.summary;
    if (totalInserts > 0) lines.push(`- **${totalInserts} insert(s)** across ${this._countTables(changelog.entries, 'inserts')} table(s)`);
    if (totalUpdates > 0) lines.push(`- **${totalUpdates} update(s)** across ${this._countTables(changelog.entries, 'updates')} table(s)`);
    if (totalDeletes > 0) lines.push(`- **${totalDeletes} delete(s)** across ${this._countTables(changelog.entries, 'deletes')} table(s)`);
    if (tablesUnchanged > 0) lines.push(`- **${tablesUnchanged} table(s)** unchanged`);
    lines.push('');

    lines.push('## Changes by Table');
    lines.push('');

    for (const entry of changelog.entries) {
      const total = entry.inserts.length + entry.updates.length + entry.deletes.length;
      lines.push(`### ${entry.table} — ${total} change(s)`);
      lines.push('');

      if (entry.inserts.length > 0) {
        lines.push(`- **${entry.inserts.length} row(s) created:**`);
        for (const row of entry.inserts.slice(0, 10)) {
          const preview = Object.entries(row.preview)
            .map(([k, v]) => `${k}=${this._fmt(v)}`)
            .join(', ');
          lines.push(`  - ${preview}`);
        }
        if (entry.inserts.length > 10) {
          lines.push(`  - … and ${entry.inserts.length - 10} more`);
        }
        lines.push('');
      }

      if (entry.updates.length > 0) {
        // Group updates by changed columns
        const groups = this._groupUpdatesByColumns(entry.updates);
        for (const group of groups) {
          if (group.rows.length === 1) {
            const u = group.rows[0];
            const changes = u.changes.map(c => `\`${c.column}\` changed from ${this._fmt(c.oldValue)} → ${this._fmt(c.newValue)}`).join(', ');
            lines.push(`- **1 row updated:** id=${u.pk}: ${changes}`);
          } else {
            const pks = group.rows.map(u => u.pk).join(', ');
            const change = group.rows[0].changes[0];
            lines.push(`- **${group.rows.length} rows updated:** \`${change.column}\` changed from ${this._fmt(change.oldValue)} → ${this._fmt(change.newValue)} (ids: ${pks})`);
          }
        }
        lines.push('');
      }

      if (entry.deletes.length > 0) {
        lines.push(`- **${entry.deletes.length} row(s) deleted:**`);
        for (const row of entry.deletes.slice(0, 10)) {
          const preview = Object.entries(row.preview)
            .map(([k, v]) => `${k}=${this._fmt(v)}`)
            .join(', ');
          lines.push(`  - ${preview}`);
        }
        if (entry.deletes.length > 10) {
          lines.push(`  - … and ${entry.deletes.length - 10} more`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private _fmt(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string') return `"${v}"`;
    return String(v);
  }

  private _groupUpdatesByColumns(updates: IUpdatedRow[]): { columns: string[]; rows: IUpdatedRow[] }[] {
    const groups = new Map<string, IUpdatedRow[]>();
    for (const u of updates) {
      const key = u.changes.map(c => `${c.column}:${JSON.stringify(c.oldValue)}→${JSON.stringify(c.newValue)}`).join('|');
      const group = groups.get(key) ?? [];
      group.push(u);
      groups.set(key, group);
    }
    return [...groups.entries()].map(([, rows]) => ({
      columns: rows[0].changes.map(c => c.column),
      rows,
    }));
  }
}
```

## Server-Side Changes

None. Uses existing snapshot data stored by the timeline feature.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.snapshotChangelog",
        "title": "Saropa Drift Advisor: Generate Snapshot Changelog",
        "icon": "$(list-ordered)"
      }
    ]
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.snapshotChangelog', async () => {
    const snapshots = snapshotStore.getAll();
    if (snapshots.length < 2) {
      vscode.window.showWarningMessage('Need at least 2 snapshots to generate a changelog.');
      return;
    }

    const pickA = await vscode.window.showQuickPick(
      snapshots.map(s => ({ label: s.name, description: s.timestamp, snapshot: s })),
      { placeHolder: 'Select "from" snapshot (older)' }
    );
    if (!pickA) return;

    const pickB = await vscode.window.showQuickPick(
      snapshots.filter(s => s.name !== pickA.label).map(s => ({ label: s.name, description: s.timestamp, snapshot: s })),
      { placeHolder: 'Select "to" snapshot (newer)' }
    );
    if (!pickB) return;

    const meta = await client.schemaMetadata();
    const generator = new ChangelogGenerator();
    const changelog = await generator.generate(pickA.snapshot, pickB.snapshot, meta.tables);

    const renderer = new ChangelogRenderer();
    const markdown = renderer.render(changelog);

    const doc = await vscode.workspace.openTextDocument({
      content: markdown,
      language: 'markdown',
    });
    await vscode.window.showTextDocument(doc);
  })
);
```

## Testing

- `changelog-generator.test.ts`:
  - No changes → empty entries, summary all zeros
  - Inserts only → correct insert entries with previews
  - Deletes only → correct delete entries with previews
  - Updates only → correct column changes detected
  - Mixed changes → all types represented
  - PK detection works for non-`id` columns
  - Empty table in both snapshots → skipped (no entry)
- `changelog-renderer.test.ts`:
  - Markdown output has correct headers
  - Grouped updates show "N rows updated" with shared change description
  - Single updates show per-row detail
  - Long lists truncated at 10 with "… and N more"
  - NULL values rendered as "NULL"
  - String values rendered with quotes
  - No changes → summary says "unchanged"

## Known Limitations

- Requires snapshots to contain full row data — snapshots with row-count-only won't work
- PK detection heuristic may fail for tables without a clear PK
- Update grouping only works when the exact same column changed to the exact same value
- Large tables (10k+ rows) produce very long changelogs — capped at 10 rows per section
- No "diff between current state and snapshot" — must compare two stored snapshots
- Cross-table changes aren't correlated (e.g., "user created and then placed an order")
- No support for schema changes (only data changes are tracked)
- Markdown output is not interactive — no links to rows or tables
