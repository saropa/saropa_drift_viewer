import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { LogCaptureBridge } from '../debug/log-capture-bridge';
import {
  DriftTerminalLink,
  DriftTerminalLinkProvider,
} from '../terminal/drift-terminal-link-provider';
import { dialogMock, messageMock, extensions } from './vscode-mock';

const sampleMeta = [
  { name: 'users', columns: [], rowCount: 10 },
  { name: 'orders', columns: [], rowCount: 5 },
  { name: 'user_settings', columns: [], rowCount: 1 },
  { name: 'products', columns: [], rowCount: 20 },
];

function fakeContext(line: string): { line: string; terminal: unknown } {
  return { line, terminal: {} };
}

describe('DriftTerminalLinkProvider', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let revealSpy: sinon.SinonSpy;
  let provider: DriftTerminalLinkProvider;

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    revealSpy = sinon.spy(async () => {});
    messageMock.reset();
    dialogMock.reset();
    extensions.clearExtensions();
    provider = new DriftTerminalLinkProvider(client, revealSpy);
  });

  afterEach(() => {
    fetchStub.restore();
  });

  // --- provideTerminalLinks ---

  describe('provideTerminalLinks', () => {
    it('should match "no such table: tablename"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('SqliteException: no such table: user_settigns') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, 'user_settigns');
      assert.strictEqual(links[0].matchType, 'table');
    });

    it('should match "no such column: table.column"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('Error: no such column: users.emal') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, 'users');
      assert.strictEqual(links[0].matchType, 'column');
      assert.strictEqual(links[0].columnName, 'emal');
    });

    it('should match "UNIQUE constraint failed: table.column"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('UNIQUE constraint failed: users.email') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, 'users');
      assert.strictEqual(links[0].matchType, 'table');
    });

    it('should match "NOT NULL constraint failed: table.column"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('NOT NULL constraint failed: orders.total') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, 'orders');
      assert.strictEqual(links[0].matchType, 'table');
    });

    it('should match "table X already exists"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('table users already exists') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, 'users');
      assert.strictEqual(links[0].matchType, 'table');
    });

    it('should match "FOREIGN KEY constraint failed"', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('FOREIGN KEY constraint failed') as any,
      );
      assert.strictEqual(links.length, 1);
      assert.strictEqual(links[0].tableName, null);
      assert.strictEqual(links[0].matchType, 'fk_error');
    });

    it('should return empty for unrelated lines', () => {
      const links = provider.provideTerminalLinks(
        fakeContext('flutter: app started successfully') as any,
      );
      assert.strictEqual(links.length, 0);
    });

    it('should set correct startIndex and length', () => {
      const line = 'SqliteException: no such table: my_table';
      const links = provider.provideTerminalLinks(
        fakeContext(line) as any,
      );
      assert.strictEqual(links.length, 1);
      const link = links[0];
      assert.strictEqual(
        line.substring(link.startIndex, link.startIndex + link.length),
        'my_table',
      );
    });
  });

  // --- handleTerminalLink ---

  describe('handleTerminalLink', () => {
    function stubSchema(): void {
      fetchStub.resolves(
        new Response(JSON.stringify(sampleMeta), { status: 200 }),
      );
    }

    it('should reveal exact match', async () => {
      stubSchema();
      const link = new DriftTerminalLink(0, 5, 'users', 'table');
      await provider.handleTerminalLink(link);
      assert.ok(revealSpy.calledOnce);
      assert.strictEqual(revealSpy.firstCall.args[0], 'users');
    });

    it('should suggest fuzzy match for close typo', async () => {
      stubSchema();
      dialogMock.infoMessageResult = 'View Table';
      const link = new DriftTerminalLink(0, 13, 'user_settigns', 'table');
      await provider.handleTerminalLink(link);

      assert.ok(messageMock.infos.length > 0);
      assert.ok(messageMock.infos[0].includes('user_settings'));
      assert.ok(revealSpy.calledOnce);
      assert.strictEqual(revealSpy.firstCall.args[0], 'user_settings');
    });

    it('should show warning when server is unreachable', async () => {
      fetchStub.rejects(new Error('connection refused'));
      const link = new DriftTerminalLink(0, 5, 'users', 'table');
      await provider.handleTerminalLink(link);

      assert.ok(messageMock.warnings.length > 0);
      assert.ok(messageMock.warnings[0].includes('not reachable'));
      assert.ok(revealSpy.notCalled);
    });

    it('should handle fk_error by showing table picker', async () => {
      stubSchema();
      dialogMock.quickPickResult = 'orders';
      const link = new DriftTerminalLink(0, 27, null, 'fk_error');
      await provider.handleTerminalLink(link);

      assert.ok(revealSpy.calledOnce);
      assert.strictEqual(revealSpy.firstCall.args[0], 'orders');
    });

    it('should show table picker when user clicks Show All Tables', async () => {
      stubSchema();
      dialogMock.infoMessageResult = 'Show All Tables';
      dialogMock.quickPickResult = 'orders';
      const link = new DriftTerminalLink(0, 13, 'user_settigns', 'table');
      await provider.handleTerminalLink(link);

      assert.ok(revealSpy.calledOnce);
      assert.strictEqual(revealSpy.firstCall.args[0], 'orders');
    });

    it('should show picker for distant fuzzy match', async () => {
      stubSchema();
      dialogMock.quickPickResult = 'users';
      const link = new DriftTerminalLink(0, 20, 'completely_different', 'table');
      await provider.handleTerminalLink(link);

      assert.ok(revealSpy.calledOnce);
      assert.strictEqual(revealSpy.firstCall.args[0], 'users');
    });

    it('should not reveal when user dismisses info message', async () => {
      stubSchema();
      dialogMock.infoMessageResult = undefined;
      const link = new DriftTerminalLink(0, 13, 'user_settigns', 'table');
      await provider.handleTerminalLink(link);

      assert.ok(revealSpy.notCalled);
    });
  });

  // --- Log bridge integration ---

  describe('log bridge integration', () => {
    it('should write terminal link event when bridge is provided', async () => {
      const bridge = new LogCaptureBridge();
      const writeStub = sinon.stub(bridge, 'writeTerminalLinkEvent');

      const providerWithBridge = new DriftTerminalLinkProvider(
        client,
        revealSpy,
        bridge,
      );

      fetchStub.resolves(
        new Response(JSON.stringify(sampleMeta), { status: 200 }),
      );

      const link = new DriftTerminalLink(0, 5, 'users', 'table');
      await providerWithBridge.handleTerminalLink(link);

      assert.ok(writeStub.calledOnce);
      assert.ok(writeStub.firstCall.args[0].includes('users'));
      writeStub.restore();
    });
  });
});
