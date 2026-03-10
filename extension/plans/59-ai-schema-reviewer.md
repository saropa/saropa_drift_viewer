# Feature 59: AI Schema Reviewer

## What It Does

Send the entire database schema to an LLM and receive a structured review: normalization issues, naming inconsistencies, missing indexes, anti-patterns, redundant columns, and suggested improvements — each with generated migration Dart code to fix it. Like a senior DBA code-reviewing your schema.

## User Experience

1. Command palette → "Drift Viewer: Review Schema with AI"
2. Extension collects schema metadata + FK relationships + index info
3. Sends to LLM via VS Code's Language Model API (Copilot Chat)
4. Results displayed in a webview report panel

```
╔══════════════════════════════════════════════════════════════╗
║  AI SCHEMA REVIEW                                            ║
║  Analyzed 12 tables, 67 columns, 8 FKs                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ⚠ NORMALIZATION                                    Score: B ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ orders.customer_name duplicates users.name            │   ║
║  │ → Remove column, JOIN to users instead                │   ║
║  │ [Copy Migration Code]                                 │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  ⚠ NAMING INCONSISTENCY                            Score: C ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ Mixed naming: user_id (snake), userId (camel),        │   ║
║  │ UserID (pascal) across tables                         │   ║
║  │ → Standardize to snake_case                           │   ║
║  │ [Copy Migration Code]                                 │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  ✓ MISSING INDEXES                                  Score: A ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ orders.user_id is an FK without an index              │   ║
║  │ → CREATE INDEX idx_orders_user_id ON orders(user_id)  │   ║
║  │ [Copy SQL] [Copy Migration Code]                      │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  ✓ ANTI-PATTERNS                                    Score: A ║
║  ┌──────────────────────────────────────────────────────┐   ║
║  │ No issues found.                                      │   ║
║  └──────────────────────────────────────────────────────┘   ║
║                                                              ║
║  Overall: B+  │  [Export Report] [Re-analyze]                ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/ai-review/
  ai-schema-reviewer.ts      # Schema collection + LLM prompt + response parsing
  ai-review-panel.ts         # Webview panel lifecycle
  ai-review-html.ts          # HTML template
  ai-review-types.ts         # Interfaces
extension/src/test/
  ai-schema-reviewer.test.ts
```

## Modified Files

```
extension/src/extension.ts    # Register command
extension/package.json         # Command
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `indexSuggestions()`
- `vscode.lm` — VS Code Language Model API (Copilot Chat integration)
- Requires user to have a Copilot subscription or compatible LM extension

## Architecture

### Schema Collection

Gathers all schema information into a single prompt-ready structure:

```typescript
interface ISchemaSnapshot {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; pk: boolean; nullable: boolean }>;
    foreignKeys: Array<{ from: string; toTable: string; toColumn: string }>;
    rowCount: number;
    indexes: string[];
  }>;
  createStatements: string;  // From schema dump
}

