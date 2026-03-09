/** Result of a fuzzy match comparison. */
export interface IFuzzyResult {
  name: string;
  distance: number;
}

/** Compute Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest matches for a target among candidates.
 * Comparison is case-insensitive. Results sorted by ascending distance.
 */
export function findClosestMatches(
  target: string,
  candidates: string[],
  maxResults: number,
): IFuzzyResult[] {
  const lower = target.toLowerCase();
  return candidates
    .map((name) => ({
      name,
      distance: levenshtein(lower, name.toLowerCase()),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults);
}
