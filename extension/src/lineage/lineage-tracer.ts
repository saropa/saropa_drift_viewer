import type { DriftApiClient } from '../api-client';
import type { TableMetadata } from '../api-types';
import { rowsToObjects } from '../timeline/snapshot-store';
import type {
  IFkMap, IFkRef, ILineageNode, ILineageResult,
} from './lineage-types';

const MAX_DOWNSTREAM_ROWS = 50;
const MAX_PREVIEW_COLS = 5;

/** Quote a value for use in a SQL WHERE clause. */
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  const s = String(value);
  if (/^-?\d+(\.\d+)?$/.test(s)) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

/** Traces FK relationships upstream and downstream. */
export class LineageTracer {
  constructor(private readonly _client: DriftApiClient) {}

  async trace(
    table: string,
    pkColumn: string,
    pkValue: unknown,
    maxDepth: number,
    direction: 'both' | 'up' | 'down',
  ): Promise<ILineageResult> {
    const tables = await this._client.schemaMetadata();
    const fkMap = await this._buildFkMap(tables);

    const rootRow = await this._fetchRow(table, pkColumn, pkValue);
    const root: ILineageNode = {
      table, pkColumn, pkValue,
      preview: rootRow ? preview(rootRow) : {},
      direction: 'root',
      children: [],
    };

    let upstreamCount = 0;
    let downstreamCount = 0;

    if (rootRow && (direction === 'both' || direction === 'up')) {
      const up = await this._traceUpstream(
        table, rootRow, fkMap, maxDepth, new Set(),
      );
      root.children.push(...up);
      upstreamCount = countNodes(up);
    }

    if (direction === 'both' || direction === 'down') {
      const down = await this._traceDownstream(
        { table, pkColumn, pkValue }, fkMap, maxDepth, new Set(),
      );
      root.children.push(...down);
      downstreamCount = countNodes(down);
    }

    return { root, upstreamCount, downstreamCount };
  }

