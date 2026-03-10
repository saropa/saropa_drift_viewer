import type { ISqlSnippet } from './snippet-types';

/** Render a single snippet card with run form, edit, and delete actions. */
export function renderSnippetCard(
  s: ISqlSnippet,
  tableOptions: string,
): string {
  const varInputs = s.variables.map((v) => {
    const label = `<label>${esc(v.name)}</label>`;
    if (v.type === 'table') {
      return `<div class="var-row">${label}
        <select data-var="${esc(v.name)}" onchange="updatePreview('${esc(s.id)}')">
          <option value="">-- select table --</option>
          ${tableOptions}
        </select></div>`;
    }
    const inputType = v.type === 'number' ? 'number' : 'text';
    const def = v.default ? ` value="${esc(v.default)}"` : '';
    return `<div class="var-row">${label}
      <input type="${inputType}" data-var="${esc(v.name)}"${def}
             oninput="updatePreview('${esc(s.id)}')"
             placeholder="${esc(v.description || v.name)}" /></div>`;
  }).join('');

  const runForm = s.variables.length > 0
    ? `<div id="run-${esc(s.id)}" class="var-form" style="display:none"
           data-sql="${escAttr(s.sql)}">
        ${varInputs}
        <div class="preview">${esc(s.sql)}</div>
        <div class="form-actions">
          <button onclick="runSnippet('${esc(s.id)}')">Run</button>
          <button class="secondary"
                  onclick="showRunForm('${esc(s.id)}')">Cancel</button>
        </div>
        <div id="result-${esc(s.id)}"></div>
      </div>`
    : '';

  const desc = s.description
    ? `<div class="snippet-desc">${esc(s.description)}</div>`
    : '';
  const meta = s.useCount > 0
    ? `<div class="snippet-meta">Used ${s.useCount} time${s.useCount === 1 ? '' : 's'}</div>`
    : '';

  const runAction = s.variables.length > 0
    ? `showRunForm('${esc(s.id)}')`
    : `post('runSnippet', {id:'${esc(s.id)}', values:{}})`;

  return `<div class="snippet">
    <div class="snippet-name">${esc(s.name)}</div>
    ${desc}
    <div class="snippet-sql">${esc(s.sql)}</div>
    <div class="snippet-actions">
      <button onclick="${runAction}">Run</button>
      <button class="secondary" onclick="editSnippet('${esc(s.id)}')">Edit</button>
      <button class="secondary danger" onclick="deleteSnippet('${esc(s.id)}', '${escAttr(s.name)}')">Delete</button>
    </div>
    ${runForm}
    ${meta}
  </div>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s: string): string {
  return esc(s).replace(/'/g, '&#39;');
}
