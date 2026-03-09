# Claude Code Best Practices — saropa_drift_viewer

A practical guide to configuring Claude Code for this project: a Dart/Flutter debug HTTP server with embedded web UI and VS Code extension.

**Status:** Implemented. All files referenced below exist in the repo.

## Hooks API Note

Claude Code hooks receive **JSON on stdin** (not environment variables). Parse with:
```bash
INPUT=$(cat)
VALUE=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('key',''))")
```

Signaling: **exit 0** = allow (stderr shown as warning), **exit 2** = block.
This project uses `python3` for JSON parsing (`jq` is not available on this machine).

---

## 1. CLAUDE.md — The Foundation

See `CLAUDE.md` in the project root.

### Content (for reference)

```markdown
## Project Overview

saropa_drift_viewer is a debug-only HTTP server that exposes SQLite/Drift table
data as JSON and a minimal web viewer.  Two deliverables ship from this repo:

1. **Dart package** (pub.dev) — the server + Flutter overlay widget
2. **VS Code extension** (Marketplace / Open VSX) — tree view, CodeLens, definition provider

No direct Drift dependency — DB access is via an injected `DriftDebugQuery` callback.

## Key Files & Structure

| Path | Purpose |
|------|---------|
| `lib/saropa_drift_viewer.dart` | Public API (non-Flutter): server, logger, start helper |
| `lib/flutter.dart` | Public API (Flutter): adds overlay + floating button |
| `lib/src/drift_debug_server_io.dart` | VM HTTP server (singleton, dart:io) |
| `lib/src/server/router.dart` | Request dispatcher → handlers |
| `lib/src/server/html_content.dart` | Inline HTML/CSS/JS web UI (~2700 lines, treat as generated) |
| `lib/src/server/*.dart` | One handler per concern (auth, table, sql, schema, …) |
| `extension/src/extension.ts` | VS Code extension entry point |
| `extension/src/api-client.ts` | HTTP client for debug server |
| `scripts/publish.py` | Dart package publish pipeline (13 steps) |
| `scripts/publish_extension.py` | Extension publish pipeline (15 steps) |

## Commands

| Task | Command |
|------|---------|
| Install (Dart) | `flutter pub get` |
| Install (Extension) | `cd extension && npm install` |
| Analyze | `flutter analyze --fatal-infos` |
| Format check | `dart format --set-exit-if-changed .` |
| Test (Dart) | `flutter test` |
| Test (Extension) | `cd extension && npm test` |
| Compile (Extension) | `cd extension && npm run compile` |
| Publish dry-run | `dart pub publish --dry-run` |

## Workflow

1. Make changes in `lib/src/` (Dart) or `extension/src/` (TypeScript)
2. Run `flutter analyze --fatal-infos` — must pass with zero issues
3. Run `dart format --set-exit-if-changed .` — must pass
4. Run `flutter test` — must pass
5. If extension changed: `cd extension && npm run compile && npm test`
6. Commit atomically (one concern per commit)

## Design Principles

- **No Drift dependency.** All DB access via `DriftDebugQuery` callback (duck-typing).
- **Debug-only.** This package should never run in release builds.
- **Platform-conditional exports.** `drift_debug_server.dart` conditionally exports IO vs stub.
- **No-throw callbacks.** Error logger wraps callbacks in try/catch — logging must never crash the app.
- **Strict analysis.** strict-casts, strict-inference, strict-raw-types all enabled.
- **saropa_lints.** 859 rules at recommended tier. Run `dart run custom_lint` for custom lint checks.

## Key Patterns

- Handler files in `server/` return `Future<Response>` and take `(ServerContext, HttpRequest)`.
- Barrel exports in `lib/saropa_drift_viewer.dart` and `lib/flutter.dart` — don't add internal files.
- `html_content.dart` is effectively generated — avoid manual edits; use the web UI build process.
- Extension uses shared services pattern: `DriftApiClient`, `GenerationWatcher`, `DriftTreeProvider`.
- Version tags: `v{x.y.z}` for Dart package, `ext-v{x.y.z}` for extension.

## Quality Standards

- All CI checks must pass before merging: analyze, format, test.
- No `print()` in library code — use `developer.log()` via `DriftDebugErrorLogger`.
- Preserve `return await` for async stack traces (not `unnecessary_await_in_return`).
- Keep handler files focused: one HTTP concern per file.
```

---

## 2. Rules (`.claude/rules/`) — Scoped Instructions

### `global.md` — All files

```markdown
# Global Rules

## Code Simplicity
- Functions ≤ 40 lines (Dart handlers may need more; prefer extracting helpers).
- Parameters ≤ 5 per function.
- Nesting ≤ 3 levels deep.
- Files ≤ 400 lines (exception: html_content.dart, analysis_options*.yaml).

## Error Handling
- Library code: no bare `print()`. Use `developer.log()` or `DriftDebugErrorLogger`.
- Callbacks passed to the server must be wrapped in try/catch (no-throw pattern).
- Validate at system boundaries (HTTP requests, user input). Trust internal code.

## Commit Hygiene
- Atomic commits: one logical change. No "and" in the message.
- OK: ≤ 5 files, ≤ 200 lines changed.
- WARN: 6–10 files, 201–400 lines.
- STOP: > 10 files, > 400 lines — commit now, continue separately.
- Version bumps and CHANGELOG updates are part of the publish script, not manual commits.

## Dependencies
- Do NOT add a direct dependency on `drift` or `sqlite3`. The duck-typing pattern is intentional.
- Justify any new dependency — prefer `dart:` / `flutter:` stdlib where possible.
```

### `dart.md` — Applies to `lib/**/*.dart`, `test/**/*.dart`

```markdown
# Dart Rules

