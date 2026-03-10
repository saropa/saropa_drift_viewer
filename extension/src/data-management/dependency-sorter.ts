import type { IFkContext } from './dataset-types';

/** Topological sort for FK-ordered insert and delete operations. */
export class DependencySorter {
  /**
   * Returns tables in insertion order (parents first).
   * Tables with no FK dependencies come first.
   */
  sortForInsert(tables: string[], fks: IFkContext[]): string[] {
    const sorted = this._topoSort(tables, fks);

    // Circular dependency: append remaining tables
    if (sorted.length < tables.length) {
      const remaining = tables.filter((t) => !sorted.includes(t));
      sorted.push(...remaining);
    }

    return sorted;
  }

  /** Returns tables in deletion order (children first). */
  sortForDelete(tables: string[], fks: IFkContext[]): string[] {
    return this.sortForInsert(tables, fks).reverse();
  }

  /** True when some tables could not be topologically sorted. */
  hasCircularDeps(tables: string[], fks: IFkContext[]): boolean {
    return this._topoSort(tables, fks).length < tables.length;
  }

  /** Kahn's algorithm — returns only the sortable subset. */
  private _topoSort(
    tables: string[],
    fks: IFkContext[],
  ): string[] {
    const deps = new Map<string, Set<string>>();
    for (const table of tables) {
      deps.set(table, new Set());
    }
    for (const fk of fks) {
      if (deps.has(fk.fromTable) && deps.has(fk.toTable)) {
        deps.get(fk.fromTable)!.add(fk.toTable);
      }
    }

    const inDegree = new Map<string, number>();
    for (const t of tables) {
      inDegree.set(t, deps.get(t)!.size);
    }

    const queue = tables.filter((t) => inDegree.get(t) === 0);
    const sorted: string[] = [];

    while (queue.length > 0) {
      const t = queue.shift()!;
      sorted.push(t);
      for (const [child, parents] of deps) {
        if (parents.has(t)) {
          parents.delete(t);
          const newDegree = (inDegree.get(child) ?? 1) - 1;
          inDegree.set(child, newDegree);
          if (newDegree === 0) {
            queue.push(child);
          }
        }
      }
    }

    return sorted;
  }
}