async function collectSchema(client: DriftApiClient): Promise<ISchemaSnapshot> {
  const meta = await client.schemaMetadata();
  const dump = await client.schemaDump();
  const tables = await Promise.all(
    meta.filter(t => !t.name.startsWith('sqlite_')).map(async table => {
      const fks = await client.tableFkMeta(table.name);
      return {
        name: table.name,
        columns: table.columns,
        foreignKeys: fks,
        rowCount: table.rowCount,
        indexes: [],  // Extracted from dump
      };
    })
  );
  return { tables, createStatements: dump };
}
```

### LLM Integration

Uses VS Code's Language Model API for provider-agnostic LLM access:

```typescript
async function reviewSchema(schema: ISchemaSnapshot): Promise<IReviewResult> {
  const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
  if (models.length === 0) {
    // Fallback: try any available model
    const fallback = await vscode.lm.selectChatModels({});
    if (fallback.length === 0) {
      throw new Error('No language model available. Install GitHub Copilot or a compatible extension.');
    }
  }

  const model = models[0];
  const prompt = buildReviewPrompt(schema);

  const response = await model.sendRequest(
    [vscode.LanguageModelChatMessage.User(prompt)],
    {},
    new vscode.CancellationTokenSource().token,
  );

  let text = '';
  for await (const chunk of response.text) {
    text += chunk;
  }

  return parseReviewResponse(text);
}
```

### Prompt Construction

```typescript
function buildReviewPrompt(schema: ISchemaSnapshot): string {
  return `You are a senior database architect reviewing a SQLite schema used with the Drift ORM in a Flutter/Dart application.

Analyze this schema and provide findings in these categories:
1. NORMALIZATION — duplicated data, denormalization issues
2. NAMING — inconsistent naming conventions across tables/columns
3. MISSING_INDEXES — FK columns or frequently-filtered columns without indexes
4. ANTI_PATTERNS — EAV tables, polymorphic associations, god tables, stringly-typed columns
5. REDUNDANCY — columns that duplicate information available via JOINs
6. TYPE_SAFETY — columns using TEXT where INTEGER/REAL would be more appropriate

For each finding, provide:
- category: one of the above
- severity: "error" | "warning" | "info"
- table: affected table name
- column: affected column name (if applicable)
- description: one sentence explaining the issue
- suggestion: one sentence fix
- migrationSql: the SQL ALTER/CREATE statement to fix it
- migrationDart: Drift migration Dart code (MigrationStrategy.onUpgrade format)

Also provide an overall letter grade (A through F) per category and overall.

Respond in JSON format:
{
  "overall": "B+",
  "categories": { "NORMALIZATION": "B", ... },
  "findings": [ { category, severity, table, column, description, suggestion, migrationSql, migrationDart } ]
}

Here is the schema:

${schema.createStatements}

Table statistics:
${schema.tables.map(t => `${t.name}: ${t.rowCount} rows, ${t.columns.length} columns, ${t.foreignKeys.length} FKs`).join('\n')}`;
}
```

### Response Parsing

```typescript
interface IReviewFinding {
  category: string;
  severity: 'error' | 'warning' | 'info';
  table: string;
  column?: string;
  description: string;
  suggestion: string;
  migrationSql: string;
  migrationDart: string;
}

interface IReviewResult {
  overall: string;
  categories: Record<string, string>;
  findings: IReviewFinding[];
}

function parseReviewResponse(text: string): IReviewResult {
  // Extract JSON from response (may be wrapped in markdown code block)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse LLM response');

  const json = JSON.parse(jsonMatch[1] ?? jsonMatch[0]);
  return {
    overall: json.overall ?? 'N/A',
    categories: json.categories ?? {},
    findings: (json.findings ?? []).map(validateFinding),
  };
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'reanalyze' }
{ command: 'copyMigrationSql', index: number }
{ command: 'copyMigrationDart', index: number }
{ command: 'exportReport' }
```

Extension → Webview:
```typescript
{ command: 'reviewing', tableCount: number }
{ command: 'results', result: IReviewResult }
{ command: 'error', message: string }
```

## Server-Side Changes

None. Uses existing schema and metadata endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.aiSchemaReview",
        "title": "Drift Viewer: Review Schema with AI",
        "icon": "$(sparkle)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.aiSchemaReview",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Testing

- `ai-schema-reviewer.test.ts`:
  - Schema collection gathers all tables, columns, FKs, row counts
  - Prompt includes CREATE TABLE statements and statistics
  - JSON response parsed correctly into `IReviewResult`
  - Markdown-wrapped JSON (```json ... ```) extracted correctly
  - Invalid JSON → meaningful error message
  - Empty findings array → "no issues" display
  - Each finding has required fields validated
  - Migration SQL and Dart code copied to clipboard correctly
  - No LLM available → clear error message with install instructions
  - `sqlite_` internal tables excluded from schema collection

## Known Limitations

- Requires a Language Model extension (GitHub Copilot or compatible) — no built-in LLM
- LLM responses are non-deterministic — same schema may get different reviews
- Generated migration code is suggestions, not validated — may need manual adjustment
- Large schemas (50+ tables) may exceed model context window — truncation needed
- Review takes 5-15 seconds depending on model and schema size
- No caching — re-analyze always calls the LLM again
- LLM may hallucinate issues that don't exist — findings should be reviewed by the user