## Style
- Follow existing patterns in the codebase before inventing new ones.
- Use `///` doc comments on all public APIs. Internal code needs comments only when non-obvious.
- Prefer `final` for local variables. Use `const` for compile-time constants.
- Type all public API signatures explicitly. Rely on inference for locals.

## Analysis
- All code must pass `flutter analyze --fatal-infos` with zero issues.
- All code must pass `dart format` with no changes.
- saropa_lints (recommended tier) is active — respect its diagnostics.
- strict-casts, strict-inference, strict-raw-types are all enabled.

## Platform Safety
- Never import `dart:io` directly in cross-platform code. Use conditional exports.
- `drift_debug_server.dart` handles platform selection — don't bypass it.

## Server Handlers
- Each handler file in `lib/src/server/` owns one HTTP concern.
- Handlers receive `ServerContext` + request data, return `Response`.
- Don't add cross-cutting concerns (auth, CORS) inside individual handlers — those go in the router.

## Testing
- Test files go in `test/` with `_test.dart` suffix.
- Use parameterized tests for edge cases.
- Mock at the callback boundary (`DriftDebugQuery`), not at HTTP level.
```

### `typescript.md` — Applies to `extension/**/*.ts`

```markdown
# TypeScript / VS Code Extension Rules

## Style
- Interfaces use `I` prefix (e.g., `IDriftApiClient`).
- One provider/feature per file. Keep extension.ts as a thin wiring layer.
- Use `DriftApiClient` for all HTTP calls to the debug server.

## Build
- Must compile cleanly: `npm run compile` (tsc with strict mode).
- Tests run via `npm test` (mocha + sinon).
- File limit: 300 lines per file (publish script enforces this).

## Live Refresh
- `GenerationWatcher` polls `/api/generation` — don't add parallel polling.
- Providers subscribe to `onDidChange` events, not direct HTTP calls.

## Testing
- Mock VS Code API using `vscode-mock.ts`.
- Use sinon for stubs/spies.
- Test files: `extension/src/test/*.test.ts`.
```

---

## 3. Commands (`.claude/commands/`) — Slash Command Shortcuts

### `/commit` — `commit.md`

````markdown
# /commit — Quality-gated commit

## Pre-computed context
```bash
git status
git diff --cached --stat
git diff --stat
git log --oneline -5
```

## Instructions
1. Run `flutter analyze --fatal-infos`. If it fails, fix issues first.
2. Run `dart format --set-exit-if-changed .`. If it fails, run `dart format .` and re-stage.
3. Run `flutter test`. If tests fail, fix them.
4. If extension files changed, run `cd extension && npm run compile && npm test`.
5. Review staged changes. Ensure the diff is atomic (one logical change).
6. Check commit size: ≤ 5 files / ≤ 200 lines is OK. Warn if larger.
7. Write a conventional commit message: `type(scope): description`
   - Types: feat, fix, refactor, test, docs, chore
   - Scopes: server, extension, ui, build, deps
8. Do NOT bump version or update CHANGELOG — the publish script handles that.
````

### `/check` — `check.md`

````markdown
# /check — Full quality gate

## Pre-computed context
```bash
git status
flutter --version
node --version 2>/dev/null
```

## Instructions
Run all checks in order. Stop and report at first failure:

1. `flutter pub get`
2. `dart format --set-exit-if-changed .`
3. `flutter analyze --fatal-infos`
4. `flutter test`
5. If extension/ has changes: `cd extension && npm install && npm run compile && npm test`
6. `dart pub publish --dry-run`

Report results as a table:

| Check | Status |
|-------|--------|
| Format | ✓/✗ |
| Analyze | ✓/✗ |
| Test (Dart) | ✓/✗ |
| Compile (Extension) | ✓/✗/skipped |
| Test (Extension) | ✓/✗/skipped |
| Publish dry-run | ✓/✗ |
````

### `/test` — `test.md`

````markdown
# /test — Run tests with auto-fix

## Pre-computed context
```bash
flutter test 2>&1 | tail -50
```

## Instructions
1. Run `flutter test`. Capture output.
2. If tests fail, analyze the failure output.
3. Fix the failing tests or the code they test.
4. Re-run `flutter test` to confirm.
5. If extension tests are relevant, also run `cd extension && npm test`.
6. Report which tests failed, what was fixed, and final pass/fail status.
````

---

## 4. Hooks (`.claude/hooks/`) — Automated Guardrails

All hooks are bash scripts. They receive **JSON on stdin** and use `python3` for parsing
(no `jq` on this machine). Exit 0 = allow, exit 2 = block. Warnings go to stderr.

See the actual implementations in `.claude/hooks/`. Key behaviors:

| Hook | Event | Trigger | Action |
|------|-------|---------|--------|
| `block-fluff.sh` | UserPromptSubmit | Filler messages ("thanks", "cool") | Block (exit 2) |
| `cost-awareness.sh` | UserPromptSubmit | >1000 transcript lines | Warn; >2000 = block |
| `guard-expensive.sh` | PreToolUse (Bash) | Publish/force-push/rm-rf | Block publish; warn destructive |
| `guard-large-write.sh` | PreToolUse (Write) | >300 lines written | Warn; >1000 = block |
| `post-analyze.sh` | PostToolUse (Write\|Edit) | .dart file edited | Run `flutter analyze` |
| `stop-quality-gate.sh` | Stop | Dart/TS files changed | Block if format/analyze/test fail |

### JSON Parsing Pattern (all hooks)

```bash
INPUT=$(cat)
VALUE=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('prompt',''))")
```

Available fields by event type:
- **UserPromptSubmit**: `$.prompt`, `$.transcript_path`, `$.session_id`
- **PreToolUse**: `$.tool_name`, `$.tool_input.command`, `$.tool_input.file_path`, `$.tool_input.content`
- **PostToolUse**: `$.tool_name`, `$.tool_input.file_path`, `$.tool_response`
- **Stop**: `$.last_assistant_message`, `$.stop_hook_active`

---

## 5. Agents (`.claude/agents/`) — Specialized Subagents

### `self-reviewer.md` — Post-change quality check

```markdown
Review the changes made in this session. Check:

