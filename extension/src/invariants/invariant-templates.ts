/**
 * Pre-built invariant rule templates for common data integrity checks.
 */

import type { DriftApiClient } from '../api-client';
import type { IInvariantTemplate } from './invariant-types';

/** Template categories for UI organization. */
export type TemplateCategory =
  | 'uniqueness'
  | 'nullability'
  | 'range'
  | 'referential'
  | 'cardinality'
  | 'custom';

/** Template with category info for UI display. */
export interface ICategorizedTemplate extends IInvariantTemplate {
  category: TemplateCategory;
  description: string;
}

/**
 * Generates invariant templates for a given table based on its schema.
 */
export class InvariantTemplates {
  constructor(private readonly _client: DriftApiClient) {}

  /**
   * Get all available templates for a table.
   * Analyzes the table's columns and foreign keys to generate relevant templates.
   */
  async getTemplatesForTable(table: string): Promise<ICategorizedTemplate[]> {
    const templates: ICategorizedTemplate[] = [];

    try {
      const allMeta = await this._client.schemaMetadata();
      const tableMeta = allMeta.find((t) => t.name === table);
      if (!tableMeta) return templates;

      const fks = await this._client.tableFkMeta(table);

      // Unique column templates
      for (const col of tableMeta.columns) {
        if (!col.pk) {
          templates.push({
            category: 'uniqueness',
            name: `${table}.${col.name} is unique`,
            description: `Ensure no duplicate values in ${col.name}`,
            sql: `SELECT "${col.name}", COUNT(*) AS cnt FROM "${table}" GROUP BY "${col.name}" HAVING cnt > 1`,
            expectation: 'zero_rows',
            severity: 'warning',
          });
        }
      }

      // Not-null templates for non-PK columns
      for (const col of tableMeta.columns.filter((c) => !c.pk)) {
        templates.push({
          category: 'nullability',
          name: `${table}.${col.name} is not null`,
          description: `Ensure ${col.name} has no NULL values`,
          sql: `SELECT * FROM "${table}" WHERE "${col.name}" IS NULL`,
          expectation: 'zero_rows',
          severity: 'warning',
        });
      }

      // Range templates for numeric columns
      const numericTypes = ['INTEGER', 'REAL', 'NUMERIC', 'INT', 'FLOAT', 'DOUBLE'];
      for (const col of tableMeta.columns) {
        if (numericTypes.some((t) => col.type.toUpperCase().includes(t))) {
          templates.push({
            category: 'range',
            name: `${table}.${col.name} >= 0`,
            description: `Ensure ${col.name} is non-negative`,
            sql: `SELECT * FROM "${table}" WHERE "${col.name}" < 0`,
            expectation: 'zero_rows',
            severity: 'warning',
          });
        }
      }

      // FK integrity templates
      for (const fk of fks) {
        templates.push({
          category: 'referential',
          name: `${table}.${fk.fromColumn} → ${fk.toTable}.${fk.toColumn} (no orphans)`,
          description: `Ensure all ${fk.fromColumn} values reference valid ${fk.toTable} rows`,
          sql: `SELECT a.* FROM "${table}" a LEFT JOIN "${fk.toTable}" b ON a."${fk.fromColumn}" = b."${fk.toColumn}" WHERE b."${fk.toColumn}" IS NULL AND a."${fk.fromColumn}" IS NOT NULL`,
          expectation: 'zero_rows',
          severity: 'error',
        });
      }

      // Reverse FK (parent has children) templates
      // Fetch FK metadata for all other tables in parallel to avoid N+1 queries
      const otherTables = allMeta.filter((t) => t.name !== table);
      const otherFkResults = await Promise.all(
        otherTables.map(async (t) => ({
          table: t,
          fks: await this._client.tableFkMeta(t.name).catch(() => []),
        })),
      );

      for (const { table: otherTable, fks: otherFks } of otherFkResults) {
        for (const fk of otherFks) {
          if (fk.toTable === table) {
            templates.push({
              category: 'cardinality',
              name: `Every ${table} has ${otherTable.name}`,
              description: `Ensure every ${table} row has at least one ${otherTable.name} child`,
              sql: `SELECT p.* FROM "${table}" p LEFT JOIN "${otherTable.name}" c ON c."${fk.fromColumn}" = p."${fk.toColumn}" WHERE c."${fk.fromColumn}" IS NULL`,
              expectation: 'zero_rows',
              severity: 'warning',
            });
          }
        }
      }

      // Table has data template
      templates.push({
        category: 'cardinality',
        name: `${table} has rows`,
        description: `Ensure ${table} is not empty`,
        sql: `SELECT CASE WHEN COUNT(*) = 0 THEN 1 END AS empty FROM "${table}" WHERE 1=0 UNION ALL SELECT NULL WHERE (SELECT COUNT(*) FROM "${table}") = 0`,
        expectation: 'zero_rows',
        severity: 'info',
      });

    } catch {
      // Server unreachable or table doesn't exist
    }

    return templates;
  }

  /**
   * Get common templates that can apply to any table.
   */
  getCommonTemplates(table: string): ICategorizedTemplate[] {
    return [
      {
        category: 'cardinality',
        name: `${table} row count in range`,
        description: 'Ensure table row count is within expected bounds',
        sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM "${table}") NOT BETWEEN 1 AND 1000000 THEN 1 END AS out_of_range`,
        expectation: 'zero_rows',
        severity: 'warning',
      },
      {
        category: 'custom',
        name: `Custom ${table} invariant`,
        description: 'Write your own SQL query',
        sql: `SELECT * FROM "${table}" WHERE /* your condition */`,
        expectation: 'zero_rows',
        severity: 'warning',
      },
    ];
  }
}

/**
 * Format a template as a quick pick item for VS Code.
 */
export function templateToQuickPickItem(
  template: ICategorizedTemplate,
): { label: string; description: string; detail: string; template: ICategorizedTemplate } {
  const icons: Record<TemplateCategory, string> = {
    uniqueness: '$(key)',
    nullability: '$(circle-slash)',
    range: '$(arrow-both)',
    referential: '$(link)',
    cardinality: '$(list-ordered)',
    custom: '$(code)',
  };

  return {
    label: `${icons[template.category]} ${template.name}`,
    description: template.category,
    detail: template.description,
    template,
  };
}
