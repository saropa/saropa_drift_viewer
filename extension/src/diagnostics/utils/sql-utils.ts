/**
 * Shared SQL string utilities for diagnostics (e.g. performance provider).
 * Extracted for Phase 2 modularization.
 */

import type { QueryEntry } from '../../api-types';

/**
 * Extracts the primary table name from a SQL statement.
 * Supports FROM, INSERT INTO, UPDATE, DELETE FROM.
 * @returns Table name or null if not matched
 */
export function extractTableFromSql(sql: string): string | null {
  const fromMatch = sql.match(/FROM\s+"?(\w+)"?/i);
  if (fromMatch) return fromMatch[1];

  const insertMatch = sql.match(/INSERT\s+INTO\s+"?(\w+)"?/i);
  if (insertMatch) return insertMatch[1];

  const updateMatch = sql.match(/UPDATE\s+"?(\w+)"?/i);
  if (updateMatch) return updateMatch[1];

  const deleteMatch = sql.match(/DELETE\s+FROM\s+"?(\w+)"?/i);
  if (deleteMatch) return deleteMatch[1];

  return null;
}

/**
 * Normalizes whitespace and truncates SQL to a maximum length with ellipsis.
 */
export function truncateSql(sql: string, maxLen: number): string {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return normalized.substring(0, maxLen - 3) + '...';
}

/**
 * Returns true if all queries normalize to the same pattern (ignoring numbers and string literals).
 * Used to detect N+1-style repeated queries.
 */
export function areSimilarQueries(queries: QueryEntry[]): boolean {
  if (queries.length < 2) return false;

  const normalized = queries.map((q) =>
    q.sql
      .replace(/\s+/g, ' ')
      .replace(/\d+/g, '?')
      .replace(/'[^']*'/g, '?')
      .toLowerCase()
      .trim(),
  );

  const first = normalized[0];
  return normalized.every((n) => n === first);
}
