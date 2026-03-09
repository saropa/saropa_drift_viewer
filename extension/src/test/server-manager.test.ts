import * as assert from 'assert';
import * as sinon from 'sinon';
import { resetMocks, MockMemento } from './vscode-mock';
import { ServerManager } from '../server-manager';
import { DriftApiClient } from '../api-client';
import { IServerInfo, ServerDiscovery, IDiscoveryConfig } from '../server-discovery';

function makeServer(port: number): IServerInfo {
  return {
    host: '127.0.0.1',
    port,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    missedPolls: 0,
  };
}

function defaultConfig(): IDiscoveryConfig {
  return { host: '127.0.0.1', portRangeStart: 8642, portRangeEnd: 8644 };
}

describe('ServerManager', () => {
  let fetchStub: sinon.SinonStub;
  let client: DriftApiClient;
  let discovery: ServerDiscovery;
  let manager: ServerManager;
  let memento: MockMemento;

  beforeEach(() => {
    resetMocks();
    fetchStub = sinon.stub(globalThis, 'fetch');
    fetchStub.rejects(new Error('connection refused'));
    client = new DriftApiClient('127.0.0.1', 8642);
    discovery = new ServerDiscovery(defaultConfig());
    memento = new MockMemento();
    manager = new ServerManager(discovery, client, memento);
  });

  afterEach(() => {
    manager.dispose();
    discovery.dispose();
    fetchStub.restore();
  });

  it('should start with no active server', () => {
    assert.strictEqual(manager.activeServer, undefined);
  });

  it('should auto-select when single server found', () => {
    const changed = sinon.stub();
    manager.onDidChangeActive(changed);

    // Simulate discovery finding one server
    const servers = [makeServer(8642)];
    (discovery as any)._onDidChangeServers.fire(servers);

    assert.ok(changed.calledOnce);
    assert.strictEqual(manager.activeServer?.port, 8642);
  });

  it('should reconfigure client on server change', () => {
    const spy = sinon.spy(client, 'reconfigure');

    const servers = [makeServer(8643)];
    (discovery as any)._onDidChangeServers.fire(servers);

    assert.ok(spy.calledOnce);
    assert.ok(spy.calledWith('127.0.0.1', 8643));
  });

  it('should fire onDidChangeActive with undefined when all servers lost', () => {
    // First, select a server
    (discovery as any)._onDidChangeServers.fire([makeServer(8642)]);
    assert.strictEqual(manager.activeServer?.port, 8642);

    // All servers lost
    const changed = sinon.stub();
    manager.onDidChangeActive(changed);
    (discovery as any)._onDidChangeServers.fire([]);

    assert.ok(changed.calledOnce);
    assert.strictEqual(manager.activeServer, undefined);
  });

  it('should auto-switch when active dies and 1 remains', () => {
    // Single server first — auto-selected
    (discovery as any)._onDidChangeServers.fire([makeServer(8642)]);
    assert.strictEqual(manager.activeServer?.port, 8642);

    // Second server appears (active still alive — no change)
    (discovery as any)._onDidChangeServers.fire([makeServer(8642), makeServer(8643)]);
    assert.strictEqual(manager.activeServer?.port, 8642);

    // 8642 dies, only 8643 remains — auto-switch
    (discovery as any)._onDidChangeServers.fire([makeServer(8643)]);
    assert.strictEqual(manager.activeServer?.port, 8643);
  });

  it('should persist known ports to workspace state', () => {
    const servers = [makeServer(8642), makeServer(8643)];
    (discovery as any)._onDidChangeServers.fire(servers);

    const stored = memento.get<number[]>('driftViewer.lastKnownPorts', []) ?? [];
    assert.deepStrictEqual(stored.sort(), [8642, 8643]);
  });

  it('should guard against concurrent QuickPick calls', async () => {
    // Single server first — auto-selected
    (discovery as any)._onDidChangeServers.fire([makeServer(8642)]);

    // Two servers appear — triggers selectServer
    (discovery as any)._onDidChangeServers.fire([makeServer(8642), makeServer(8643)]);
    // Second fire while QuickPick is open — should be skipped (no crash)
    (discovery as any)._onDidChangeServers.fire([makeServer(8642), makeServer(8643)]);
  });

  it('should keep active server when it is still alive', () => {
    const s = makeServer(8642);
    (discovery as any)._onDidChangeServers.fire([s]);
    assert.strictEqual(manager.activeServer?.port, 8642);

    const changed = sinon.stub();
    manager.onDidChangeActive(changed);

    // Server still alive on next poll
    (discovery as any)._onDidChangeServers.fire([makeServer(8642)]);
    assert.ok(changed.notCalled, 'should not fire when active is still alive');
    assert.strictEqual(manager.activeServer?.port, 8642);
  });

  it('should show warning when selectServer called with no servers', async () => {
    // Stub discovery.servers to return empty
    sinon.stub(discovery, 'servers').get(() => []);
    await manager.selectServer();
    // No crash — warning shown via vscode mock
  });
});
