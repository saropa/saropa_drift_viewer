import * as vscode from 'vscode';
import { DriftApiClient, QueryEntry } from '../api-client';

/**
 * Minimal subset of the Saropa Log Capture API used by this bridge.
 * Avoids a hard dependency on the saropa-log-capture package.
 */
interface LogCaptureApi {
  writeLine(text: string, options?: { category?: string }): void;
  insertMarker(text?: string): void;
  getSessionInfo(): { isActive: boolean } | undefined;
  registerIntegrationProvider(provider: {
    readonly id: string;
    isEnabled(): boolean;
    onSessionStartSync?(): Array<{ kind: 'header'; lines: string[] }> | undefined;
    onSessionEnd?(): Promise<Array<{ kind: 'header'; lines: string[] }> | undefined>;
  }): vscode.Disposable;
}

type LogMode = 'off' | 'slow-only' | 'all';

function getLogMode(): LogMode {
  return vscode.workspace
    .getConfiguration('driftViewer')
    .get<LogMode>('performance.logToCapture', 'slow-only') ?? 'slow-only';
}

export class LogCaptureBridge {
  private _api: LogCaptureApi | undefined;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Attempt to connect to the Saropa Log Capture extension.
   * No-op if the extension is not installed.
   */
  async init(
    context: vscode.ExtensionContext,
    client: DriftApiClient,
  ): Promise<void> {
    const ext = vscode.extensions.getExtension('saropa.saropa-log-capture');
    if (!ext) return;

    this._api = ext.isActive
      ? (ext.exports as LogCaptureApi)
      : ((await ext.activate()) as LogCaptureApi);

    const cfg = vscode.workspace.getConfiguration('driftViewer');
    const slowMs = cfg.get<number>('performance.slowThresholdMs', 500) ?? 500;

    const reg = this._api.registerIntegrationProvider({
      id: 'saropa-drift-advisor',
      isEnabled: () => true,
      onSessionStartSync: () => [
        {
          kind: 'header',
          lines: [
            `Saropa Drift Advisor: ${client.baseUrl}`,
            `Slow query threshold: ${slowMs}ms`,
          ],
        },
      ],
      onSessionEnd: async () => {
        const perf = await client.performance().catch(() => null);
        if (!perf) return undefined;
        return [
          {
            kind: 'header',
            lines: [
              `Drift Queries: ${perf.totalQueries} total, ${perf.avgDurationMs}ms avg`,
              `Slow queries: ${perf.slowQueries.length}`,
              ...perf.slowQueries
                .slice(0, 5)
                .map((q) => `  ${q.durationMs}ms: ${q.sql.slice(0, 80)}`),
            ],
          },
        ];
      },
    });
    this._disposables.push(reg);
  }

  /** Write a slow-query alert line into the capture session. */
  writeSlowQuery(query: QueryEntry): void {
    if (!this._api) return;
    const mode = getLogMode();
    if (mode === 'off') return;

    this._api.writeLine(
      `\u26a0 DRIFT SLOW (${query.durationMs}ms): ${query.sql.slice(0, 200)}`,
      { category: 'drift-perf' },
    );
  }

  /** Write a query line (for 'all' mode). */
  writeQuery(query: QueryEntry): void {
    if (!this._api) return;
    if (getLogMode() !== 'all') return;

    this._api.writeLine(
      `DRIFT QUERY (${query.durationMs}ms): ${query.sql.slice(0, 200)}`,
      { category: 'drift-query' },
    );
  }

  /** Write a terminal link match/action event. */
  writeTerminalLinkEvent(msg: string): void {
    if (!this._api) return;
    this._api.writeLine(`DRIFT LINK: ${msg}`, { category: 'drift-link' });
  }

  /** Write a data editing event. */
  writeDataEdit(msg: string): void {
    if (!this._api) return;
    this._api.writeLine(`DRIFT EDIT: ${msg}`, { category: 'drift-edit' });
  }

  /** Write a connection lifecycle event. */
  writeConnectionEvent(msg: string): void {
    if (!this._api) return;
    if (getLogMode() === 'off') return;

    this._api.writeLine(`DRIFT: ${msg}`, { category: 'drift-perf' });
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables.length = 0;
    this._api = undefined;
  }
}
