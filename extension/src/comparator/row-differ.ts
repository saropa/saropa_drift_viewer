/** Match classification for a single column in a row diff. */
export type RowDiffMatch =
  | 'same'
  | 'different'
  | 'only_a'
  | 'only_b'
  | 'type_mismatch';

/** Per-column comparison result. */
export interface IRowDiffColumn {
  column: string;
  valueA: unknown;
  valueB: unknown;
  match: RowDiffMatch;
}

/** Full row-vs-row diff result. */
export interface IRowDiff {
  labelA: string;
  labelB: string;
  columns: IRowDiffColumn[];
  sameCount: number;
  differentCount: number;
  onlyACount: number;
  onlyBCount: number;
}

const MATCH_ORDER: Record<RowDiffMatch, number> = {
  same: 0,
  different: 1,
  type_mismatch: 2,
  only_a: 3,
  only_b: 4,
};

/** Compare two row objects column-by-column. */
export class RowDiffer {
  diff(
    rowA: Record<string, unknown>,
    rowB: Record<string, unknown>,
    labelA: string,
    labelB: string,
  ): IRowDiff {
    const allColumns = new Set([
      ...Object.keys(rowA),
      ...Object.keys(rowB),
    ]);
    const columns: IRowDiffColumn[] = [];
    let same = 0;
    let different = 0;
    let onlyA = 0;
    let onlyB = 0;

    for (const col of allColumns) {
      const hasA = col in rowA;
      const hasB = col in rowB;

      if (hasA && hasB) {
        const valA = rowA[col];
        const valB = rowB[col];
        const match = this._classify(valA, valB);
        columns.push({ column: col, valueA: valA, valueB: valB, match });
        if (match === 'same') {
          same++;
        } else {
          different++;
        }
      } else if (hasA) {
        columns.push({
          column: col, valueA: rowA[col], valueB: undefined, match: 'only_a',
        });
        onlyA++;
      } else {
        columns.push({
          column: col, valueA: undefined, valueB: rowB[col], match: 'only_b',
        });
        onlyB++;
      }
    }

    columns.sort((a, b) => MATCH_ORDER[a.match] - MATCH_ORDER[b.match]);

    return {
      labelA,
      labelB,
      columns,
      sameCount: same,
      differentCount: different,
      onlyACount: onlyA,
      onlyBCount: onlyB,
    };
  }

  /** Classify the match between two values present in both rows. */
  private _classify(a: unknown, b: unknown): RowDiffMatch {
    if (a === b) return 'same';
    if (a === null || b === null) return 'different';

    // Numeric coercion — SQLite may return 42 or "42"
    if (typeof a === 'number' || typeof b === 'number') {
      const numA = Number(a);
      const numB = Number(b);
      if (!isNaN(numA) && !isNaN(numB) && numA === numB) return 'same';
    }

    if (typeof a !== typeof b) return 'type_mismatch';
    return String(a) === String(b) ? 'same' : 'different';
  }
}
