# Feature 03: Data Charts & Visualizations

**Effort:** L (Large) | **Priority:** 12

## Overview

Render bar charts, pie charts, time series lines, and histograms directly from SQL query results or table data. All rendering uses inline SVG — no charting library dependencies. This transforms the debug viewer from a data inspector into a visual analytics tool.

**User value:** Instantly spot data distributions, trends, and anomalies visually. No Dart/Flutter database tool offers inline charting today.

## Architecture

### Server-side (Dart)
No new endpoints. Charts are pure client-side rendering of existing data from `/api/table/{name}` and `POST /api/sql`.

### Client-side (JS)
Add `renderBarChart()`, `renderPieChart()`, `renderLineChart()`, `renderHistogram()` functions. Add chart type selector and axis pickers that appear after query results.

### VS Code Extension / Flutter
No changes.

### New Files
None.

## Implementation Details

### UI HTML (add after `sql-result` div, ~line 1592)

```html
<div id="chart-controls" class="sql-toolbar" style="display:none;margin-top:0.5rem;">
  <label for="chart-type">Chart:</label>
  <select id="chart-type">
    <option value="none">None</option>
    <option value="bar">Bar</option>
    <option value="pie">Pie</option>
    <option value="line">Line / Time series</option>
    <option value="histogram">Histogram</option>
  </select>
  <label for="chart-x">X / Label:</label>
  <select id="chart-x"></select>
  <label for="chart-y">Y / Value:</label>
  <select id="chart-y"></select>
  <button type="button" id="chart-render">Render</button>
</div>
<div id="chart-container" style="display:none;margin-top:0.5rem;"></div>
```

### CSS Additions

```css
.chart-bar { fill: var(--link); }
.chart-bar:hover { fill: var(--fg); }
.chart-label { font-size: 10px; fill: var(--muted); }
.chart-axis { stroke: var(--border); stroke-width: 1; }
.chart-axis-label { font-size: 11px; fill: var(--muted); }
.chart-line { stroke: var(--link); stroke-width: 2; fill: none; }
.chart-dot { fill: var(--link); }
.chart-dot:hover { fill: var(--fg); r: 5; }
.chart-slice { stroke: var(--bg); stroke-width: 2; cursor: pointer; }
.chart-slice:hover { opacity: 0.8; }
.chart-legend { font-size: 11px; fill: var(--fg); }
```

### Chart Rendering Functions (JS)

```javascript
const CHART_COLORS = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
];

function renderBarChart(container, data, xKey, yKey) {
  const W = 600, H = 300, PAD = 50;
  const vals = data.map((d) => Number(d[yKey]) || 0);
  const maxVal = Math.max(...vals, 1);
  const barW = Math.max(4, (W - PAD * 2) / data.length - 2);
  let svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';

  // Axes
  svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
  svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';

  // Y-axis labels (5 ticks)
  for (let i = 0; i <= 4; i++) {
    const v = (maxVal / 4 * i).toFixed(maxVal > 100 ? 0 : 1);
    const y = H - PAD - (i / 4) * (H - PAD * 2);
    svg += '<text class="chart-axis-label" x="' + (PAD - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + v + '</text>';
  }

  // Bars
  data.forEach((d, i) => {
    const v = Number(d[yKey]) || 0;
    const bh = (v / maxVal) * (H - PAD * 2);
    const x = PAD + i * (barW + 2);
    const y = H - PAD - bh;
    svg += '<rect class="chart-bar" x="' + x + '" y="' + y + '" width="' + barW + '" height="' + bh + '">';
    svg += '<title>' + esc(String(d[xKey])) + ': ' + v + '</title></rect>';
    if (data.length <= 20) {
      svg += '<text class="chart-label" x="' + (x + barW / 2) + '" y="' + (H - PAD + 14) + '" text-anchor="middle" transform="rotate(-45,' + (x + barW / 2) + ',' + (H - PAD + 14) + ')">' + esc(String(d[xKey]).slice(0, 12)) + '</text>';
    }
  });

  svg += '</svg>';
  container.innerHTML = svg;
  container.style.display = 'block';
}

function renderPieChart(container, data, labelKey, valueKey) {
  const W = 500, H = 350, R = 130, CX = 200, CY = H / 2;
  const vals = data.map((d) => Math.max(0, Number(d[valueKey]) || 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  // Group small slices into "Other"
  const threshold = total * 0.02;
  const significant = [];
  let otherVal = 0;
  data.forEach((d, i) => {
    if (vals[i] >= threshold) significant.push({ label: d[labelKey], value: vals[i] });
    else otherVal += vals[i];
  });
  if (otherVal > 0) significant.push({ label: 'Other', value: otherVal });

  let svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
  let angle = 0;
  significant.forEach((d, i) => {
    const sweep = (d.value / total) * 2 * Math.PI;
    const x1 = CX + R * Math.cos(angle);
    const y1 = CY + R * Math.sin(angle);
    const x2 = CX + R * Math.cos(angle + sweep);
    const y2 = CY + R * Math.sin(angle + sweep);
    const large = sweep > Math.PI ? 1 : 0;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += '<path class="chart-slice" d="M' + CX + ',' + CY + ' L' + x1 + ',' + y1 + ' A' + R + ',' + R + ' 0 ' + large + ' 1 ' + x2 + ',' + y2 + ' Z" fill="' + color + '">';
    svg += '<title>' + esc(String(d.label)) + ': ' + d.value + ' (' + (d.value / total * 100).toFixed(1) + '%)</title></path>';
    angle += sweep;
  });

  // Legend
  significant.forEach((d, i) => {
    const ly = 20 + i * 18;
    const lx = CX + R + 30;
    const color = CHART_COLORS[i % CHART_COLORS.length];
    svg += '<rect x="' + lx + '" y="' + (ly - 8) + '" width="10" height="10" fill="' + color + '"/>';
    svg += '<text class="chart-legend" x="' + (lx + 14) + '" y="' + ly + '">' + esc(String(d.label).slice(0, 20)) + ' (' + d.value + ')</text>';
  });

  svg += '</svg>';
  container.innerHTML = svg;
  container.style.display = 'block';
}

function renderLineChart(container, data, xKey, yKey) {
  const W = 600, H = 300, PAD = 50;
  const vals = data.map((d) => Number(d[yKey]) || 0);
  const maxVal = Math.max(...vals, 1);
  const minVal = Math.min(...vals, 0);
  const range = maxVal - minVal || 1;
  const stepX = (W - PAD * 2) / Math.max(data.length - 1, 1);

  let svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
  svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + (H - PAD) + '" x2="' + (W - PAD) + '" y2="' + (H - PAD) + '"/>';
  svg += '<line class="chart-axis" x1="' + PAD + '" y1="' + PAD + '" x2="' + PAD + '" y2="' + (H - PAD) + '"/>';

  const points = data.map((d, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
    return x + ',' + y;
  });

  // Area fill (translucent)
  svg += '<polygon points="' + PAD + ',' + (H - PAD) + ' ' + points.join(' ') + ' ' + (PAD + (data.length - 1) * stepX) + ',' + (H - PAD) + '" fill="var(--link)" opacity="0.1"/>';

  // Line
  svg += '<polyline class="chart-line" points="' + points.join(' ') + '"/>';

  // Dots with tooltips
  data.forEach((d, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - ((Number(d[yKey]) || 0) - minVal) / range * (H - PAD * 2);
    svg += '<circle class="chart-dot" cx="' + x + '" cy="' + y + '" r="3"><title>' + esc(String(d[xKey])) + ': ' + d[yKey] + '</title></circle>';
  });

  svg += '</svg>';
  container.innerHTML = svg;
  container.style.display = 'block';
}

function renderHistogram(container, data, valueKey, bins) {
  bins = bins || 10;
  const vals = data.map((d) => Number(d[valueKey]) || 0).filter((v) => !isNaN(v));
  if (vals.length === 0) { container.innerHTML = '<p class="meta">No numeric data.</p>'; return; }
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const binWidth = (max - min) / bins || 1;
  const counts = new Array(bins).fill(0);
  vals.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    counts[idx]++;
  });

  const histData = counts.map((c, i) => ({
    label: (min + i * binWidth).toFixed(1) + '-' + (min + (i + 1) * binWidth).toFixed(1),
    value: c,
  }));

  renderBarChart(container, histData, 'label', 'value');
}
```

