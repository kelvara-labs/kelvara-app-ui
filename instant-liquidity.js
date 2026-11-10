// Instant withdrawal (Positions): how much of a Kamino position could leave right now, and how the vault's
// idle-cash coverage moved over the last 24h / 7d. Two layers, kept apart so each number stays true:
//   idle            vault idle cash (history available)
//   includingMarkets idle + free cash of the best lending reserve one withdraw can draw on (live only)
// Status and "withdrawable now" use includingMarkets when the backend supplied it, else idle.
// Pure model + DOM chart; no innerHTML.

const DUST_FRACTION = 0.001; // below 0.1% of the position counts as no exit (Kamino rejects dust withdrawals)
const SVG = 'http://www.w3.org/2000/svg';

export function instantLiquidityModel(series, positionAmount, { dustFraction = DUST_FRACTION } = {}) {
  const position = Number(positionAmount);
  const idle = Number(series?.latest?.idle);
  if (!series || !Number.isFinite(position) || position < 0 || !Number.isFinite(idle) || idle < 0) {
    return { status: 'unknown', basis: null, positionAmount: Number.isFinite(position) ? position : null, idleNow: null, marketsFreeNow: null, includingMarketsNow: null, withdrawableNow: null, coverageNow: null, idleCoverageNow: null, points: [], knownPoints: 0, fullShare: null, source: series?.source ?? null, stale: Boolean(series?.stale), observedAt: series?.latest?.observedAt ?? null, stepSeconds: series?.stepSeconds ?? null };
  }
  const cover = value => position === 0 ? 1 : Math.min(1, value / position);
  const including = Number(series.latest.instantIncludingMarkets), markets = Number(series.latest.marketsFree);
  const hasMarkets = series.latest.instantIncludingMarkets != null && Number.isFinite(including) && including >= 0;
  const exitNow = hasMarkets ? Math.max(including, idle) : idle;
  const coverageNow = cover(exitNow);
  const points = (Array.isArray(series.points) ? series.points : []).map(point => {
    const value = point?.idle;
    return { t: point?.t, idle: Number.isFinite(value) && value >= 0 ? value : null, coverage: Number.isFinite(value) && value >= 0 ? cover(value) : null };
  });
  const known = points.filter(point => point.coverage !== null);
  return {
    status: position === 0 ? 'empty' : coverageNow >= 1 ? 'full' : coverageNow >= dustFraction ? 'partial' : 'none',
    basis: hasMarkets ? 'including_markets' : 'idle_only',
    positionAmount: position,
    idleNow: idle,
    marketsFreeNow: hasMarkets && Number.isFinite(markets) && markets >= 0 ? markets : null,
    includingMarketsNow: hasMarkets ? exitNow : null,
    withdrawableNow: Math.min(position, exitNow),
    coverageNow,
    idleCoverageNow: cover(idle),
    points,
    knownPoints: known.length,
    fullShare: known.length ? known.filter(point => point.coverage >= 1).length / known.length : null,
    source: series.source,
    stale: Boolean(series.stale),
    observedAt: series.latest.observedAt ?? null,
    stepSeconds: series.stepSeconds ?? null,
  };
}

export function instantStatusCopy(model) {
  if (model.stale) return { tone: 'warning', icon: '!', label: 'Instant: data delayed' };
  switch (model.status) {
    case 'full': return { tone: 'ready', icon: '✓', label: 'Instant: full' };
    case 'partial': return { tone: 'warning', icon: '◐', label: `Instant: partial ${Math.floor(model.coverageNow * 100)}%` };
    case 'none': return { tone: 'danger', icon: '✕', label: 'Instant: none' };
    case 'empty': return { tone: 'neutral', icon: '–', label: 'Instant: no balance' };
    default: return { tone: 'neutral', icon: '?', label: 'Instant: unavailable' };
  }
}

