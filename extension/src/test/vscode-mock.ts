/**
 * Mock implementation of the vscode API for unit testing outside VS Code.
 * Classes and types are split into vscode-mock-classes.ts and vscode-mock-types.ts.
 */

export * from './vscode-mock-classes';
export * from './vscode-mock-types';

import { MockDiagnosticCollection, MockOutputChannel, MockTreeView } from './vscode-mock-classes';
import { MockWebviewPanel } from './vscode-mock-types';

// Track panels, tree views & CodeLens providers created
export const createdPanels: MockWebviewPanel[] = [];
export const createdTreeViews: MockTreeView[] = [];
export const registeredCodeLensProviders: Array<{ selector: any; provider: any }> = [];
export const registeredDefinitionProviders: Array<{ selector: any; provider: any }> = [];
export const registeredHoverProviders: Array<{ selector: any; provider: any }> = [];
export const registeredCodeActionProviders: Array<{ selector: any; provider: any; metadata?: any }> = [];
export const createdDiagnosticCollections: MockDiagnosticCollection[] = [];
export const registeredFileDecorationProviders: any[] = [];
export const registeredTerminalLinkProviders: Array<{ provider: any }> = [];
export const registeredTimelineProviders: Array<{ scheme: string; provider: any }> = [];
export const createdTextDocuments: Array<{ content: string; language: string }> = [];

// --- Clipboard mock ---
let _clipboardText = '';
export const clipboardMock = {
  get text() { return _clipboardText; },
  reset() { _clipboardText = ''; },
};

// --- Dialog mock ---
let _saveDialogResult: any = undefined;
let _infoMessageResult: string | undefined = undefined;
let _quickPickResult: string | undefined = undefined;
let _inputBoxResult: string | undefined = undefined;

export const dialogMock = {
  set saveResult(uri: any) { _saveDialogResult = uri; },
  set infoMessageResult(v: string | undefined) { _infoMessageResult = v; },
  set quickPickResult(v: string | undefined) { _quickPickResult = v; },
  set inputBoxResult(v: string | undefined) { _inputBoxResult = v; },
  reset() {
    _saveDialogResult = undefined;
    _infoMessageResult = undefined;
    _quickPickResult = undefined;
    _inputBoxResult = undefined;
  },
};

// --- Info/error message tracking ---
export const messageMock = {
  infos: [] as string[],
  errors: [] as string[],
  warnings: [] as string[],
  reset() {
    this.infos.length = 0;
    this.errors.length = 0;
    this.warnings.length = 0;
  },
};

// --- fs mock ---
export const writtenFiles: Array<{ uri: any; content: Uint8Array }> = [];

export const window = {
  createWebviewPanel: (
    _viewType: string,
    _title: string,
    _column: any,
    _options?: any,
  ): MockWebviewPanel => {
    const panel = new MockWebviewPanel();
    createdPanels.push(panel);
    return panel;
  },
  createTreeView: (
    _viewId: string,
    _options: any,
  ): MockTreeView => {
    const tv = new MockTreeView();
    createdTreeViews.push(tv);
    return tv as any;
  },
  createOutputChannel: (name: string) => new MockOutputChannel(name),
  createStatusBarItem: (_alignment?: any, _priority?: number) => ({
    text: '',
    command: '',
    tooltip: '',
    backgroundColor: undefined as any,
    show: () => { /* no-op */ },
    dispose: () => { /* no-op */ },
  }),
  withProgress: async (_options: any, task: (progress: any) => Promise<any>) =>
    task({ report: () => { /* no-op */ } }),
  showSaveDialog: async (_options?: any) => _saveDialogResult,
  showInformationMessage: async (msg: string, ..._items: string[]) => {
    messageMock.infos.push(msg);
    return _infoMessageResult;
  },
  showWarningMessage: async (msg: string) => {
    messageMock.warnings.push(msg);
  },
  showErrorMessage: async (msg: string) => {
    messageMock.errors.push(msg);
  },
  showQuickPick: async (_items: any[], _options?: any) => _quickPickResult,
  showInputBox: async (_options?: any) => _inputBoxResult,
  showTextDocument: async (_doc: any, _column?: any) => { /* no-op */ },
  registerFileDecorationProvider: (provider: any) => {
    registeredFileDecorationProviders.push(provider);
    return { dispose: () => { /* no-op */ } };
  },
  registerTerminalLinkProvider: (provider: any) => {
    registeredTerminalLinkProviders.push({ provider });
    return { dispose: () => { /* no-op */ } };
  },
  registerWebviewViewProvider: (_viewId: string, _provider: any) => {
    return { dispose: () => { /* no-op */ } };
  },
};

