import type { DriftApiClient } from '../api-client';
import type { IDiagramForeignKey } from '../api-types';
import { DescriptionInferrer } from './description-inferrer';
import type {
  IDocColumn, IDocTable, ISchemaDocsData,
} from './schema-docs-types';

/**
 * Collects schema + FK metadata from the server and assembles
 * an {@link ISchemaDocsData} ready for rendering.
 */
export async function collectSchemaDocsData(
  client: DriftApiClient,
): Promise<ISchemaDocsData> {
  const [tables, diagram] = await Promise.all([
    client.schemaMetadata(),
    client.schemaDiagram(),
  ]);

  const allFks = diagram.foreignKeys;
  const inferrer = new DescriptionInferrer();

  const docTables: IDocTable[] = tables.map(table => {
    const outbound = allFks.filter(f => f.fromTable === table.name);
    const inbound = allFks.filter(f => f.toTable === table.name);

    const fkByCol = new Map<string, IDiagramForeignKey>();
    for (const fk of outbound) {
      fkByCol.set(fk.fromColumn, fk);
    }

    const columns: IDocColumn[] = table.columns.map(col => {
      const colFk = fkByCol.get(col.name);
      return {
        name: col.name,
        type: col.type,
        pk: col.pk,
        nullable: false,
        fk: colFk
          ? { toTable: colFk.toTable, toColumn: colFk.toColumn }
          : undefined,
        description: inferrer.inferColumnDescription(col, colFk),
      };
    });

    return {
      name: table.name,
      description: inferrer.inferTableDescription(
        table, outbound, inbound,
      ),
      columns,
      referencedBy: inbound,
      rowCount: table.rowCount,
    };
  });

  const totalRows = docTables.reduce((s, t) => s + t.rowCount, 0);

  return {
    generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    tables: docTables,
    totalRows,
    totalFks: allFks.length,
  };
}
