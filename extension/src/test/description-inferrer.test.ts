import * as assert from 'assert';
import { DescriptionInferrer } from '../schema-docs/description-inferrer';
import type { TableMetadata } from '../api-client';
import type { IDiagramForeignKey } from '../api-types';

function table(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    name: 'users',
    columns: [{ name: 'id', type: 'INTEGER', pk: true }],
    rowCount: 10,
    ...overrides,
  };
}

function fk(overrides: Partial<IDiagramForeignKey> = {}): IDiagramForeignKey {
  return {
    fromTable: 'orders',
    fromColumn: 'user_id',
    toTable: 'users',
    toColumn: 'id',
    ...overrides,
  };
}

describe('DescriptionInferrer', () => {
  const inferrer = new DescriptionInferrer();

  describe('inferTableDescription', () => {
    it('core entity with many reverse FKs', () => {
      const reverseFks = [
        fk({ fromTable: 'orders' }),
        fk({ fromTable: 'sessions' }),
        fk({ fromTable: 'audit_log' }),
        fk({ fromTable: 'comments' }),
      ];
      const desc = inferrer.inferTableDescription(
        table(), [], reverseFks,
      );
      assert.ok(desc.includes('Core entity'));
      assert.ok(desc.includes('4'));
    });

    it('standalone table with no FKs', () => {
      const desc = inferrer.inferTableDescription(table(), [], []);
      assert.ok(desc.includes('Standalone'));
      assert.ok(desc.includes('no foreign key'));
    });

    it('leaf table linked to parents', () => {
      const outbound = [fk({ toTable: 'users' })];
      const desc = inferrer.inferTableDescription(
        table({ name: 'orders' }), outbound, [],
      );
      assert.ok(desc.includes('Leaf table'));
      assert.ok(desc.includes('users'));
    });

    it('auth columns detected', () => {
      const t = table({
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'email', type: 'TEXT', pk: false },
          { name: 'password', type: 'TEXT', pk: false },
        ],
      });
      const desc = inferrer.inferTableDescription(t, [], []);
      assert.ok(desc.includes('authentication'));
    });

    it('financial columns detected', () => {
      const t = table({
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'total_amount', type: 'REAL', pk: false },
        ],
      });
      const desc = inferrer.inferTableDescription(t, [], []);
      assert.ok(desc.includes('financial'));
    });

    it('temporal columns detected', () => {
      const t = table({
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'created_at', type: 'TEXT', pk: false },
        ],
      });
      const desc = inferrer.inferTableDescription(t, [], []);
      assert.ok(desc.includes('temporal'));
    });

    it('geolocation columns detected', () => {
      const t = table({
        columns: [
          { name: 'id', type: 'INTEGER', pk: true },
          { name: 'latitude', type: 'REAL', pk: false },
          { name: 'longitude', type: 'REAL', pk: false },
        ],
      });
      const desc = inferrer.inferTableDescription(t, [], []);
      assert.ok(desc.includes('geolocation'));
    });

    it('fallback description from table name', () => {
      const t = table({ name: 'user_preferences' });
      const outbound = [fk({ toTable: 'users' })];
      const inbound = [fk({ fromTable: 'settings' })];
      const desc = inferrer.inferTableDescription(t, outbound, inbound);
      assert.ok(desc.length > 0);
    });
  });

  describe('inferColumnDescription', () => {
    it('primary key', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'id', type: 'INTEGER', pk: true },
      );
      assert.strictEqual(desc, 'Primary key.');
    });

    it('foreign key', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'user_id', type: 'INTEGER', pk: false },
        fk({ toTable: 'users', toColumn: 'id' }),
      );
      assert.ok(desc.includes('users.id'));
    });

    it('created_at timestamp', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'created_at', type: 'TEXT', pk: false },
      );
      assert.ok(desc.includes('creation'));
    });

    it('updated_at timestamp', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'updated_at', type: 'TEXT', pk: false },
      );
      assert.ok(desc.includes('modification'));
    });

    it('deleted_at soft-delete', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'deleted_at', type: 'TEXT', pk: false },
      );
      assert.ok(desc.includes('Soft-delete'));
    });

    it('boolean flag prefixes', () => {
      for (const prefix of ['is_active', 'has_email', 'can_edit']) {
        const desc = inferrer.inferColumnDescription(
          { name: prefix, type: 'INTEGER', pk: false },
        );
        assert.strictEqual(desc, 'Boolean flag.');
      }
    });

    it('email column', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'email', type: 'TEXT', pk: false },
      );
      assert.strictEqual(desc, 'Email address.');
    });

    it('phone column', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'phone', type: 'TEXT', pk: false },
      );
      assert.strictEqual(desc, 'Phone number.');
    });

    it('password column', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'password', type: 'TEXT', pk: false },
      );
      assert.strictEqual(desc, 'Hashed password.');
    });

    it('unknown column returns empty string', () => {
      const desc = inferrer.inferColumnDescription(
        { name: 'foo_bar', type: 'TEXT', pk: false },
      );
      assert.strictEqual(desc, '');
    });
  });
});
