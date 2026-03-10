import * as assert from 'assert';
import * as sinon from 'sinon';
import {
  resetMocks,
  createdPanels,
  createdTextDocuments,
} from './vscode-mock';
import { ConstraintWizardPanel } from '../constraint-wizard/constraint-wizard-panel';

function latestPanel() {
  return createdPanels[createdPanels.length - 1];
}

describe('ConstraintWizardPanel', () => {
  const tableMeta = {
    name: 'users',
    rowCount: 100,
    columns: [
      { name: 'id', type: 'INTEGER', pk: true },
      { name: 'email', type: 'TEXT', pk: false },
      { name: 'age', type: 'INTEGER', pk: false },
    ],
  };
  const fks = [
    { fromColumn: 'org_id', toTable: 'orgs', toColumn: 'id' },
  ];

  let mockClient: {
    sql: sinon.SinonStub;
    schemaMetadata: sinon.SinonStub;
    tableFkMeta: sinon.SinonStub;
  };

  beforeEach(() => {
    resetMocks();
    (ConstraintWizardPanel as any)._currentPanel = undefined;
    mockClient = {
      sql: sinon.stub().resolves({ columns: [], rows: [] }),
      schemaMetadata: sinon.stub().resolves([tableMeta]),
      tableFkMeta: sinon.stub().resolves(fks),
    };
  });

  afterEach(() => sinon.restore());

  it('should create a webview panel with table name', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    assert.strictEqual(createdPanels.length, 1);
    const html = latestPanel().webview.html;
    assert.ok(html.includes('users'));
    assert.ok(html.includes('Constraint Wizard'));
  });

  it('should reuse existing panel on second call', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    assert.strictEqual(createdPanels.length, 1);
  });

  it('should show existing PK and FK constraints', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    const html = latestPanel().webview.html;
    assert.ok(html.includes('PRIMARY KEY'));
    assert.ok(html.includes('org_id'));
    assert.ok(html.includes('orgs'));
  });

  it('should add a constraint on addConstraint message', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    latestPanel().webview.simulateMessage({
      command: 'addConstraint', kind: 'unique',
    });
    const html = latestPanel().webview.html;
    assert.ok(html.includes('UNIQUE'));
  });

  it('should remove a constraint on removeConstraint', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    latestPanel().webview.simulateMessage({
      command: 'addConstraint', kind: 'check',
    });
    const html1 = latestPanel().webview.html;
    assert.ok(
      !html1.includes('No constraints designed yet'),
      'Should have at least one draft',
    );

    const match = /data-id="(cw_\d+)"/.exec(html1);
    assert.ok(match, 'Should have a draft with data-id');
    latestPanel().webview.simulateMessage({
      command: 'removeConstraint', id: match![1],
    });
    const html2 = latestPanel().webview.html;
    assert.ok(
      html2.includes('No constraints designed yet'),
      'All drafts should be removed',
    );
  });

  it('should test a constraint and show results', async () => {
    mockClient.sql
      .onFirstCall().resolves({
        columns: ['email', '_cnt'],
        rows: [['dup@test.com', 2]],
      });

    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    latestPanel().webview.simulateMessage({
      command: 'addConstraint', kind: 'unique',
    });

    const html1 = latestPanel().webview.html;
    const match = /data-id="(cw_\d+)"/.exec(html1);
    assert.ok(match);

    latestPanel().webview.simulateMessage({
      command: 'updateConstraint', index: 0, columns: ['email'],
    });
    latestPanel().webview.simulateMessage({
      command: 'testConstraint', id: match![1],
    });

    await new Promise((r) => setTimeout(r, 50));
    const html2 = latestPanel().webview.html;
    assert.ok(
      html2.includes('violation') || html2.includes('dup@test.com'),
    );
  });

  it('should open dart editor on generateDart', async () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    latestPanel().webview.simulateMessage({
      command: 'addConstraint', kind: 'unique',
    });
    latestPanel().webview.simulateMessage({
      command: 'updateConstraint', index: 0, columns: ['email'],
    });
    latestPanel().webview.simulateMessage({
      command: 'generateDart',
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(createdTextDocuments.length > 0);
    const doc = createdTextDocuments[createdTextDocuments.length - 1];
    assert.strictEqual(doc.language, 'dart');
    assert.ok(doc.content.includes('CREATE UNIQUE INDEX'));
  });

  it('should open sql editor on generateSql', async () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    latestPanel().webview.simulateMessage({
      command: 'addConstraint', kind: 'check',
    });
    latestPanel().webview.simulateMessage({
      command: 'updateConstraint', index: 0,
      expression: 'age >= 0',
    });
    latestPanel().webview.simulateMessage({
      command: 'generateSql',
    });

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(createdTextDocuments.length > 0);
    const doc = createdTextDocuments[createdTextDocuments.length - 1];
    assert.strictEqual(doc.language, 'sql');
    assert.ok(doc.content.includes('age >= 0'));
  });

  it('should clean up singleton on panel dispose', () => {
    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    assert.strictEqual(createdPanels.length, 1);
    latestPanel().simulateClose();

    ConstraintWizardPanel.createOrShow(
      mockClient as any, tableMeta, fks,
    );
    assert.strictEqual(createdPanels.length, 2);
  });
});
