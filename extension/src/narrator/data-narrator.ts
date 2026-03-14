/**
 * DataNarrator: Build human-readable stories from database rows.
 *
 * Traverses FK relationships one level deep and generates
 * paragraph-style narratives describing the entity and its connections.
 */

import type { DriftApiClient, ForeignKey, TableMetadata } from '../api-client';
import type {
  IEntityGraph, IEntityNode, INarrativeResult, IRelatedData,
} from './narrator-types';
import { sqlLiteral } from './narrator-utils';
import {
  describeChildren, describeParents, describeRoot,
} from './data-narrator-describe';

export class DataNarrator {
  private static readonly _MAX_RELATED_ROWS = 10;

  constructor(private readonly _client: DriftApiClient) {}

  /**
   * Build the entity graph by fetching the root row and
   * traversing FK relationships in both directions.
   */
  async buildGraph(
    table: string,
    pkColumn: string,
    pkValue: unknown,
  ): Promise<IEntityGraph> {
    const rootResult = await this._client.sql(
      `SELECT * FROM "${table}" WHERE "${pkColumn}" = ${sqlLiteral(pkValue)} LIMIT 1`,
    );

    if (rootResult.rows.length === 0) {
      throw new Error(`Row not found: ${table}.${pkColumn} = ${pkValue}`);
    }

    const row = this._rowToObject(rootResult.columns, rootResult.rows[0]);
    const root: IEntityNode = {
      table,
      pkColumn,
      pkValue,
      row,
      columns: rootResult.columns,
    };

    const related = new Map<string, IRelatedData>();

    await this._fetchParents(root, related);
    await this._fetchChildren(root, related);

    return { root, relatedTables: related };
  }

  /**
   * Generate a human-readable narrative from the entity graph.
   */
  generateNarrative(graph: IEntityGraph): INarrativeResult {
    const parts: string[] = [];
    const mdParts: string[] = [];

    const rootDesc = describeRoot(graph.root);
    parts.push(rootDesc.text);
    mdParts.push(rootDesc.markdown);

    const parents = this._getRelatedByDirection(graph, 'parent');
    if (parents.length > 0) {
      const parentDesc = describeParents(parents);
      parts.push(parentDesc.text);
      mdParts.push(parentDesc.markdown);
    }

    const children = this._getRelatedByDirection(graph, 'child');
    for (const child of children) {
      const childDesc = describeChildren(child);
      parts.push(childDesc.text);
      mdParts.push(childDesc.markdown);
    }

    return {
      text: parts.join('\n\n'),
      markdown: mdParts.join('\n\n'),
      graph,
    };
  }

  private async _fetchParents(
    root: IEntityNode,
    related: Map<string, IRelatedData>,
  ): Promise<void> {
    const fks = await this._client.tableFkMeta(root.table);

    for (const fk of fks) {
      const fkValue = root.row[fk.fromColumn];
      if (fkValue === null || fkValue === undefined) continue;

      try {
        const result = await this._client.sql(
          `SELECT * FROM "${fk.toTable}" WHERE "${fk.toColumn}" = ${sqlLiteral(fkValue)} LIMIT 1`,
        );
        if (result.rows.length > 0) {
          related.set(`parent:${fk.toTable}:${fk.fromColumn}`, {
            table: fk.toTable,
            direction: 'parent',
            fkColumn: fk.fromColumn,
            rows: result.rows.map((r) => this._rowToObject(result.columns, r)),
            rowCount: result.rows.length,
            truncated: false,
          });
        }
      } catch {
        // Skip if query fails (table might not exist at runtime)
      }
    }
  }

  private async _fetchChildren(
    root: IEntityNode,
    related: Map<string, IRelatedData>,
  ): Promise<void> {
    const allMeta = await this._client.schemaMetadata();
    const candidateTables = allMeta.filter(
      (t) => t.name !== root.table && !t.name.startsWith('sqlite_'),
    );

    // Fetch FK metadata in parallel for better performance
    const fkResults = await Promise.all(
      candidateTables.map(async (t) => {
        try {
          const fks = await this._client.tableFkMeta(t.name);
          return { table: t, fks };
        } catch {
          return { table: t, fks: [] as ForeignKey[] };
        }
      }),
    );

    // Process results sequentially to avoid overwhelming the server
    for (const { table: otherTable, fks: otherFks } of fkResults) {
      for (const fk of otherFks) {
        if (fk.toTable !== root.table) continue;
        if (fk.toColumn !== root.pkColumn) continue;

        try {
          const countResult = await this._client.sql(
            `SELECT COUNT(*) as cnt FROM "${otherTable.name}" WHERE "${fk.fromColumn}" = ${sqlLiteral(root.pkValue)}`,
          );
          const count = Number((countResult.rows[0] as unknown[])[0]) || 0;
          if (count === 0) continue;

          const result = await this._client.sql(
            `SELECT * FROM "${otherTable.name}" WHERE "${fk.fromColumn}" = ${sqlLiteral(root.pkValue)} LIMIT ${DataNarrator._MAX_RELATED_ROWS}`,
          );

          related.set(`child:${otherTable.name}:${fk.fromColumn}`, {
            table: otherTable.name,
            direction: 'child',
            fkColumn: fk.fromColumn,
            rows: result.rows.map((r) => this._rowToObject(result.columns, r)),
            rowCount: count,
            truncated: count > DataNarrator._MAX_RELATED_ROWS,
          });
        } catch {
          // Skip if query fails
        }
      }
    }
  }

  private _getRelatedByDirection(
    graph: IEntityGraph,
    direction: 'parent' | 'child',
  ): IRelatedData[] {
    const result: IRelatedData[] = [];
    for (const [, data] of graph.relatedTables) {
      if (data.direction === direction) {
        result.push(data);
      }
    }
    return result;
  }

  private _rowToObject(
    columns: string[],
    row: unknown[],
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  }
}

export { findNameColumn } from './data-narrator-describe';
