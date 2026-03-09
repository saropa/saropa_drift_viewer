import * as assert from 'assert';
import * as sinon from 'sinon';
import { messageMock, resetMocks } from './vscode-mock';
import { ServerDiscovery, IDiscoveryConfig } from '../server-discovery';

function defaultConfig(): IDiscoveryConfig {
  return { host: '127.0.0.1', portRangeStart: 8642, portRangeEnd: 8644 };
}

function healthJson(): string {
  return JSON.stringify({ ok: true });
}

function metadataJson(): string {
  return JSON.stringify([{ name: 'users', columns: [], rowCount: 5 }]);
}

function makeResponse(body: string): Response {
  return {
    ok: true,
    json: async () => JSON.parse(body),
  } as Response;
}

describe('ServerDiscovery', () => {
  let fetchStub: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  let discovery: ServerDiscovery;

  beforeEach(() => {
    resetMocks();
    fetchStub = sinon.stub(globalThis, 'fetch');
    fetchStub.rejects(new Error('connection refused'));
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    discovery?.dispose();
    clock.restore();
    fetchStub.restore();
  });

  function stubPortAlive(port: number): void {
    fetchStub
      .withArgs(`http://127.0.0.1:${port}/api/health`, sinon.match.any)
      .resolves(makeResponse(healthJson()));
    fetchStub
      .withArgs(`http://127.0.0.1:${port}/api/schema/metadata`)
      .resolves(makeResponse(metadataJson()));
  }

  it('should start in searching state', () => {
    discovery = new ServerDiscovery(defaultConfig());
    assert.strictEqual(discovery.state, 'searching');
    assert.strictEqual(discovery.servers.length, 0);
  });

  it('should find a server and transition to connected', async () => {
    stubPortAlive(8642);
    discovery = new ServerDiscovery(defaultConfig());

    const changed = sinon.stub();
    discovery.onDidChangeServers(changed);
    discovery.start();

    // Let the poll complete
    await clock.tickAsync(1);

    assert.strictEqual(discovery.state, 'connected');
    assert.strictEqual(discovery.servers.length, 1);
    assert.strictEqual(discovery.servers[0].port, 8642);
    assert.ok(changed.calledOnce);
  });

  it('should find multiple servers', async () => {
    stubPortAlive(8642);
    stubPortAlive(8643);
    discovery = new ServerDiscovery(defaultConfig());

    discovery.start();
    await clock.tickAsync(1);

    assert.strictEqual(discovery.servers.length, 2);
    const ports = discovery.servers.map((s) => s.port).sort();
    assert.deepStrictEqual(ports, [8642, 8643]);
  });

  it('should require 2 consecutive misses before removing a server', async () => {
    stubPortAlive(8642);
    discovery = new ServerDiscovery(defaultConfig());

    discovery.start();
    await clock.tickAsync(1);
    assert.strictEqual(discovery.servers.length, 1);

    // Server goes down — first miss
    fetchStub.reset();
    fetchStub.rejects(new Error('connection refused'));
    await clock.tickAsync(15001);
    assert.strictEqual(discovery.servers.length, 1, 'should survive 1 miss');

    // Second miss — removed
    await clock.tickAsync(15001);
    assert.strictEqual(discovery.servers.length, 0, 'should be removed after 2 misses');
  });

  it('should transition to backoff after 5 empty scans', async () => {
    discovery = new ServerDiscovery(defaultConfig());
    discovery.start();

    // 5 empty scans at 3s intervals
    for (let i = 0; i < 5; i++) {
      await clock.tickAsync(3001);
    }

    assert.strictEqual(discovery.state, 'backoff');
  });

  it('should use correct intervals per state', async () => {
    discovery = new ServerDiscovery(defaultConfig());
    discovery.start();
    await clock.tickAsync(1);

    // Searching state — 3s interval
    const callsBefore = fetchStub.callCount;
    await clock.tickAsync(3001);
    assert.ok(fetchStub.callCount > callsBefore, 'should poll at 3s in searching');

    // Transition to connected
    stubPortAlive(8642);
    await clock.tickAsync(3001);
    assert.strictEqual(discovery.state, 'connected');

    // Connected state — 15s interval
    const callsConnected = fetchStub.callCount;
    await clock.tickAsync(3001);
    assert.strictEqual(
      fetchStub.callCount,
      callsConnected,
      'should NOT poll at 3s in connected',
    );
    await clock.tickAsync(12001);
    assert.ok(
      fetchStub.callCount > callsConnected,
      'should poll at 15s in connected',
    );
  });

  it('should stop polling on stop()', async () => {
    discovery = new ServerDiscovery(defaultConfig());
    discovery.start();
    await clock.tickAsync(1);

    discovery.stop();
    const callCount = fetchStub.callCount;
    await clock.tickAsync(10000);
    assert.strictEqual(fetchStub.callCount, callCount, 'no more polls after stop');
  });

  it('should retry from searching state on retry()', async () => {
    discovery = new ServerDiscovery(defaultConfig());
    discovery.start();

    // Go to backoff
    for (let i = 0; i < 5; i++) {
      await clock.tickAsync(3001);
    }
    assert.strictEqual(discovery.state, 'backoff');

    // Retry
    discovery.retry();
    assert.strictEqual(discovery.state, 'searching');
    await clock.tickAsync(1);
    // Should have polled again
    assert.ok(fetchStub.callCount > 0);
  });

  it('should reject servers failing secondary validation', async () => {
    // Health passes but metadata fails
    fetchStub
      .withArgs('http://127.0.0.1:8642/api/health', sinon.match.any)
      .resolves(makeResponse(healthJson()));
    fetchStub
      .withArgs('http://127.0.0.1:8642/api/schema/metadata')
      .resolves(makeResponse(JSON.stringify({ notAnArray: true })));

    discovery = new ServerDiscovery(defaultConfig());
    discovery.start();
    await clock.tickAsync(1);

    assert.strictEqual(discovery.servers.length, 0);
  });

  it('should throttle notifications per port', async () => {
    stubPortAlive(8642);
    discovery = new ServerDiscovery(defaultConfig());

    discovery.start();
    await clock.tickAsync(1);
    assert.strictEqual(messageMock.infos.length, 1);

    // Server goes down (2 misses) then comes back
    fetchStub.reset();
    fetchStub.rejects(new Error('connection refused'));
    await clock.tickAsync(15001);
    await clock.tickAsync(15001);

    // Server back up within 60s of first notification
    stubPortAlive(8642);
    await clock.tickAsync(3001);
    // Notification should be throttled
    assert.strictEqual(messageMock.infos.length, 1, 'should throttle notification');
  });
});
