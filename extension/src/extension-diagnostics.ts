/**
 * Diagnostic manager and provider registration.
 * Central drift-advisor collection plus disable/clear/copy commands.
 */

import * as vscode from 'vscode';
import type { DriftApiClient } from './api-client';
import type { SchemaIntelligence } from './engines/schema-intelligence';
import type { QueryIntelligence } from './engines/query-intelligence';
import {
  BestPracticeProvider,
  DataQualityProvider,
  DiagnosticCodeActionProvider,
  DiagnosticManager,
  NamingProvider,
  PerformanceProvider,
  RuntimeProvider,
  SchemaProvider,
} from './diagnostics';

export interface DiagnosticSetupResult {
  diagnosticManager: DiagnosticManager;
}

/**
 * Create diagnostic collection, register all providers and related commands.
 * Caller must pass schemaIntel and queryIntel (created from client).
 */
export function setupDiagnostics(
  context: vscode.ExtensionContext,
  client: DriftApiClient,
  schemaIntel: SchemaIntelligence,
  queryIntel: QueryIntelligence,
): DiagnosticSetupResult {
  const diagnosticManager = new DiagnosticManager(client, schemaIntel, queryIntel);
  context.subscriptions.push(diagnosticManager);

  context.subscriptions.push(
    diagnosticManager.registerProvider(new SchemaProvider()),
    diagnosticManager.registerProvider(new PerformanceProvider()),
    diagnosticManager.registerProvider(new DataQualityProvider()),
    diagnosticManager.registerProvider(new BestPracticeProvider()),
    diagnosticManager.registerProvider(new NamingProvider()),
    diagnosticManager.registerProvider(new RuntimeProvider()),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.disableDiagnosticRule',
      async (ruleCode: string) => {
        const config = vscode.workspace.getConfiguration('driftViewer.diagnostics');
        const currentDisabled = config.get<string[]>('disabledRules', []);
        if (!currentDisabled.includes(ruleCode)) {
          await config.update(
            'disabledRules',
            [...currentDisabled, ruleCode],
            vscode.ConfigurationTarget.Workspace,
          );
          vscode.window.showInformationMessage(
            `Disabled diagnostic rule: ${ruleCode}`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.clearRuntimeAlerts',
      () => {
        const runtimeProvider = diagnosticManager.getProvider('runtime') as RuntimeProvider | undefined;
        if (runtimeProvider) {
          runtimeProvider.clearEvents();
          diagnosticManager.refresh();
          vscode.window.showInformationMessage('Runtime alerts cleared');
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'driftViewer.copySuggestedName',
      async (name: string) => {
        await vscode.env.clipboard.writeText(name);
        vscode.window.showInformationMessage(`Copied "${name}" to clipboard`);
      },
    ),
  );

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'dart', scheme: 'file' },
      new DiagnosticCodeActionProvider(diagnosticManager),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  return { diagnosticManager };
}
