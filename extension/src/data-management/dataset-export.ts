import type { DriftApiClient } from '../api-client';
import type { IDriftDataset } from './dataset-types';

/** Export current database data as a reusable dataset file. */
export class DatasetExport {
  constructor(private readonly _client: DriftApiClient) {}

  async export(
    tables: string[],
    name: string,
  ): Promise<IDriftDataset> {
    const data: Record<string, Record<string, unknown>[]> = {};

    for (const table of tables) {
      const result = await this._client.sql(
        `SELECT * FROM "${table}"`,
      );
      // Convert column+row arrays into row objects
      data[table] = result.rows.map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < result.columns.length; i++) {
          obj[result.columns[i]] = (row as unknown[])[i];
        }
        return obj;
      });
    }

    return { $schema: 'drift-dataset/v1', name, tables: data };
  }
}
