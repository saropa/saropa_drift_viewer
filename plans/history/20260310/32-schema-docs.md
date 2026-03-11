# Feature 32: Schema Documentation Generator

## What It Does

Auto-generate beautiful documentation from the live database schema. Infers table descriptions from column names and FK relationships. Includes column type reference, constraint annotations, FK relationship map, and an embedded ER diagram. Export as self-contained HTML or Markdown.

## User Experience

1. Command palette → "Saropa Drift Advisor: Generate Schema Documentation"
2. Output format picker: HTML or Markdown
3. A documentation file is generated and opened:

### HTML Output (in browser)

```
╔═══════════════════════════════════════════════════════════╗
║  DATABASE SCHEMA DOCUMENTATION                            ║
║  Generated: 2026-03-10 10:42:31                          ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  ┌─ Overview ────────────────────────────────────────┐   ║
║  │  Tables: 8  │  Total rows: 52,389  │  FKs: 12    │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ┌─ ER Diagram ──────────────────────────────────────┐   ║
║  │  [Interactive SVG diagram]                         │   ║
║  └────────────────────────────────────────────────────┘   ║
║                                                           ║
║  ─────────────────────────────────────────────────────── ║
║                                                           ║
║  ## users                                                 ║
║  Stores user accounts with authentication and profile     ║
║  data.                                                    ║
║                                                           ║
║  | Column     | Type    | PK | Nullable | FK          |  ║
║  |------------|---------|:--:|:--------:|-------------|  ║
║  | id         | INTEGER | ✓  |          |             |  ║
║  | name       | TEXT    |    |          |             |  ║
║  | email      | TEXT    |    |          |             |  ║
║  | role_id    | INTEGER |    |          | → roles.id  |  ║
║  | created_at | TEXT    |    |          |             |  ║
║  | updated_at | TEXT    |    | ✓        |             |  ║
║  |                                                       ║
║  Referenced by: orders.user_id, sessions.user_id,        ║
║  audit_log.user_id                                       ║
║  Row count: 1,250                                        ║
║                                                           ║
║  ─────────────────────────────────────────────────────── ║
║                                                           ║
║  ## orders                                                ║
║  Stores purchase orders linked to users.                  ║
║  ...                                                      ║
╚═══════════════════════════════════════════════════════════╝
```

### Markdown Output

```markdown
# Database Schema Documentation

Generated: 2026-03-10 10:42:31 | Tables: 8 | Rows: 52,389 | FKs: 12

## Table of Contents

- [users](#users)
- [orders](#orders)
- [products](#products)
...

## users

> Stores user accounts with authentication and profile data.

| Column | Type | PK | Nullable | FK |
|---|---|---|---|---|
| id | INTEGER | ✓ | | |
| name | TEXT | | | |
| email | TEXT | | | |
| role_id | INTEGER | | | → roles.id |
...

**Referenced by:** orders.user_id, sessions.user_id
**Row count:** 1,250
```

## New Files

```
extension/src/
  schema-docs/
    schema-docs-command.ts     # Orchestrates data collection + rendering
    description-inferrer.ts    # Infers table/column descriptions from names + relationships
    docs-html-renderer.ts      # Renders HTML documentation
    docs-md-renderer.ts        # Renders Markdown documentation
extension/src/test/
  description-inferrer.test.ts
  docs-md-renderer.test.ts
```

## Dependencies

- `api-client.ts` — `schemaMetadata()`, `tableFkMeta()`, `schemaDiagram()`
- Reuses diagram SVG from existing Feature (ER diagram panel)

## Architecture

### Description Inferrer

Generates human-readable descriptions from column names and FK patterns:

