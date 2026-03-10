/**
 * Session sharing commands: share, open, annotate.
 * Uses VS Code native InputBox / QuickPick — no webview panel.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from '../api-client';

/** Share a debug session. Copies the session URL to clipboard. */
export async function shareSession(
  client: DriftApiClient,
): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating shared session\u2026',
      },
      () => client.sessionShare({ sharedAt: new Date().toISOString() }),
    );
    await vscode.env.clipboard.writeText(result.url);
    vscode.window.showInformationMessage(
      `Session ${result.id} shared. URL copied to clipboard.`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Share session failed: ${msg}`);
  }
}

/** Open a shared session by ID and display its state as JSON. */
export async function openSession(
  client: DriftApiClient,
): Promise<void> {
  const id = await vscode.window.showInputBox({
    title: 'Open Shared Session',
    prompt: 'Enter session ID',
    placeHolder: 'e.g. abc123def',
  });
  if (!id) return;

  try {
    const session = await client.sessionGet(id);
    const content = JSON.stringify(session, null, 2);
    const doc = await vscode.workspace.openTextDocument({
      content,
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Open session failed: ${msg}`);
  }
}

/** Add an annotation to an existing session. */
export async function annotateSession(
  client: DriftApiClient,
): Promise<void> {
  const id = await vscode.window.showInputBox({
    title: 'Annotate Session (1/2)',
    prompt: 'Enter session ID',
    placeHolder: 'e.g. abc123def',
  });
  if (!id) return;

  const text = await vscode.window.showInputBox({
    title: 'Annotate Session (2/2)',
    prompt: 'Enter annotation text',
    placeHolder: 'Found issue in users table',
  });
  if (!text) return;

  try {
    await client.sessionAnnotate(id, text, 'vscode-user');
    vscode.window.showInformationMessage('Annotation added.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Annotate failed: ${msg}`);
  }
}
