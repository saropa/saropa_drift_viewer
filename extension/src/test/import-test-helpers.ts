/**
 * Shared test helpers for import-executor tests.
 */

/** Create a mock API client for import testing. */
export function createMockClient(options: {
  existingRows?: Record<string, unknown>[];
  shouldFail?: boolean;
  failOnRow?: number;
} = {}) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const deletedIds: string[] = [];
  let lastInsertId = 100;
  let currentRow = 0;
  let inTransaction = false;

  return {
    insertedRows,
    updatedRows,
    deletedIds,
    sql: async (query: string) => {
      if (query === 'BEGIN TRANSACTION') {
        inTransaction = true;
        return { columns: [], rows: [] };
      }
      if (query === 'COMMIT') {
        inTransaction = false;
        return { columns: [], rows: [] };
      }
      if (query === 'ROLLBACK') {
        inTransaction = false;
        insertedRows.length = 0;
        updatedRows.length = 0;
        return { columns: [], rows: [] };
      }

      if (query.startsWith('SELECT * FROM')) {
        const match = query.match(/WHERE "id" = '(\d+)'/);
        if (match && options.existingRows) {
          const id = parseInt(match[1], 10);
          const existing = options.existingRows.find((r) => r.id === id);
          if (existing) {
            return {
              columns: Object.keys(existing),
              rows: [Object.values(existing)],
            };
          }
        }
        return { columns: [], rows: [] };
      }

      if (query.startsWith('INSERT INTO')) {
        if (options.shouldFail && options.failOnRow === currentRow) {
          currentRow++;
          throw new Error('Simulated failure');
        }
        insertedRows.push({ query });
        currentRow++;
        return { columns: [], rows: [] };
      }

      if (query.startsWith('UPDATE')) {
        if (options.shouldFail && options.failOnRow === currentRow) {
          currentRow++;
          throw new Error('Simulated failure');
        }
        updatedRows.push({ query });
        currentRow++;
        return { columns: [], rows: [] };
      }

      if (query.startsWith('DELETE FROM')) {
        if (options.shouldFail && options.failOnRow === currentRow) {
          currentRow++;
          throw new Error('Simulated failure');
        }
        const match = query.match(/WHERE "id" = '(\d+)'/);
        if (match) {
          deletedIds.push(match[1]);
        }
        return { columns: [], rows: [] };
      }

      if (query === 'SELECT last_insert_rowid()') {
        return { columns: ['id'], rows: [[lastInsertId++]] };
      }

      return { columns: [], rows: [] };
    },
  } as any;
}
