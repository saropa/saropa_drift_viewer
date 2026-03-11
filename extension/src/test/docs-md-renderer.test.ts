import * as assert from 'assert';
import { DocsMdRenderer } from '../schema-docs/docs-md-renderer';
import type { ISchemaDocsData, IDocTable } from '../schema-docs/schema-docs-types';

function docTable(overrides: Partial<IDocTable> = {}): IDocTable {
  return {
    name: 'users',
    description: 'Stores user data.',
    columns: [
      {
        name: 'id', type: 'INTEGER', pk: true,
        nullable: false, description: 'Primary key.',
      },
      {
        name: 'name', type: 'TEXT', pk: false,
        nullable: false, description: '',
      },
    ],
    referencedBy: [],
    rowCount: 100,
    ...overrides,
  };
}

function docsData(overrides: Partial<ISchemaDocsData> = {}): ISchemaDocsData {
  return {
    generatedAt: '2026-03-10 12:00:00',
    tables: [docTable()],
    totalRows: 100,
    totalFks: 0,
    ...overrides,
  };
}

describe('DocsMdRenderer', () => {
  const renderer = new DocsMdRenderer();

  it('output starts with H1 title', () => {
    const md = renderer.render(docsData());
    assert.ok(md.startsWith('# Database Schema Documentation'));
  });

  it('metadata line includes stats', () => {
    const md = renderer.render(docsData({
      totalRows: 5000, totalFks: 3,
    }));
    assert.ok(md.includes('Tables: 1'));
    assert.ok(md.includes('Rows: 5,000'));
    assert.ok(md.includes('FKs: 3'));
  });

  it('all tables appear in table of contents', () => {
    const data = docsData({
      tables: [
        docTable({ name: 'users' }),
        docTable({ name: 'orders' }),
        docTable({ name: 'products' }),
      ],
    });
    const md = renderer.render(data);
    assert.ok(md.includes('- [users]'));
    assert.ok(md.includes('- [orders]'));
    assert.ok(md.includes('- [products]'));
  });

  it('table section includes description', () => {
    const md = renderer.render(docsData({
      tables: [docTable({ description: 'Custom desc.' })],
    }));
    assert.ok(md.includes('> Custom desc.'));
  });

  it('FK references render correctly', () => {
    const table = docTable({
      columns: [
        {
          name: 'role_id', type: 'INTEGER', pk: false,
          nullable: false,
          fk: { toTable: 'roles', toColumn: 'id' },
          description: 'FK.',
        },
      ],
    });
    const md = renderer.render(docsData({ tables: [table] }));
    assert.ok(md.includes('\u2192 roles.id'));
  });

  it('referenced-by renders when present', () => {
    const table = docTable({
      referencedBy: [
        {
          fromTable: 'orders', fromColumn: 'user_id',
          toTable: 'users', toColumn: 'id',
        },
      ],
    });
    const md = renderer.render(docsData({ tables: [table] }));
    assert.ok(md.includes('**Referenced by:**'));
    assert.ok(md.includes('orders.user_id'));
  });

  it('referenced-by omitted when empty', () => {
    const md = renderer.render(docsData());
    assert.ok(!md.includes('**Referenced by:**'));
  });

  it('empty database produces minimal output', () => {
    const md = renderer.render(docsData({
      tables: [], totalRows: 0, totalFks: 0,
    }));
    assert.ok(md.includes('# Database Schema Documentation'));
    assert.ok(md.includes('Tables: 0'));
    assert.ok(md.includes('Rows: 0'));
  });

  it('row count is locale-formatted', () => {
    const table = docTable({ rowCount: 12345 });
    const md = renderer.render(docsData({
      tables: [table], totalRows: 12345,
    }));
    assert.ok(md.includes('12,345'));
  });

  it('PK column shows checkmark', () => {
    const md = renderer.render(docsData());
    assert.ok(md.includes('\u2713'));
  });

  it('footer includes Drift Viewer link', () => {
    const md = renderer.render(docsData());
    assert.ok(md.includes('saropa_drift_advisor'));
  });

  it('escapes pipe characters in column names', () => {
    const table = docTable({
      columns: [
        {
          name: 'a|b', type: 'TEXT', pk: false,
          nullable: false, description: 'has|pipe',
        },
      ],
    });
    const md = renderer.render(docsData({ tables: [table] }));
    assert.ok(md.includes('a\\|b'));
    assert.ok(md.includes('has\\|pipe'));
  });
});
