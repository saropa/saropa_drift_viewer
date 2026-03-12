import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { InvariantTemplates, templateToQuickPickItem } from '../invariants/invariant-templates';

function makeClient(): DriftApiClient {
  return new DriftApiClient('127.0.0.1', 8642);
}

describe('InvariantTemplates', () => {
  let client: DriftApiClient;

  beforeEach(() => {
    client = makeClient();
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getTemplatesForTable', () => {
    it('should generate unique column templates', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'email', type: 'TEXT', pk: false },
            { name: 'name', type: 'TEXT', pk: false },
          ],
          rowCount: 100,
        },
      ]);
      sinon.stub(client, 'tableFkMeta').resolves([]);

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('users');

      const uniqueTemplates = result.filter((t) => t.category === 'uniqueness');
      assert.ok(uniqueTemplates.length >= 2);
      assert.ok(uniqueTemplates.some((t) => t.name.includes('email')));
      assert.ok(uniqueTemplates.some((t) => t.name.includes('name')));
    });

    it('should generate not-null templates for non-PK columns', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'email', type: 'TEXT', pk: false },
          ],
          rowCount: 100,
        },
      ]);
      sinon.stub(client, 'tableFkMeta').resolves([]);

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('users');

      const nullTemplates = result.filter((t) => t.category === 'nullability');
      assert.ok(nullTemplates.some((t) => t.name.includes('email')));
      assert.ok(!nullTemplates.some((t) => t.name.includes('id')));
    });

    it('should generate range templates for numeric columns', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([
        {
          name: 'accounts',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'balance', type: 'REAL', pk: false },
            { name: 'name', type: 'TEXT', pk: false },
          ],
          rowCount: 100,
        },
      ]);
      sinon.stub(client, 'tableFkMeta').resolves([]);

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('accounts');

      const rangeTemplates = result.filter((t) => t.category === 'range');
      assert.ok(rangeTemplates.some((t) => t.name.includes('balance')));
      assert.ok(!rangeTemplates.some((t) => t.name.includes('name')));
    });

    it('should generate FK integrity templates', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([
        {
          name: 'orders',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'user_id', type: 'INTEGER', pk: false },
          ],
          rowCount: 100,
        },
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
          ],
          rowCount: 50,
        },
      ]);
      sinon.stub(client, 'tableFkMeta')
        .withArgs('orders').resolves([
          { fromColumn: 'user_id', toTable: 'users', toColumn: 'id' },
        ])
        .withArgs('users').resolves([]);

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('orders');

      const fkTemplates = result.filter((t) => t.category === 'referential');
      assert.strictEqual(fkTemplates.length, 1);
      assert.ok(fkTemplates[0].name.includes('user_id'));
      assert.ok(fkTemplates[0].name.includes('users'));
      assert.strictEqual(fkTemplates[0].severity, 'error');
    });

    it('should return empty array for non-existent table', async () => {
      sinon.stub(client, 'schemaMetadata').resolves([]);
      sinon.stub(client, 'tableFkMeta').resolves([]);

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('non_existent');

      assert.strictEqual(result.length, 0);
    });

    it('should handle server errors gracefully', async () => {
      sinon.stub(client, 'schemaMetadata').rejects(new Error('Server error'));

      const templates = new InvariantTemplates(client);
      const result = await templates.getTemplatesForTable('users');

      assert.strictEqual(result.length, 0);
    });
  });

  describe('getCommonTemplates', () => {
    it('should return common templates for any table', () => {
      const templates = new InvariantTemplates(client);
      const result = templates.getCommonTemplates('users');

      assert.ok(result.length >= 2);
      assert.ok(result.some((t) => t.category === 'cardinality'));
      assert.ok(result.some((t) => t.category === 'custom'));
    });

    it('should include table name in templates', () => {
      const templates = new InvariantTemplates(client);
      const result = templates.getCommonTemplates('orders');

      for (const t of result) {
        assert.ok(
          t.name.includes('orders') || t.sql.includes('orders'),
          `Expected "orders" in template: ${t.name}`,
        );
      }
    });
  });
});

describe('templateToQuickPickItem', () => {
  it('should format template for VS Code quick pick', () => {
    const template = {
      category: 'uniqueness' as const,
      name: 'users.email is unique',
      description: 'Ensure no duplicate emails',
      sql: 'SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1',
      expectation: 'zero_rows' as const,
      severity: 'warning' as const,
    };

    const item = templateToQuickPickItem(template);

    assert.ok(item.label.includes('users.email is unique'));
    assert.strictEqual(item.description, 'uniqueness');
    assert.strictEqual(item.detail, 'Ensure no duplicate emails');
    assert.strictEqual(item.template, template);
  });

  it('should include category icon in label', () => {
    const templates = [
      { category: 'uniqueness' as const, expectedIcon: '$(key)' },
      { category: 'nullability' as const, expectedIcon: '$(circle-slash)' },
      { category: 'range' as const, expectedIcon: '$(arrow-both)' },
      { category: 'referential' as const, expectedIcon: '$(link)' },
      { category: 'cardinality' as const, expectedIcon: '$(list-ordered)' },
      { category: 'custom' as const, expectedIcon: '$(code)' },
    ];

    for (const { category, expectedIcon } of templates) {
      const template = {
        category,
        name: 'Test',
        description: 'Test',
        sql: 'SELECT 1',
        expectation: 'zero_rows' as const,
        severity: 'warning' as const,
      };

      const item = templateToQuickPickItem(template);
      assert.ok(
        item.label.includes(expectedIcon),
        `Expected ${expectedIcon} in label for ${category}`,
      );
    }
  });
});
