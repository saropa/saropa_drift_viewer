# Feature 18: Natural Language to SQL

## What It Does

Type a plain-English question ("users who signed up this week with no orders") and get a SQL query generated from the live database schema. The schema context (tables, columns, types, foreign keys) is sent to an LLM, which returns valid SQL. Results display inline in the SQL Notebook.

## User Experience

1. Open the SQL Notebook (`Ctrl+Shift+Q`) or click "Ask in English" in the notebook toolbar
2. A text input appears with placeholder: "Describe what you want to query…"
3. Type: "show me users who have no orders"
4. Extension sends schema + question to the configured LLM provider
5. Generated SQL appears in a new notebook cell, pre-filled but not yet executed:
   ```sql
   SELECT u.* FROM "users" u
   LEFT JOIN "orders" o ON o.user_id = u.id
   WHERE o.id IS NULL;
   ```
6. User reviews, optionally edits, then executes with the existing Run button
7. Results render in the standard notebook results pane
8. Previous natural-language queries are saved in history (accessible via dropdown)

### Error / Edge Cases

- If the LLM returns invalid SQL, show the error inline with a "Retry" button
- If no API key is configured, show a setup prompt linking to extension settings
- Rate-limit indicator in the status bar during generation

## New Files

```
extension/src/
  nl-sql/
    nl-sql-provider.ts        # Orchestrates schema collection + LLM call + result injection
    schema-context-builder.ts  # Builds compact schema summary for the LLM prompt
    llm-client.ts              # HTTP client for LLM API (provider-agnostic)
    nl-sql-history.ts          # Persists past NL queries + generated SQL
extension/src/test/
  schema-context-builder.test.ts
  nl-sql-history.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()` for table/column/type info, `tableFkMeta()` for FK relationships
- `sql-notebook/` — inject generated SQL into a new notebook cell
- External: user-configured LLM API (OpenAI, Anthropic, Ollama, etc.)

## Architecture

### Schema Context Builder

Collects the live schema and formats it as a compact prompt:

```typescript
interface ISchemaContext {
  tables: ITableContext[];
  foreignKeys: IFkContext[];
}

interface ITableContext {
  name: string;
  columns: { name: string; type: string; pk: boolean }[];
  rowCount: number;
}

interface IFkContext {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

class SchemaContextBuilder {
  constructor(private readonly _client: DriftApiClient) {}

  async build(): Promise<string> {
    const meta = await this._client.schemaMetadata();
    const fks = await Promise.all(
      meta.tables.map(t => this._client.tableFkMeta(t.name))
    );

    // Format as compact DDL-like text (not full CREATE TABLE — saves tokens)
    // Example output:
    // users(id INTEGER PK, name TEXT, email TEXT, created_at TEXT) [1250 rows]
    // orders(id INTEGER PK, user_id INTEGER FK→users.id, total REAL) [3400 rows]
    return this._formatForLlm(meta, fks);
  }
}
```

### LLM Client

Provider-agnostic HTTP client. Supports OpenAI-compatible APIs (covers OpenAI, Anthropic via proxy, Ollama, LM Studio, etc.):

```typescript
interface ILlmConfig {
  apiUrl: string;       // e.g., "https://api.openai.com/v1/chat/completions"
  apiKey: string;       // from VS Code secret storage
  model: string;        // e.g., "gpt-4o-mini"
  maxTokens: number;    // default 500
}

class LlmClient {
  constructor(private readonly _config: ILlmConfig) {}

  async generateSql(schemaContext: string, question: string): Promise<string> {
    const systemPrompt = [
      'You are a SQL assistant for SQLite databases.',
      'Given the schema below, write a single SELECT query that answers the user\'s question.',
      'Return ONLY the SQL query, no explanation.',
      'Use double quotes for identifiers. Use single quotes for strings.',
      '',
      'Schema:',
      schemaContext,
    ].join('\n');

    const response = await fetch(this._config.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this._config.apiKey}`,
      },
      body: JSON.stringify({
        model: this._config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question },
        ],
        max_tokens: this._config.maxTokens,
        temperature: 0,
      }),
    });

    const json = await response.json();
    return this._extractSql(json.choices[0].message.content);
  }

  private _extractSql(text: string): string {
    // Strip markdown code fences if present
    const match = text.match(/```sql?\s*([\s\S]*?)```/);
    return (match ? match[1] : text).trim();
  }
}
```

### NL-SQL Provider

Orchestrates the full flow:

```typescript
class NlSqlProvider implements vscode.Disposable {
  constructor(
    private readonly _client: DriftApiClient,
    private readonly _contextBuilder: SchemaContextBuilder,
    private readonly _llmClient: LlmClient,
    private readonly _history: NlSqlHistory,
  ) {}

