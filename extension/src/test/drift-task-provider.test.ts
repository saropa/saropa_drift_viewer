import * as assert from 'assert';
import { resetMocks, Task, TaskScope, TaskGroup, CustomExecution, TaskRevealKind, TaskPanelKind } from './vscode-mock';
import { DriftTaskProvider } from '../tasks/drift-task-provider';

describe('DriftTaskProvider', () => {
  let provider: DriftTaskProvider;

  beforeEach(() => {
    resetMocks();
    provider = new DriftTaskProvider();
  });

  describe('provideTasks', () => {
    it('should return 3 tasks', () => {
      const tasks = provider.provideTasks();
      assert.strictEqual(tasks.length, 3);
    });

    it('should include Health Check task', () => {
      const tasks = provider.provideTasks();
      const healthCheck = tasks.find((t) => t.name === 'Drift: Health Check');
      assert.ok(healthCheck, 'Health Check task should exist');
      assert.strictEqual(healthCheck.definition.check, 'healthCheck');
      assert.strictEqual(healthCheck.definition.type, 'drift');
    });

    it('should include Anomaly Scan task', () => {
      const tasks = provider.provideTasks();
      const anomalyScan = tasks.find((t) => t.name === 'Drift: Anomaly Scan');
      assert.ok(anomalyScan, 'Anomaly Scan task should exist');
      assert.strictEqual(anomalyScan.definition.check, 'anomalyScan');
    });

    it('should include Index Coverage task', () => {
      const tasks = provider.provideTasks();
      const indexCoverage = tasks.find((t) => t.name === 'Drift: Index Coverage');
      assert.ok(indexCoverage, 'Index Coverage task should exist');
      assert.strictEqual(indexCoverage.definition.check, 'indexCoverage');
    });

    it('should set source to Saropa Drift Advisor', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.strictEqual(task.source, 'Saropa Drift Advisor');
      }
    });

    it('should set scope to Workspace', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.strictEqual(task.scope, TaskScope.Workspace);
      }
    });

    it('should set group to Test', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.strictEqual(task.group, TaskGroup.Test);
      }
    });

    it('should set reveal to Always and panel to Dedicated', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.strictEqual(task.presentationOptions.reveal, TaskRevealKind.Always);
        assert.strictEqual(task.presentationOptions.panel, TaskPanelKind.Dedicated);
      }
    });

    it('should use CustomExecution', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.ok(task.execution instanceof CustomExecution, 'should use CustomExecution');
      }
    });

    it('should set detail descriptions', () => {
      const tasks = provider.provideTasks();
      for (const task of tasks) {
        assert.ok(task.detail && task.detail.length > 0, 'detail should be non-empty');
      }
    });
  });

  describe('resolveTask', () => {
    it('should resolve a task with drift type', () => {
      const inputTask = new Task(
        { type: 'drift', check: 'anomalyScan' },
        TaskScope.Workspace,
        'Anomaly Scan',
        'Saropa Drift Advisor',
      );
      inputTask.detail = 'Scan for data anomalies';
      const resolved = provider.resolveTask(inputTask as any);
      assert.ok(resolved, 'should resolve the task');
      assert.strictEqual(resolved!.definition.check, 'anomalyScan');
      assert.strictEqual(resolved!.name, 'Drift: Anomaly Scan');
    });

    it('should return undefined for non-drift type', () => {
      const inputTask = new Task(
        { type: 'shell', check: 'anomalyScan' },
        TaskScope.Workspace,
        'Some Task',
        'Other',
      );
      const resolved = provider.resolveTask(inputTask as any);
      assert.strictEqual(resolved, undefined);
    });

    it('should return undefined when check is missing', () => {
      const inputTask = new Task(
        { type: 'drift' },
        TaskScope.Workspace,
        'Bad Task',
        'Saropa Drift Advisor',
      );
      const resolved = provider.resolveTask(inputTask as any);
      assert.strictEqual(resolved, undefined);
    });
  });

  describe('static type', () => {
    it('should be "drift"', () => {
      assert.strictEqual(DriftTaskProvider.type, 'drift');
    });
  });
});
