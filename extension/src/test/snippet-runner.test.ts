import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { SnippetRunner } from '../snippets/snippet-runner';
import type { ISqlSnippet } from '../snippets/snippet-types';

describe('SnippetRunner', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let runner: SnippetRunner;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    runner = new SnippetRunner(client);
  });

  afterEach(() => {
    fetchStub.restore();
  });

  describe('extractVariables', () => {
    it('should extract variable names from SQL template', () => {
      const vars = runner.extractVariables(
        'SELECT * FROM "${table}" WHERE id = ${id} LIMIT ${n}',
      );
      assert.deepStrictEqual(vars, ['table', 'id', 'n']);
    });

    it('should deduplicate repeated variables', () => {
      const vars = runner.extractVariables(
        'SELECT "${col}" FROM "${table}" WHERE "${col}" IS NOT NULL',
      );
      assert.deepStrictEqual(vars, ['col', 'table']);
    });

    it('should return empty array when no variables', () => {
      const vars = runner.extractVariables('SELECT 1');
      assert.deepStrictEqual(vars, []);
    });
  });

  describe('interpolate', () => {
    it('should replace all variable occurrences', () => {
      const result = runner.interpolate(
        'SELECT * FROM "${table}" LIMIT ${n}',
        { table: 'orders', n: '10' },
      );
      assert.strictEqual(result, 'SELECT * FROM "orders" LIMIT 10');
    });

    it('should leave unknown variables as-is', () => {
      const result = runner.interpolate(
        'SELECT ${col} FROM "${table}"',
        { table: 'users' },
      );
      assert.strictEqual(result, 'SELECT ${col} FROM "users"');
    });

    it('should handle empty values map', () => {
      const sql = 'SELECT * FROM "${table}"';
      const result = runner.interpolate(sql, {});
      assert.strictEqual(result, sql);
    });
  });

  describe('inferVariableTypes', () => {
    it('should detect table type for "table" name', () => {
      const vars = runner.inferVariableTypes(['table']);
      assert.strictEqual(vars.length, 1);
      assert.strictEqual(vars[0].type, 'table');
    });

    it('should detect table type for names ending in _table', () => {
      const vars = runner.inferVariableTypes(['source_table']);
      assert.strictEqual(vars[0].type, 'table');
    });

    it('should detect number type for n, limit, count', () => {
      const vars = runner.inferVariableTypes(['n', 'limit', 'count']);
      assert.ok(vars.every((v) => v.type === 'number'));
      assert.ok(vars.every((v) => v.default === '10'));
    });

    it('should default to text type', () => {
      const vars = runner.inferVariableTypes(['column', 'value']);
      assert.ok(vars.every((v) => v.type === 'text'));
    });
  });

  describe('run', () => {
    it('should execute interpolated SQL against client', async () => {
      const result = { columns: ['count'], rows: [[42]] };
      fetchStub.resolves(
        new Response(JSON.stringify(result), { status: 200 }),
      );

      const snippet: ISqlSnippet = {
        id: 'test',
        name: 'Row count',
        sql: 'SELECT COUNT(*) AS count FROM "${table}"',
        category: 'Basics',
        variables: [{ name: 'table', type: 'table' }],
        createdAt: '',
        useCount: 0,
      };

      const data = await runner.run(snippet, { table: 'orders' });
      assert.deepStrictEqual(data, result);

      const [, opts] = fetchStub.firstCall.args;
      const body = JSON.parse(opts.body as string);
      assert.strictEqual(
        body.sql,
        'SELECT COUNT(*) AS count FROM "orders"',
      );
    });
  });
});
