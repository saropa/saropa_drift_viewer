import { escapeHtml, type IDashboardLayout, type IWidgetConfig, type IWidgetTypeInfo } from './dashboard-types';

/** Build the complete HTML for the dashboard webview. */
export function buildDashboardHtml(
  layout: IDashboardLayout,
  widgetTypes: IWidgetTypeInfo[],
  initialWidgetHtml: Map<string, string>,
): string {
  const widgetsHtml = layout.widgets.map((w) => buildWidgetHtml(w, initialWidgetHtml.get(w.id))).join('\n');
  const widgetTypesJson = JSON.stringify(widgetTypes);
  const layoutJson = JSON.stringify(layout);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
${getDashboardCss()}
</style>
</head>
<body>
<div class="dashboard">
  <div class="header">
    <h1>Dashboard</h1>
    <div class="header-actions">
      <button class="btn" id="addWidgetBtn">\u{2795} Add Widget</button>
      <button class="btn" id="layoutBtn">\u2699 Layout</button>
      <button class="btn" id="refreshBtn">\u{1F504} Refresh</button>
    </div>
  </div>

  <div class="grid" id="grid" style="grid-template-columns: repeat(${layout.columns}, 1fr);">
    ${widgetsHtml || '<div class="empty-state"><p>No widgets yet.</p><p>Click "+ Add Widget" to get started.</p></div>'}
  </div>
</div>

<div class="modal" id="addWidgetModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Add Widget</h2>
      <button class="modal-close" id="closeAddModal">\u00D7</button>
    </div>
    <div class="widget-picker" id="widgetPicker">
    </div>
  </div>
</div>

<div class="modal" id="configModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2 id="configModalTitle">Configure Widget</h2>
      <button class="modal-close" id="closeConfigModal">\u00D7</button>
    </div>
    <form id="configForm">
      <div id="configFields"></div>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save</button>
        <button type="button" class="btn" id="cancelConfigBtn">Cancel</button>
      </div>
    </form>
  </div>
</div>

<div class="modal" id="layoutModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Manage Layouts</h2>
      <button class="modal-close" id="closeLayoutModal">\u00D7</button>
    </div>
    <div class="layout-actions">
      <input type="text" id="layoutNameInput" placeholder="Layout name..." value="${esc(layout.name)}">
      <button class="btn" id="saveLayoutBtn">Save</button>
    </div>
  </div>
</div>

<script>
${getDashboardJs(widgetTypesJson, layoutJson)}
</script>
</body>
</html>`;
}

function buildWidgetHtml(widget: IWidgetConfig, bodyHtml?: string): string {
  return `<div class="widget" 
    data-id="${esc(widget.id)}" 
    data-type="${esc(widget.type)}"
    draggable="true"
    style="grid-column: ${widget.gridX + 1} / span ${widget.gridW}; grid-row: ${widget.gridY + 1} / span ${widget.gridH};">
    <div class="widget-header">
      <span class="widget-title">${esc(widget.title)}</span>
      <div class="widget-actions">
        <button class="widget-btn widget-edit" title="Edit">\u270F</button>
        <button class="widget-btn widget-refresh" title="Refresh">\u{1F504}</button>
        <button class="widget-btn widget-remove" title="Remove">\u00D7</button>
      </div>
    </div>
    <div class="widget-body" id="body-${esc(widget.id)}">
      ${bodyHtml || '<p class="loading">Loading\u2026</p>'}
    </div>
    <div class="widget-resize-handle"></div>
  </div>`;
}

const esc = escapeHtml;

function getDashboardCss(): string {
  return `
* { box-sizing: border-box; }
body {
  font-family: var(--vscode-font-family);
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  margin: 0;
  padding: 0;
}
.dashboard { padding: 16px; }
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--vscode-widget-border);
}
.header h1 { margin: 0; font-size: 18px; font-weight: 500; }
.header-actions { display: flex; gap: 8px; }
.btn {
  padding: 6px 12px;
  border: 1px solid var(--vscode-button-border, var(--vscode-widget-border));
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.btn-primary {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-color: var(--vscode-button-background);
}
.btn-primary:hover { opacity: 0.9; }

.grid {
  display: grid;
  gap: 12px;
  min-height: 200px;
}
.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 48px;
  opacity: 0.6;
}

