/**
 * Debug, extensions, and tasks mock modules for the vscode API.
 * Extracted from vscode-mock.ts for the 300-line limit.
 */

// --- Debug session support ---

type DebugSessionListener = (session: any) => void;
const debugStartListeners: DebugSessionListener[] = [];
const debugTerminateListeners: DebugSessionListener[] = [];

export const debug = {
  activeDebugSession: undefined as any,
  onDidStartDebugSession: (listener: DebugSessionListener) => {
    debugStartListeners.push(listener);
    return {
      dispose: () => {
        const idx = debugStartListeners.indexOf(listener);
        if (idx >= 0) debugStartListeners.splice(idx, 1);
      },
    };
  },
  onDidTerminateDebugSession: (listener: DebugSessionListener) => {
    debugTerminateListeners.push(listener);
    return {
      dispose: () => {
        const idx = debugTerminateListeners.indexOf(listener);
        if (idx >= 0) debugTerminateListeners.splice(idx, 1);
      },
    };
  },
  /** Simulate a debug session starting. */
  simulateStart: (session: any) => {
    for (const l of [...debugStartListeners]) l(session);
  },
  /** Simulate a debug session ending. */
  simulateTerminate: (session: any) => {
    for (const l of [...debugTerminateListeners]) l(session);
  },
  registerDebugAdapterTrackerFactory: (_adapterId: string, _factory: any) => ({
    dispose: () => {},
  }),
};

// --- Extensions mock ---

const extensionMap: Record<string, any> = {};

export const extensions = {
  getExtension: (id: string) => extensionMap[id],
  /** Helper to register a fake extension for testing. */
  setExtension: (id: string, ext: any) => { extensionMap[id] = ext; },
  clearExtensions: () => {
    for (const key of Object.keys(extensionMap)) {
      delete extensionMap[key];
    }
  },
};

// --- Task support ---

const registeredTaskProviders: Array<{ type: string; provider: any }> = [];

export const tasks = {
  registerTaskProvider: (type: string, provider: any) => {
    registeredTaskProviders.push({ type, provider });
    return {
      dispose: () => {
        const idx = registeredTaskProviders.findIndex((r) => r.provider === provider);
        if (idx >= 0) { registeredTaskProviders.splice(idx, 1); }
      },
    };
  },
  getRegisteredProviders: () => [...registeredTaskProviders],
};

/** Reset debug, extensions, and task mock state. */
export function resetExtras(): void {
  debug.activeDebugSession = undefined;
  debugStartListeners.length = 0;
  debugTerminateListeners.length = 0;
  extensions.clearExtensions();
  registeredTaskProviders.length = 0;
}
