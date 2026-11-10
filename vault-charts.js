// Shared chart layer for the Vaults workspace: a smooth line with a soft area (e.g. share price), signed
// bars (net deposits − withdrawals) and stacked areas (instant liquidity tiers). A data-space SVG stretched
// to the plot with non-scaling strokes; all text is HTML around it. The time axis starts at the first
// recorded sample, so a vault that only began recording fills the plot instead of hugging its right edge.
// Inner gaps stay gaps (a bucket without a sample is drawn as nothing, never as zero).
const SVG_NS = 'http://www.w3.org/2000/svg';
let gradientId = 0;
const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const svgNode = (doc, tag, attributes = {}) => {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
};

// Line charts span the data range (padded so a flat line sits mid-plot); bars are symmetric around zero;
// stacked areas start at zero.
export function seriesScale(values, mode) {
  const known = values.filter(Number.isFinite);
  if (!known.length) return null;
  if (mode === 'bars') {
    const max = Math.max(...known.map(Math.abs));
    return max > 0 ? { min: -max, max } : { min: -1, max: 1 };
  }
  if (mode === 'stack') {
    const max = Math.max(...known);
    return { min: 0, max: max > 0 ? max * 1.15 : 1 };
  }
  let min = Math.min(...known), max = Math.max(...known);
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.001 || 1;
  return { min: min - pad, max: max + pad };
}

// Index of the first bucket with a recorded value; earlier buckets are before recording began.
export function firstRecorded(points, has) {
  const index = points.findIndex(has);
  return index < 0 ? null : index;
}