const registeredCommands: Record<string, (...args: any[]) => any> = {};

const contextValues: Record<string, unknown> = {};

export const commands = {
  registerCommand: (id: string, handler: (...args: any[]) => any) => {
    registeredCommands[id] = handler;
    return { dispose: () => { delete registeredCommands[id]; } };
  },
  executeCommand: async (id: string, ...args: any[]) => {
    if (id === 'setContext' && args.length >= 2) {
      contextValues[args[0] as string] = args[1];
      return;
    }
    return registeredCommands[id]?.(...args);
  },
  /** Helper to invoke a registered command in tests. */
  executeRegistered: (id: string, ...args: any[]) => registeredCommands[id]?.(...args),
  getRegistered: () => ({ ...registeredCommands }),
  /** Read a context value set via setContext. */
  getContext: (key: string) => contextValues[key],
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
  }),
  onDidChangeConfiguration: (_listener: any) => ({ dispose: () => { /* no-op */ } }),
  openTextDocument: async (options: any) => {
    if (options && typeof options === 'object' && 'content' in options) {
      createdTextDocuments.push(options);
    }
    return options;
  },
  findFiles: async (_include: any, _exclude?: any): Promise<any[]> => [],
  registerTimelineProvider: (scheme: string, provider: any) => {
    registeredTimelineProviders.push({ scheme, provider });
    return { dispose: () => { /* no-op */ } };
  },
  fs: {
    readFile: async (_uri: any): Promise<Uint8Array> => new Uint8Array(),
    writeFile: async (uri: any, content: Uint8Array) => {
      writtenFiles.push({ uri, content });
    },
  },
};

export const env = {
  openExternal: async (_uri: any) => true,
  clipboard: {
    writeText: async (text: string) => { _clipboardText = text; },
    readText: async () => _clipboardText,
  },
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value, scheme: 'http', authority: '', path: value }),
  file: (path: string) => ({ toString: () => path, scheme: 'file', path, fsPath: path }),
};

export const languages = {
  createDiagnosticCollection: (name: string): MockDiagnosticCollection => {
    const col = new MockDiagnosticCollection(name);
    createdDiagnosticCollections.push(col);
    return col;
  },
  registerCodeLensProvider: (selector: any, provider: any) => {
    registeredCodeLensProviders.push({ selector, provider });
    return { dispose: () => { /* no-op */ } };
  },
  registerDefinitionProvider: (selector: any, provider: any) => {
    registeredDefinitionProviders.push({ selector, provider });
    return { dispose: () => { /* no-op */ } };
  },
  registerHoverProvider: (selector: any, provider: any) => {
    registeredHoverProviders.push({ selector, provider });
    return { dispose: () => { /* no-op */ } };
  },
  registerCodeActionsProvider: (selector: any, provider: any, metadata?: any) => {
    registeredCodeActionProviders.push({ selector, provider, metadata });
    return { dispose: () => { /* no-op */ } };
  },
};

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

/** Reset all shared mock state between tests. */
export function resetMocks(): void {
  createdPanels.length = 0;
  createdTreeViews.length = 0;
  writtenFiles.length = 0;
  clipboardMock.reset();
  dialogMock.reset();
  messageMock.reset();
  registeredCodeLensProviders.length = 0;
  registeredDefinitionProviders.length = 0;
  registeredHoverProviders.length = 0;
  registeredCodeActionProviders.length = 0;
  debug.activeDebugSession = undefined;
  registeredFileDecorationProviders.length = 0;
  registeredTerminalLinkProviders.length = 0;
  registeredTimelineProviders.length = 0;
  createdDiagnosticCollections.length = 0;
  createdTextDocuments.length = 0;
  registeredTaskProviders.length = 0;
  debugStartListeners.length = 0;
  debugTerminateListeners.length = 0;
  extensions.clearExtensions();
  for (const key of Object.keys(registeredCommands)) {
    delete registeredCommands[key];
  }
  for (const key of Object.keys(contextValues)) {
    delete contextValues[key];
  }
}
