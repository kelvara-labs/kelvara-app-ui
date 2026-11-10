import { formatTokenAmount, formatAgo } from './instant-liquidity.js';

const SCHEMA = 'vault-withdrawal-liquidity/v1';
const windows = ['24h', '7d', '30d'], views = new WeakMap();
const quantity = (raw, decimals) => typeof raw === 'string' && /^(0|[1-9]\d{0,38})$/.test(raw) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? Number(raw) / 10 ** decimals : null;
export function withdrawalLiquidityModel(data, positionAmount = null, now = Date.now()) {
  if (data?.schemaVersion !== SCHEMA || !Array.isArray(data.points)) throw new Error('Invalid liquidity history');
  const latest = data.latest, decimals = latest?.tokenDecimals;
  const idle = quantity(latest?.idleRaw, decimals), total = quantity(latest?.totalEstimatedWithdrawalRaw, decimals);
  const additional = quantity(latest?.additionalReserveLiquidityRaw, decimals);
  const position = positionAmount === null || positionAmount === undefined ? null : Number(positionAmount);
  const observedAt = latest?.observedAt, age = observedAt ? now - Date.parse(observedAt) : NaN;
  const stale = !Number.isFinite(age) || age > 180000 || age < -30000 || Boolean(data.stale);
  const validTotal = latest?.status === 'complete' && idle !== null && total !== null && total >= idle && additional !== null;
  return {
    idle, total: validTotal ? total : null, additional: validTotal ? additional : null, stale,
    observedAt, slot: latest?.slot ?? null, status: !latest ? 'unavailable' : stale ? 'stale' : validTotal ? 'estimated' : 'partial',
    position: Number.isFinite(position) && position >= 0 ? position : null,
    positionCapacity: validTotal && !stale && Number.isFinite(position) && position > 0 ? Math.min(position, total) : null,
    positionCoverage: validTotal && !stale && Number.isFinite(position) && position > 0 ? Math.min(1, total / position) : null,
    vaultCoverage: validTotal && Number.isFinite(data.vaultCoverageBps) ? data.vaultCoverageBps / 100 : null,
    dataCoverage: Math.max(0, Math.min(1, Number(data.coverage?.fraction) || 0)), window: data.window,
    points: data.points.map(row => ({ t: row.t, idle: quantity(row.idleMinRaw, decimals), total: quantity(row.totalMinRaw, decimals), samples: row.sampleCount, completeSamples: row.completeSampleCount })),
    reserves: (latest?.reserves || []).map(row => ({
      reserve: row.reserve, amount: latest.status === 'complete' ? quantity(row.attributableRaw, decimals) : null,
      owned: quantity(row.ownedRaw, decimals), free: quantity(row.freeRaw, decimals), queued: quantity(row.queuedRaw, decimals),
      cap: quantity(row.capRemainingRaw, decimals), eligible: row.eligible,
    })),
    selectedReserve: latest?.selectedReserve, calculationVersion: latest?.calculationVersion, commitment: latest?.commitment,
    observationId: latest?.observationId, reasons: latest?.reasons || [],
  };
}

