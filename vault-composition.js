// Vaults workspace: what a vault position is made of over time, from recorded observation-hub evidence.
// Tier 1 = vault idle cash, Tier 2 = additional free cash withdrawable from the best lending reserve,
// Lent = the rest of the vault's assets, borrowed out and not instantly withdrawable.
// Vault-level data shared by every holder; the connected wallet only decides which vaults are listed.
import { formatTokenAmount } from './instant-liquidity.js';

const SCHEMA = 'vault-withdrawal-liquidity/v1';
const RAW = /^(0|[1-9]\d{0,38})$/;
const SVG_NS = 'http://www.w3.org/2000/svg';
export const VAULT_TIERS = Object.freeze([
  { key: 'tier1', figureLabel: 'Tier 1 · Idle cash', label: 'Tier 1 · Vault idle cash', short: 'Tier 1', detail: 'Paid out first, no lending market involved' },
  { key: 'tier2', figureLabel: 'Tier 2 · Market cash', label: 'Tier 2 · Lending-market free cash', short: 'Tier 2', detail: 'Withdrawable by pulling unborrowed cash from one reserve' },
  { key: 'lent', figureLabel: 'Lent to borrowers', label: 'Lent to borrowers', short: 'Lent', detail: 'Not instantly withdrawable until borrowers repay or new deposits arrive' },
]);

const amount = (raw, decimals) => typeof raw === 'string' && RAW.test(raw) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? Number(raw) / 10 ** decimals : null;

function parts(composition, decimals) {
  if (!composition) return null;
  const tier1 = amount(composition.tier1Raw, decimals), tier2 = amount(composition.tier2Raw, decimals);
  const lent = amount(composition.lentRaw, decimals), gross = amount(composition.grossRaw, decimals);
  if ([tier1, tier2, lent, gross].some(value => value === null) || gross <= 0) return null;
  return { tier1, tier2, lent, gross, tier1Share: tier1 / gross, tier2Share: tier2 / gross, lentShare: lent / gross };
}

export function vaultCompositionModel(data, { positionAmount = null, now = Date.now() } = {}) {
  if (data?.schemaVersion !== SCHEMA || !Array.isArray(data.points)) throw new Error('Invalid vault liquidity history');
  const latest = data.latest, decimals = latest?.tokenDecimals;
  const points = data.points.map(row => ({ t: row.t, observedAt: row.composition?.observedAt ?? null, parts: parts(row.composition, decimals) }));
  let current = null;
  if (latest?.status === 'complete' && typeof latest.grossAssetsRaw === 'string' && typeof latest.additionalReserveLiquidityRaw === 'string') {
    const gross = BigInt(latest.grossAssetsRaw), idle = BigInt(latest.idleRaw), tier2 = BigInt(latest.additionalReserveLiquidityRaw);
    if (idle + tier2 <= gross) current = parts({ tier1Raw: latest.idleRaw, tier2Raw: latest.additionalReserveLiquidityRaw, lentRaw: String(gross - idle - tier2), grossRaw: latest.grossAssetsRaw }, decimals);
  }
  const observedAt = latest?.observedAt ?? null, age = observedAt ? now - Date.parse(observedAt) : NaN;
  const stale = !Number.isFinite(age) || age > 180000 || age < -30000 || Boolean(data.stale);
  const position = positionAmount === null || positionAmount === undefined ? null : Number(positionAmount);
  return {
    window: data.window, observedAt, slot: latest?.slot ?? null, stale, current,
    status: !latest ? 'unavailable' : current ? (stale ? 'stale' : 'current') : 'partial',
    position: Number.isFinite(position) && position >= 0 ? position : null,
    positionShareOfVault: current && Number.isFinite(position) && position > 0 ? position / current.gross : null,
    points, observedPoints: points.filter(row => row.parts).length,
  };
}