  async ask(question: string): Promise<string> {
    const schema = await this._contextBuilder.build();
    const sql = await this._llmClient.generateSql(schema, question);
    this._history.add(question, sql);
    return sql;
  }
}
```

### Query History

```typescript
interface INlSqlEntry {
  question: string;
  sql: string;
  timestamp: number;
}

class NlSqlHistory {
  private _entries: INlSqlEntry[] = [];

  constructor(private readonly _state: vscode.Memento) {
    this._entries = _state.get<INlSqlEntry[]>('nlSqlHistory', []);
  }

  add(question: string, sql: string): void {
    this._entries.unshift({ question, sql, timestamp: Date.now() });
    if (this._entries.length > 50) this._entries.length = 50;
    this._state.update('nlSqlHistory', this._entries);
  }

  get entries(): readonly INlSqlEntry[] { return this._entries; }
}
```

## Server-Side Changes

None. This feature is extension-only — it uses the existing `schemaMetadata()`, `tableFkMeta()`, and `sql()` endpoints.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.askNaturalLanguage",
        "title": "Saropa Drift Advisor: Ask in English",
        "icon": "$(comment-discussion)"
      },
      {
        "command": "driftViewer.nlSqlHistory",
        "title": "Saropa Drift Advisor: NL Query History"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.askNaturalLanguage",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    },
    "configuration": {
      "properties": {
        "driftViewer.nlSql.apiUrl": {
          "type": "string",
          "default": "https://api.openai.com/v1/chat/completions",
          "description": "LLM API endpoint (OpenAI-compatible)."
        },
        "driftViewer.nlSql.model": {
          "type": "string",
          "default": "gpt-4o-mini",
          "description": "LLM model to use for SQL generation."
        },
        "driftViewer.nlSql.maxTokens": {
          "type": "number",
          "default": 500,
          "description": "Maximum tokens for the LLM response."
        }
      }
    }
  }
}
```

API key is stored in `vscode.SecretStorage`, not in settings (never in plaintext).

## Wiring in extension.ts

```typescript
const schemaCtx = new SchemaContextBuilder(client);
const nlHistory = new NlSqlHistory(context.workspaceState);

// LLM client created lazily (needs config + secret)
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.askNaturalLanguage', async () => {
    const config = vscode.workspace.getConfiguration('driftViewer.nlSql');
    const apiKey = await context.secrets.get('driftViewer.nlSql.apiKey');
    if (!apiKey) {
      const set = await vscode.window.showWarningMessage(
        'No API key configured for NL-to-SQL.', 'Set API Key'
      );
      if (set) {
        const key = await vscode.window.showInputBox({ prompt: 'Enter API key', password: true });
        if (key) await context.secrets.store('driftViewer.nlSql.apiKey', key);
      }
      return;
    }

    const question = await vscode.window.showInputBox({
      prompt: 'Describe what you want to query…',
      placeHolder: 'e.g., users who signed up this week with no orders',
    });
    if (!question) return;

    const llm = new LlmClient({
      apiUrl: config.get('apiUrl', 'https://api.openai.com/v1/chat/completions'),
      apiKey,
      model: config.get('model', 'gpt-4o-mini'),
      maxTokens: config.get('maxTokens', 500),
    });

    const provider = new NlSqlProvider(client, schemaCtx, llm, nlHistory);
    const sql = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Generating SQL…' },
      () => provider.ask(question)
    );

    // Open as SQL document for review
    const doc = await vscode.workspace.openTextDocument({
      content: `-- Question: ${question}\n${sql}`,
      language: 'sql',
    });
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
  }),

  vscode.commands.registerCommand('driftViewer.nlSqlHistory', async () => {
    const pick = await vscode.window.showQuickPick(
      nlHistory.entries.map(e => ({ label: e.question, detail: e.sql, entry: e })),
      { placeHolder: 'Select a previous query' }
    );
    if (pick) {
      const doc = await vscode.workspace.openTextDocument({
        content: `-- Question: ${pick.entry.question}\n${pick.entry.sql}`,
        language: 'sql',
      });
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    }
  })
);
```

## Testing

- `schema-context-builder.test.ts`: test compact formatting, FK inclusion, empty schema edge case
- `nl-sql-history.test.ts`: test add, deduplication, max length cap, persistence round-trip
- LLM client is not unit-tested (external dependency) — integration test with a mock HTTP server if desired

## Known Limitations

- Requires an external LLM API key — no built-in model
- Quality depends on the LLM; small models may produce invalid SQL for complex schemas
- Schema context is sent to the LLM on every query (no caching of schema embedding)
- Only SELECT queries are generated — no INSERT/UPDATE/DELETE
- Large schemas (100+ tables) may exceed token limits — context builder should truncate
- No feedback loop: if the SQL is wrong, user must manually fix it (no "refine" step)
- API key stored in VS Code secret storage — not synced across machines
