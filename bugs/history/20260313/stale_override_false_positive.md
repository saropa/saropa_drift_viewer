# Bug Report: Stale Override False Positive (Saropa Package Vibrancy)

**Status:** Addressed (reference implementation in repo)  
**Source:** Saropa Package Vibrancy (extension / linter)  
**Code:** `stale-override`  
**Severity:** Medium (incorrect advice leads to broken `flutter pub get`)  
**Reported:** 2026-03-13  
**Archived:** 2026-03-13  

---

## Resolution summary

This repo does not contain the Vibrancy tool; the fix is implemented here as a **reference implementation** and correct classification script. Before reporting an override as stale, the script runs a version solve with that override removed; only if the solve succeeds is the override classified as stale. Script: `scripts/check_stale_overrides.py`. Unit tests: `scripts/tests/test_check_stale_overrides.py`. Vibrancy (in its own repo) should adopt the same logic: run/simulate a solve without the override and do not report stale if the solve fails.

---

## Summary

The Saropa Package Vibrancy tool reports that `analyzer` and `dart_style` in `dependency_overrides` are "stale" and "safe to remove." After removing them, **version solving fails**. The overrides are **required** to resolve a real conflict between transitive dependencies. The "stale override" diagnostic is a **false positive**.

---

## Environment

- **Consumer project:** Flutter app (e.g. saropa_kykto) with:
  - `drift: ^2.32.0` and `drift_dev: ^2.32.0` (require `analyzer ^10.0.0`)
  - `saropa_lints: ^8.2.2` (depends on `analyzer ^9.0.0`)
- **Tool:** Saropa Package Vibrancy (diagnostics on `pubspec.yaml`)
- **Observation:** Vibrancy reports "Stale override: no conflict detected for analyzer" and "Stale override: no conflict detected for dart_style. Safe to remove."

---

## Steps to Reproduce

1. In a Flutter project, set in `pubspec.yaml`:
   - **dependencies / dev_dependencies:**  
     `drift: ^2.32.0`, `drift_dev: ^2.32.0`, `saropa_lints: ^8.2.2`
   - **dependency_overrides:**  
     `analyzer: ^10.0.0`  
     `dart_style: ^3.1.6`

2. Run `flutter pub get` → **succeeds** (overrides in place).

3. Remove the `analyzer` and `dart_style` entries from `dependency_overrides` (as the Vibrancy "stale override" hint suggests).

4. Run `flutter pub get` again → **fails** with:

   ```
   Because no versions of saropa_lints match >8.2.2 <9.0.0 and saropa_lints 8.2.2 depends on analyzer ^9.0.0,
   saropa_lints ^8.2.2 requires analyzer ^9.0.0.
   And because drift_dev 2.32.0 depends on analyzer ^10.0.0 and no versions of drift_dev match >2.32.0 <3.0.0,
   saropa_lints ^8.2.2 is incompatible with drift_dev ^2.32.0.
   So, because <project> depends on both drift_dev ^2.32.0 and saropa_lints ^8.2.2, version solving failed.
   ```

5. Restore the two overrides → `flutter pub get` **succeeds** again.

---

## Expected vs Actual

| Aspect | Expected | Actual |
|--------|----------|--------|
| When overrides are present | Resolution succeeds; overrides are needed. | Correct: resolution succeeds. |
| "Stale override" diagnostic | Should **not** be emitted for overrides that are still required for version solving. | **Incorrect:** Vibrancy reports both overrides as "stale" and "safe to remove." |
| After removing overrides (as suggested) | Either resolution still works or the tool does not suggest removal. | **Incorrect:** Resolution fails; the suggestion is wrong. |

---

## Root Cause (Hypothesis)

The Vibrancy logic that marks an override as "stale" likely:

- Does **not** run a full `pub get` / version solve without that override, or
- Uses a cached or partial resolution (e.g. only direct dependencies), or
- Treats an override as unnecessary if the **current** lockfile satisfies constraints, ignoring that the lockfile was produced **with** the override.

So it concludes "no conflict detected" even though the conflict is between **transitive** constraints (saropa_lints → analyzer ^9 vs drift_dev → analyzer ^10). The override is required to break that conflict; without it, the solver fails.

---

## Why the Overrides Exist

1. **analyzer**  
   - `drift_dev` 2.32.x requires `analyzer ^10.0.0`.  
   - `saropa_lints` 8.2.2 requires `analyzer ^9.0.0`.  
   - No single analyzer version satisfies both.  
   - Override `analyzer: ^10.0.0` is used so drift_dev (and build_runner/drift codegen) work; saropa_lints runs with analyzer 10 (acceptable until saropa_lints supports it officially).

2. **dart_style**  
   - `drift_dev` 2.32 pulls in `dart_style` 3.1.3, which uses APIs removed in analyzer 10 (e.g. `ParserErrorCode`), so build_runner fails.  
   - Override `dart_style: ^3.1.6` uses a version that supports analyzer 10, so build_runner succeeds.

Both overrides are **necessary** for this dependency combination; they are not legacy leftovers.

---

## Impact

- **User impact:** Users who follow the "stale override" suggestion remove the overrides and get a broken `flutter pub get`. They must discover the failure and re-add the overrides (or revert).
- **Trust:** Repeated false positives for "stale override" reduce trust in the Vibrancy tool for other override suggestions.

---

## Suggested Fix (for Vibrancy)

Before reporting an override as "stale" or "safe to remove":

1. Run (or simulate) a version solve with that override **removed** (and no other changes).
2. If the solve **fails**, do **not** report the override as stale; it is still required.
3. Optionally: only mark an override as stale if the solve **succeeds** without it and the resolved versions are unchanged for all packages that depend on the overridden package.

This requires the tool to use the real Pub version solver (e.g. via `dart pub get` with a modified pubspec or a programmatic solve) rather than inferring from direct constraints or lockfile alone.

### Reference implementation (this repo)

- **Script:** `scripts/check_stale_overrides.py`
- **Usage:** `python scripts/check_stale_overrides.py [--pubspec PATH] [--flutter] [--dry-run]`
- **Behaviour:** For each entry in `dependency_overrides`, temporarily removes it, runs `dart pub get` or `flutter pub get`, and classifies as **required** (solve failed without it) or **stale** (solve succeeded). Only overrides that are classified as stale should be reported as "safe to remove."

---

## Minimal pubspec Snippet (Reproduction)

```yaml
dependencies:
  drift: ^2.32.0

dev_dependencies:
  drift_dev: ^2.32.0
  saropa_lints: ^8.2.2

dependency_overrides:
  analyzer: ^10.0.0
  dart_style: ^3.1.6
```

With the overrides: `flutter pub get` succeeds.  
Without the overrides: `flutter pub get` fails with the conflict above.

---

## References

- Consumer project where observed: saropa_kykto (Flutter app).
- Drift 2.32.0 changelog: migrates to sqlite3 3.x and analyzer ^10.
- saropa_lints 8.2.2: depends on analyzer ^9.0.0 (as of report date).
- dart_style 3.1.6+ supports analyzer 10 (3.1.3 does not).
