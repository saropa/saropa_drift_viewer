/**
 * Shared test fixtures for DataNarrator tests.
 */

import { DataNarrator } from '../narrator';

export interface ISqlResult {
  columns: string[];
  rows: unknown[][];
}

export interface IFkResult {
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface ITableMeta {
  name: string;
  columns: { name: string; type: string; pk: boolean }[];
  rowCount: number;
}

export function tbl(name: string, pk = 'id'): ITableMeta {
  return {
    name,
    columns: [
      { name: pk, type: 'INTEGER', pk: true },
      { name: 'name', type: 'TEXT', pk: false },
    ],
    rowCount: 1,
  };
}

export function sqlResult(columns: string[], ...rows: unknown[][]): ISqlResult {
  return { columns, rows };
}

export function mockNarratorClient(opts: {
  tables: ITableMeta[];
  fks: Record<string, IFkResult[]>;
  rows: Record<string, ISqlResult>;
}): DataNarrator {
  const client = {
    schemaMetadata: async () => opts.tables,
    tableFkMeta: async (name: string) => opts.fks[name] ?? [],
    sql: async (query: string) => {
      for (const [key, val] of Object.entries(opts.rows)) {
        if (query.includes(key)) return val;
      }
      return { columns: [], rows: [] };
    },
  };
  return new DataNarrator(client as never);
}
