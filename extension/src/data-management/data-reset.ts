import type { DriftApiClient } from '../api-client';
import type { DependencySorter } from './dependency-sorter';
import type { IFkContext, IResetResult } from './dataset-types';

/** Clear tables in safe FK order (children first). */
export class DataReset {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _sorter: DependencySorter,
  ) {}

  async clearAll(): Promise<IResetResult> {
    const meta = await this._client.schemaMetadata();
    const tables = meta
      .filter((t) => !t.name.startsWith('sqlite_'))
      .map((t) => t.name);
    return this._clearTables(tables);
  }

  async clearTable(table: string): Promise<IResetResult> {
    const dependents = await this._findDependents(table);
    return this._clearTables(
      dependents.length > 0 ? [...dependents, table] : [table],
    );
  }

  async clearGroup(tables: string[]): Promise<IResetResult> {
    return this._clearTables(tables);
  }

  /** Preview what would be deleted without executing. */
  async previewClear(
    tables: string[],
  ): Promise<{ name: string; rowCount: number }[]> {
    const allFks = await this._getAllFks(tables);
    const deleteOrder = this._sorter.sortForDelete(tables, allFks);
    const preview: { name: string; rowCount: number }[] = [];

    for (const table of deleteOrder) {
      const result = await this._client.sql(
        `SELECT COUNT(*) AS cnt FROM "${table}"`,
      );
      const count = (result.rows[0] as unknown[])[0] as number;
      preview.push({ name: table, rowCount: count });
    }

    return preview;
  }

  private async _clearTables(tables: string[]): Promise<IResetResult> {
    const allFks = await this._getAllFks(tables);
    const deleteOrder = this._sorter.sortForDelete(tables, allFks);

    const results: { name: string; deletedRows: number }[] = [];
    let total = 0;

    for (const table of deleteOrder) {
      const countResult = await this._client.sql(
        `SELECT COUNT(*) AS cnt FROM "${table}"`,
      );
      const count = (countResult.rows[0] as unknown[])[0] as number;

      await this._client.sql(`DELETE FROM "${table}"`);
      results.push({ name: table, deletedRows: count });
      total += count;
    }

    return { tables: results, totalDeleted: total };
  }

  /** Find tables that have FKs pointing to the given table. */
  private async _findDependents(table: string): Promise<string[]> {
    const meta = await this._client.schemaMetadata();
    const dependents: string[] = [];

    for (const t of meta) {
      if (t.name === table || t.name.startsWith('sqlite_')) continue;
      const fks = await this._client.tableFkMeta(t.name);
      if (fks.some((fk) => fk.toTable === table)) {
        dependents.push(t.name);
      }
    }

    return dependents;
  }

  /** Collect FK contexts for a set of tables. */
  async getAllFks(tables: string[]): Promise<IFkContext[]> {
    return this._getAllFks(tables);
  }

  private async _getAllFks(tables: string[]): Promise<IFkContext[]> {
    const fks: IFkContext[] = [];
    for (const t of tables) {
      const tableFks = await this._client.tableFkMeta(t);
      for (const fk of tableFks) {
        fks.push({ fromTable: t, toTable: fk.toTable });
      }
    }
    return fks;
  }
}