export const vaultPercent = share => share === null || share === undefined ? '—' : share > 0 && share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(1)}%`;
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

// 100% stacked area: bottom Tier 1, middle Tier 2, top Lent. Gaps (no complete sample) stay empty.
export function vaultCompositionChart(model, { document: doc = globalThis.document, symbol = '' } = {}) {
  // Data-space SVG stretched to the plot box (preserveAspectRatio none, non-scaling strokes); all text is
  // HTML around it, so labels stay legible at any width.
  const width = 1000, left = 0, right = 0, top = 0, bottom = 100;
  const container = element(doc, 'figure', 'vault-composition-chart');
  const svg = svgNode(doc, 'svg', { viewBox: `0 0 ${width} ${bottom}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Share of the vault in Tier 1, Tier 2 and lent to borrowers over time. Gaps mean no complete observation.' });
  const count = model.points.length;
  const x = index => left + index * (width - left - right) / Math.max(1, count - 1);
  const y = share => bottom - share * (bottom - top);
  const yAxis = element(doc, 'div', 'vault-composition-y');
  yAxis.setAttribute('aria-hidden', 'true');
  for (const share of [1, 0.5, 0]) {
    svg.append(svgNode(doc, 'line', { class: 'vault-composition-grid', x1: left, x2: width - right, y1: y(share), y2: y(share) }));
    yAxis.append(element(doc, 'span', '', `${share * 100}%`));
  }
  const runs = [];
  let run = [];
  model.points.forEach((row, index) => { if (row.parts) run.push(index); else if (run.length) { runs.push(run); run = []; } });
  if (run.length) runs.push(run);
  const bands = [['tier1', row => 0, row => row.tier1Share], ['tier2', row => row.tier1Share, row => row.tier1Share + row.tier2Share], ['lent', row => row.tier1Share + row.tier2Share, () => 1]];
  for (const indexes of runs) {
    // A single isolated sample is drawn as a thin column so it stays visible.
    const xs = indexes.length === 1 ? [x(indexes[0]) - 1.5, x(indexes[0]) + 1.5] : indexes.map(x);
    const rows = indexes.length === 1 ? [model.points[indexes[0]].parts, model.points[indexes[0]].parts] : indexes.map(index => model.points[index].parts);
    for (const [key, lower, upper] of bands) {
      const upperEdge = rows.map((row, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(2)},${y(upper(row)).toFixed(2)}`).join(' ');
      const lowerEdge = rows.map((row, i) => [xs[i], lower(row)]).reverse().map(([px, share]) => `L${px.toFixed(2)},${y(share).toFixed(2)}`).join(' ');
      svg.append(svgNode(doc, 'path', { class: `vault-composition-band vault-composition-${key}`, d: `${upperEdge} ${lowerEdge} Z` }));
    }
  }
  const timeLabel = iso => new Date(iso).toLocaleString([], model.window === '24h' ? { hour: '2-digit', minute: '2-digit' } : { month: 'short', day: 'numeric' });
  const xAxis = element(doc, 'div', 'vault-composition-x');
  xAxis.setAttribute('aria-hidden', 'true');
  if (count) xAxis.append(element(doc, 'span', '', timeLabel(model.points[0].t)), element(doc, 'span', '', 'now'));
  const crosshair = svgNode(doc, 'line', { class: 'vault-composition-crosshair', x1: 0, x2: 0, y1: top, y2: bottom, visibility: 'hidden' });
  svg.append(crosshair);

  const tooltip = element(doc, 'div', 'vault-composition-tooltip');
  tooltip.hidden = true;
  const readout = element(doc, 'p', 'instant-meta vault-composition-readout', 'Hover or use the arrow keys to inspect a time.');
  readout.setAttribute('aria-live', 'polite');
  const hit = svgNode(doc, 'rect', { x: left, y: 0, width: width - left - right, height: bottom, fill: 'transparent', tabindex: 0, role: 'slider', 'aria-label': 'Vault composition history. Use arrow keys to select a time.', 'aria-valuemin': 0, 'aria-valuemax': Math.max(0, count - 1) });
  let selected = count - 1;
  const select = (index, showTooltip) => {
    if (!count) return;
    selected = Math.max(0, Math.min(count - 1, index));
    const row = model.points[selected];
    crosshair.setAttribute('x1', x(selected)); crosshair.setAttribute('x2', x(selected)); crosshair.setAttribute('visibility', 'visible');
    const when = new Date(row.observedAt || row.t).toLocaleString();
    tooltip.replaceChildren(element(doc, 'strong', '', when));
    let text;
    if (row.parts) {
      for (const tier of VAULT_TIERS) {
        const line = element(doc, 'span', `vault-composition-tip-row vault-composition-key-${tier.key}`);
        line.append(element(doc, 'i', '', ''), `${tier.short} ${formatTokenAmount(row.parts[tier.key], symbol)} · ${vaultPercent(row.parts[`${tier.key}Share`])}`);
        tooltip.append(line);
      }
      tooltip.append(element(doc, 'span', 'vault-composition-tip-row', `Vault total ${formatTokenAmount(row.parts.gross, symbol)}`));
      text = `${when} · ${VAULT_TIERS.map(tier => `${tier.short} ${vaultPercent(row.parts[`${tier.key}Share`])}`).join(' · ')} · vault ${formatTokenAmount(row.parts.gross, symbol)}`;
    } else {
      tooltip.append(element(doc, 'span', 'vault-composition-tip-row', 'No complete observation'));
      text = `${when} · no complete observation`;
    }
    tooltip.hidden = !showTooltip;
    if (showTooltip) {
      const fraction = x(selected) / width;
      tooltip.style.left = `${(fraction * 100).toFixed(2)}%`;
      tooltip.classList.toggle('is-flipped', fraction > 0.6);
    }
    readout.textContent = text;
    hit.setAttribute('aria-valuenow', String(selected)); hit.setAttribute('aria-valuetext', text);
  };
  hit.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect();
    if (!box.width) return;
    const px = (event.clientX - box.left) / box.width * width;
    select(Math.round((px - left) / (width - left - right) * (count - 1)), true);
  });
  hit.addEventListener('pointerleave', () => { tooltip.hidden = true; crosshair.setAttribute('visibility', 'hidden'); });
  hit.addEventListener('focus', () => select(selected, true));
  hit.addEventListener('blur', () => { tooltip.hidden = true; crosshair.setAttribute('visibility', 'hidden'); });
  hit.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); select(selected + (event.key === 'ArrowLeft' ? -1 : 1), true); }
  });
  svg.append(hit);

  const legend = element(doc, 'div', 'vault-composition-legend');
  for (const tier of VAULT_TIERS) {
    const key = element(doc, 'span', `vault-composition-key-${tier.key}`);
    key.append(element(doc, 'i', '', ''), tier.label);
    legend.append(key);
  }
  const area = element(doc, 'div', 'vault-composition-area');
  area.append(svg, tooltip);
  const plot = element(doc, 'div', 'vault-composition-plot');
  plot.append(yAxis, area, xAxis);
  container.append(legend, plot, readout);
  return container;
}

export function vaultCompositionTable(model, { document: doc = globalThis.document, symbol = '' } = {}) {
  const details = element(doc, 'details', 'vault-composition-table');
  details.append(element(doc, 'summary', '', 'Show data table'));
  const table = element(doc, 'table');
  const head = element(doc, 'tr');
  for (const label of ['Time', 'Tier 1', 'Tier 2', 'Lent', 'Vault total']) head.append(element(doc, 'th', '', label));
  table.append(head);
  for (const row of [...model.points].reverse()) {
    if (!row.parts) continue;
    const tr = element(doc, 'tr');
    tr.append(element(doc, 'td', '', new Date(row.observedAt || row.t).toLocaleString()));
    for (const key of ['tier1', 'tier2', 'lent']) tr.append(element(doc, 'td', '', `${formatTokenAmount(row.parts[key], symbol)} (${vaultPercent(row.parts[`${key}Share`])})`));
    tr.append(element(doc, 'td', '', formatTokenAmount(row.parts.gross, symbol)));
    table.append(tr);
  }
  if (!model.observedPoints) details.append(element(doc, 'p', 'instant-meta', 'No complete observations in this window.'));
  else details.append(table);
  return details;
}
