import type { IChangelog, IUpdatedRow } from './changelog-types';

/** Max rows shown per insert/delete section before truncating. */
const MAX_ROWS = 10;

/** Render a structured changelog as readable Markdown. */
export class ChangelogRenderer {
  render(changelog: IChangelog): string {
    const lines: string[] = [];

    this._renderHeader(lines, changelog);
    this._renderSummary(lines, changelog);
    this._renderEntries(lines, changelog);

    return lines.join('\n');
  }

  private _renderHeader(lines: string[], cl: IChangelog): void {
    lines.push('# Database Changelog');
    lines.push('');
    lines.push(
      `**From:** Snapshot "${cl.fromSnapshot.name}" (${cl.fromSnapshot.timestamp})`,
    );
    lines.push(
      `**To:** Snapshot "${cl.toSnapshot.name}" (${cl.toSnapshot.timestamp})`,
    );
    lines.push('');
  }

  private _renderSummary(lines: string[], cl: IChangelog): void {
    lines.push('## Summary');
    lines.push('');

    const { summary } = cl;
    if (
      summary.totalInserts === 0 &&
      summary.totalUpdates === 0 &&
      summary.totalDeletes === 0
    ) {
      lines.push('No changes detected.');
      lines.push('');
      return;
    }

    if (summary.totalInserts > 0) {
      const n = this._tableCount(cl, 'inserts');
      lines.push(`- **${summary.totalInserts} insert(s)** across ${n} table(s)`);
    }
    if (summary.totalUpdates > 0) {
      const n = this._tableCount(cl, 'updates');
      lines.push(`- **${summary.totalUpdates} update(s)** across ${n} table(s)`);
    }
    if (summary.totalDeletes > 0) {
      const n = this._tableCount(cl, 'deletes');
      lines.push(`- **${summary.totalDeletes} delete(s)** across ${n} table(s)`);
    }
    if (summary.tablesUnchanged > 0) {
      lines.push(`- **${summary.tablesUnchanged} table(s)** unchanged`);
    }
    lines.push('');
  }

  private _renderEntries(lines: string[], cl: IChangelog): void {
    if (cl.entries.length === 0) return;

    lines.push('## Changes by Table');
    lines.push('');

    for (const entry of cl.entries) {
      const total =
        entry.inserts.length + entry.updates.length + entry.deletes.length;
      lines.push(`### ${entry.table} — ${total} change(s)`);
      lines.push('');

      this._renderInserts(lines, entry.inserts);
      this._renderUpdates(lines, entry.updates);
      this._renderDeletes(lines, entry.deletes);
    }

    if (cl.unchangedTables.length > 0) {
      lines.push(`### ${cl.unchangedTables.join(', ')} — no changes`);
      lines.push('');
    }
  }

  private _renderInserts(
    lines: string[],
    inserts: { preview: Record<string, unknown> }[],
  ): void {
    if (inserts.length === 0) return;

    lines.push(`- **${inserts.length} row(s) created:**`);
    for (const row of inserts.slice(0, MAX_ROWS)) {
      lines.push(`  - ${this._previewStr(row.preview)}`);
    }
    if (inserts.length > MAX_ROWS) {
      lines.push(`  - … and ${inserts.length - MAX_ROWS} more`);
    }
    lines.push('');
  }

  private _renderUpdates(lines: string[], updates: IUpdatedRow[]): void {
    if (updates.length === 0) return;

    const groups = this._groupUpdates(updates);
    for (const group of groups) {
      if (group.rows.length === 1) {
        const u = group.rows[0];
        const detail = u.changes
          .map(
            (c) =>
              `\`${c.column}\` changed from ${this._fmt(c.oldValue)} → ${this._fmt(c.newValue)}`,
          )
          .join(', ');
        lines.push(`- **1 row updated:** id=${String(u.pk)}: ${detail}`);
      } else {
        const pks = group.rows.map((u) => String(u.pk)).join(', ');
        const detail = group.rows[0].changes
          .map(
            (c) =>
              `\`${c.column}\` ${this._fmt(c.oldValue)} → ${this._fmt(c.newValue)}`,
          )
          .join(', ');
        lines.push(
          `- **${group.rows.length} rows updated:** ${detail} (ids: ${pks})`,
        );
      }
    }
    lines.push('');
  }

  private _renderDeletes(
    lines: string[],
    deletes: { preview: Record<string, unknown> }[],
  ): void {
    if (deletes.length === 0) return;

    lines.push(`- **${deletes.length} row(s) deleted:**`);
    for (const row of deletes.slice(0, MAX_ROWS)) {
      lines.push(`  - ${this._previewStr(row.preview)}`);
    }
    if (deletes.length > MAX_ROWS) {
      lines.push(`  - … and ${deletes.length - MAX_ROWS} more`);
    }
    lines.push('');
  }

  private _previewStr(preview: Record<string, unknown>): string {
    return Object.entries(preview)
      .map(([k, v]) => `${k}=${this._fmt(v)}`)
      .join(', ');
  }

  private _fmt(v: unknown): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'string') return `"${v}"`;
    return String(v);
  }

  private _tableCount(
    cl: IChangelog,
    field: 'inserts' | 'updates' | 'deletes',
  ): number {
    return cl.entries.filter((e) => e[field].length > 0).length;
  }

  private _groupUpdates(
    updates: IUpdatedRow[],
  ): { rows: IUpdatedRow[] }[] {
    const groups = new Map<string, IUpdatedRow[]>();
    for (const u of updates) {
      const key = u.changes
        .map(
          (c) =>
            `${c.column}:${JSON.stringify(c.oldValue)}→${JSON.stringify(c.newValue)}`,
        )
        .join('|');
      const list = groups.get(key) ?? [];
      list.push(u);
      groups.set(key, list);
    }
    return [...groups.values()].map((rows) => ({ rows }));
  }
}