.widget {
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  background: var(--vscode-editor-background);
  display: flex;
  flex-direction: column;
  position: relative;
  transition: border-color 0.15s, box-shadow 0.15s, opacity 0.2s, transform 0.2s;
}
.widget:hover { border-color: var(--vscode-focusBorder); }
.widget.dragging { opacity: 0.5; }
.widget.drag-over { box-shadow: 0 0 0 2px var(--vscode-focusBorder); }

.widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid var(--vscode-widget-border);
  background: var(--vscode-sideBar-background);
  border-radius: 3px 3px 0 0;
  cursor: move;
}
.widget-title {
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.widget-actions { display: flex; gap: 4px; }
.widget-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--vscode-foreground);
  cursor: pointer;
  border-radius: 3px;
  font-size: 12px;
  opacity: 0.6;
  display: flex;
  align-items: center;
  justify-content: center;
}
.widget-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }

.widget-body {
  flex: 1;
  padding: 10px;
  overflow: auto;
  font-size: 12px;
}

.widget-resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 12px;
  height: 12px;
  cursor: se-resize;
  background: linear-gradient(135deg, transparent 50%, var(--vscode-widget-border) 50%);
  border-radius: 0 0 3px 0;
}

/* Widget content styles */
.loading { opacity: 0.5; text-align: center; }
.widget-body.refreshing { opacity: 0.5; pointer-events: none; }
.widget-body.refreshing::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: 2px solid var(--vscode-foreground);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.empty-data { opacity: 0.5; text-align: center; font-style: italic; }
.widget-error { color: var(--vscode-errorForeground); }

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.mini-table th, .mini-table td {
  padding: 4px 6px;
  border: 1px solid var(--vscode-widget-border);
  text-align: left;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mini-table th {
  background: var(--vscode-sideBar-background);
  font-weight: 500;
}
.more-rows { opacity: 0.5; font-size: 10px; margin-top: 4px; }

.widget-table-stats .stat-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}
.stat-label { opacity: 0.7; }
.stat-value { font-weight: 500; }

.widget-counter {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}
.counter-value { font-size: 28px; font-weight: bold; }
.counter-label { font-size: 11px; opacity: 0.7; margin-top: 4px; }

.chart-svg { max-width: 100%; height: auto; }
.pie-chart { max-width: 80px; margin: 0 auto; display: block; }

