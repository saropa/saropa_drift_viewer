# Feature 42: Data Annotations & Bookmarks

## What It Does

Pin notes and bookmarks to specific tables, columns, and rows. Add annotations like "This column is unused — candidate for removal" or "Row 42 is the test admin account." Annotations persist in workspace state and appear as decorations in the tree view and data panels. Export/import annotations as JSON for team sharing.

## User Experience

### Adding Annotations

1. Right-click any table, column, or row → "Add Annotation"
2. Type a note:

```
Add Annotation
──────────────
  Target: users.email (column)
  Icon:   [💡 Note ▾]   (Note, Warning, Bug, Star, Pin)
  Note:   [Must be unique but no UNIQUE constraint   ]

  [Cancel]  [Save]
```

### Viewing Annotations

Annotations appear as decorations throughout the UI:

```
DRIFT VIEWER — DATABASE EXPLORER
─────────────────────────────────
▼ users (1,250 rows) 📌 2 notes
│  id       INTEGER PK
│  name     TEXT
│  email    TEXT        💡 "Must be unique but no UNIQUE constraint"
│  age      INTEGER     ⚠ "Nullable — should be required"
│
▼ orders (3,400 rows)
│  id       INTEGER PK
│  user_id  INTEGER FK  ⭐ "Main join point for reports"
```

### Bookmarked Rows

```
╔══════════════════════════════════════════════════════════════╗
║  BOOKMARKS                                    [Export]       ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  ⭐ users #42 — "Test admin account"                        ║
║     name="Alice Admin", email="admin@test.com"               ║
║     [View] [Remove]                                          ║
║                                                              ║
║  🐛 orders #201 — "Triggers the null total bug"             ║
║     user_id=42, total=NULL, status="pending"                 ║
║     [View] [Remove]                                          ║
║                                                              ║
║  📌 sessions — "Token expiry logic is in auth_handler.dart" ║
║     [View Table] [Remove]                                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

## New Files

```
extension/src/
  annotations/
    annotation-store.ts        # CRUD for annotations in workspace state
    annotation-decorator.ts    # Tree view decoration provider
    annotation-panel.ts        # Bookmarks panel (webview)
    annotation-panel-html.ts   # HTML template
    annotation-types.ts        # Shared interfaces
extension/src/test/
  annotation-store.test.ts
  annotation-decorator.test.ts
```

## Dependencies

- `tree/drift-tree-provider.ts` — decoration integration
- `api-client.ts` — `sql()` for fetching bookmarked row previews

## Architecture

### Annotation Types

```typescript
type AnnotationIcon = 'note' | 'warning' | 'bug' | 'star' | 'pin';

type AnnotationTarget =
  | { kind: 'table'; table: string }
  | { kind: 'column'; table: string; column: string }
  | { kind: 'row'; table: string; pkColumn: string; pkValue: unknown };

interface IAnnotation {
  id: string;
  target: AnnotationTarget;
  icon: AnnotationIcon;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

interface IAnnotationExport {
  $schema: 'drift-annotations/v1';
  annotations: IAnnotation[];
}
```

### Annotation Store

```typescript
class AnnotationStore {
  private _annotations: IAnnotation[] = [];

  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly _state: vscode.Memento) {
    this._annotations = _state.get<IAnnotation[]>('annotations', []);
  }

  getAll(): readonly IAnnotation[] {
    return this._annotations;
  }

  getForTable(table: string): IAnnotation[] {
    return this._annotations.filter(a =>
      a.target.table === table
    );
  }

  getForColumn(table: string, column: string): IAnnotation[] {
    return this._annotations.filter(a =>
      a.target.kind === 'column' &&
      a.target.table === table &&
      a.target.column === column
    );
  }

  getForRow(table: string, pkValue: unknown): IAnnotation[] {
    return this._annotations.filter(a =>
      a.target.kind === 'row' &&
      a.target.table === table &&
      a.target.pkValue === pkValue
    );
  }

  add(annotation: IAnnotation): void {
    this._annotations.push(annotation);
    this._persist();
  }

  update(id: string, text: string): void {
    const ann = this._annotations.find(a => a.id === id);
    if (ann) {
      ann.text = text;
      ann.updatedAt = new Date().toISOString();
      this._persist();
    }
  }

  remove(id: string): void {
    this._annotations = this._annotations.filter(a => a.id !== id);
    this._persist();
  }

  exportAll(): string {
    return JSON.stringify(
      { $schema: 'drift-annotations/v1', annotations: this._annotations },
      null, 2
    );
  }

  importFrom(json: string): number {
    const data = JSON.parse(json) as IAnnotationExport;
    const existingIds = new Set(this._annotations.map(a => a.id));
    let added = 0;
    for (const ann of data.annotations) {
      if (!existingIds.has(ann.id)) {
        this._annotations.push(ann);
        added++;
      }
    }
    this._persist();
    return added;
  }

