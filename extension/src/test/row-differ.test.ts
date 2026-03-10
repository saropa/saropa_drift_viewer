import * as assert from 'assert';
import { RowDiffer } from '../comparator/row-differ';
import type { IRowDiff, RowDiffMatch } from '../comparator/row-differ';

function diff(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): IRowDiff {
  return new RowDiffer().diff(a, b, 'A', 'B');
}

function matchOf(result: IRowDiff, col: string): RowDiffMatch | undefined {
  return result.columns.find((c) => c.column === col)?.match;
}

describe('RowDiffer', () => {
  it('should mark identical values as same', () => {
    const r = diff({ id: 1, name: 'Alice' }, { id: 1, name: 'Alice' });
    assert.strictEqual(r.sameCount, 2);
    assert.strictEqual(r.differentCount, 0);
    assert.strictEqual(matchOf(r, 'id'), 'same');
    assert.strictEqual(matchOf(r, 'name'), 'same');
  });

  it('should mark different values as different', () => {
    const r = diff({ id: 1, name: 'Alice' }, { id: 1, name: 'Bob' });
    assert.strictEqual(r.sameCount, 1);
    assert.strictEqual(r.differentCount, 1);
    assert.strictEqual(matchOf(r, 'name'), 'different');
  });

  it('should mark column only in A', () => {
    const r = diff({ id: 1, role: 'admin' }, { id: 1 });
    assert.strictEqual(r.onlyACount, 1);
    assert.strictEqual(matchOf(r, 'role'), 'only_a');
    const col = r.columns.find((c) => c.column === 'role')!;
    assert.strictEqual(col.valueA, 'admin');
    assert.strictEqual(col.valueB, undefined);
  });

  it('should mark column only in B', () => {
    const r = diff({ id: 1 }, { id: 1, extra: true });
    assert.strictEqual(r.onlyBCount, 1);
    assert.strictEqual(matchOf(r, 'extra'), 'only_b');
    const col = r.columns.find((c) => c.column === 'extra')!;
    assert.strictEqual(col.valueA, undefined);
    assert.strictEqual(col.valueB, true);
  });

  it('should treat numeric string vs number as same', () => {
    const r = diff({ count: 42 }, { count: '42' });
    assert.strictEqual(matchOf(r, 'count'), 'same');
  });

  it('should treat number vs numeric string as same (reversed)', () => {
    const r = diff({ count: '7' }, { count: 7 });
    assert.strictEqual(matchOf(r, 'count'), 'same');
  });

  it('should treat null vs null as same', () => {
    const r = diff({ val: null }, { val: null });
    assert.strictEqual(matchOf(r, 'val'), 'same');
  });

  it('should treat null vs value as different', () => {
    const r = diff({ val: null }, { val: 'hello' });
    assert.strictEqual(matchOf(r, 'val'), 'different');
  });

  it('should treat value vs null as different', () => {
    const r = diff({ val: 'hello' }, { val: null });
    assert.strictEqual(matchOf(r, 'val'), 'different');
  });

  it('should detect type mismatch for non-numeric types', () => {
    const r = diff({ val: '42' }, { val: true });
    assert.strictEqual(matchOf(r, 'val'), 'type_mismatch');
  });

  it('should handle empty rows', () => {
    const r = diff({}, {});
    assert.strictEqual(r.columns.length, 0);
    assert.strictEqual(r.sameCount, 0);
    assert.strictEqual(r.differentCount, 0);
    assert.strictEqual(r.onlyACount, 0);
    assert.strictEqual(r.onlyBCount, 0);
  });

  it('should sort: same, different, type_mismatch, only_a, only_b', () => {
    const r = diff(
      { s: 1, d: 'x', t: '1', a: 'only' },
      { s: 1, d: 'y', t: true, b: 'only' },
    );

    const matches = r.columns.map((c) => c.match);
    assert.deepStrictEqual(matches, [
      'same',
      'different',
      'type_mismatch',
      'only_a',
      'only_b',
    ]);
  });

  it('should preserve labels', () => {
    const r = new RowDiffer().diff(
      { id: 1 }, { id: 2 }, 'users.id=1', 'users.id=2',
    );
    assert.strictEqual(r.labelA, 'users.id=1');
    assert.strictEqual(r.labelB, 'users.id=2');
  });

  it('should handle all columns different between tables', () => {
    const r = diff({ a: 1, b: 2 }, { c: 3, d: 4 });
    assert.strictEqual(r.onlyACount, 2);
    assert.strictEqual(r.onlyBCount, 2);
    assert.strictEqual(r.sameCount, 0);
    assert.strictEqual(r.differentCount, 0);
  });
});
