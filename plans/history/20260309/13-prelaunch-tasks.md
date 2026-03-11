# Feature 13: Pre-Launch Health Check Tasks

## What It Does

Register VS Code tasks like "Drift: Run Anomaly Scan" and "Drift: Check Index Coverage" that can be wired into `launch.json` as `preLaunchTask`. Automatically scan for database issues every time you press F5.

## User Experience

### In launch.json:
```jsonc
{
  "name": "Flutter App",
  "type": "dart",
  "request": "launch",
  "preLaunchTask": "Drift: Health Check"
}
```

### When pressing F5:
```
Terminal: Drift Health Check
──────────────────────────────
Connecting to Drift server on :8642... OK

Index Coverage:
  ✓ users: 2 indexes (email, created_at)
  ✗ posts: 0 indexes — MISSING: idx_posts_user_id (FK)
  ✓ comments: 1 index (post_id)

Anomaly Scan:
  ✗ 3 orphaned FK(s): posts.author_id -> users.id
  ⚠ 45 NULL values in users.deleted_at (10.5%)
  ✓ No duplicate rows detected

Summary: 2 issues found (1 error, 1 warning)
──────────────────────────────
Task completed with warnings.
```

If errors are found, the task exits with non-zero code → launch is blocked → user sees "preLaunchTask failed" and can review the output.

### From Command Palette:
- "Tasks: Run Task" → "Drift: Run Anomaly Scan"
- "Tasks: Run Task" → "Drift: Check Index Coverage"
- "Tasks: Run Task" → "Drift: Health Check" (both combined)

## New Files

```
extension/src/
  tasks/
    drift-task-provider.ts        # TaskProvider implementation
    health-check-runner.ts        # Runs checks and formats output
extension/src/test/
  drift-task-provider.test.ts
  health-check-runner.test.ts
```

## Dependencies

- `api-client.ts` (Feature 1) — for API calls

## How It Works

### Task Provider

```typescript
class DriftTaskProvider implements vscode.TaskProvider {
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
    if (definition.type === DriftTaskProvider.type) {
      return this.createTask(task.name, definition.check, task.detail ?? '');
    }
    return undefined;
  }

  private createTask(name: string, check: string, detail: string): vscode.Task {
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

interface DriftTaskDefinition extends vscode.TaskDefinition {
  type: 'drift';
  check: 'healthCheck' | 'anomalyScan' | 'indexCoverage';
}
```

### Custom Execution (Pseudoterminal)

```typescript
class HealthCheckTerminal implements vscode.Pseudoterminal {
  private _writeEmitter = new vscode.EventEmitter<string>();
  private _closeEmitter = new vscode.EventEmitter<number>();
  readonly onDidWrite = this._writeEmitter.event;
  readonly onDidClose = this._closeEmitter.event;

  constructor(private readonly _check: string) {}

  open(): void {
    this.run();
  }

  close(): void {}

  private async run(): Promise<void> {
    const write = (text: string) => this._writeEmitter.fire(text + '\r\n');

    write('Drift Health Check');
    write('═'.repeat(40));
    write('');

    // Connect to server
    const { host, port } = getServerConfig();
    const client = new DriftApiClient(host, port);

    write(`Connecting to Drift server on ${host}:${port}...`);
    try {
      await client.health();
      write('  ✓ Connected\r\n');
    } catch {
      write('  ✗ Cannot connect to Drift server');
      write('  Make sure your Flutter app is running with DriftDebugServer.start()');
      this._closeEmitter.fire(1);
      return;
    }

    let errorCount = 0;
    let warningCount = 0;

    // Index Coverage
    if (this._check === 'healthCheck' || this._check === 'indexCoverage') {
      write('Index Coverage:');
      try {
        const suggestions = await client.indexSuggestions();
        if (suggestions.length === 0) {
          write('  ✓ No missing indexes detected');
        } else {
          for (const s of suggestions) {
            const icon = s.priority === 'high' ? '✗' : '⚠';
            write(`  ${icon} ${s.table}.${s.column}: ${s.reason}`);
            write(`    ${s.sql}`);
            if (s.priority === 'high') errorCount++;
            else warningCount++;
          }
        }
      } catch (e) {
        write(`  ✗ Failed to check indexes: ${e}`);
        errorCount++;
      }
      write('');
    }

    // Anomaly Scan
    if (this._check === 'healthCheck' || this._check === 'anomalyScan') {
      write('Anomaly Scan:');
      try {
        const anomalies = await client.anomalies();
        if (anomalies.length === 0) {
          write('  ✓ No anomalies detected');
        } else {
          for (const a of anomalies) {
            const icon = a.severity === 'error' ? '✗' : a.severity === 'warning' ? '⚠' : 'ℹ';
            write(`  ${icon} ${a.message}`);
            if (a.severity === 'error') errorCount++;
            else if (a.severity === 'warning') warningCount++;
          }
        }
      } catch (e) {
        write(`  ✗ Failed to scan anomalies: ${e}`);
        errorCount++;
      }
      write('');
    }

    // Summary
    write('═'.repeat(40));
    const total = errorCount + warningCount;
    if (total === 0) {
      write('✓ All checks passed');
    } else {
      write(`${total} issue(s) found (${errorCount} error(s), ${warningCount} warning(s))`);
    }

    // Exit code: non-zero blocks preLaunchTask
    this._closeEmitter.fire(errorCount > 0 ? 1 : 0);
  }
}
```

