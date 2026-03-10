import * as assert from 'assert';
import * as sinon from 'sinon';
import { ConstraintValidator } from '../constraint-wizard/constraint-validator';

describe('ConstraintValidator', () => {
  let mockClient: {
    sql: sinon.SinonStub;
    schemaMetadata: sinon.SinonStub;
  };
  let validator: ConstraintValidator;

  beforeEach(() => {
    mockClient = {
      sql: sinon.stub(),
      schemaMetadata: sinon.stub().resolves([
        {
          name: 'users',
          rowCount: 10,
          columns: [
            { name: 'id', type: 'INTEGER', pk: true },
            { name: 'email', type: 'TEXT', pk: false },
            { name: 'age', type: 'INTEGER', pk: false },
            { name: 'phone', type: 'TEXT', pk: false },
          ],
        },
      ]),
    };
    validator = new ConstraintValidator(mockClient as any);
  });

  afterEach(() => sinon.restore());

  it('should report valid when UNIQUE has no duplicates', async () => {
    mockClient.sql
      .onFirstCall().resolves({ columns: ['email', '_cnt'], rows: [] })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[0]] });

    const result = await validator.test({
      id: 'c1', kind: 'unique', table: 'users', columns: ['email'],
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.violationCount, 0);
    assert.strictEqual(result.violations.length, 0);
  });

  it('should report violations when UNIQUE has duplicates', async () => {
    mockClient.sql
      .onFirstCall().resolves({
        columns: ['email', '_cnt'],
        rows: [['alice@example.com', 3]],
      })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[1]] });

    const result = await validator.test({
      id: 'c2', kind: 'unique', table: 'users', columns: ['email'],
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.violationCount, 1);
    assert.strictEqual(
      result.violations[0].values['email'], 'alice@example.com',
    );
    assert.strictEqual(result.violations[0].values['_cnt'], 3);
  });

  it('should reject UNIQUE with no columns selected', async () => {
    const result = await validator.test({
      id: 'c8', kind: 'unique', table: 'users', columns: [],
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.violations[0].values['error']);
  });

  it('should reject CHECK with empty expression', async () => {
    const result = await validator.test({
      id: 'c9', kind: 'check', table: 'users', expression: '',
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.violations[0].values['error']);
  });

  it('should reject NOT NULL with no column', async () => {
    const result = await validator.test({
      id: 'c10', kind: 'not_null', table: 'users',
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.violations[0].values['error']);
  });

  it('should report valid when CHECK is satisfied', async () => {
    mockClient.sql
      .onFirstCall().resolves({ columns: ['_pk'], rows: [] })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[0]] });

    const result = await validator.test({
      id: 'c3', kind: 'check', table: 'users',
      expression: 'age >= 0 AND age <= 150',
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.violationCount, 0);
  });

  it('should report violations when CHECK is violated', async () => {
    mockClient.sql
      .onFirstCall().resolves({
        columns: ['_pk', 'id', 'age'],
        rows: [[42, 42, -1], [88, 88, 999]],
      })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[2]] });

    const result = await validator.test({
      id: 'c4', kind: 'check', table: 'users',
      expression: 'age >= 0 AND age <= 150',
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.violationCount, 2);
    assert.strictEqual(result.violations.length, 2);
    assert.strictEqual(result.violations[0].rowPk, 42);
  });

  it('should report valid when NOT NULL has no NULLs', async () => {
    mockClient.sql
      .onFirstCall().resolves({ columns: ['_pk', 'phone'], rows: [] })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[0]] });

    const result = await validator.test({
      id: 'c5', kind: 'not_null', table: 'users', column: 'phone',
    });

    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.violationCount, 0);
  });

  it('should report violations when NOT NULL has NULLs', async () => {
    mockClient.sql
      .onFirstCall().resolves({
        columns: ['_pk', 'phone'],
        rows: [[1, null], [5, null]],
      })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[12]] });

    const result = await validator.test({
      id: 'c6', kind: 'not_null', table: 'users', column: 'phone',
    });

    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.violationCount, 12);
    assert.strictEqual(result.violations.length, 2);
  });

  it('should use rowid when table has no PK column', async () => {
    mockClient.schemaMetadata.resolves([
      {
        name: 'logs',
        rowCount: 5,
        columns: [
          { name: 'message', type: 'TEXT', pk: false },
        ],
      },
    ]);
    mockClient.sql
      .onFirstCall().resolves({ columns: ['_pk', 'message'], rows: [] })
      .onSecondCall().resolves({ columns: ['cnt'], rows: [[0]] });

    const result = await validator.test({
      id: 'c7', kind: 'not_null', table: 'logs', column: 'message',
    });

    assert.strictEqual(result.valid, true);
    const firstCall = mockClient.sql.firstCall.args[0] as string;
    assert.ok(firstCall.includes('"rowid"'));
  });
});
