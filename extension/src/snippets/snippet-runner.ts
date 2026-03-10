import type { DriftApiClient } from '../api-client';
import type { ISnippetVariable, ISqlSnippet } from './snippet-types';

export class SnippetRunner {
  constructor(private readonly _client: DriftApiClient) {}

  /** Extract variable names from SQL template. */
  extractVariables(sql: string): string[] {
    const matches = sql.matchAll(/\$\{(\w+)\}/g);
    return [...new Set([...matches].map((m) => m[1]))];
  }

  /** Substitute variables and return final SQL. */
  interpolate(
    sql: string,
    values: Record<string, string>,
  ): string {
    return sql.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const value = values[name];
      if (value === undefined) {
        return `\${${name}}`;
      }
      return value;
    });
  }

  /** Run a snippet with variable values. */
  async run(
    snippet: ISqlSnippet,
    values: Record<string, string>,
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    const sql = this.interpolate(snippet.sql, values);
    return this._client.sql(sql);
  }

  /** Auto-detect variable types from names. */
  inferVariableTypes(names: string[]): ISnippetVariable[] {
    return names.map((name) => {
      if (name === 'table' || name.endsWith('_table')) {
        return { name, type: 'table' as const, description: 'Table name' };
      }
      if (name === 'limit' || name === 'n' || name === 'count') {
        return { name, type: 'number' as const, default: '10' };
      }
      return { name, type: 'text' as const };
    });
  }
}

/** Generate a random UUID v4. */
export function snippetUuid(): string {
  const h = '0123456789abcdef';
  const seg = (n: number): string => {
    let s = '';
    for (let i = 0; i < n; i++) {
      s += h[Math.floor(Math.random() * 16)];
    }
    return s;
  };
  const v = h[8 + Math.floor(Math.random() * 4)];
  return `${seg(8)}-${seg(4)}-4${seg(3)}-${v}${seg(3)}-${seg(12)}`;
}

/** Built-in starter snippets seeded on first run. */
export const STARTER_SNIPPETS: ISqlSnippet[] = [
  {
    id: 'builtin-row-count',
    name: 'Row count',
    sql: 'SELECT COUNT(*) AS count FROM "${table}"',
    category: 'Basics',
    variables: [{ name: 'table', type: 'table' }],
    useCount: 0,
    createdAt: '',
  },
  {
    id: 'builtin-recent-rows',
    name: 'Recent rows',
    sql: 'SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT ${n}',
    category: 'Debugging',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'n', type: 'number', default: '20' },
    ],
    useCount: 0,
    createdAt: '',
  },
  {
    id: 'builtin-distinct-values',
    name: 'Distinct values',
    sql: 'SELECT DISTINCT "${column}" FROM "${table}" ORDER BY 1',
    category: 'Exploration',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'column', type: 'text' },
    ],
    useCount: 0,
    createdAt: '',
  },
  {
    id: 'builtin-null-check',
    name: 'NULL counts per column',
    sql: 'SELECT COUNT(*) - COUNT("${column}") AS null_count FROM "${table}"',
    category: 'Data Quality',
    variables: [
      { name: 'table', type: 'table' },
      { name: 'column', type: 'text' },
    ],
    useCount: 0,
    createdAt: '',
  },
];
