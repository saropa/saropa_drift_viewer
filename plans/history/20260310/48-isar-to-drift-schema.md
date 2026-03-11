# Feature 48: Isar-to-Drift Schema Generator

## What It Does

Parses Isar `@collection` classes from Dart source files or Isar JSON schema
exports, maps types to Drift column definitions, and generates Drift table
class `.dart` files. A webview panel lets users configure mapping options
(embedded strategy, enum strategy, list handling) and preview the output.

Part 1 of 2 — schema generation only. Data migration is a separate feature.

## Architecture

Extension-only (Tier 1). No server endpoints needed. Reads workspace files
via `vscode.workspace.fs.readFile`, parses in TypeScript, generates Dart.

## New Files

```
extension/src/isar-gen/
  isar-gen-types.ts       132 lines  Interfaces + webview message types
  isar-parser.ts          297 lines  Regex-based @collection parser
  isar-json-parser.ts     156 lines  Isar JSON schema parser
  isar-type-mapper.ts     298 lines  Isar → Drift type mapping
  isar-drift-codegen.ts   164 lines  Drift table class generator
  isar-gen-panel.ts       152 lines  Singleton webview panel
  isar-gen-html.ts        217 lines  Webview HTML template
  isar-gen-commands.ts     79 lines  registerIsarGenCommands()

extension/src/test/
  isar-parser.test.ts     288 lines
  isar-type-mapper.test.ts 265 lines
  isar-drift-codegen.test.ts 192 lines
  isar-json-parser.test.ts 120 lines
```

## Type Mapping

| Isar Type | Drift Column | Builder |
|---|---|---|
| Id | IntColumn | integer().autoIncrement() |
| String | TextColumn | text() |
| int | IntColumn | integer() |
| double | RealColumn | real() |
| bool | BoolColumn | boolean() |
| DateTime | DateTimeColumn | dateTime() |
| Uint8List | BlobColumn | blob() |
| List<T> | TextColumn | text() (JSON) |
| Enum (ordinal) | IntColumn | integer() |
| Enum (name) | TextColumn | text() |
| @embedded | TextColumn | text() (JSON) or flattened |
| IsarLink<T> | IntColumn | integer().nullable() (FK) |
| IsarLinks<T> | junction table | auto-generated |

## Key Decisions

1. `Id` → `integer().autoIncrement()` (Drift PK)
2. `List<T>` → JSON TEXT by default (toggle per field)
3. `IsarLinks<T>` → junction table `{source}_{property}`
4. `@embedded` → JSON TEXT by default (toggle to flatten)
5. `@Backlink` skipped (virtual in Isar)
6. No migration code generated
7. Enum strategy auto-detected from annotation

## Limitations

- Regex-based parsing (no AST)
- Single-level embedded flattening
- `byte`/`short`/`float` lose precision info
- Enum `EnumType.value` defaults to TextColumn with TODO
- JSON schema targets Isar v3.x/v4.x format
