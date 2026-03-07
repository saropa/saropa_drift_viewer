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

// Track panels created by createWebviewPanel
export const createdPanels: MockWebviewPanel[] = [];

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
  createStatusBarItem: (_alignment?: any, _priority?: number) => ({
    text: '',
    command: '',
    tooltip: '',
    show: () => { /* no-op */ },
    dispose: () => { /* no-op */ },
  }),
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
};

export const env = {
  openExternal: async (_uri: any) => true,
};

export const Uri = {
  parse: (value: string) => ({ toString: () => value, scheme: 'http', authority: '', path: value }),
};

export enum ViewColumn {
  Active = -1,
  Beside = -2,
  One = 1,
  Two = 2,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

/** Reset all shared mock state between tests. */
export function resetMocks(): void {
  createdPanels.length = 0;
  for (const key of Object.keys(registeredCommands)) {
    delete registeredCommands[key];
  }
}
