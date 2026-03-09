import * as assert from 'assert';
import * as sinon from 'sinon';
import { DriftApiClient } from '../api-client';
import { GenerationWatcher } from '../generation-watcher';

describe('GenerationWatcher', () => {
  let client: DriftApiClient;
  let genStub: sinon.SinonStub;
  let watcher: GenerationWatcher;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    client = new DriftApiClient('127.0.0.1', 8642);
    // Stub the client method directly to avoid Response/fetch issues with fake timers
    genStub = sinon.stub(client, 'generation');
    watcher = new GenerationWatcher(client);
  });

  afterEach(() => {
    watcher.stop();
    clock.restore();
    genStub.restore();
  });

  async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  it('should fire onDidChange when generation changes', async () => {
    genStub.resolves(1);

    let fired = false;
    watcher.onDidChange(() => { fired = true; });
    watcher.start();

    await flush();

    assert.strictEqual(fired, true, 'listener should fire on generation change');
    assert.strictEqual(watcher.generation, 1);
  });

  it('should not fire when generation stays the same', async () => {
    genStub.resolves(0); // same as initial

    let fireCount = 0;
    watcher.onDidChange(() => { fireCount++; });
    watcher.start();

    await flush();

    assert.strictEqual(fireCount, 0, 'should not fire when generation unchanged');
  });

  it('should continue polling after errors', async () => {
    genStub.onFirstCall().rejects(new Error('connection refused'));
    genStub.onSecondCall().resolves(1);

    let fired = false;
    watcher.onDidChange(() => { fired = true; });
    watcher.start();

    // First poll: error
    await flush();
    assert.strictEqual(fired, false, 'should not fire on error');

    // Advance timer for retry
    clock.tick(1000);
    await flush();

    assert.strictEqual(fired, true, 'should fire after successful retry');
  });

  it('should stop polling when stop() is called', async () => {
    genStub.resolves(1);

    watcher.start();
    await flush();

    watcher.stop();
    const callCount = genStub.callCount;

    // Advance timer — should not make new calls
    clock.tick(5000);
    await flush();

    assert.strictEqual(genStub.callCount, callCount, 'should not poll after stop');
  });

  it('should allow disposing a listener', async () => {
    genStub.resolves(1);

    let fired = false;
    const sub = watcher.onDidChange(() => { fired = true; });
    sub.dispose();

    watcher.start();
    await flush();

    assert.strictEqual(fired, false, 'disposed listener should not fire');
  });

  it('should not start twice', () => {
    genStub.returns(new Promise(() => { /* never resolves */ }));
    watcher.start();
    watcher.start();
    assert.strictEqual(genStub.callCount, 1, 'should only poll once');
  });
});