export function formatTokenAmount(value, symbol = '') {
  if (!Number.isFinite(value)) return '—';
  const digits = value !== 0 && Math.abs(value) < 0.01 ? 6 : 2;
  const text = groupDigits(value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  return symbol ? `${text} ${symbol}` : text;
}

// Accounting style: thousands grouped with a non-breaking space (1 388 443.35), decimal point kept.
export const groupDigits = text => String(text).replace(/,/g, '\u00A0');
export const formatGrouped = (value, maximumFractionDigits = 2) => Number.isFinite(value) ? groupDigits(value.toLocaleString('en-US', { maximumFractionDigits })) : '—';

function timeLabel(iso, stepSeconds) {
  // Stored and transported in UTC; shown in the viewer's own time zone.
  const options = stepSeconds >= 3600
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }
    : { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
  return new Date(iso).toLocaleString(undefined, options);
}

function node(doc, tag, attrs = {}, text) {
  const el = tag === 'svg' || ['path', 'line', 'rect', 'text', 'g', 'circle'].includes(tag) ? doc.createElementNS(SVG, tag) : doc.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  if (text !== undefined) el.textContent = text;
  return el;
}

// Relative age for "updated 40s ago". Stored times are UTC; this only measures distance from now.
export function formatAgo(iso, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Expanded history: chart only (no axis text drawn over the plot). Mouse hover previews a moment; a
// tap/click or arrow key pins one. Details go to `onSelect` so the caller can show them beside the chart,
// never on it: { time, coverage, idle, withdrawable }, or null when the pointer leaves with nothing pinned.
// Drawn at the container's real pixel width and redrawn on resize.
export function instantHistoryChart(model, { document: doc = globalThis.document, width = 320, height = 112, onSelect = () => {} } = {}) {
  const wrap = node(doc, 'div', { class: 'instant-chart' });
  let svg = null, drawnWidth = 0, active = -1, pinned = -1;
  const draw = w => {
    w = Math.max(220, Math.round(w));
    if (svg && w === drawnWidth) return;
    drawnWidth = w;
    const pad = 4, count = model.points.length;
    const x = index => pad + (count <= 1 ? w - pad * 2 : (index / (count - 1)) * (w - pad * 2));
    const y = coverage => pad + (1 - coverage) * (height - pad * 2);
    const next = node(doc, 'svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, role: 'img', 'aria-label': model.fullShare === null ? 'No history in this window' : `Full exit possible ${Math.round(model.fullShare * 100)}% of the time` });
    next.append(node(doc, 'line', { class: 'instant-grid', x1: 0, x2: w, y1: y(1), y2: y(1) }), node(doc, 'line', { class: 'instant-grid', x1: 0, x2: w, y1: y(0), y2: y(0) }));
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const line = run.map(([index, coverage], i) => `${i ? 'L' : 'M'}${x(index).toFixed(1)},${y(coverage).toFixed(1)}`).join('');
      next.append(node(doc, 'path', { class: 'instant-area', d: `${line}L${x(run[run.length - 1][0]).toFixed(1)},${y(0)}L${x(run[0][0]).toFixed(1)},${y(0)}Z` }));
      next.append(node(doc, 'path', { class: 'instant-line', d: run.length === 1 ? `M${x(run[0][0]) - 1},${y(run[0][1])}h2` : line }));
      run = [];
    };
    model.points.forEach((point, index) => { if (point.coverage === null) flush(); else run.push([index, point.coverage]); });
    flush();
    const crosshair = node(doc, 'line', { class: 'instant-crosshair', y1: 0, y2: height, visibility: 'hidden' });
    const dot = node(doc, 'circle', { class: 'instant-dot', r: 4, visibility: 'hidden' });
    const hit = node(doc, 'rect', { class: 'instant-hit', x: 0, y: 0, width: w, height, tabindex: 0, 'aria-label': 'Select a moment; use left and right arrow keys' });
    next.append(crosshair, dot, hit);
    const select = (index, pin = false) => {
      if (!count) return;
      active = Math.max(0, Math.min(count - 1, index));
      if (pin) pinned = active;
      const point = model.points[active], px = x(active);
      crosshair.setAttribute('x1', px); crosshair.setAttribute('x2', px); crosshair.setAttribute('visibility', 'visible');
      if (point.coverage === null) dot.setAttribute('visibility', 'hidden');
      else { dot.setAttribute('cx', px); dot.setAttribute('cy', y(point.coverage)); dot.setAttribute('visibility', 'visible'); }
      const withdrawable = point.idle === null || model.positionAmount === null ? null : Math.min(model.positionAmount, point.idle);
      onSelect({ time: timeLabel(point.t, model.stepSeconds), coverage: point.coverage, idle: point.idle, withdrawable });
    };
    const clear = () => { active = -1; crosshair.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); onSelect(null); };
    const fromEvent = event => { const box = hit.getBoundingClientRect(); return Math.round(((event.clientX - box.left) / box.width) * (count - 1)); };
    hit.addEventListener('click', event => select(fromEvent(event), true));
    // Mouse: hover previews. Touch/pen: drag to scrub (a plain move without contact has no meaning there).
    hit.addEventListener('pointermove', event => { if (event.pointerType === 'mouse' || event.buttons) select(fromEvent(event), event.pointerType !== 'mouse'); });
    hit.addEventListener('pointerleave', event => { if (event.pointerType !== 'mouse') return; if (pinned >= 0) select(pinned); else clear(); });
    hit.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); select((active < 0 ? count - 1 : active) + (event.key === 'ArrowLeft' ? -1 : 1), true); }
    });
    if (active >= 0) select(active);
    if (svg) svg.replaceWith(next); else wrap.append(next);
    svg = next;
  };
  draw(width);
  if (typeof ResizeObserver === 'function') new ResizeObserver(entries => { const w = entries[0]?.contentRect?.width; if (w) draw(w); }).observe(wrap);
  return wrap;
}

// Compact preview for the collapsed state: line + wash on a fixed 0-100% scale, gaps kept, no text
// (the surrounding button carries the label). Drawn at its own pixel size, never scaled.
export function instantSparkline(model, { document: doc = globalThis.document, width = 216, height = 44 } = {}) {
  const svg = node(doc, 'svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false', class: 'instant-sparkline' });
  const count = model.points.length, pad = 2;
  const x = index => pad + (count <= 1 ? width - pad * 2 : (index / (count - 1)) * (width - pad * 2));
  const y = coverage => pad + (1 - coverage) * (height - pad * 2);
  svg.append(node(doc, 'line', { class: 'instant-grid', x1: 0, x2: width, y1: y(1), y2: y(1) }), node(doc, 'line', { class: 'instant-grid', x1: 0, x2: width, y1: y(0), y2: y(0) }));
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const line = run.map(([index, coverage], i) => `${i ? 'L' : 'M'}${x(index).toFixed(1)},${y(coverage).toFixed(1)}`).join('');
    svg.append(node(doc, 'path', { class: 'instant-area', d: `${line}L${x(run[run.length - 1][0]).toFixed(1)},${y(0)}L${x(run[0][0]).toFixed(1)},${y(0)}Z` }));
    svg.append(node(doc, 'path', { class: 'instant-line instant-line-thin', d: run.length === 1 ? `M${x(run[0][0]) - 1},${y(run[0][1])}h2` : line }));
    run = [];
  };
  model.points.forEach((point, index) => { if (point.coverage === null) flush(); else run.push([index, point.coverage]); });
  flush();
  return svg;
}