```typescript
class DescriptionInferrer {
  inferTableDescription(
    table: TableMetadata,
    fks: IFkContext[],
    reverseFks: IFkContext[],
  ): string {
    const parts: string[] = [];

    // Verb based on FK pattern
    if (reverseFks.length > 3) {
      parts.push(`Core entity referenced by ${reverseFks.length} other tables.`);
    } else if (fks.length === 0 && reverseFks.length === 0) {
      parts.push('Standalone table with no foreign key relationships.');
    } else if (fks.length > 0 && reverseFks.length === 0) {
      parts.push(`Leaf table linked to ${[...new Set(fks.map(f => f.toTable))].join(', ')}.`);
    }

    // Content hints from column names
    const colNames = table.columns.map(c => c.name.toLowerCase());
    if (colNames.some(n => /email|password|auth|login/.test(n))) {
      parts.push('Contains authentication data.');
    }
    if (colNames.some(n => /price|total|amount|cost/.test(n))) {
      parts.push('Contains financial/pricing data.');
    }
    if (colNames.some(n => /created_at|updated_at|timestamp/.test(n))) {
      parts.push('Includes temporal tracking.');
    }
    if (colNames.some(n => /lat|lng|longitude|latitude|geo/.test(n))) {
      parts.push('Contains geolocation data.');
    }

    return parts.join(' ') || `Stores ${table.name.replace(/_/g, ' ')} data.`;
  }

  inferColumnDescription(col: ColumnMetadata, fk?: IFkContext): string {
    if (col.pk) return 'Primary key (auto-increment).';
    if (fk) return `Foreign key referencing ${fk.toTable}.${fk.toColumn}.`;

    const name = col.name.toLowerCase();
    if (/created_at|created_date/.test(name)) return 'Timestamp of record creation.';
    if (/updated_at|modified_at/.test(name)) return 'Timestamp of last modification.';
    if (/deleted_at/.test(name)) return 'Soft-delete timestamp (null = active).';
    if (/^is_|^has_|^can_/.test(name)) return 'Boolean flag.';
    if (/email/.test(name)) return 'Email address.';
    if (/phone/.test(name)) return 'Phone number.';
    if (/password|pwd/.test(name)) return 'Hashed password (never store plaintext).';

    return '';
  }
}
```

### HTML Renderer

