/**
 * In-memory store for runtime events (breakpoints, row changes, connection errors).
 */

export interface IRuntimeEvent {
  type: 'breakpoint-hit' | 'row-inserted' | 'row-deleted' | 'connection-error';
  table?: string;
  message: string;
  timestamp: number;
  count?: number;
}

const MAX_EVENTS = 100;
const EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Mutable store for runtime events with TTL and size limit.
 */
export class RuntimeEventStore {
  private readonly _events: IRuntimeEvent[] = [];

  addEvent(event: IRuntimeEvent): void {
    this._events.unshift(event);
    if (this._events.length > MAX_EVENTS) {
      this._events.length = MAX_EVENTS;
    }
  }

  pruneOldEvents(): void {
    const cutoff = Date.now() - EVENT_TTL_MS;
    while (this._events.length > 0 && this._events[this._events.length - 1].timestamp < cutoff) {
      this._events.pop();
    }
  }

  clearEvents(): void {
    this._events.length = 0;
  }

  get events(): readonly IRuntimeEvent[] {
    return this._events;
  }

  hasRecentConnectionError(withinMs = 30000): boolean {
    return this._events.some(
      (e) => e.type === 'connection-error' && Date.now() - e.timestamp < withinMs,
    );
  }
}