.widget-health {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.health-grade { font-size: 32px; font-weight: bold; }
.health-score { font-size: 12px; opacity: 0.7; }
.health-metrics { font-size: 10px; opacity: 0.7; display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.grade-a { color: #22c55e; }
.grade-b { color: #84cc16; }
.grade-c { color: #eab308; }
.grade-d { color: #f97316; }
.grade-f { color: #ef4444; }

.widget-invariants { font-size: 11px; }
.invariant-summary { font-weight: 500; margin-bottom: 8px; }
.invariant-summary.passing { color: #22c55e; }
.invariant-summary.failing { color: #ef4444; }
.invariant-item { padding: 2px 0; opacity: 0.8; }
.invariant-item.error { color: #ef4444; }
.invariant-item.warning { color: #eab308; }

.widget-dvr {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 100%;
}
.dvr-stat { text-align: center; }
.dvr-value { font-size: 18px; font-weight: 500; display: block; }
.dvr-label { font-size: 10px; opacity: 0.7; }

.widget-watch { text-align: center; }
.watch-table { font-weight: 500; margin-bottom: 4px; }
.watch-count { font-size: 16px; }
.watch-hint { font-size: 10px; opacity: 0.5; margin-top: 4px; }

.widget-text { white-space: pre-wrap; }

/* Modals */
.modal {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}
.modal.active { display: flex; }
.modal-content {
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-widget-border);
  border-radius: 6px;
  min-width: 320px;
  max-width: 480px;
  max-height: 80vh;
  overflow: auto;
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--vscode-widget-border);
}
.modal-header h2 { margin: 0; font-size: 14px; }
.modal-close {
  background: none;
  border: none;
  color: var(--vscode-foreground);
  font-size: 18px;
  cursor: pointer;
  opacity: 0.6;
}
.modal-close:hover { opacity: 1; }

.widget-picker {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  padding: 16px;
}
.widget-type-card {
  padding: 12px;
  border: 1px solid var(--vscode-widget-border);
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.widget-type-card:hover { border-color: var(--vscode-focusBorder); }
.widget-type-icon { font-size: 20px; margin-bottom: 4px; }
.widget-type-label { font-size: 12px; font-weight: 500; }
.widget-type-desc { font-size: 10px; opacity: 0.7; margin-top: 2px; }

#configForm { padding: 16px; }
.form-group { margin-bottom: 12px; }
.form-group label { display: block; font-size: 11px; margin-bottom: 4px; opacity: 0.8; }
.form-group input, .form-group select, .form-group textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--vscode-widget-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 3px;
  font-size: 12px;
}
.form-group textarea { min-height: 60px; resize: vertical; }
.form-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }

.layout-actions { padding: 16px; display: flex; gap: 8px; }
.layout-actions input { flex: 1; }
`;
}

function getDashboardJs(widgetTypesJson: string, layoutJson: string): string {
  return `
const vscode = acquireVsCodeApi();
const widgetTypes = ${widgetTypesJson};
let layout = ${layoutJson};
let draggingId = null;
let configWidgetId = null;
let configWidgetType = null;

// Render widget picker
const picker = document.getElementById('widgetPicker');
picker.innerHTML = widgetTypes.map(wt => 
  '<div class="widget-type-card" data-type="' + wt.type + '">' +
    '<div class="widget-type-icon">' + wt.icon + '</div>' +
    '<div class="widget-type-label">' + wt.label + '</div>' +
    '<div class="widget-type-desc">' + wt.description + '</div>' +
  '</div>'
).join('');

// Event handlers
document.getElementById('addWidgetBtn').onclick = () => {
  document.getElementById('addWidgetModal').classList.add('active');
};
document.getElementById('closeAddModal').onclick = () => {
  document.getElementById('addWidgetModal').classList.remove('active');
};
document.getElementById('layoutBtn').onclick = () => {
  document.getElementById('layoutModal').classList.add('active');
};
document.getElementById('closeLayoutModal').onclick = () => {
  document.getElementById('layoutModal').classList.remove('active');
};
document.getElementById('refreshBtn').onclick = () => {
  document.querySelectorAll('.widget-body').forEach(b => b.classList.add('refreshing'));
  vscode.postMessage({ command: 'refreshAll' });
};
document.getElementById('saveLayoutBtn').onclick = () => {
  const name = document.getElementById('layoutNameInput').value.trim();
  if (name) {
    vscode.postMessage({ command: 'saveLayout', name });
    document.getElementById('layoutModal').classList.remove('active');
  }
};

// Widget type selection
picker.onclick = (e) => {
  const card = e.target.closest('.widget-type-card');
  if (card) {
    const type = card.dataset.type;
    document.getElementById('addWidgetModal').classList.remove('active');
    showConfigModal(type, null, {});
  }
};

// Config modal handlers
document.getElementById('closeConfigModal').onclick = () => {
  document.getElementById('configModal').classList.remove('active');
};
document.getElementById('cancelConfigBtn').onclick = () => {
  document.getElementById('configModal').classList.remove('active');
};
document.getElementById('configForm').onsubmit = (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const config = {};
  for (const [key, value] of formData) {
    config[key] = value;
  }
  if (configWidgetId) {
    vscode.postMessage({ command: 'editWidget', id: configWidgetId, config });
  } else {
    vscode.postMessage({ command: 'addWidget', type: configWidgetType, config });
  }
  document.getElementById('configModal').classList.remove('active');
};

function showConfigModal(type, widgetId, existingConfig) {
  const wt = widgetTypes.find(w => w.type === type);
  configWidgetId = widgetId;
  configWidgetType = type;
  
  document.getElementById('configModalTitle').textContent = widgetId ? 'Edit Widget' : 'Configure ' + (wt ? wt.label : type);
  
  // Request config schema from extension
  vscode.postMessage({ command: 'getConfigSchema', type, existingConfig });
}

// Grid events
const grid = document.getElementById('grid');

grid.addEventListener('dragstart', (e) => {
  const widget = e.target.closest('.widget');
  if (widget) {
    draggingId = widget.dataset.id;
    widget.classList.add('dragging');
  }
});

grid.addEventListener('dragend', (e) => {
  const widget = e.target.closest('.widget');
  if (widget) {
    widget.classList.remove('dragging');
  }
  draggingId = null;
  document.querySelectorAll('.widget.drag-over').forEach(w => w.classList.remove('drag-over'));
});

grid.addEventListener('dragover', (e) => {
  e.preventDefault();
  const widget = e.target.closest('.widget');
  if (widget && widget.dataset.id !== draggingId) {
    document.querySelectorAll('.widget.drag-over').forEach(w => w.classList.remove('drag-over'));
    widget.classList.add('drag-over');
  }
});

grid.addEventListener('drop', (e) => {
  e.preventDefault();
  const widget = e.target.closest('.widget');
  if (widget && draggingId && widget.dataset.id !== draggingId) {
    vscode.postMessage({ command: 'swapWidgets', idA: draggingId, idB: widget.dataset.id });
  }
  document.querySelectorAll('.widget.drag-over').forEach(w => w.classList.remove('drag-over'));
});

// Widget action buttons
grid.addEventListener('click', (e) => {
  const widget = e.target.closest('.widget');
  if (!widget) return;
  
  if (e.target.closest('.widget-remove')) {
    widget.style.opacity = '0.5';
    widget.style.transform = 'scale(0.95)';
    vscode.postMessage({ command: 'removeWidget', id: widget.dataset.id });
  } else if (e.target.closest('.widget-edit')) {
    const w = layout.widgets.find(w => w.id === widget.dataset.id);
    if (w) showConfigModal(w.type, w.id, w.config);
  } else if (e.target.closest('.widget-refresh')) {
    const body = document.getElementById('body-' + widget.dataset.id);
    if (body) body.classList.add('refreshing');
    vscode.postMessage({ command: 'refreshWidget', id: widget.dataset.id });
  }
});

// Handle messages from extension
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.command) {
    case 'updateWidget': {
      const body = document.getElementById('body-' + msg.id);
      if (body) {
        body.classList.remove('refreshing');
        body.innerHTML = msg.html;
      }
      break;
    }
    case 'updateAll': {
      for (const update of msg.updates) {
        const body = document.getElementById('body-' + update.id);
        if (body) {
          body.classList.remove('refreshing');
          body.innerHTML = update.html;
        }
      }
      break;
    }
    case 'layoutChanged': {
      layout = msg.layout;
      // Full re-render needed for structural changes
      location.reload();
      break;
    }
    case 'showConfigForm': {
      renderConfigForm(msg.schema, msg.existingConfig, msg.tables);
      document.getElementById('configModal').classList.add('active');
      break;
    }
    case 'showError': {
      console.error(msg.message);
      break;
    }
  }
});

function renderConfigForm(schema, existingConfig, tables) {
  const fields = document.getElementById('configFields');
  fields.innerHTML = schema.map(field => {
    const value = existingConfig[field.key] !== undefined ? existingConfig[field.key] : (field.default || '');
    let input = '';
    if (field.type === 'tableSelect') {
      input = '<select name="' + field.key + '">' +
        tables.map(t => '<option value="' + t + '"' + (value === t ? ' selected' : '') + '>' + t + '</option>').join('') +
        '</select>';
    } else if (field.type === 'select') {
      input = '<select name="' + field.key + '">' +
        (field.options || []).map(o => '<option value="' + o + '"' + (value === o ? ' selected' : '') + '>' + o + '</option>').join('') +
        '</select>';
    } else if (field.type === 'number') {
      input = '<input type="number" name="' + field.key + '" value="' + value + '">';
    } else if (field.type === 'checkbox') {
      input = '<input type="checkbox" name="' + field.key + '"' + (value ? ' checked' : '') + '>';
    } else {
      const isLong = field.key === 'sql' || field.key === 'text';
      if (isLong) {
        input = '<textarea name="' + field.key + '">' + escapeHtml(String(value)) + '</textarea>';
      } else {
        input = '<input type="text" name="' + field.key + '" value="' + escapeHtml(String(value)) + '">';
      }
    }
    return '<div class="form-group"><label>' + field.label + (field.required ? ' *' : '') + '</label>' + input + '</div>';
  }).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
`;
}