  /** Follow FK columns in the current row to find parent rows. */
  private async _traceUpstream(
    table: string,
    row: Record<string, unknown>,
    fkMap: IFkMap,
    depth: number,
    visited: Set<string>,
  ): Promise<ILineageNode[]> {
    if (depth <= 0) return [];

    const nodes: ILineageNode[] = [];
    const outgoing = fkMap.outgoing.get(table) ?? [];

    for (const fk of outgoing) {
      const fkValue = row[fk.fromColumn];
      if (fkValue === null || fkValue === undefined) continue;

      const key = `${fk.toTable}:${fkValue}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const parentRow = await this._fetchRow(
        fk.toTable, fk.toColumn, fkValue,
      );
      if (!parentRow) continue;

      const node: ILineageNode = {
        table: fk.toTable,
        pkColumn: fk.toColumn,
        pkValue: fkValue,
        preview: preview(parentRow),
        direction: 'upstream',
        fkColumn: fk.fromColumn,
        children: [],
      };

      node.children = await this._traceUpstream(
        fk.toTable, parentRow, fkMap, depth - 1, visited,
      );
      nodes.push(node);
    }
    return nodes;
  }

  /** Find rows in other tables that reference this row's PK. */
  private async _traceDownstream(
    pk: { table: string; pkColumn: string; pkValue: unknown },
    fkMap: IFkMap,
    depth: number,
    visited: Set<string>,
  ): Promise<ILineageNode[]> {
    if (depth <= 0) return [];

    const nodes: ILineageNode[] = [];
    const incoming = fkMap.incoming.get(pk.table) ?? [];

    for (const fk of incoming) {
      const rows = await this._queryChildren(
        fk.fromTable, fk.fromColumn, pk.pkValue,
      );

      for (const r of rows) {
        const childPkCol = getPkColumn(fk.fromTable, fkMap);
        const childPk = getPkValue(r, fk.fromTable, fkMap);
        const key = `${fk.fromTable}:${childPk}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const node: ILineageNode = {
          table: fk.fromTable,
          pkColumn: childPkCol,
          pkValue: childPk,
          preview: preview(r),
          direction: 'downstream',
          fkColumn: fk.fromColumn,
          children: [],
        };

        node.children = await this._traceDownstream(
          { table: fk.fromTable, pkColumn: childPkCol, pkValue: childPk },
          fkMap, depth - 1, visited,
        );
        nodes.push(node);
      }
    }
    return nodes;
  }

  /** Build bidirectional FK map for quick lookup. */
  private async _buildFkMap(
    tables: TableMetadata[],
  ): Promise<IFkMap> {
    const outgoing = new Map<string, IFkRef[]>();
    const incoming = new Map<string, IFkRef[]>();
    const pkColumns = new Map<string, string>();

    const userTables = tables.filter(
      (t) => !t.name.startsWith('sqlite_'),
    );
    for (const table of userTables) {
      const pkCol = table.columns.find((c) => c.pk)?.name ?? 'rowid';
      pkColumns.set(table.name, pkCol);
    }

    const fkResults = await Promise.all(
      userTables.map(async (t) => ({
        table: t.name,
        fks: await this._client.tableFkMeta(t.name),
      })),
    );

    for (const { table, fks } of fkResults) {
      for (const fk of fks) {
        const ref: IFkRef = {
          fromTable: table,
          fromColumn: fk.fromColumn,
          toTable: fk.toTable,
          toColumn: fk.toColumn,
        };
        pushToMap(outgoing, table, ref);
        pushToMap(incoming, fk.toTable, ref);
      }
    }
    return { outgoing, incoming, pkColumns };
  }

  private async _fetchRow(
    table: string, column: string, value: unknown,
  ): Promise<Record<string, unknown> | null> {
    const q = `SELECT * FROM "${table}" WHERE "${column}" = ${sqlLiteral(value)} LIMIT 1`;
    try {
      const result = await this._client.sql(q);
      const rows = rowsToObjects(result.columns, result.rows);
      return rows[0] ?? null;
    } catch {
      return null;
    }
  }

  private async _queryChildren(
    table: string, column: string, value: unknown,
  ): Promise<Record<string, unknown>[]> {
    const q = `SELECT * FROM "${table}" WHERE "${column}" = ${sqlLiteral(value)} LIMIT ${MAX_DOWNSTREAM_ROWS}`;
    try {
      const result = await this._client.sql(q);
      return rowsToObjects(result.columns, result.rows);
    } catch {
      return [];
    }
  }
}

/** Collect DELETE statements in children-first order. */
export function generateDeleteSql(
  lineage: ILineageResult,
): string {
  const statements: string[] = [];
  const visited = new Set<string>();

  function collect(node: ILineageNode): void {
    for (const child of node.children) {
      if (child.direction === 'downstream') {
        collect(child);
      }
    }
    const key = `${node.table}:${node.pkValue}`;
    if (!visited.has(key) && node.direction !== 'upstream') {
      visited.add(key);
      statements.push(
        `DELETE FROM "${node.table}" WHERE "${node.pkColumn}" = ${sqlLiteral(node.pkValue)};`,
      );
    }
  }

  collect(lineage.root);
  return `-- Safe deletion order (children first)\n${statements.join('\n')}`;
}

function preview(row: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(row).slice(0, MAX_PREVIEW_COLS);
  return Object.fromEntries(keys.map((k) => [k, row[k]]));
}

function countNodes(nodes: ILineageNode[]): number {
  let count = nodes.length;
  for (const n of nodes) {
    count += countNodes(n.children);
  }
  return count;
}

function pushToMap(
  map: Map<string, IFkRef[]>, key: string, ref: IFkRef,
): void {
  const list = map.get(key) ?? [];
  list.push(ref);
  map.set(key, list);
}

function getPkColumn(table: string, fkMap: IFkMap): string {
  return fkMap.pkColumns.get(table) ?? 'rowid';
}

function getPkValue(
  row: Record<string, unknown>, table: string, fkMap: IFkMap,
): unknown {
  const col = getPkColumn(table, fkMap);
  return row[col];
}
