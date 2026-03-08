# Feature 06: Data Bookmarks & Saved Queries

**Effort:** S (Small) | **Priority:** 2

## Overview

Save, name, and organize frequently used SQL queries in a persistent library. Bookmarks persist in `localStorage` and can be exported/imported as JSON for sharing with team members. Enhances the existing SQL history (line 1678-1738, max 20 unnamed queries) with permanent, named entries.

**User value:** Never re-type common debug queries. Share query collections across the team via a JSON file in version control.

## Architecture

### Server-side (Dart)

No changes. Bookmarks are purely client-side, stored in `localStorage` following the existing pattern of `SQL_HISTORY_KEY` (line 1679) and `THEME_KEY` (line 1677).

### Client-side (JS)

Add bookmark management UI in the SQL runner section. Save/load/delete/export/import functions.

### VS Code Extension / Flutter

No changes.

### New Files

None.

## Implementation Details

### localStorage Schema

```javascript
const BOOKMARKS_KEY = "drift-viewer-bookmarks";

// Structure:
// [
//   { "name": "Active users", "sql": "SELECT ...", "createdAt": "2026-03-07T..." },
//   { "name": "Order totals", "sql": "SELECT ...", "createdAt": "2026-03-07T..." }
// ]
```

### UI HTML (in `sql-runner-collapsible`, after history dropdown ~line 1586)

```html
<div class="sql-toolbar" style="margin-top:0.25rem;">
  <select id="sql-bookmarks" title="Saved queries" style="max-width:12rem;">
    <option value="">-- Bookmarks --</option>
  </select>
  <button type="button" id="sql-bookmark-save" title="Save current query">
    Save
  </button>
  <button type="button" id="sql-bookmark-delete" title="Delete selected">
    Del
  </button>
  <button type="button" id="sql-bookmark-export" title="Export as JSON">
    Export
  </button>
  <button type="button" id="sql-bookmark-import" title="Import from JSON">
    Import
  </button>
</div>
```

### JS Implementation

```javascript
const BOOKMARKS_KEY = "drift-viewer-bookmarks";
let bookmarks = [];

function loadBookmarks() {
  try {
    bookmarks = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
  } catch (e) {
    bookmarks = [];
  }
}

function saveBookmarks() {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch (e) {
    /* quota exceeded — unlikely for text-only bookmarks */
  }
}

function refreshBookmarksDropdown() {
  const sel = document.getElementById("sql-bookmarks");
  sel.innerHTML =
    '<option value="">-- Bookmarks (' +
    bookmarks.length +
    ") --</option>" +
    bookmarks
      .map(
        (b, i) =>
          '<option value="' +
          i +
          '" title="' +
          esc(b.sql) +
          '">' +
          esc(b.name) +
          "</option>",
      )
      .join("");
}

// Save
document
  .getElementById("sql-bookmark-save")
  .addEventListener("click", function () {
    const sql = document.getElementById("sql-input").value.trim();
    if (!sql) return;
    const name = prompt("Bookmark name:", sql.slice(0, 40));
    if (!name) return;
    bookmarks.unshift({
      name: name,
      sql: sql,
      createdAt: new Date().toISOString(),
    });
    saveBookmarks();
    refreshBookmarksDropdown();
  });

// Load
document
  .getElementById("sql-bookmarks")
  .addEventListener("change", function () {
    const idx = parseInt(this.value, 10);
    if (!isNaN(idx) && bookmarks[idx]) {
      document.getElementById("sql-input").value = bookmarks[idx].sql;
    }
  });

// Delete
document
  .getElementById("sql-bookmark-delete")
  .addEventListener("click", function () {
    const sel = document.getElementById("sql-bookmarks");
    const idx = parseInt(sel.value, 10);
    if (isNaN(idx) || !bookmarks[idx]) return;
    if (!confirm('Delete bookmark "' + bookmarks[idx].name + '"?')) return;
    bookmarks.splice(idx, 1);
    saveBookmarks();
    refreshBookmarksDropdown();
  });

// Export
document
  .getElementById("sql-bookmark-export")
  .addEventListener("click", function () {
    if (bookmarks.length === 0) {
      alert("No bookmarks to export.");

      return;
    }
    const blob = new Blob([JSON.stringify(bookmarks, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drift-viewer-bookmarks.json";
    a.click();
    URL.revokeObjectURL(url);
  });

// Import
document
  .getElementById("sql-bookmark-import")
  .addEventListener("click", function () {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = function () {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error("Expected JSON array");
          let newCount = 0;
          imported.forEach((b) => {
            if (b.name && b.sql && !bookmarks.some((e) => e.sql === b.sql)) {
              bookmarks.push(b);
              newCount++;
            }
          });
          saveBookmarks();
          refreshBookmarksDropdown();
          alert(
            "Imported " +
              newCount +
              " new bookmark(s). " +
              (imported.length - newCount) +
              " duplicate(s) skipped.",
          );
        } catch (e) {
          alert("Invalid bookmark file: " + e.message);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });

// Initialize on page load
loadBookmarks();
refreshBookmarksDropdown();
```

## Effort Estimate

**S (Small)**

- Server: 0 lines
- Client: ~80 lines JS, ~10 lines HTML
- Pure client-side feature using existing `localStorage` patterns
- No new dependencies

## Dependencies & Risks

- **localStorage limit**: 5-10 MB. Bookmarks are text-only, so even 1000 bookmarks would use ~100 KB. Not a concern.
- **`prompt()` and `confirm()` dialogs**: Basic but functional for a debug tool. Could be replaced with inline UI later.
- **Import validation**: Malformed JSON or wrong structure is caught with try/catch and error message.
- **Deduplication**: Import skips bookmarks with identical SQL. Name collisions are allowed (different queries can have the same name).

## Testing Strategy

1. **Save/load cycle**: Save a bookmark, refresh the page, verify it persists in the dropdown
2. **Delete**: Save two bookmarks, delete one, verify the other remains
3. **Export**: Save bookmarks, click Export, verify downloaded JSON is valid
4. **Import**: Export bookmarks, clear localStorage, import the file, verify bookmarks restored
5. **Duplicate handling**: Import the same file twice — verify no duplicates added
6. **Edge cases**: Empty SQL (should be blocked), very long SQL names, special characters in names
7. **Cross-browser**: localStorage works the same in Chrome, Firefox, Edge
