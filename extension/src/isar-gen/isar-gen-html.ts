/**
 * HTML template for the Isar-to-Drift Schema Generator webview.
 */

import type {
  IIsarCollection,
  IIsarEmbedded,
  IIsarGenConfig,
  IIsarMappingResult,
} from './isar-gen-types';

function esc(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSourceSummary(
  collections: IIsarCollection[],
  embeddeds: IIsarEmbedded[],
): string {
  const items = collections
    .map((c) => `<li>${esc(c.className)} (${esc(c.fileUri)}:${c.line})</li>`)
    .join('\n');
  const embItems = embeddeds.length > 0
    ? `<p>Embedded Objects: ${embeddeds.length}</p><ul>`
      + embeddeds.map((e) => `<li>${esc(e.className)}</li>`).join('')
      + '</ul>'
    : '';
  return `<h3>Source: ${collections.length} collection(s)</h3>
<ul>${items}</ul>${embItems}`;
}

function renderOptions(config: IIsarGenConfig): string {
  const embJson = config.embeddedStrategy === 'json' ? ' checked' : '';
  const embFlat = config.embeddedStrategy === 'flatten' ? ' checked' : '';
  const enumAuto = config.enumStrategy === 'auto' ? ' checked' : '';
  const enumInt = config.enumStrategy === 'integer' ? ' checked' : '';
  const enumText = config.enumStrategy === 'text' ? ' checked' : '';
  const idxChecked = config.includeIndexes ? ' checked' : '';
  const cmnChecked = config.includeComments ? ' checked' : '';

  return `<h3>Options</h3>
<div class="option-group">
  <label>Embedded strategy:</label>
  <label><input type="radio" name="embedded" value="json"${embJson}>
    JSON serialize</label>
  <label><input type="radio" name="embedded" value="flatten"${embFlat}>
    Flatten columns</label>
</div>
<div class="option-group">
  <label>Enum strategy:</label>
  <label><input type="radio" name="enum" value="auto"${enumAuto}>
    Auto-detect</label>
  <label><input type="radio" name="enum" value="integer"${enumInt}>
    Force integer</label>
  <label><input type="radio" name="enum" value="text"${enumText}>
    Force text</label>
</div>
<div class="option-group">
  <label><input type="checkbox" name="indexes"${idxChecked}>
    Include indexes</label>
  <label><input type="checkbox" name="comments"${cmnChecked}>
    Include comments</label>
</div>`;
}

function renderTableBlock(
  t: IIsarMappingResult['tables'][0],
  prefix?: string,
): string {
  const cols = t.columns
    .map((c) => `  <tr><td>${esc(c.getterName)}</td>`
      + `<td>${esc(c.columnType)}</td>`
      + `<td>${esc(c.comment ?? '')}</td></tr>`)
    .join('\n');
  const label = prefix
    ? `${prefix}: ${esc(t.tableName ?? t.className)}`
    : esc(t.className);
  return `<h4>${label}</h4>
<table><thead><tr><th>Column</th><th>Type</th><th>Notes</th></tr></thead>
<tbody>${cols}</tbody></table>`;
}

function renderPreview(result: IIsarMappingResult): string {
  const tables = result.tables
    .map((t) => renderTableBlock(t)).join('\n');
  const junctions = result.junctionTables
    .map((jt) => renderTableBlock(jt, 'Junction')).join('\n');

  const warns = result.warnings.length > 0
    ? '<div class="warnings"><h4>Warnings</h4><ul>'
      + result.warnings.map((w) => `<li>${esc(w)}</li>`).join('')
      + '</ul></div>'
    : '';

  const skipped = result.skippedBacklinks.length > 0
    ? '<div class="muted"><p>Skipped backlinks: '
      + result.skippedBacklinks.map((b) => esc(b)).join(', ')
      + '</p></div>'
    : '';

  return `<h3>Mapping Preview</h3>${tables}${junctions}${warns}${skipped}`;
}

/** Build the full webview HTML. */
export function buildIsarGenHtml(
  collections: IIsarCollection[],
  embeddeds: IIsarEmbedded[],
  config: IIsarGenConfig,
  mappingResult: IIsarMappingResult,
): string {
  const body = `
<h2>Isar to Drift Schema Generator</h2>
${renderSourceSummary(collections, embeddeds)}
${renderOptions(config)}
${renderPreview(mappingResult)}
<div class="toolbar">
  <button class="btn" data-action="generate">Generate Dart</button>
  <button class="btn" data-action="copy">Copy to Clipboard</button>
  <button class="btn" data-action="save">Save to File</button>
</div>`;

  return wrapHtml(body);
}

function wrapHtml(body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-editor-foreground, #ccc);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 16px; line-height: 1.4;
  }
  h2 { margin-top: 0; }
  h3 { margin-top: 20px; }
  h4 { margin: 12px 0 4px; }
  table {
    width: 100%; border-collapse: collapse;
    font-size: 13px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  th, td {
    text-align: left; padding: 4px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #444);
  }
  th { opacity: 0.7; font-size: 11px; text-transform: uppercase; }
  .btn {
    background: var(--vscode-button-background, #0e639c);
    color: var(--vscode-button-foreground, #fff);
    border: none; padding: 6px 14px; border-radius: 3px;
    cursor: pointer; font-size: 13px;
  }
  .btn:hover {
    background: var(--vscode-button-hoverBackground, #1177bb);
  }
  .option-group {
    margin: 8px 0; display: flex;
    gap: 12px; align-items: center;
  }
  .option-group label { font-size: 13px; }
  .toolbar {
    margin-top: 20px; display: flex; gap: 8px;
    border-top: 1px solid var(--vscode-panel-border, #444);
    padding-top: 12px;
  }
  .warnings { color: #e0a800; }
  .muted { opacity: 0.6; font-style: italic; }
</style>
</head>
<body>
${body}
<script>
  const vscode = acquireVsCodeApi();

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    vscode.postMessage({ command: btn.dataset.action });
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.name === 'embedded') {
      vscode.postMessage({
        command: 'updateConfig',
        config: { embeddedStrategy: el.value },
      });
    } else if (el.name === 'enum') {
      vscode.postMessage({
        command: 'updateConfig',
        config: { enumStrategy: el.value },
      });
    } else if (el.name === 'indexes') {
      vscode.postMessage({
        command: 'updateConfig',
        config: { includeIndexes: el.checked },
      });
    } else if (el.name === 'comments') {
      vscode.postMessage({
        command: 'updateConfig',
        config: { includeComments: el.checked },
      });
    }
  });
</script>
</body>
</html>`;
}