const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export function withdrawalHistoryChart(model, { document: doc = globalThis.document, symbol = '' } = {}) {
  const container = element(doc, 'div', 'withdrawal-history');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 720 160'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Minimum observed withdrawal liquidity: idle and including reserves. Gaps mean no observations.');
  const maximum = Math.max(1, ...model.points.flatMap(row => [row.idle ?? 0, row.total ?? 0]));
  const x = index => 5 + index * 710 / Math.max(1, model.points.length - 1), y = value => 150 - value / maximum * 140;
  for (const key of ['idle', 'total']) {
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const path = doc.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('class', `withdrawal-line withdrawal-line-${key}`);
      path.setAttribute('d', run.length === 1 ? `M${x(run[0][0]) - 1},${y(run[0][1])}h2` : run.map(([index, value], i) => `${i ? 'L' : 'M'}${x(index)},${y(value)}`).join(' '));
      svg.append(path); run = [];
    };
    model.points.forEach((row, index) => { if (row[key] === null) flush(); else run.push([index, row[key]]); });
    flush();
  }
  const readout = element(doc, 'p', 'instant-meta', 'Select a point to inspect both observed amounts.');
  readout.setAttribute('aria-live', 'polite');
  const hit = doc.createElementNS(svg.namespaceURI, 'rect');
  for (const [key, value] of Object.entries({ x: 0, y: 0, width: 720, height: 160, fill: 'transparent', tabindex: 0, role: 'slider', 'aria-label': 'Liquidity history. Use arrow keys to select a time.', 'aria-valuemin': 0, 'aria-valuemax': Math.max(0, model.points.length - 1) })) hit.setAttribute(key, String(value));
  let selected = Math.max(0, model.points.length - 1);
  const select = index => {
    selected = Math.max(0, Math.min(model.points.length - 1, index));
    const row = model.points[selected]; if (!row) return;
    const time = new Date(row.t).toLocaleString(), text = `${time} · Idle ${formatTokenAmount(row.idle, symbol)} · Including reserves ${formatTokenAmount(row.total, symbol)} · ${row.completeSamples ?? 0}/${row.samples ?? 0} complete samples`;
    readout.textContent = text; hit.setAttribute('aria-valuenow', String(selected)); hit.setAttribute('aria-valuetext', text);
  };
  hit.addEventListener('pointermove', event => {
    const box = svg.getBoundingClientRect();
    if (box.width) select(Math.round((event.clientX - box.left) / box.width * (model.points.length - 1)));
  });
  hit.addEventListener('click', () => select(selected));
  hit.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); select(selected + (event.key === 'ArrowLeft' ? -1 : 1)); }
  });
  svg.append(hit);
  const legend = element(doc, 'div', 'withdrawal-legend');
  legend.append(element(doc, 'span', 'withdrawal-idle-key', 'Idle liquidity'), element(doc, 'span', 'withdrawal-total-key', 'Including reserves'));
  container.append(legend, svg, readout);
  return container;
}

