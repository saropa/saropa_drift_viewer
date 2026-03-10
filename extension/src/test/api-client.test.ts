import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';

describe('DriftApiClient', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
  });

  afterEach(() => {
    fetchStub.restore();
  });

  describe('health()', () => {
    it('should return health response on success', async () => {
      fetchStub.resolves(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const result = await client.health();
      assert.deepStrictEqual(result, { ok: true });
      assert.ok(fetchStub.calledOnceWith('http://127.0.0.1:8642/api/health'));
    });

    it('should throw on non-200 status', async () => {
      fetchStub.resolves(new Response('', { status: 500 }));
      await assert.rejects(() => client.health(), /Health check failed: 500/);
    });
  });

  describe('schemaMetadata()', () => {
    it('should return table metadata array', async () => {
      const data = [
        {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'name', type: 'TEXT', pk: false },
          ],
          rowCount: 42,
        },
      ];
      fetchStub.resolves(new Response(JSON.stringify(data), { status: 200 }));
      const result = await client.schemaMetadata();
      assert.deepStrictEqual(result, data);
    });

    it('should throw on non-200 status', async () => {
      fetchStub.resolves(new Response('', { status: 404 }));
      await assert.rejects(() => client.schemaMetadata(), /Schema metadata failed/);
    });
  });

  describe('tableFkMeta()', () => {
    it('should return foreign keys for table', async () => {
      const fks = [{ fromColumn: 'user_id', toTable: 'users', toColumn: 'id' }];
      fetchStub.resolves(new Response(JSON.stringify(fks), { status: 200 }));
      const result = await client.tableFkMeta('orders');
      assert.deepStrictEqual(result, fks);
      assert.ok(fetchStub.calledOnceWith('http://127.0.0.1:8642/api/table/orders/fk-meta'));
    });

    it('should URL-encode table name', async () => {
      fetchStub.resolves(new Response('[]', { status: 200 }));
      await client.tableFkMeta('my table');
      assert.ok(fetchStub.calledOnceWith('http://127.0.0.1:8642/api/table/my%20table/fk-meta'));
    });
  });

  describe('generation()', () => {
    it('should return generation number', async () => {
      fetchStub.resolves(new Response(JSON.stringify({ generation: 5 }), { status: 200 }));
      const gen = await client.generation(3);
      assert.strictEqual(gen, 5);
      assert.ok(fetchStub.calledOnceWith('http://127.0.0.1:8642/api/generation?since=3'));
    });
  });

  describe('sql()', () => {
    it('should POST query and return result', async () => {
      const result = { columns: ['id', 'name'], rows: [[1, 'Alice']] };
      fetchStub.resolves(new Response(JSON.stringify(result), { status: 200 }));
      const data = await client.sql('SELECT * FROM users');
      assert.deepStrictEqual(data, result);

      const [url, opts] = fetchStub.firstCall.args;
      assert.strictEqual(url, 'http://127.0.0.1:8642/api/sql');
      assert.strictEqual(opts.method, 'POST');
      assert.deepStrictEqual(JSON.parse(opts.body), { sql: 'SELECT * FROM users' });
    });
  });

  describe('baseUrl', () => {
    it('should expose the base URL', () => {
      assert.strictEqual(client.baseUrl, 'http://127.0.0.1:8642');
    });
  });

  describe('setAuthToken()', () => {
    it('should send Bearer header when token is set', async () => {
      client.setAuthToken('my-secret');
      fetchStub.resolves(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await client.health();
      const opts = fetchStub.firstCall.args[1];
      assert.strictEqual(opts.headers['Authorization'], 'Bearer my-secret');
    });

    it('should not send auth header when token is undefined', async () => {
      fetchStub.resolves(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await client.health();
      const opts = fetchStub.firstCall.args[1];
      assert.strictEqual(opts.headers['Authorization'], undefined);
    });

    it('should clear token when set to empty string', async () => {
      client.setAuthToken('my-secret');
      client.setAuthToken('');
      fetchStub.resolves(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      await client.health();
      const opts = fetchStub.firstCall.args[1];
      assert.strictEqual(opts.headers['Authorization'], undefined);
    });

    it('should merge auth with Content-Type on POST', async () => {
      client.setAuthToken('token123');
      const result = { columns: [], rows: [] };
      fetchStub.resolves(new Response(JSON.stringify(result), { status: 200 }));
      await client.sql('SELECT 1');
      const opts = fetchStub.firstCall.args[1];
      assert.strictEqual(opts.headers['Authorization'], 'Bearer token123');
      assert.strictEqual(opts.headers['Content-Type'], 'application/json');
    });
  });

  describe('schemaDump()', () => {
    it('should return SQL text', async () => {
      fetchStub.resolves(new Response('CREATE TABLE t(id INT);', { status: 200 }));
      const sql = await client.schemaDump();
      assert.strictEqual(sql, 'CREATE TABLE t(id INT);');
    });

    it('should throw on non-200 status', async () => {
      fetchStub.resolves(new Response('', { status: 500 }));
      await assert.rejects(() => client.schemaDump(), /Schema dump failed/);
    });
  });

  describe('databaseFile()', () => {
    it('should return ArrayBuffer', async () => {
      const buf = new ArrayBuffer(4);
      fetchStub.resolves(new Response(buf, { status: 200 }));
      const result = await client.databaseFile();
      assert.ok(result instanceof ArrayBuffer);
    });

    it('should throw on non-200 status', async () => {
      fetchStub.resolves(new Response('', { status: 500 }));
      await assert.rejects(() => client.databaseFile(), /Database download failed/);
    });
  });

  describe('sessionGet()', () => {
    it('should URL-encode session ID', async () => {
      const session = { state: {}, createdAt: '', expiresAt: '', annotations: [] };
      fetchStub.resolves(new Response(JSON.stringify(session), { status: 200 }));
      await client.sessionGet('abc def');
      assert.ok(fetchStub.calledOnceWith(
        'http://127.0.0.1:8642/api/session/abc%20def',
        sinon.match.any,
      ));
    });
  });

  describe('importData()', () => {
    it('should POST format, table, and data', async () => {
      const result = { imported: 2, errors: [], format: 'json', table: 'users' };
      fetchStub.resolves(new Response(JSON.stringify(result), { status: 200 }));
      const data = await client.importData('json', 'users', '[{"id":1}]');
      assert.deepStrictEqual(data, result);
      const opts = fetchStub.firstCall.args[1];
      assert.strictEqual(opts.method, 'POST');
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.format, 'json');
      assert.strictEqual(body.table, 'users');
    });
  });
});
