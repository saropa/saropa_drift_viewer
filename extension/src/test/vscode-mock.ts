/**
 * Mock implementation of the vscode API for unit testing outside VS Code.
 */

export class EventEmitter {
  private _listeners: Array<(...args: any[]) => void> = [];
  event = (listener: (...args: any[]) => void) => {
    this._listeners.push(listener);
    return { dispose: () => { /* no-op */ } };
  };
  fire(...args: any[]) {
    this._listeners.forEach((l) => l(...args));
  }
}

// --- Tree view support ---

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: ThemeColor,
  ) {}
}

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value: string;
  isTrusted?: boolean;
  constructor(value = '') {
    this.value = value;
  }
}

// --- CodeLens support ---

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export class Location {
  public readonly uri: any;
  public readonly range: Range;

  constructor(uri: any, rangeOrPosition: Position | Range) {
    this.uri = uri;
    if (rangeOrPosition instanceof Range) {
      this.range = rangeOrPosition;
    } else {
      // Convert Position to zero-width Range (matches real vscode behavior)
      this.range = new Range(
        rangeOrPosition.line, rangeOrPosition.character,
        rangeOrPosition.line, rangeOrPosition.character,
      );
    }
  }
}

export const CancellationTokenNone = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => { /* no-op */ } }),
};

export class CodeLens {
  range: Range;
  command?: { title: string; command: string; arguments?: any[] };
  constructor(range: Range, command?: { title: string; command: string; arguments?: any[] }) {
    this.range = range;
    this.command = command;
  }
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string | MarkdownString;
  iconPath?: ThemeIcon | { light: string; dark: string };
  collapsibleState?: TreeItemCollapsibleState;
  contextValue?: string;
  command?: any;

  constructor(
    label: string,
    collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

export class MockTreeView {
  disposed = false;
  dispose() {
    this.disposed = true;
  }
}

// --- Webview support ---

export class MockWebview {
  html = '';
  private _onDidReceiveMessage = new EventEmitter();

  onDidReceiveMessage(
    listener: (msg: any) => void,
    _thisArg?: any,
    disposables?: { push: (d: any) => void }[],
  ) {
    const disposable = this._onDidReceiveMessage.event(listener);
    if (disposables) {
      (disposables as any[]).push(disposable);
    }
    return disposable;
  }

  /** Simulate the webview sending a message to the extension. */
  simulateMessage(msg: any): void {
    this._onDidReceiveMessage.fire(msg);
  }
}

export class MockWebviewPanel {
  webview = new MockWebview();
  private _onDidDispose = new EventEmitter();
  private _disposed = false;
  revealed = false;
  revealColumn: any = undefined;

  onDidDispose(
    listener: () => void,
    _thisArg?: any,
    disposables?: any[],
  ) {
    const disposable = this._onDidDispose.event(listener);
    if (disposables) {
      disposables.push(disposable);
    }
    return disposable;
  }

  reveal(column?: any) {
    this.revealed = true;
    this.revealColumn = column;
  }

  dispose() {
    if (!this._disposed) {
      this._disposed = true;
      this._onDidDispose.fire();
    }
  }

  /** Simulate the user closing the panel. */
  simulateClose(): void {
    this.dispose();
  }
}

// Track panels, tree views & CodeLens providers created
export const createdPanels: MockWebviewPanel[] = [];
export const createdTreeViews: MockTreeView[] = [];
export const registeredCodeLensProviders: Array<{ selector: any; provider: any }> = [];
export const registeredDefinitionProviders: Array<{ selector: any; provider: any }> = [];
export const createdTextDocuments: Array<{ content: string; language: string }> = [];

// --- Clipboard mock ---

let _clipboardText = '';

export const clipboardMock = {
  get text() { return _clipboardText; },
  reset() { _clipboardText = ''; },
};

// --- Dialog mock ---

let _saveDialogResult: any = undefined;

export const dialogMock = {
  set saveResult(uri: any) { _saveDialogResult = uri; },
  reset() { _saveDialogResult = undefined; },
};

// --- Info/error message tracking ---

export const messageMock = {
  infos: [] as string[],
  errors: [] as string[],
  reset() {
    this.infos.length = 0;
    this.errors.length = 0;
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
  createStatusBarItem: (_alignment?: any, _priority?: number) => ({
    text: '',
    command: '',
    tooltip: '',
    show: () => { /* no-op */ },
    dispose: () => { /* no-op */ },
  }),
  withProgress: async (_options: any, task: (progress: any) => Promise<any>) =>
    task({ report: () => { /* no-op */ } }),
  showSaveDialog: async (_options?: any) => _saveDialogResult,
  showInformationMessage: async (msg: string) => {
    messageMock.infos.push(msg);
  },
  showErrorMessage: async (msg: string) => {
    messageMock.errors.push(msg);
  },
  showTextDocument: async (_doc: any, _column?: any) => { /* no-op */ },
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
  openTextDocument: async (options: any) => {
    if (options && typeof options === 'object' && 'content' in options) {
      createdTextDocuments.push(options);
    }
    return options;
  },
  findFiles: async (_include: any, _exclude?: any): Promise<any[]> => [],
  fs: {
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
  file: (path: string) => ({ toString: () => path, scheme: 'file', path }),
};

export const languages = {
  registerCodeLensProvider: (selector: any, provider: any) => {
    registeredCodeLensProviders.push({ selector, provider });
    return { dispose: () => { /* no-op */ } };
  },
  registerDefinitionProvider: (selector: any, provider: any) => {
    registeredDefinitionProviders.push({ selector, provider });
    return { dispose: () => { /* no-op */ } };
  },
};

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

// --- Task support ---

export enum TaskScope {
  Global = 1,
  Workspace = 2,
}

export enum TaskRevealKind {
  Always = 1,
  Silent = 2,
  Never = 3,
}

export enum TaskPanelKind {
  Shared = 1,
  Dedicated = 2,
  New = 3,
}

export const TaskGroup = {
  Clean: { id: 'clean' },
  Build: { id: 'build' },
  Rebuild: { id: 'rebuild' },
  Test: { id: 'test' },
};

export class CustomExecution {
  constructor(public readonly callback: () => Promise<any>) {}
}

export class Task {
  definition: any;
  scope: any;
  name: string;
  source: string;
  execution: any;
  detail?: string;
  group?: any;
  presentationOptions: any = {};

  constructor(
    definition: any,
    scope: any,
    name: string,
    source: string,
    execution?: any,
  ) {
    this.definition = definition;
    this.scope = scope;
    this.name = name;
    this.source = source;
    this.execution = execution;
  }
}

// --- Debug session support ---

type DebugSessionListener = (session: any) => void;
const debugStartListeners: DebugSessionListener[] = [];
const debugTerminateListeners: DebugSessionListener[] = [];

export const debug = {
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
