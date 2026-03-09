import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { LogCaptureBridge } from '../debug/log-capture-bridge';
import { extensions } from './vscode-mock';

describe('LogCaptureBridge', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let bridge: LogCaptureBridge;
  let fakeContext: { subscriptions: any[] };

  beforeEach(() => {
    fetchStub = sinon.stub(globalThis, 'fetch');
    client = new DriftApiClient('127.0.0.1', 8642);
    bridge = new LogCaptureBridge();
    fakeContext = { subscriptions: [] };
  });

  afterEach(() => {
    bridge.dispose();
    extensions.clearExtensions();
    fetchStub.restore();
  });

  describe('when saropa-log-capture is not installed', () => {
    it('should be a no-op', async () => {
      await bridge.init(fakeContext as any, client);

      // Should not throw
      bridge.writeSlowQuery({ sql: 'SELECT 1', durationMs: 1000, rowCount: 1, at: '' });
      bridge.writeQuery({ sql: 'SELECT 1', durationMs: 10, rowCount: 1, at: '' });
      bridge.writeConnectionEvent('test');
    });
  });

  describe('when saropa-log-capture is installed', () => {
    let writeLineSpy: sinon.SinonSpy;
    let insertMarkerSpy: sinon.SinonSpy;
    let registeredProvider: any;

    beforeEach(async () => {
      writeLineSpy = sinon.spy();
      insertMarkerSpy = sinon.spy();

      const fakeApi = {
        writeLine: writeLineSpy,
        insertMarker: insertMarkerSpy,
        getSessionInfo: () => ({ isActive: true }),
        registerIntegrationProvider: (provider: any) => {
          registeredProvider = provider;
          return { dispose: () => { registeredProvider = null; } };
        },
      };

      extensions.setExtension('saropa.saropa-log-capture', {
        isActive: true,
        exports: fakeApi,
      });

      await bridge.init(fakeContext as any, client);
    });

    it('should register an integration provider', () => {
      assert.ok(registeredProvider);
      assert.strictEqual(registeredProvider.id, 'saropa-drift-viewer');
    });

    it('should report enabled', () => {
      assert.strictEqual(registeredProvider.isEnabled(), true);
    });

    it('should provide header on session start', () => {
      const contributions = registeredProvider.onSessionStartSync();
      assert.ok(contributions);
      assert.strictEqual(contributions.length, 1);
      assert.strictEqual(contributions[0].kind, 'header');
      assert.ok(contributions[0].lines[0].includes('127.0.0.1:8642'));
    });

    it('should provide summary on session end', async () => {
      const samplePerf = {
        totalQueries: 10,
        totalDurationMs: 500,
        avgDurationMs: 50,
        slowQueries: [{ sql: 'SELECT 1', durationMs: 400, rowCount: 1, at: '' }],
        recentQueries: [],
      };
      fetchStub.resolves(
        new Response(JSON.stringify(samplePerf), { status: 200 }),
      );

      const contributions = await registeredProvider.onSessionEnd();
      assert.ok(contributions);
      assert.strictEqual(contributions[0].kind, 'header');
      assert.ok(contributions[0].lines[0].includes('10 total'));
    });

    it('should return undefined on session end if server fails', async () => {
      fetchStub.rejects(new Error('connection refused'));

      const contributions = await registeredProvider.onSessionEnd();
      assert.strictEqual(contributions, undefined);
    });

    it('should write slow query via writeLine', () => {
      bridge.writeSlowQuery({
        sql: 'SELECT * FROM large_table',
        durationMs: 1200,
        rowCount: 100,
        at: '',
      });

      assert.ok(writeLineSpy.calledOnce);
      const [text, opts] = writeLineSpy.firstCall.args;
      assert.ok(text.includes('1200ms'));
      assert.strictEqual(opts.category, 'drift-perf');
    });

    it('should write connection event via writeLine', () => {
      bridge.writeConnectionEvent('Connected to server');

      assert.ok(writeLineSpy.calledOnce);
      const [text] = writeLineSpy.firstCall.args;
      assert.ok(text.includes('Connected to server'));
    });
  });

  describe('dispose()', () => {
    it('should become no-op after dispose', async () => {
      const writeLineSpy = sinon.spy();

      extensions.setExtension('saropa.saropa-log-capture', {
        isActive: true,
        exports: {
          writeLine: writeLineSpy,
          insertMarker: sinon.spy(),
          getSessionInfo: () => ({ isActive: true }),
          registerIntegrationProvider: () => ({ dispose: () => {} }),
        },
      });

      await bridge.init(fakeContext as any, client);
      bridge.dispose();

      bridge.writeSlowQuery({ sql: 'SELECT 1', durationMs: 1000, rowCount: 1, at: '' });
      assert.strictEqual(writeLineSpy.callCount, 0);
    });
  });
});