  private _persist(): void {
    this._state.update('annotations', this._annotations);
    this._onDidChange.fire();
  }
}
```

### Tree View Decoration

```typescript
const ICON_MAP: Record<AnnotationIcon, string> = {
  note: '💡',
  warning: '⚠',
  bug: '🐛',
  star: '⭐',
  pin: '📌',
};

class AnnotationDecorator implements vscode.FileDecorationProvider {
  constructor(private readonly _store: AnnotationStore) {}

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    // Tree item URIs encode table/column identity
    // e.g., drift://table/users or drift://column/users/email
    const annotations = this._getAnnotationsForUri(uri);
    if (annotations.length === 0) return undefined;

    const first = annotations[0];
    return {
      badge: String(annotations.length),
      tooltip: `${ICON_MAP[first.icon]} ${first.text}`,
    };
  }
}
```

### Webview Message Protocol

Webview → Extension:
```typescript
{ command: 'removeAnnotation', id: string }
{ command: 'editAnnotation', id: string, text: string }
{ command: 'viewRow', table: string, pkColumn: string, pkValue: unknown }
{ command: 'viewTable', table: string }
{ command: 'exportAll' }
{ command: 'importFile' }
```

Extension → Webview:
```typescript
{ command: 'init', annotations: IAnnotation[], rowPreviews: Record<string, Record<string, unknown>> }
{ command: 'updated', annotations: IAnnotation[] }
```

## Server-Side Changes

None.

## package.json Contributions

```jsonc
{
  "contributes": {
    "commands": [
      {
        "command": "driftViewer.addAnnotation",
        "title": "Saropa Drift Advisor: Add Annotation",
        "icon": "$(note)"
      },
      {
        "command": "driftViewer.showBookmarks",
        "title": "Saropa Drift Advisor: Show Bookmarks",
        "icon": "$(bookmark)"
      },
      {
        "command": "driftViewer.exportAnnotations",
        "title": "Saropa Drift Advisor: Export Annotations"
      },
      {
        "command": "driftViewer.importAnnotations",
        "title": "Saropa Drift Advisor: Import Annotations"
      }
    ],
    "menus": {
      "view/item/context": [
        {
          "command": "driftViewer.addAnnotation",
          "when": "viewItem =~ /driftTable|driftColumn|driftRow/",
          "group": "7_annotations"
        }
      ],
      "view/title": [{
        "command": "driftViewer.showBookmarks",
        "when": "view == driftViewer.databaseExplorer && driftViewer.serverConnected",
        "group": "navigation"
      }]
    }
  }
}
```

## Wiring in extension.ts

```typescript
const annotationStore = new AnnotationStore(context.workspaceState);
const annotationDecorator = new AnnotationDecorator(annotationStore);

context.subscriptions.push(
  vscode.window.registerFileDecorationProvider(annotationDecorator),

  vscode.commands.registerCommand('driftViewer.addAnnotation', async (item?: TreeItem) => {
    const target = resolveAnnotationTarget(item);
    if (!target) return;

    const iconPick = await vscode.window.showQuickPick([
      { label: '💡 Note', value: 'note' as const },
      { label: '⚠ Warning', value: 'warning' as const },
      { label: '🐛 Bug', value: 'bug' as const },
      { label: '⭐ Star', value: 'star' as const },
      { label: '📌 Pin', value: 'pin' as const },
    ], { placeHolder: 'Annotation type' });
    if (!iconPick) return;

    const text = await vscode.window.showInputBox({ prompt: 'Annotation text' });
    if (!text) return;

    annotationStore.add({
      id: crypto.randomUUID(),
      target,
      icon: iconPick.value,
      text,
      createdAt: new Date().toISOString(),
    });

    treeProvider.refresh();
  }),

  vscode.commands.registerCommand('driftViewer.showBookmarks', () => {
    AnnotationPanel.createOrShow(context.extensionUri, annotationStore, client);
  }),
);
```

## Testing

- `annotation-store.test.ts`:
  - Add and retrieve annotation
  - Filter by table, column, row
  - Update text and timestamp
  - Remove by ID
  - Export produces valid JSON with `$schema`
  - Import adds only new (no duplicates)
  - `onDidChange` fires on add/update/remove
- `annotation-decorator.test.ts`:
  - Returns decoration for annotated table
  - Returns undefined for unannotated items
  - Badge shows annotation count
  - Tooltip shows first annotation text

## Known Limitations

- Annotations stored in workspace state — not synced across machines
- Row bookmarks reference PK values — if a row is deleted, the bookmark becomes stale
- No automatic cleanup of stale bookmarks (rows that no longer exist)
- File decoration provider has limited styling options (badge + tooltip only)
- No rich text in annotations — plain text only
- No annotation search or filtering in the bookmarks panel
- Maximum ~100 annotations before tree view performance may degrade
- Import doesn't merge conflicting annotations for the same target
