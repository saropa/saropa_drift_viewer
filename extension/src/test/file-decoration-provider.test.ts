import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DriftApiClient } from '../api-client';
import {
  DriftFileDecorationProvider,
  formatBadge,
} from '../decorations/file-decoration-provider';

function apiResponse(tables: Array<{ name: string; rowCount: number }>): Response {
  const body = tables.map((t) => ({
    name: t.name,
    columns: [],
    rowCount: t.rowCount,
  }));
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('formatBadge', () => {
  it('returns raw number below 1000', () => {
    assert.strictEqual(formatBadge(0), '0');
    assert.strictEqual(formatBadge(42), '42');
    assert.strictEqual(formatBadge(999), '999');
  });

  it('abbreviates thousands with rounding', () => {
    assert.strictEqual(formatBadge(1000), '1K');
    assert.strictEqual(formatBadge(1499), '1K');
    assert.strictEqual(formatBadge(1500), '2K');
    assert.strictEqual(formatBadge(45000), '45K');
  });

  it('abbreviates millions with rounding', () => {
    assert.strictEqual(formatBadge(1_000_000), '1M');
    assert.strictEqual(formatBadge(2_500_000), '3M');
  });

  it('promotes to M at the K/M rounding boundary', () => {
    assert.strictEqual(formatBadge(999_499), '999K');
    assert.strictEqual(formatBadge(999_500), '1M');
    assert.strictEqual(formatBadge(999_999), '1M');
  });
});

describe('DriftFileDecorationProvider', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let provider: DriftFileDecorationProvider;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    fetchStub.rejects(new Error('connection refused'));
    client = new DriftApiClient('127.0.0.1', 8642);
    provider = new DriftFileDecorationProvider();
  });

  afterEach(() => {
    fetchStub.restore();
  });

  describe('provideFileDecoration()', () => {
    it('returns undefined for unknown files', () => {
      const uri = vscode.Uri.file('/some/file.dart');
      assert.strictEqual(provider.provideFileDecoration(uri as any), undefined);
    });

    it('returns decoration after refresh', async () => {
      fetchStub.resolves(apiResponse([{ name: 'users', rowCount: 1200 }]));
      const map = new Map([['users', '/lib/tables/users.dart']]);

      await provider.refresh(client, map);

      const uri = vscode.Uri.file('/lib/tables/users.dart');
      const deco = provider.provideFileDecoration(uri as any);
      assert.ok(deco);
      assert.strictEqual(deco.badge, '1K');
      assert.ok(deco.tooltip?.includes('users'));
    });
  });

  describe('refresh()', () => {
    it('aggregates row counts for multi-table files', async () => {
      fetchStub.resolves(apiResponse([
        { name: 'users', rowCount: 500 },
        { name: 'posts', rowCount: 300 },
      ]));
      const map = new Map([
        ['users', '/lib/tables.dart'],
        ['posts', '/lib/tables.dart'],
      ]);

      await provider.refresh(client, map);

      const uri = vscode.Uri.file('/lib/tables.dart');
      const deco = provider.provideFileDecoration(uri as any);
      assert.ok(deco);
      assert.strictEqual(deco.badge, '800');
    });

    it('keeps separate badges for different files', async () => {
      fetchStub.resolves(apiResponse([
        { name: 'users', rowCount: 100 },
        { name: 'posts', rowCount: 5000 },
      ]));
      const map = new Map([
        ['users', '/lib/users.dart'],
        ['posts', '/lib/posts.dart'],
      ]);

      await provider.refresh(client, map);

      const usersDeco = provider.provideFileDecoration(
        vscode.Uri.file('/lib/users.dart') as any,
      );
      const postsDeco = provider.provideFileDecoration(
        vscode.Uri.file('/lib/posts.dart') as any,
      );
      assert.strictEqual(usersDeco?.badge, '100');
      assert.strictEqual(postsDeco?.badge, '5K');
    });

    it('fires onDidChangeFileDecorations', async () => {
      fetchStub.resolves(apiResponse([{ name: 'users', rowCount: 10 }]));
      let fired = false;
      provider.onDidChangeFileDecorations(() => { fired = true; });

      await provider.refresh(client, new Map([['users', '/lib/u.dart']]));
      assert.ok(fired);
    });

    it('does not fire when no tables match', async () => {
      fetchStub.resolves(apiResponse([{ name: 'users', rowCount: 10 }]));
      let fired = false;
      provider.onDidChangeFileDecorations(() => { fired = true; });

      await provider.refresh(client, new Map()); // no mapping
      assert.strictEqual(fired, false);
    });

    it('clears stale decorations on subsequent refresh', async () => {
      // First refresh: users file gets a badge
      fetchStub.resolves(apiResponse([{ name: 'users', rowCount: 100 }]));
      await provider.refresh(client, new Map([['users', '/lib/users.dart']]));
      assert.ok(provider.provideFileDecoration(
        vscode.Uri.file('/lib/users.dart') as any,
      ));

      // Second refresh: no tables → badge removed
      fetchStub.resolves(apiResponse([]));
      await provider.refresh(client, new Map());
      assert.strictEqual(
        provider.provideFileDecoration(vscode.Uri.file('/lib/users.dart') as any),
        undefined,
      );
    });

    it('skips tables not in the file map', async () => {
      fetchStub.resolves(apiResponse([
        { name: 'users', rowCount: 100 },
        { name: 'unknown_table', rowCount: 999 },
      ]));
      const map = new Map([['users', '/lib/users.dart']]);

      await provider.refresh(client, map);

      const uri = vscode.Uri.file('/lib/users.dart');
      const deco = provider.provideFileDecoration(uri as any);
      assert.strictEqual(deco?.badge, '100');
    });

    it('tooltip lists all tables with formatted counts', async () => {
      fetchStub.resolves(apiResponse([
        { name: 'users', rowCount: 1234 },
        { name: 'roles', rowCount: 5 },
      ]));
      const map = new Map([
        ['users', '/lib/auth.dart'],
        ['roles', '/lib/auth.dart'],
      ]);

      await provider.refresh(client, map);

      const deco = provider.provideFileDecoration(
        vscode.Uri.file('/lib/auth.dart') as any,
      );
      assert.ok(deco?.tooltip?.includes('users'));
      assert.ok(deco?.tooltip?.includes('roles'));
      assert.ok(deco?.tooltip?.includes('rows'));
    });

    it('propagates API errors', async () => {
      fetchStub.rejects(new Error('connection refused'));
      await assert.rejects(
        () => provider.refresh(client, new Map([['x', '/x.dart']])),
        /connection refused/,
      );
    });
  });
});