1. **Hard limits**: Any function > 40 lines? Any file > 400 lines (except html_content.dart)?
   Parameters > 5? Nesting > 3 levels?

2. **Dart conventions**: strict analysis clean? No bare print()? No direct dart:io imports
   in cross-platform code? Doc comments on public APIs?

3. **Server pattern**: Handlers take (ServerContext, request), return Response?
   No cross-cutting concerns leaked into handlers?

4. **Extension pattern**: Under 300 lines per .ts file? Providers use GenerationWatcher
   events (not direct polling)? DriftApiClient used for HTTP?

5. **No scope creep**: Were only the requested changes made? Any unnecessary refactoring,
   extra features, or unrelated cleanups?

Report findings as:
- PASS: [what's good]
- WARN: [minor issues]
- FAIL: [must-fix before commit]
```

---

## 6. Settings (`.claude/settings.json`)

See `.claude/settings.json` for the implemented configuration. Key design decisions:

- **Wildcard permissions** (`flutter analyze:*`) replace 25+ ad-hoc one-off grants
- **Hook wiring** uses correct nested structure with matchers and timeouts
- **Paths** use `$CLAUDE_PROJECT_DIR` for portability
- **`settings.local.json`** keeps machine-specific overrides (not committed)

---

## 7. Communication Rules

Implemented in the `## Communication` section of `CLAUDE.md`.

---

## 8. Research Discipline

Implemented in the `## Research Discipline` section of `CLAUDE.md`.

Key context-saving rules:
- `html_content.dart` is ~2700 lines — never read unless working on the web UI
- `analysis_options.yaml` is huge — grep for specific rules, don't read whole file
- Server handlers are self-contained — read only the relevant one

---

## 9. What This Configuration Prevents

| Problem | Solution | Priority |
|---------|----------|----------|
| Broken builds at "done" | Stop hook quality gate | **High** |
| Analysis errors discovered late | Post-edit auto-analyze | **High** |
| Accidental publish/force push | Expensive command guard | **High** |
| Context blown on html_content.dart | Research discipline + large read guard | **High** |
| Sprawling multi-concern commits | Commit size thresholds | Medium |
| Token waste on filler | Fluff blocker hook | Medium |
| Giant file writes | Large write guard (300-line .ts limit) | Medium |
| Sycophantic over-correction | Communication rules | Medium |
| Runaway session costs | Cost awareness hook | Low |

---

## 10. Tailored File Structure

```
saropa_drift_viewer/
  CLAUDE.md                              # Project context
  .claude/
    settings.json                        # Permissions + hook wiring
    settings.local.json                  # Machine-specific (keep as-is)
    rules/
      global.md                          # Code limits, commit hygiene
      dart.md                            # Dart/Flutter conventions
      typescript.md                      # Extension conventions
    commands/
      commit.md                          # /commit — quality-gated commit
      check.md                           # /check — full quality gate
      test.md                            # /test — test with auto-fix
    agents/
      self-reviewer.md                   # Post-change quality review
    hooks/
      block-fluff.sh                     # Reject filler messages
      cost-awareness.sh                  # Context size warnings
      guard-expensive.sh                 # Dangerous command confirmation
      guard-large-write.sh              # Write size limits
      post-analyze.sh                    # Auto-analyze after Dart edits
      stop-quality-gate.sh              # Must-pass before stopping
```

---

## 11. Implementation Status

All items implemented. To tune or disable specific hooks, edit `.claude/settings.json`
and remove or comment out the relevant hook entry.
