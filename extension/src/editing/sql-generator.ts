import { PendingChange, groupByTable } from './change-tracker';

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Generate reviewed SQL from pending changes, grouped by table. */
export function generateSql(changes: readonly PendingChange[]): string {
  if (changes.length === 0) {
    return '-- Saropa Drift Advisor: No pending changes.\n';
  }

  const lines: string[] = [
    `-- Saropa Drift Advisor: Generated SQL (${changes.length} change(s))`,
    '-- Review carefully before executing!',
    '',
  ];

  for (const [table, tableChanges] of groupByTable(changes)) {
    lines.push(`-- ${table}: ${tableChanges.length} change(s)`);

    for (const change of tableChanges) {
      switch (change.kind) {
        case 'cell':
          lines.push(
            `UPDATE "${table}" SET "${change.column}" = ${sqlLiteral(change.newValue)} ` +
              `WHERE "${change.pkColumn}" = ${sqlLiteral(change.pkValue)};`,
          );
          break;
        case 'insert': {
          const cols = Object.keys(change.values);
          const vals = cols.map((c) => sqlLiteral(change.values[c]));
          lines.push(
            `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) ` +
              `VALUES (${vals.join(', ')});`,
          );
          break;
        }
        case 'delete':
          lines.push(
            `DELETE FROM "${table}" WHERE "${change.pkColumn}" = ${sqlLiteral(change.pkValue)};`,
          );
          break;
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
