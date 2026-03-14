/** Narrative description helpers for DataNarrator (extracted for modularization). */

import type { IEntityNode, IRelatedData } from './narrator-types';
import { capitalize, formatValue, singularize } from './narrator-utils';

const PREVIEW_COLUMNS = 4;

/** Common column names that typically contain human-readable identifiers. */
const NAME_COLUMN_CANDIDATES = ['name', 'title', 'label', 'description', 'email', 'username'];

/** Find a column that likely contains a human-readable name. */
export function findNameColumn(columns: string[]): string | undefined {
  return columns.find((c) => NAME_COLUMN_CANDIDATES.includes(c.toLowerCase()));
}

function findNameColumnFromRow(row: Record<string, unknown>): string | undefined {
  return findNameColumn(Object.keys(row));
}

function findPkValue(row: Record<string, unknown>): unknown {
  const pkCandidates = ['id', 'rowid', '_rowid_'];
  for (const pk of pkCandidates) {
    if (row[pk] !== undefined) return row[pk];
  }
  const keys = Object.keys(row);
  return keys.length > 0 ? row[keys[0]] : undefined;
}

function isIdColumn(col: string): boolean {
  const lower = col.toLowerCase();
  return lower === 'id' || lower === 'rowid' || lower === '_rowid_' ||
         lower.endsWith('_id') || lower.endsWith('id');
}

export function describeRoot(root: IEntityNode): { text: string; markdown: string } {
  const nameCol = findNameColumn(root.columns);
  const name = nameCol ? String(root.row[nameCol]) : null;
  const entityName = singularize(capitalize(root.table));

  let header = `${entityName}`;
  if (name) {
    header += ` "${name}"`;
  }
  header += ` (${root.pkColumn}: ${formatValue(root.pkValue)})`;

  const notable = root.columns
    .filter((c) => !isIdColumn(c) && c !== nameCol && root.row[c] != null)
    .slice(0, PREVIEW_COLUMNS);

  let details = '';
  if (notable.length > 0) {
    const detailParts = notable.map((c) => `${c} = ${formatValue(root.row[c])}`);
    details = ` — ${detailParts.join(', ')}`;
  }

  const text = `${header}${details}.`;
  const markdown = `**${header}**${details}.`;

  return { text, markdown };
}

export function describeParents(parents: IRelatedData[]): { text: string; markdown: string } {
  const parts: string[] = [];
  const mdParts: string[] = [];

  for (const parent of parents) {
    if (parent.rows.length === 0) continue;
    const row = parent.rows[0];
    const nameCol = findNameColumnFromRow(row);
    const name = nameCol ? String(row[nameCol]) : null;
    const entityName = singularize(capitalize(parent.table));

    let desc = `Belongs to ${entityName}`;
    if (name) {
      desc += ` "${name}"`;
    }
    const pk = findPkValue(row);
    if (pk !== undefined) {
      desc += ` (id: ${formatValue(pk)})`;
    }
    desc += ` via ${parent.fkColumn}.`;

    parts.push(desc);
    mdParts.push(desc.replace(`Belongs to ${entityName}`, `Belongs to **${entityName}**`));
  }

  return {
    text: parts.join(' '),
    markdown: mdParts.join(' '),
  };
}

export function describeChildren(child: IRelatedData): { text: string; markdown: string } {
  const count = child.rowCount;
  const noun = count === 1 ? singularize(child.table) : child.table;

  let header = `Has ${count} ${noun}`;
  if (child.truncated) {
    header += ` (showing first ${child.rows.length})`;
  }
  header += ':';

  const items = child.rows.map((row) => {
    const summary = summarizeRow(row);
    return `  • ${summary}`;
  });

  const text = `${header}\n${items.join('\n')}`;
  const markdown = `**${header}**\n${items.join('\n')}`;

  return { text, markdown };
}

export function summarizeRow(row: Record<string, unknown>): string {
  const pk = findPkValue(row);
  const nameCol = findNameColumnFromRow(row);
  const name = nameCol ? String(row[nameCol]) : null;

  let summary = '';
  if (name) {
    summary = `"${name}"`;
    if (pk !== undefined) {
      summary += ` (id: ${formatValue(pk)})`;
    }
  } else if (pk !== undefined) {
    summary = `id: ${formatValue(pk)}`;
  }

  const otherCols = Object.keys(row)
    .filter((k) => !isIdColumn(k) && k !== nameCol)
    .slice(0, 2);

  if (otherCols.length > 0) {
    const extras = otherCols.map((k) => `${k}=${formatValue(row[k])}`);
    summary += summary ? `, ${extras.join(', ')}` : extras.join(', ');
  }

  return summary || '(row)';
}