// Monotone cubic path through [x, y] pairs (Fritsch–Carlson): smooth, never overshoots the data.
export function smoothPath(pts) {
  if (pts.length === 1) return `M${pts[0][0] - 2},${pts[0][1]}h4`;
  if (pts.length === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;
  const n = pts.length, dx = [], slope = [], tangent = new Array(n);
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  tangent[0] = slope[0]; tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { tangent[i] = 0; tangent[i + 1] = 0; continue; }
    const a = tangent[i] / slope[i], b = tangent[i + 1] / slope[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); tangent[i] = t * a * slope[i]; tangent[i + 1] = t * b * slope[i]; }
  }
  let d = `M${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += `C${(pts[i][0] + c).toFixed(2)},${(pts[i][1] + c * tangent[i]).toFixed(2)} ${(pts[i + 1][0] - c).toFixed(2)},${(pts[i + 1][1] - c * tangent[i + 1]).toFixed(2)} ${pts[i + 1][0].toFixed(2)},${pts[i + 1][1].toFixed(2)}`;
  }
  return d;
}

const runsOf = (count, has) => {
  const runs = []; let run = [];
  for (let index = 0; index < count; index++) { if (has(index)) run.push(index); else if (run.length) { runs.push(run); run = []; } }
  if (run.length) runs.push(run);
  return runs;
};

// Generic interactive plot. `layers(ctx)` draws into the svg; `tip(point)` returns tooltip lines.
function plotFrame({ doc, points, scale, label, format, window, height, layers, tip, legend }) {
  const width = 1000, bottom = 100, count = points.length;
  const x = index => count === 1 ? width / 2 : index * width / (count - 1);
  const y = value => bottom - (value - scale.min) / (scale.max - scale.min) * bottom;
  const container = element(doc, 'figure', 'vault-chart');
  if (legend?.length) {
    const keys = element(doc, 'div', 'vault-chart-legend');
    for (const item of legend) { const key = element(doc, 'span', `vault-chart-key vault-chart-key-${item.key}`); key.append(element(doc, 'i'), item.label); keys.append(key); }
    container.append(keys);
  }
  const svg = svgNode(doc, 'svg', { viewBox: `0 0 ${width} ${bottom}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${label} over time. Gaps mean nothing was recorded.` });
  const yAxis = element(doc, 'div', 'vault-chart-y'); yAxis.setAttribute('aria-hidden', 'true');
  const ticks = scale.min < 0 ? [scale.max, 0, scale.min] : [scale.max, scale.min + (scale.max - scale.min) / 2, scale.min];
  for (const tick of ticks) {
    svg.append(svgNode(doc, 'line', { class: tick === 0 && scale.min < 0 ? 'vault-chart-zero' : 'vault-chart-grid', x1: 0, x2: width, y1: y(tick), y2: y(tick) }));
    yAxis.append(element(doc, 'span', '', format(tick, { axis: true })));
  }
  layers({ svg, x, y, width, bottom });
  const timeLabel = iso => new Date(iso).toLocaleString([], window === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const xAxis = element(doc, 'div', 'vault-chart-x'); xAxis.setAttribute('aria-hidden', 'true');
  const marks = count < 3 ? [0, count - 1] : [0, Math.round((count - 1) / 3), Math.round(2 * (count - 1) / 3), count - 1];
  [...new Set(marks)].forEach((index, i, all) => xAxis.append(element(doc, 'span', '', i === all.length - 1 ? 'Now' : timeLabel(points[index].t))));
  const crosshair = svgNode(doc, 'line', { class: 'vault-chart-crosshair', x1: 0, x2: 0, y1: 0, y2: bottom, visibility: 'hidden' });
  svg.append(crosshair);
  const tooltip = element(doc, 'div', 'vault-chart-tooltip'); tooltip.hidden = true;
  const readout = element(doc, 'p', 'vault-sr-only'); readout.setAttribute('aria-live', 'polite');
  const hit = svgNode(doc, 'rect', { x: 0, y: 0, width, height: bottom, fill: 'transparent', tabindex: 0, role: 'slider', 'aria-label': `${label} history. Use arrow keys to select a time.`, 'aria-valuemin': 0, 'aria-valuemax': Math.max(0, count - 1) });
  let selected = count - 1;
  const select = (index, show) => {
    selected = Math.max(0, Math.min(count - 1, index));
    const point = points[selected], when = new Date(point.observedAt || point.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    crosshair.setAttribute('x1', x(selected)); crosshair.setAttribute('x2', x(selected)); crosshair.setAttribute('visibility', 'visible');
    const lines = tip(point);
    tooltip.replaceChildren(element(doc, 'strong', '', when), ...lines.map(line => {
      const row = element(doc, 'span', `vault-chart-tip-row${line.key ? ` vault-chart-key-${line.key}` : ''}`);
      if (line.key) row.append(element(doc, 'i'));
      row.append(line.text ?? line);
      return row;
    }));
    tooltip.hidden = !show;
    if (show) { const fraction = x(selected) / width; tooltip.style.left = `${(fraction * 100).toFixed(2)}%`; tooltip.classList.toggle('is-flipped', fraction > 0.6); }
    const text = `${when} · ${lines.map(line => line.text ?? line).join(' · ')}`;
    readout.textContent = text; hit.setAttribute('aria-valuenow', String(selected)); hit.setAttribute('aria-valuetext', text);
  };
  const hide = () => { tooltip.hidden = true; crosshair.setAttribute('visibility', 'hidden'); };
  hit.addEventListener('pointermove', event => { const box = svg.getBoundingClientRect(); if (box.width) select(Math.round((event.clientX - box.left) / box.width * (count - 1)), true); });
  hit.addEventListener('pointerleave', hide);
  hit.addEventListener('focus', () => select(selected, true));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); select(selected + (event.key === 'ArrowLeft' ? -1 : 1), true); } });
  svg.append(hit);
  const area = element(doc, 'div', 'vault-chart-area'); area.style.height = `${height}px`; area.append(svg, tooltip);
  yAxis.style.height = `${height}px`;
  const plot = element(doc, 'div', 'vault-chart-plot'); plot.append(yAxis, area, xAxis);
  container.append(plot, readout);
  return container;
}

const gradient = (doc, svg, key) => {
  const id = `vault-chart-fill-${key}-${++gradientId}`, defs = svgNode(doc, 'defs'), grad = svgNode(doc, 'linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgNode(doc, 'stop', { offset: '0%', class: `vault-chart-stop-top vault-chart-fill-${key}` }), svgNode(doc, 'stop', { offset: '100%', class: `vault-chart-stop-bottom vault-chart-fill-${key}` }));
  defs.append(grad); svg.append(defs);
  return `url(#${id})`;
};

