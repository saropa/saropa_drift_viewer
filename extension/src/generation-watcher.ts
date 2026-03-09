import { DriftApiClient } from './api-client';

type Listener = () => void;

export class GenerationWatcher {
  private readonly _client: DriftApiClient;
  private _generation = 0;
  private _running = false;
  private _listeners: Listener[] = [];
  private _pollTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(client: DriftApiClient) {
    this._client = client;
  }

  onDidChange(listener: Listener): { dispose: () => void } {
    this._listeners.push(listener);
    return {
      dispose: () => {
        this._listeners = this._listeners.filter((l) => l !== listener);
      },
    };
  }

  start(): void {
    if (this._running) return;
    this._running = true;
    this._poll();
  }

  stop(): void {
    this._running = false;
    if (this._pollTimeout !== undefined) {
      clearTimeout(this._pollTimeout);
      this._pollTimeout = undefined;
    }
  }

  private async _poll(): Promise<void> {
    if (!this._running) return;

    try {
      const gen = await this._client.generation(this._generation);
      if (!this._running) return;

      if (gen !== this._generation) {
        this._generation = gen;
        for (const listener of this._listeners) {
          listener();
        }
      }
    } catch {
      // Server unreachable — retry after delay
    }

    if (this._running) {
      this._pollTimeout = setTimeout(() => this._poll(), 1000);
    }
  }

  /** Reset the generation counter (e.g., after active server changes). */
  reset(): void {
    this._generation = 0;
  }

  get generation(): number {
    return this._generation;
  }
}