export async function renderWithdrawalLiquidity(container, { targetId, positionAmount = null, symbol = '', fetchImpl = fetch } = {}) {
  if (!container) return;
  const previous = views.get(container);
  if (previous?.targetId === targetId && previous.positionAmount === positionAmount && Date.now() - previous.loadedAt < 45000) return;
  if (previous) clearTimeout(previous.timer);
  const state = { targetId, positionAmount, window: previous?.window || '24h', loadedAt: Date.now(), timer: null, requestId: 0 };
  views.set(container, state);
  const doc = container.ownerDocument;
  const el = (tag, cls, text) => element(doc, tag, cls, text);
  container.hidden = false; container.classList.add('withdrawal-liquidity'); container.dataset.targetId = targetId;
  const heading = el('h3', 'withdrawal-heading', 'Withdrawal liquidity');
  const status = el('p', 'instant-meta', 'Loading recorded onchain observations…');
  status.setAttribute('role', 'status');
  container.replaceChildren(heading, status);
  async function load() {
    const requestId = ++state.requestId;
    try {
      const response = await fetchImpl(`/api/vaults/withdrawal-liquidity?targetId=${encodeURIComponent(targetId)}&window=${state.window}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('unavailable');
      const data = await response.json();
      if (data.targetId !== targetId) throw new Error('wrong target');
      const model = withdrawalLiquidityModel(data, positionAmount);
      if (views.get(container) !== state || state.requestId !== requestId) return;
      const metrics = el('div', 'withdrawal-metrics');
      for (const [label, value, detail] of [
        ['Tier 1 · Idle liquidity', model.idle, 'Tokens held idle by the vault'],
        ['Tier 2 · Including reserves', model.total, 'Estimated capacity · includes Tier 1'],
      ]) {
        const card = el('div', 'withdrawal-metric');
        card.append(el('span', 'withdrawal-label', label), el('strong', 'withdrawal-amount', formatTokenAmount(value, symbol)), el('span', 'instant-meta', detail));
        metrics.append(card);
      }
      const fresh = model.status === 'unavailable' ? 'No observations yet. History starts when collection begins.'
        : `${model.stale ? 'Data delayed — last observed ' : 'Observed '}${formatAgo(model.observedAt) || 'at an unknown time'} · ${model.commitment} slot ${model.slot}${model.status === 'partial' ? ' · Reserve data unavailable' : ''}`;
      status.textContent = fresh;
      status.title = model.observedAt || '';
      const details = el('div', 'withdrawal-summary');
      if (model.position !== null) {
        details.append(el('p', 'instant-meta', `Your position: ${formatTokenAmount(model.position, symbol)}`));
        details.append(el('p', 'instant-meta', model.positionCapacity === null ? 'Position capacity unavailable until complete, fresh evidence is available.'
          : `Estimated liquidity for your position: ${formatTokenAmount(model.positionCapacity, symbol)} · ${(model.positionCoverage * 100).toFixed(1)}%`));
      }
      if (model.vaultCoverage !== null) details.append(el('p', 'instant-meta', `Observed capacity / estimated vault assets, before fees: ${model.vaultCoverage.toFixed(1)}%`));
      const controls = el('div', 'instant-window');
      controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'Liquidity history window');
      for (const window of windows) {
        const button = el('button', '', window); button.type = 'button'; button.setAttribute('aria-pressed', String(state.window === window));
        button.addEventListener('click', () => { state.window = window; load(); });
        controls.append(button);
      }
      const coverage = el('p', 'instant-meta', `History: minimum observed per bucket · ${data.coverage?.completeMinutes ?? 0} complete minute samples · ${(model.dataCoverage * 100).toFixed(1)}% window coverage · gaps are unknown`);
      const evidence = el('details', 'withdrawal-evidence');
      evidence.append(el('summary', '', 'Reserve breakdown and evidence'));
      for (const reserve of model.reserves) {
        evidence.append(el('p', 'instant-meta', `${reserve.reserve === model.selectedReserve ? 'Selected · ' : ''}${reserve.reserve}: ${formatTokenAmount(reserve.amount, symbol)} attributable${reserve.eligible ? '' : ' · restricted'}`));
        evidence.append(el('p', 'instant-meta', `Vault-owned value ${formatTokenAmount(reserve.owned, symbol)} · Free cash after queue ${formatTokenAmount(reserve.free, symbol)} · Queue-held ${formatTokenAmount(reserve.queued, symbol)} · Cap remaining ${reserve.cap === null ? 'not configured' : formatTokenAmount(reserve.cap, symbol)}`));
      }
      evidence.append(el('p', 'instant-meta', `Calculation: ${model.calculationVersion || 'unavailable'} · Observation: ${model.observationId || 'unavailable'}`));
      for (const reason of model.reasons) evidence.append(el('p', 'instant-meta', reason));
      const caveat = el('p', 'withdrawal-caveat', 'Vault-level liquidity shared by all holders, before fees. Tier 2 models one reserve; execution still depends on permissions, protocol state, transaction limits and competing withdrawals. An estimate is not a guaranteed or simulated exit.');
      const publicLink = el('a', 'withdrawal-public-link', 'View public vault liquidity');
      publicLink.href = `/liquidity.html?targetId=${encodeURIComponent(targetId)}`;
      container.replaceChildren(heading, metrics, status, details, controls, coverage, withdrawalHistoryChart(model, { document: doc, symbol }), evidence, caveat, publicLink);
      state.loadedAt = Date.now();
    } catch {
      if (views.get(container) === state && state.requestId === requestId) {
        status.textContent = 'Recorded liquidity is unavailable. No live fallback is substituted for missing history.';
        container.replaceChildren(heading, status);
      }
    }
    if (views.get(container) === state && state.requestId === requestId) {
      clearTimeout(state.timer);
      state.timer = setTimeout(() => { if (container.isConnected) load(); }, 60000);
    }
  }
  await load();
}