### Integration with SQL Runner and Table View

After SQL query results are received (around line 2401):
```javascript
// Show chart controls when results available
const chartControls = document.getElementById('chart-controls');
if (rows.length > 0) {
  const keys = Object.keys(rows[0]);
  const xSel = document.getElementById('chart-x');
  const ySel = document.getElementById('chart-y');
  xSel.innerHTML = keys.map((k) => '<option>' + esc(k) + '</option>').join('');
  ySel.innerHTML = keys.map((k) => '<option>' + esc(k) + '</option>').join('');
  chartControls.style.display = 'flex';
  // Store rows for charting
  window._chartRows = rows;
} else {
  chartControls.style.display = 'none';
}
```

Render button handler:
```javascript
document.getElementById('chart-render').addEventListener('click', function () {
  const type = document.getElementById('chart-type').value;
  const xKey = document.getElementById('chart-x').value;
  const yKey = document.getElementById('chart-y').value;
  const container = document.getElementById('chart-container');
  const rows = window._chartRows || [];
  if (type === 'none' || rows.length === 0) { container.style.display = 'none'; return; }
  if (type === 'bar') renderBarChart(container, rows, xKey, yKey);
  else if (type === 'pie') renderPieChart(container, rows, xKey, yKey);
  else if (type === 'line') renderLineChart(container, rows, xKey, yKey);
  else if (type === 'histogram') renderHistogram(container, rows, yKey);
});
```

## Effort Estimate

**L (Large)**
- Server: 0 lines changed
- Client: ~300 lines JS (four chart types with SVG rendering, axes, labels, tooltips, legend)
- CSS: ~20 lines
- HTML: ~15 lines
- Testing requires multiple data shapes and chart types

## Dependencies & Risks

- **Large datasets**: SVG rendering degrades with >1000 data points. Mitigate by sampling: if `data.length > 500`, sample every Nth row.
- **Pie chart readability**: Too many slices become unreadable. Auto-group slices below 2% into "Other".
- **Theme support**: All colors use CSS variables (`var(--link)`, `var(--border)`, etc.) so charts work in both light and dark themes.
- **Zero new dependencies**: Pure SVG following the existing schema diagram pattern (line 1812-1839).
- **Responsive sizing**: SVG `viewBox` could be added for responsive scaling, but fixed dimensions are simpler and consistent with the existing diagram.

## Testing Strategy

1. **Bar chart**: Run `SELECT category, COUNT(*) FROM items GROUP BY category` — verify bars render with correct heights and labels
2. **Pie chart**: Same GROUP BY data — verify slices, percentages, legend. Test with >10 categories (Other grouping)
3. **Line chart**: Run `SELECT date, value FROM metrics ORDER BY date` — verify line connects points chronologically
4. **Histogram**: Select a numeric column — verify distribution bins
5. **Theme**: Toggle dark/light mode with chart rendered — verify colors adapt
6. **Edge cases**: Single row, all same values, negative values, NULL values, non-numeric Y column
7. **Large data**: 500+ rows — verify performance is acceptable