```typescript
class DocsHtmlRenderer {
  render(data: ISchemaDocsData): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Schema Documentation</title>
  <style>${this._css()}</style>
</head>
<body>
  <header>
    <h1>Database Schema Documentation</h1>
    <p>Generated: ${esc(data.generatedAt)} | Tables: ${data.tables.length} | Rows: ${data.totalRows.toLocaleString()} | FKs: ${data.totalFks}</p>
  </header>

  <nav>
    <h2>Table of Contents</h2>
    <ul>
      ${data.tables.map(t => `<li><a href="#${t.name}">${esc(t.name)}</a> (${t.rowCount.toLocaleString()} rows)</li>`).join('\n')}
    </ul>
  </nav>

  ${data.diagramSvg ? `<section class="diagram"><h2>ER Diagram</h2>${data.diagramSvg}</section>` : ''}

  ${data.tables.map(t => this._renderTable(t)).join('\n<hr>\n')}

  <footer>
    <p>Generated by <a href="https://pub.dev/packages/saropa_drift_viewer">Saropa Drift Advisor</a></p>
  </footer>
</body>
</html>`;
  }

  private _renderTable(table: IDocTable): string {
    return `
<section id="${table.name}">
  <h2>${esc(table.name)}</h2>
  <p class="description">${esc(table.description)}</p>

  <table>
    <thead>
      <tr><th>Column</th><th>Type</th><th>PK</th><th>Nullable</th><th>FK</th><th>Description</th></tr>
    </thead>
    <tbody>
      ${table.columns.map(c => `
        <tr>
          <td><code>${esc(c.name)}</code></td>
          <td>${esc(c.type)}</td>
          <td>${c.pk ? '✓' : ''}</td>
          <td>${c.nullable ? '✓' : ''}</td>
          <td>${c.fk ? `→ ${esc(c.fk.toTable)}.${esc(c.fk.toColumn)}` : ''}</td>
          <td>${esc(c.description)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${table.referencedBy.length > 0 ? `<p><strong>Referenced by:</strong> ${table.referencedBy.map(r => `${esc(r.fromTable)}.${esc(r.fromColumn)}`).join(', ')}</p>` : ''}
  <p><strong>Row count:</strong> ${table.rowCount.toLocaleString()}</p>
</section>`;
  }
}
```

### Markdown Renderer

```typescript
class DocsMdRenderer {
  render(data: ISchemaDocsData): string {
    const lines: string[] = [
      '# Database Schema Documentation',
      '',
      `Generated: ${data.generatedAt} | Tables: ${data.tables.length} | Rows: ${data.totalRows.toLocaleString()} | FKs: ${data.totalFks}`,
      '',
      '## Table of Contents',
      '',
      ...data.tables.map(t => `- [${t.name}](#${t.name}) (${t.rowCount.toLocaleString()} rows)`),
      '',
    ];

    for (const table of data.tables) {
      lines.push(`## ${table.name}`, '');
      lines.push(`> ${table.description}`, '');
      lines.push('| Column | Type | PK | Nullable | FK | Description |');
      lines.push('|---|---|---|---|---|---|');

      for (const col of table.columns) {
        const pk = col.pk ? '✓' : '';
        const nullable = col.nullable ? '✓' : '';
        const fk = col.fk ? `→ ${col.fk.toTable}.${col.fk.toColumn}` : '';
        lines.push(`| ${col.name} | ${col.type} | ${pk} | ${nullable} | ${fk} | ${col.description} |`);
      }

      lines.push('');
      if (table.referencedBy.length > 0) {
        lines.push(`**Referenced by:** ${table.referencedBy.map(r => `${r.fromTable}.${r.fromColumn}`).join(', ')}`);
      }
      lines.push(`**Row count:** ${table.rowCount.toLocaleString()}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
```

## Server-Side Changes

None. Uses existing `schemaMetadata()`, `tableFkMeta()`, and optionally `schemaDiagram()`.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.generateSchemaDocs",
        "title": "Saropa Drift Advisor: Generate Schema Documentation",
        "icon": "$(book)"
      }
    ],
    "menus": {
      "view/title": [{
        "command": "driftViewer.generateSchemaDocs",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('driftViewer.generateSchemaDocs', async () => {
    const format = await vscode.window.showQuickPick(
      [
        { label: 'HTML', description: 'Self-contained web page', value: 'html' },
        { label: 'Markdown', description: 'Plain text, VCS-friendly', value: 'md' },
      ],
      { placeHolder: 'Output format' }
    );
    if (!format) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Generating documentation…' },
      async () => {
        const data = await collectSchemaDocsData(client);

        if (format.value === 'html') {
          const html = new DocsHtmlRenderer().render(data);
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file('schema-docs.html'),
            filters: { 'HTML': ['html'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(html, 'utf-8'));
            vscode.env.openExternal(uri);
          }
        } else {
          const md = new DocsMdRenderer().render(data);
          const doc = await vscode.workspace.openTextDocument({
            content: md,
            language: 'markdown',
          });
          await vscode.window.showTextDocument(doc);
        }
      }
    );
  })
);
```

## Testing

- `description-inferrer.test.ts`:
  - Table with many reverse FKs → "Core entity" description
  - Leaf table → mentions parent tables
  - Auth columns → "authentication data" mentioned
  - Financial columns → "pricing data" mentioned
  - Unknown table → fallback description from table name
  - Column descriptions: PK, FK, timestamps, booleans, email, phone
- `docs-md-renderer.test.ts`:
  - Output is valid Markdown
  - All tables appear in TOC
  - FK references render correctly
  - Empty database → minimal valid output
  - Special characters in table/column names are escaped

## Known Limitations

- Description inference is heuristic — may produce irrelevant descriptions for unusual schemas
- No support for user-provided descriptions (e.g., from comments in Dart source)
- ER diagram only included in HTML output (SVG doesn't embed in Markdown)
- Nullable detection may be inaccurate (SQLite's PRAGMA table_info reports schema-level nullable, not runtime)
- No versioning — documentation doesn't track changes over time
- Large schemas (50+ tables) produce very long documents
- Column descriptions are generic — no context from actual data values
- No index documentation (which columns are indexed)
