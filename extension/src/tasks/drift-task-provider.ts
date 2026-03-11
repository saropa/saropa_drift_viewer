import * as vscode from 'vscode';
import { HealthCheckTerminal } from './health-check-runner';

export type DriftCheckKind = 'healthCheck' | 'anomalyScan' | 'indexCoverage';

export interface DriftTaskDefinition extends vscode.TaskDefinition {
  type: 'drift';
  check: DriftCheckKind;
}

export class DriftTaskProvider implements vscode.TaskProvider {
  static readonly type = 'drift';

  provideTasks(): vscode.Task[] {
    return [
      this.createTask('Health Check', 'healthCheck', 'Run full database health check'),
      this.createTask('Anomaly Scan', 'anomalyScan', 'Scan for data anomalies'),
      this.createTask('Index Coverage', 'indexCoverage', 'Check for missing indexes'),
    ];
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const definition = task.definition as DriftTaskDefinition;
    if (definition.type === DriftTaskProvider.type && definition.check) {
      return this.createTask(task.name, definition.check, task.detail ?? '');
    }
    return undefined;
  }

  private createTask(name: string, check: DriftCheckKind, detail: string): vscode.Task {
    const definition: DriftTaskDefinition = { type: 'drift', check };
    const task = new vscode.Task(
      definition,
      vscode.TaskScope.Workspace,
      `Drift: ${name}`,
      'Saropa Drift Advisor',
      new vscode.CustomExecution(async () => new HealthCheckTerminal(check)),
    );
    task.detail = detail;
    task.group = vscode.TaskGroup.Test;
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      panel: vscode.TaskPanelKind.Dedicated,
    };
    return task;
  }
}