const recordingNote = (doc, points, status) => {
  const since = new Date(points[0].observedAt || points[0].t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return element(doc, 'p', 'vault-chart-note', [`Recording since ${since}`, status, 'dashed = no samples'].filter(Boolean).join(' · '));
};

// One series: mode 'line' (smooth line + soft area) or 'bars' (signed, rounded).
// `markers` (optional): [{ t, kind: 'deposit'|'withdraw', label }] drawn as dots on the line at their time.
export function vaultSeriesChart({ markers = [], status = null, points: all, mode = 'line', window = '24h', label, format = String, empty = 'No recorded samples in this window yet.', height = 150, document: doc = globalThis.document }) {
  const start = firstRecorded(all, point => Number.isFinite(point.value));
  if (start === null) { const box = element(doc, 'figure', 'vault-chart vault-chart-empty'); box.append(element(doc, 'p', 'vault-chart-note', empty)); return box; }
  const points = all.slice(start), scale = seriesScale(points.map(point => point.value), mode);
  const chart = plotFrame({
    doc, points, scale, label, format, window, height,
    tip: point => Number.isFinite(point.value) ? [`${label} ${format(point.value)}`, ...(point.detail || [])] : ['Nothing recorded'],
    layers: ({ svg, x, y, width }) => {
      if (mode === 'bars') {
        const half = Math.max(1.2, width / Math.max(1, points.length) * 0.34);
        points.forEach((point, index) => {
          if (!Number.isFinite(point.value) || point.value === 0) return;
          const top = Math.min(y(point.value), y(0)), barHeight = Math.max(0.8, Math.abs(y(point.value) - y(0)));
          svg.append(svgNode(doc, 'rect', { class: `vault-chart-bar ${point.value > 0 ? 'is-positive' : 'is-negative'}`, x: (x(index) - half).toFixed(2), y: top.toFixed(2), width: (half * 2).toFixed(2), height: barHeight.toFixed(2), rx: 1.2 }));
        });
        return;
      }
      const fill = gradient(doc, svg, 'line'), runs = runsOf(points.length, index => Number.isFinite(points[index].value));
      // Unrecorded stretches are bridged with a faint dashed line between the samples either side, so the
      // trend stays readable without pretending anything was measured in between.
      runs.slice(1).forEach((run, i) => {
        const before = runs[i].at(-1), after = run[0];
        svg.append(svgNode(doc, 'line', { class: 'vault-chart-bridge', x1: x(before), y1: y(points[before].value), x2: x(after), y2: y(points[after].value) }));
      });
      for (const run of runs) {
        const pts = run.map(index => [x(index), y(points[index].value)]);
        if (pts.length > 1) svg.append(svgNode(doc, 'path', { class: 'vault-chart-area-fill', d: `${smoothPath(pts)}L${pts.at(-1)[0]},100L${pts[0][0]},100Z`, fill }));
        svg.append(svgNode(doc, 'path', { class: 'vault-chart-line', d: smoothPath(pts) }));
      }
      for (const marker of markers) {
        const t = Date.parse(marker.t); let index = -1;
        points.forEach((point, i) => { if (Date.parse(point.observedAt || point.t) <= t + 1) index = i; });
        if (index < 0) index = 0;
        const target = points.slice(index).find(point => Number.isFinite(point.value)) ?? points[index];
        if (!Number.isFinite(target?.value)) continue;
        const dot = svgNode(doc, 'line', { class: `vault-chart-marker is-${marker.kind}`, x1: x(index), x2: x(index), y1: y(target.value), y2: y(target.value) });
        const title = svgNode(doc, 'title'); title.textContent = marker.label || marker.kind; dot.append(title); svg.append(dot);
      }
      const last = points.length - 1 - [...points].reverse().findIndex(point => Number.isFinite(point.value));
      svg.append(svgNode(doc, 'line', { class: 'vault-chart-dot', x1: x(last), x2: x(last), y1: y(points[last].value), y2: y(points[last].value) }));
    },
  });
  if (start > 0 || points.some(point => !Number.isFinite(point.value))) chart.append(recordingNote(doc, points, status));
  return chart;
}

// Stacked areas from zero, e.g. instant liquidity = Tier 1 (bottom) + Tier 2. `layersDef` = [{ key, label, value(point) }].
// `overlay` (optional) = { key, label, value(point) }: a line over the stack; where it rises above the stack
// the gap is shaded (e.g. large holders' claims above instant cash).
export function vaultStackChart({ overlay = null, status = null, points: all, layers: defs, window = '24h', label, format = String, tip, empty = 'No complete observations in this window yet.', height = 180, document: doc = globalThis.document }) {
  const has = point => defs.every(def => Number.isFinite(def.value(point)));
  const start = firstRecorded(all, has);
  if (start === null) { const box = element(doc, 'figure', 'vault-chart vault-chart-empty'); box.append(element(doc, 'p', 'vault-chart-note', empty)); return box; }
  const points = all.slice(start), totals = points.map(point => has(point) ? defs.reduce((sum, def) => sum + def.value(point), 0) : null);
  const scale = seriesScale([...totals, ...(overlay ? points.map(overlay.value) : [])], 'stack');
  const chart = plotFrame({
    doc, points, scale, label, format, window, height, legend: overlay ? [...defs, overlay] : defs,
    tip: point => has(point) ? tip(point) : ['No complete observation'],
    layers: ({ svg, x, y }) => {
      const runs = runsOf(points.length, index => has(points[index]));
      // Gaps between observations: a faded band joining the samples either side (not a measurement).
      runs.slice(1).forEach((run, i) => {
        const a = points[runs[i].at(-1)], b = points[run[0]], xa = x(runs[i].at(-1)), xb = x(run[0]);
        let lowerA = 0, lowerB = 0;
        for (const def of defs) {
          const upperA = lowerA + def.value(a), upperB = lowerB + def.value(b);
          svg.append(svgNode(doc, 'path', { class: `vault-chart-band-bridge vault-chart-fill-${def.key}`, d: `M${xa},${y(upperA)}L${xb},${y(upperB)}L${xb},${y(lowerB)}L${xa},${y(lowerA)}Z` }));
          lowerA = upperA; lowerB = upperB;
        }
      });
      for (const run of runs) {
        const xs = run.length === 1 ? [x(run[0]) - 3, x(run[0]) + 3] : run.map(x), rows = run.length === 1 ? [points[run[0]], points[run[0]]] : run.map(index => points[index]);
        let lower = rows.map(() => 0);
        for (const def of defs) {
          const upper = rows.map((row, i) => lower[i] + def.value(row));
          const top = xs.map((px, i) => [px, y(upper[i])]), base = xs.map((px, i) => [px, y(lower[i])]).reverse();
          svg.append(svgNode(doc, 'path', { class: `vault-chart-band vault-chart-fill-${def.key}`, d: `${smoothPath(top)}L${base.map(([px, py]) => `${px.toFixed(2)},${py.toFixed(2)}`).join('L')}Z` }));
          svg.append(svgNode(doc, 'path', { class: `vault-chart-band-edge vault-chart-stroke-${def.key}`, d: smoothPath(top) }));
          lower = upper;
        }
      }
      if (overlay) {
        const known = index => Number.isFinite(overlay.value(points[index]));
        for (const run of runsOf(points.length, known)) {
          const pts = run.map(index => [x(index), y(overlay.value(points[index]))]);
          run.forEach((index, i) => {
            if (i === run.length - 1 || !Number.isFinite(totals[index]) || !Number.isFinite(totals[run[i + 1]])) return;
            const next = run[i + 1], o1 = overlay.value(points[index]), o2 = overlay.value(points[next]);
            if (o1 > totals[index] || o2 > totals[next]) svg.append(svgNode(doc, 'path', { class: 'vault-chart-shortfall', d: `M${x(index)},${y(Math.max(o1, totals[index]))}L${x(next)},${y(Math.max(o2, totals[next]))}L${x(next)},${y(totals[next])}L${x(index)},${y(totals[index])}Z` }));
          });
          svg.append(svgNode(doc, 'path', { class: `vault-chart-overlay vault-chart-stroke-${overlay.key}`, d: smoothPath(pts) }));
        }
      }
    },
  });
  if (start > 0 || points.some(point => !has(point)) || status) chart.append(recordingNote(doc, points, status));
  return chart;
}