### Exit Code Behavior

| Scenario | Exit Code | Effect on preLaunchTask |
|----------|-----------|------------------------|
| All clean | 0 | Launch proceeds |
| Warnings only | 0 | Launch proceeds (warnings don't block) |
| Errors found | 1 | Launch blocked, user reviews output |
| Server unreachable | 1 | Launch blocked |

Configurable: `driftViewer.tasks.blockOnWarnings` (default: false) to also block on warnings.

## Problem Matchers

Register a problem matcher so issues from the task output appear in the Problems panel:

```jsonc
{
  "contributes": {
    "problemMatchers": [{
      "name": "drift-health",
      "owner": "driftViewer",
      "pattern": {
        "regexp": "^\\s*[✗⚠]\\s+(.+\\.\\w+):\\s+(.+)$",
        "file": 1,
        "message": 2
      },
      "severity": "warning"
    }]
  }
}
```

Note: Problem matchers work best with file:line:column format. Since drift issues map to SQL tables not files, the matcher is approximate. Feature 7 (Schema Linter) provides better diagnostics integration.

## package.json Contributions

```jsonc
{
  "contributes": {
    "taskDefinitions": [{
      "type": "drift",
      "required": ["check"],
      "properties": {
        "check": {
          "type": "string",
          "enum": ["healthCheck", "anomalyScan", "indexCoverage"],
          "description": "Which health check to run."
        }
      }
    }],
    "configuration": {
      "properties": {
        "driftViewer.tasks.blockOnWarnings": {
          "type": "boolean",
          "default": false,
          "description": "Block app launch when health check finds warnings (not just errors)."
        }
      }
    }
  }
}
```

## tasks.json Example

Users can define drift tasks in `.vscode/tasks.json`:

```jsonc
{
  "version": "2.0.0",
  "tasks": [{
    "type": "drift",
    "check": "healthCheck",
    "label": "Drift: Health Check",
    "group": "test"
  }]
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.tasks.registerTaskProvider('drift', new DriftTaskProvider())
);
```

## Testing

- Test task provider returns 3 tasks
- Test `resolveTask` recreates tasks from definitions
- Test health check runner output formatting
- Test exit codes (0 for clean, 1 for errors)
- Mock API client to return controlled anomalies/suggestions

## Known Limitations

- Server must be running before the task executes (chicken-and-egg if used as preLaunchTask and the server starts with the app)
- Workaround: use as a compound task where the first task starts the app, waits, then health check runs
- Problem matcher cannot map SQL table issues to specific Dart file:line locations (use Feature 7 for that)
- Output uses Unicode symbols (checkmarks, crosses) which may not render in all terminals
