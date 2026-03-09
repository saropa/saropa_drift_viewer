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

// Track panels & tree views created
export const createdPanels: MockWebviewPanel[] = [];
export const createdTreeViews: MockTreeView[] = [];

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
};

const registeredCommands: Record<string, (...args: any[]) => any> = {};

export const commands = {
  registerCommand: (id: string, handler: (...args: any[]) => any) => {
    registeredCommands[id] = handler;
    return { dispose: () => { delete registeredCommands[id]; } };
  },
  /** Helper to invoke a registered command in tests. */
  executeRegistered: (id: string, ...args: any[]) => registeredCommands[id]?.(...args),
  getRegistered: () => ({ ...registeredCommands }),
};

export const workspace = {
  getConfiguration: (_section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
  }),
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

/** Reset all shared mock state between tests. */
export function resetMocks(): void {
  createdPanels.length = 0;
  createdTreeViews.length = 0;
  writtenFiles.length = 0;
  clipboardMock.reset();
  dialogMock.reset();
  messageMock.reset();
  for (const key of Object.keys(registeredCommands)) {
    delete registeredCommands[key];
  }
}
