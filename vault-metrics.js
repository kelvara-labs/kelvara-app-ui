// Vault metric registry for the Vaults workspace.
//
// Every metric shown for a vault is one entry here. To add an observation-hub parameter, append an
// entry; the page renders its key figures, its section and its list badge without other changes.
//
//   id           stable identifier (also the section's DOM id suffix)
//   title        section heading
//   description  one line under the heading
//   windowed     true when the data depends on the shared 24h / 7d / 30d window
//   load(ctx)    -> data. Use ctx.getJson(url, { timeoutMs? }) so metrics sharing an endpoint share one request.
//   summary(data, ctx) -> [{ label, value, unit?, detail?, swatch? }]   key figures at the top (optional)
//   badge(data, ctx)   -> short text for the vault's row in the list (optional; first one wins)
//   render(section, data, ctx)   fills the metric's section body
//
// ctx: { vault: { targetId, address, name, symbol, positionAmount, details }, window, document, getJson }
// A metric that throws in load() or render() shows as unavailable without affecting the others.
//
// Every figure is read from recorded on-chain evidence (observation hub) or a direct chain read; nothing is
// scored, rated or estimated, and missing records stay missing.
import { formatTokenAmount } from './instant-liquidity.js';
import { VAULT_TIERS, vaultCompositionModel, vaultPercent } from './vault-composition.js';
import { vaultSeriesChart, vaultStackChart } from './vault-charts.js';

export const VAULT_WINDOWS = Object.freeze(['24h', '7d', '30d']);
const RAW = /^(0|[1-9]\d{0,38})$/;
const EXPLORER = 'https://orb.helius.dev/address/';

const node = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const amount = (raw, decimals) => typeof raw === 'string' && RAW.test(raw) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 18 ? Number(raw) / 10 ** decimals : null;
const query = (path, ctx, extra = '') => `${path}?targetId=${encodeURIComponent(ctx.vault.targetId)}${extra}`;
export const shortAddress = value => typeof value === 'string' && value.length > 10 ? `${value.slice(0, 4)}…${value.slice(-4)}` : String(value ?? '—');
export function compactAmount(value) {
  if (!Number.isFinite(value)) return '—';
  const size = Math.abs(value), sign = value < 0 ? '−' : '';
  const [divisor, suffix] = size >= 1e9 ? [1e9, 'B'] : size >= 1e6 ? [1e6, 'M'] : size >= 1e3 ? [1e3, 'K'] : [1, ''];
  return `${sign}${(size / divisor).toFixed(2)}${suffix}`;
}
// Short signed axis label: +1.2M, 0, −350K.
export function axisAmount(value) {
  if (!Number.isFinite(value) || value === 0) return '0';
  const size = Math.abs(value), [divisor, suffix] = size >= 1e9 ? [1e9, 'B'] : size >= 1e6 ? [1e6, 'M'] : size >= 1e3 ? [1e3, 'K'] : [1, ''];
  const scaled = size / divisor;
  return `${value < 0 ? '−' : '+'}${scaled >= 100 ? scaled.toFixed(0) : scaled >= 10 ? scaled.toFixed(1).replace(/\.0$/, '') : scaled.toFixed(2).replace(/\.?0+$/, '')}${suffix}`;
}
export const signedPercent = (fraction, digits = 2) => Number.isFinite(fraction) ? `${fraction < 0 ? '−' : '+'}${Math.abs(fraction * 100).toFixed(digits)}%` : '—';
const bpsPercent = bps => bps !== null && bps !== undefined && Number.isFinite(Number(bps)) ? `${(Number(bps) / 100).toFixed(Number(bps) % 100 ? 2 : 0)}%` : '—';
const shortDate = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function vaultFigure(doc, item) {
  const figure = node(doc, 'div', `vault-figure${item.swatch ? ` vault-swatch-${item.swatch}` : ''}${item.tone ? ` is-${item.tone}` : ''}`);
  const value = node(doc, 'strong', 'vault-figure-value', item.value);
  if (item.unit) value.append(node(doc, 'small', 'vault-figure-unit', item.unit));
  figure.append(node(doc, 'span', 'vault-figure-label', item.label), value);
  if (item.detail) figure.append(node(doc, 'span', 'vault-figure-detail', item.detail));
  if (item.section) {
    figure.classList.add('is-link'); figure.tabIndex = 0; figure.setAttribute('role', 'link');
    const go = () => doc.getElementById(`vault-metric-${item.section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    figure.addEventListener('click', go); figure.addEventListener('keydown', event => { if (event.key === 'Enter') go(); });
  }
  return figure;
}
const figureRow = (doc, items) => { const row = node(doc, 'div', 'vault-figures vault-section-figures'); row.append(...items.map(item => vaultFigure(doc, item))); return row; };
const addressLink = (doc, address, text = shortAddress(address)) => {
  const link = node(doc, 'a', 'vault-address', text);
  link.href = `${EXPLORER}${encodeURIComponent(address)}`; link.target = '_blank'; link.rel = 'noopener'; link.title = address;
  return link;
};
function dataTable(doc, headers, rows, className = '') {
  const wrap = node(doc, 'div', `vault-data-table ${className}`.trim());
  const table = node(doc, 'table'), head = node(doc, 'tr');
  for (const label of headers) head.append(node(doc, 'th', '', label));
  table.append(head);
  for (const cells of rows) {
    const tr = node(doc, 'tr');
    cells.forEach((cell, index) => { const td = node(doc, 'td'); td.dataset.label = headers[index]; td.append(cell); tr.append(td); });
    table.append(tr);
  }
  wrap.append(table);
  return wrap;
}
function facts(doc, rows) {
  const list = node(doc, 'dl', 'vault-references vault-facts');
  for (const [label, value] of rows) { const dd = node(doc, 'dd'); dd.append(value); list.append(node(doc, 'dt', '', label), dd); }
  return list;
}
// Method notes live behind one toggle per section instead of paragraphs under every chart.
// Method notes are kept in code for reviewers but not rendered: the page shows figures and charts only.
const about = doc => doc.createDocumentFragment();
const PROFILE = 'vault-profile/v1';
async function loadProfile(ctx) {
  const data = await ctx.getJson(query('/api/vaults/profile', ctx, `&window=${ctx.window}`));
  if (data?.schemaVersion !== PROFILE || data.targetId !== ctx.vault.targetId) throw new Error('wrong_target');
  return data;
}

// ---- Withdrawal liquidity (Tier 1 / Tier 2 / lent) -------------------------------------------------------
const withdrawalLiquidity = {
  id: 'withdrawal-liquidity',
  title: 'Can I get out now?',
  description: 'Withdrawal liquidity: how much of the vault an exit can be paid from right now.',
  windowed: true,
  async load(ctx) {
    const data = await ctx.getJson(query('/api/vaults/withdrawal-liquidity', ctx, `&window=${ctx.window}`));
    if (data?.targetId !== ctx.vault.targetId) throw new Error('wrong_target');
    return vaultCompositionModel(data, { positionAmount: ctx.vault.positionAmount });
  },
  summary(model, ctx) {
    const current = model.current;
    return [{ section: 'withdrawal-liquidity', label: 'Instant exit now', value: current ? vaultPercent(current.tier1Share + current.tier2Share) : '—', detail: current ? `${compactAmount(current.tier1 + current.tier2)} ${ctx.vault.symbol} of the vault` : 'Unavailable' }];
  },
  badge(model) {
    return model.current ? `Instant ${vaultPercent(model.current.tier1Share + model.current.tier2Share)} of vault` : null;
  },
  render(section, model, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol, unit = symbol ? ` ${symbol}` : '', current = model.current;
    if (!current) { section.append(node(doc, 'p', 'vault-chart-note', model.status === 'unavailable' ? 'No observations yet. History starts when collection begins.' : 'Reserve data incomplete right now; tiers unknown.')); return; }
    // Current state: the whole vault as one bar. Tiny tiers get a minimum visible width so they never vanish.
    const bar = node(doc, 'div', 'vault-split');
    const parts = [['tier1', 'Paid first · vault idle cash', current.tier1, current.tier1Share], ['tier2', 'Then · free cash in the lending reserve', current.tier2, current.tier2Share], ['lent', 'Lent to borrowers · waits for repayment', current.lent, current.lentShare]];
    const track = node(doc, 'div', 'vault-split-track');
    for (const [key, , value, share] of parts) {
      const seg = node(doc, 'span', `vault-split-seg vault-split-${key}`);
      seg.style.flexGrow = String(Math.max(share, key === 'lent' ? 0 : 0.015));
      seg.title = `${compactAmount(value)}${unit} · ${vaultPercent(share)}`;
      track.append(seg);
    }
    if (model.position) {
      const marker = node(doc, 'span', 'vault-split-you');
      marker.style.left = `${Math.min(100, model.position / current.gross * 100).toFixed(3)}%`;
      marker.title = `Your position ${compactAmount(model.position)}${unit}`;
      track.append(marker);
    }
    const legend = node(doc, 'div', 'vault-split-legend');
    for (const [key, label, value, share] of parts) {
      const item = node(doc, 'div', `vault-split-item vault-split-key-${key}`);
      item.append(node(doc, 'i'), node(doc, 'span', '', label), node(doc, 'strong', '', `${compactAmount(value)}${unit}`), node(doc, 'small', '', vaultPercent(share)));
      legend.append(item);
    }
    bar.append(track, legend);
    section.append(bar);
    if (model.positionShareOfVault !== null) section.append(node(doc, 'p', 'vault-chart-note', `Your position is ${vaultPercent(model.positionShareOfVault)} of the vault · instant cash covers it ${(current.tier1 + current.tier2) >= model.position ? 'fully' : `${vaultPercent((current.tier1 + current.tier2) / model.position)}`}.`));
    // History on demand: instant cash over time (Tier 1 + Tier 2), rendered when first opened.
    const history = node(doc, 'details', 'vault-history');
    history.append(node(doc, 'summary', '', `Show history · ${model.window}`));
    history.addEventListener('toggle', () => {
      if (!history.open || history.dataset.rendered) return;
      history.dataset.rendered = '1';
      const [tier1, tier2] = VAULT_TIERS;
      history.append(vaultStackChart({
        document: doc, window: model.window, label: 'Instant cash', height: 160,
        points: model.points.map(row => ({ t: row.t, observedAt: row.observedAt, parts: row.parts })),
        layers: [{ key: 'tier1', label: tier1.label, value: point => point.parts?.tier1 }, { key: 'tier2', label: tier2.label, value: point => point.parts?.tier2 }],
        format: (value, { axis } = {}) => axis ? compactAmount(value) : `${compactAmount(value)}${unit}`,
        tip: point => [{ key: 'tier1', text: `Tier 1 ${compactAmount(point.parts.tier1)}${unit}` }, { key: 'tier2', text: `Tier 2 ${compactAmount(point.parts.tier2)}${unit}` }, `Instant ${vaultPercent(point.parts.tier1Share + point.parts.tier2Share)} of vault`],
      }));
    });
    section.append(history);
    if (model.stale) section.append(node(doc, 'p', 'vault-chart-note', `Delayed · last observed ${shortDate(model.observedAt)}`));
  },
};

// ---- Value, share price, yield and flows ----------------------------------------------------------------
export function vaultValueModel(profile, { window }) {
  const decimals = profile.tokenDecimals;
  // Shares are priced against the token only when the vault's recorded share decimals match.
  const priced = Number.isInteger(decimals) && profile.sharesDecimals === decimals;
  const price = (net, shares) => priced && RAW.test(net ?? '') && RAW.test(shares ?? '') && BigInt(shares) > 0n ? Number(net) / Number(shares) : null;
  const points = profile.value.points.map(point => {
    const deposits = amount(point.depositsRaw ?? '0', decimals), withdrawals = amount(point.withdrawalsRaw ?? '0', decimals);
    return {
      t: point.t, observedAt: point.observedAt, price: price(point.netAssetsRaw, point.sharesIssuedRaw), value: amount(point.netAssetsRaw, decimals),
      flow: point.sampleCount && deposits !== null && withdrawals !== null ? deposits - withdrawals : null, deposits, withdrawals,
    };
  });
  const priceFirst = profile.value.first ? price(profile.value.first.netAssetsRaw, profile.value.first.sharesIssuedRaw) : null;
  const lastPoint = [...points].reverse().find(point => point.price !== null) ?? null;
  const latest = profile.value.latest;
  const priceNow = latest ? price(latest.netAssetsRaw, latest.sharesIssuedRaw) : null;
  const days = priceFirst !== null && lastPoint ? (Date.parse(lastPoint.observedAt) - Date.parse(profile.value.first.observedAt)) / 86400000 : null;
  const change = priceFirst && lastPoint ? lastPoint.price / priceFirst - 1 : null;
  return {
    window, priced, decimals, points, priceNow, change, days,
    // Annualised only over at least two recorded days; a 24h figure compounds noise and the vault's update lag.
    annualized: change !== null && window !== '24h' && days >= 2 ? (1 + change) ** (365 / days) - 1 : null,
    valueNow: latest ? amount(latest.netAssetsRaw, decimals) : null,
    deposits: amount(profile.value.flows.depositsRaw, decimals), withdrawals: amount(profile.value.flows.withdrawalsRaw, decimals),
    observedAt: latest?.observedAt ?? null, valueUpdatedAt: latest?.valueUpdatedAt ?? null, recorded: points.filter(point => point.value !== null).length,
  };
}

const valueAndYield = {
  id: 'value',
  title: 'Is it worth it?',
  description: 'Value, share price and flows: what one share is worth over time, the yield it implies, and money moving in and out.',
  windowed: true,
  async load(ctx) { return vaultValueModel(await loadProfile(ctx), ctx); },
  summary(model) { return [{ section: 'value', label: model.annualized === null ? `Change · ${model.window}` : `Yield · ${model.window}`, value: model.annualized === null ? signedPercent(model.change, 3) : signedPercent(model.annualized), detail: model.annualized === null ? 'Annualised from 7d / 30d' : 'Annualised from share price' }]; },
  render(section, model, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol, net = model.deposits !== null && model.withdrawals !== null ? model.deposits - model.withdrawals : null;
    section.append(figureRow(doc, [
      { label: 'Share price', value: model.priceNow === null ? '—' : model.priceNow.toFixed(6), unit: model.priceNow === null ? '' : symbol, detail: model.priced ? 'Recorded value of one share' : 'Waiting for recorded share decimals' },
      { label: `Change · ${model.window}`, value: signedPercent(model.change, 3), detail: model.days === null ? 'Not enough records' : `Over ${model.days.toFixed(1)} recorded days` },
      { label: 'Annualised', value: model.annualized === null ? '—' : signedPercent(model.annualized), detail: model.window === '24h' ? 'Shown for 7d and 30d' : model.annualized === null ? 'Needs 2 recorded days' : 'From the share price change' },
      { label: `Net flows · ${model.window}`, value: net === null ? '—' : compactAmount(net), unit: net === null ? '' : symbol, detail: `In ${compactAmount(model.deposits)} · Out ${compactAmount(model.withdrawals)}` },
    ]));
    section.append(node(doc, 'h4', 'vault-subhead', 'Vault value (TVL)'), vaultSeriesChart({
      document: doc, window: model.window, label: 'Vault value', format: (value, { axis } = {}) => axis ? compactAmount(value) : `${compactAmount(value)}${symbol ? ` ${symbol}` : ''}`,
      points: model.points.map(point => ({ t: point.t, observedAt: point.observedAt, value: point.value })),
    }));
    const fmtPrice = value => value.toFixed(value >= 100 ? 2 : 4);
    section.append(node(doc, 'h4', 'vault-subhead', 'Share price'), vaultSeriesChart({
      document: doc, window: model.window, label: 'Share price', format: (value, { axis } = {}) => axis ? fmtPrice(value) : `${value.toFixed(6)} ${symbol}`,
      points: model.points.map(point => ({ t: point.t, observedAt: point.observedAt, value: point.price, detail: point.value === null ? [] : [`Vault value ${compactAmount(point.value)} ${symbol}`] })),
    }));
    section.append(node(doc, 'h4', 'vault-subhead', 'Net deposits and withdrawals'), vaultSeriesChart({
      document: doc, window: model.window, mode: 'bars', label: 'Net flow', format: (value, { axis } = {}) => axis ? axisAmount(value) : `${value > 0 ? '+' : ''}${compactAmount(value)}${symbol ? ` ${symbol}` : ''}`,
      points: model.points.map(point => ({ t: point.t, observedAt: point.observedAt, value: point.flow, detail: point.flow === null ? [] : [`In ${compactAmount(point.deposits)} · Out ${compactAmount(point.withdrawals)}`] })),
    }));
    const updated = model.valueUpdatedAt ? `Vault value last moved on-chain ${shortDate(model.valueUpdatedAt)}.` : `Vault value did not move on-chain in ${model.window}.`;
    section.append(about(doc, 'Value is the vault\'s own recorded assets after recorded fees; Kamino refreshes it whenever the vault is used, so a quiet vault can lag interest by minutes. Share price = value ÷ shares. Shares only change on deposits and withdrawals, so each change is priced at the recorded share price. Gaps mean nothing was recorded.',
      `${updated} ${model.recorded} intervals recorded${model.observedAt ? `, latest ${shortDate(model.observedAt)}` : ''}.`));
  },
};

// ---- Collateral behind the lending market ------------------------------------------------------------------
const RISK = 'vault-risk/v1';
async function loadRisk(ctx) {
  const data = await ctx.getJson(query('/api/vaults/risk', ctx), { timeoutMs: 60000 });
  if (data?.schemaVersion !== RISK || data.targetId !== ctx.vault.targetId) throw new Error('wrong_target');
  return data;
}
const usd = value => Number.isFinite(value) ? `$${compactAmount(value)}` : '—';
const ago = seconds => seconds === null || seconds === undefined ? '—' : seconds < 120 ? `${Math.round(seconds)} s ago` : seconds < 7200 ? `${Math.round(seconds / 60)} min ago` : seconds < 172800 ? `${Math.round(seconds / 3600)} h ago` : `${Math.round(seconds / 86400)} d ago`;
export function collateralModel(risk) {
  const rows = risk.markets.flatMap(market => market.reserves.filter(row => row.maxLtv > 0 && row.valueUsd > 0).map(row => ({ ...row, market: market.market })));
  // A floor hides losses when the oracle price stops before a borrower at max LTV is underwater
  // (room to floor < 1 − max LTV). Stablecoin floors near $1 are depeg guards, shown neutrally.
  for (const row of rows) {
    row.underwaterAt = row.maxLtv > 0 ? 1 - row.maxLtv : null;
    row.depegGuard = row.band !== null && row.priceUsd !== null && Math.abs(row.priceUsd - 1) < 0.03 && row.band.lower >= 0.95 && row.band.lower <= 1;
    row.hidesLoss = !row.depegGuard && row.floorDistance !== null && row.underwaterAt !== null && row.floorDistance < row.underwaterAt;
  }
  const total = rows.reduce((sum, row) => sum + row.valueUsd, 0), hiding = rows.filter(row => row.hidesLoss);
  return { rows: rows.sort((a, b) => b.valueUsd - a.valueUsd), total, flooredUsd: hiding.reduce((sum, row) => sum + row.valueUsd, 0), hidingNames: hiding.map(row => row.name || shortAddress(row.mint)), markets: risk.markets.length, observedAt: risk.observedAt,
    lent: risk.markets.flatMap(market => market.reserves.filter(row => row.lendsHere)) };
}
const collateral = {
  id: 'collateral',
  title: 'What protects the lent cash?',
  description: 'Collateral posted by borrowers in those markets, and whether its oracle price can show a loss.',
  windowed: false,
  async load(ctx) { return collateralModel(await loadRisk(ctx)); },
  render(section, model, ctx) {
    const doc = ctx.document;
    if (!model.rows.length) { section.append(node(doc, 'p', 'vault-chart-note', 'No collateral is posted in the markets this vault lends into.')); return; }
    const top = model.rows[0];
    section.append(figureRow(doc, [
      { label: 'Collateral posted', value: usd(model.total), detail: `${model.rows.length} asset${model.rows.length === 1 ? '' : 's'} in ${model.markets} market${model.markets === 1 ? '' : 's'}` },
      { label: 'Largest collateral', value: top.name || shortAddress(top.mint), detail: `${vaultPercent(top.valueUsd / model.total)} of collateral` },
      { label: 'Floor hides losses', value: usd(model.flooredUsd), detail: model.flooredUsd ? model.hidingNames.slice(0, 3).join(', ') : 'Every floor sits below the underwater point', tone: model.flooredUsd ? 'warn' : null },
      { label: 'Your cash lent at', value: model.lent.length ? vaultPercent(model.lent[0].utilization) : '—', detail: 'Utilization of the vault\'s reserve' },
    ]));
    section.append(dataTable(doc, ['Collateral', 'Posted', 'Max LTV', 'Price', 'Price floor', 'Floor vs underwater'], model.rows.slice(0, 12).map(row => {
      const verdict = row.floorDistance === null ? 'No floor' : row.depegGuard ? `Depeg guard · ${signedPercent(-row.floorDistance, 1)}` : `Floor ${signedPercent(-row.floorDistance, 0)} · underwater ${signedPercent(-row.underwaterAt, 0)}`;
      return [row.name || addressLink(doc, row.reserve), usd(row.valueUsd), vaultPercent(row.maxLtv), row.priceUsd === null ? '—' : `$${row.priceUsd >= 100 ? row.priceUsd.toFixed(2) : row.priceUsd.toFixed(4)}`,
        row.band ? `$${row.band.lower.toFixed(row.band.lower >= 100 ? 2 : 4)}` : '—', node(doc, 'span', row.hidesLoss ? 'vault-flag-warn' : row.depegGuard ? 'vault-flag-muted' : '', verdict)];
    }), 'vault-collateral-table'));
    if (model.flooredUsd) section.append(node(doc, 'p', 'vault-callout', `${usd(model.flooredUsd)} of collateral (${model.hidingNames.join(', ')}) has an oracle floor above the point where a borrower at max LTV is underwater. A loss between the two cannot trigger liquidations and would fall on lenders in that market, including this vault.`));
  },
  summary(model) { return [{ section: 'collateral', label: 'Floor hides losses', value: usd(model.flooredUsd), detail: model.flooredUsd ? model.hidingNames.slice(0, 2).join(', ') : 'None in these markets', tone: model.flooredUsd ? 'warn' : null }]; },
};

// ---- Lending reserves the vault lends into ---------------------------------------------------------------
export function reserveHealthModel(profile) {
  const decimals = profile.tokenDecimals;
  return {
    observedAt: profile.reserves.observedAt, slot: profile.reserves.slot, window: profile.window,
    rows: profile.reserves.latest.map(row => ({
      reserve: row.reserve, share: row.shareOfVaultBps === null ? null : row.shareOfVaultBps / 10000,
      utilization: row.utilizationBps === null ? null : row.utilizationBps / 10000,
      range: row.utilizationRange ? [row.utilizationRange.minBps / 10000, row.utilizationRange.maxBps / 10000] : null,
      owned: amount(row.ownedRaw, decimals), free: amount(row.freeRaw, decimals), borrowed: amount(row.borrowedRaw, decimals),
      capRemaining: row.capRemainingRaw === null ? null : amount(row.capRemainingRaw, decimals), capCapacity: amount(row.capCapacityRaw, decimals), eligible: row.eligible,
    })),
  };
}
const lendingReserves = {
  id: 'reserves',
  title: 'Where is my cash lent?',
  description: 'The Kamino Lend reserves this vault lends into: how full they are and how much cash they hold.',
  windowed: true,
  async load(ctx) { return reserveHealthModel(await loadProfile(ctx)); },
  render(section, model, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol;
    if (!model.rows.length) { section.append(node(doc, 'p', 'vault-meta-line', `No complete reserve observation in ${model.window}.`)); return; }
    section.append(dataTable(doc, ['Reserve', 'Share of vault', 'Utilization', `Range · ${model.window}`, 'Free cash', 'Withdrawal cap left', 'Status'], model.rows.map(row => [
      addressLink(doc, row.reserve), vaultPercent(row.share), vaultPercent(row.utilization),
      row.range ? `${vaultPercent(row.range[0])} – ${vaultPercent(row.range[1])}` : '—',
      `${compactAmount(row.free)} ${symbol}`.trim(),
      row.capRemaining === null ? 'No cap' : `${compactAmount(row.capRemaining)} ${symbol}`.trim(),
      row.eligible ? '✓ Active' : '! Restricted',
    ]), 'vault-reserve-table'));
    section.append(about(doc, `Observed ${shortDate(model.observedAt)} · finalized slot ${model.slot}.`, 'Utilization = borrowed ÷ supplied. Near 100% the reserve holds little free cash, so Tier 2 shrinks and exits wait for repayments. The withdrawal cap is the reserve\'s own daily outflow limit; "Restricted" means the reserve is paused or in emergency mode and an exit cannot draw on it.'));
  },
};

// ---- Holder concentration ---------------------------------------------------------------------------------
// 10×10 share heatmap: each cell is 1% of all shares. Top holders get cells by share (largest remainder),
// deepest colour for the largest holder; the rest of the vault fills the remaining cells in a neutral tone.
export const tenureBand = days => days === null || days === undefined ? 'unknown' : days >= 90 ? 3 : days >= 30 ? 2 : days >= 7 ? 1 : 0;
export function holderCells(top, cells = 100) {
  const exact = top.map(row => row.share * cells), counts = exact.map(Math.floor);
  let left = Math.min(cells, Math.round(top.reduce((sum, row) => sum + row.share, 0) * cells)) - counts.reduce((a, b) => a + b, 0);
  exact.map((value, index) => [value - counts[index], index]).sort((a, b) => b[0] - a[0]).forEach(([, index]) => { if (left > 0) { counts[index]++; left--; } });
  const out = [];
  counts.forEach((count, rank) => { for (let i = 0; i < count; i++) out.push(rank); });
  while (out.length < cells) out.push(null);
  return out;
}
// Click to expand: the top 20 by value with a value bar, holding time and their changes per 6-hour snapshot.
function holderChanges(doc, model, symbol) {
  const details = node(doc, 'details', 'vault-history vault-holder-changes');
  details.append(node(doc, 'summary', '', `Show top ${model.top.length} holders and their moves`));
  details.addEventListener('toggle', () => {
    if (!details.open || details.dataset.rendered) return;
    details.dataset.rendered = '1';
    const max = Math.max(...model.top.map(row => row.value ?? 0), 1), snaps = (model.history?.snapshots || []).slice(-28);
    const list = node(doc, 'div', 'vault-holder-rows');
    for (const row of model.top) {
      const item = node(doc, 'div', 'vault-holder-row'), bar = node(doc, 'span', 'vault-holder-bar'), fill = node(doc, 'i', `is-tenure-${tenureBand(row.ageDays)}`);
      fill.style.width = `${((row.value ?? 0) / max * 100).toFixed(1)}%`; bar.append(fill);
      const who = node(doc, 'span', 'vault-holder-who'); who.append(node(doc, 'b', '', `#${row.rank}`), ` ${shortAddress(row.owner)}`);
      for (const label of row.labels || []) who.append(node(doc, 'em', 'vault-holder-tag', label.kind.replace(/_/g, ' ')));
      const strip = node(doc, 'span', 'vault-holder-strip');
      snaps.forEach((snap, index) => {
        const now = Number(snap.holders.find(h => h.owner === row.owner)?.sharesRaw ?? 0), prev = index ? Number(snaps[index - 1].holders.find(h => h.owner === row.owner)?.sharesRaw ?? 0) : now;
        const change = prev > 0 ? now / prev - 1 : now > 0 && index ? 1 : 0, tick = node(doc, 'i', change > 0.001 ? 'is-up' : change < -0.001 ? 'is-down' : '');
        tick.style.setProperty('--mag', Math.min(1, Math.abs(change) * 4).toFixed(2));
        tick.title = `${shortDate(snap.observedAt)} · ${change === 0 ? 'no change' : signedPercent(change, 1)}`;
        strip.append(tick);
      });
      if (!snaps.length) strip.append(node(doc, 'small', '', 'History builds every 6 h'));
      item.append(who, bar, node(doc, 'span', 'vault-holder-value', row.value === null ? '—' : `${compactAmount(row.value)} ${symbol}`.trim()),
        node(doc, 'span', 'vault-holder-since', row.ageDays === null ? 'Checking…' : `${Math.floor(row.ageDays)} d`), strip);
      list.append(item);
    }
    const head = node(doc, 'div', 'vault-holder-row is-head'); for (const text of ['Holder', 'Value', '', 'In vault', 'Moves (6 h each, green = added, red = reduced)']) head.append(node(doc, 'span', '', text));
    details.append(head, list);
  });
  return details;
}

// Current state: the top holders as one bar, each segment sized by value and coloured by time in the vault.
function holderHeatmap(doc, model, symbol) {
  const wrap = node(doc, 'div', 'vault-tenure'), bar = node(doc, 'div', 'vault-tenure-bar');
  const total = model.top.reduce((sum, row) => sum + (row.value ?? 0), 0) || 1;
  for (const row of model.top) {
    if (!row.value) continue;
    const seg = node(doc, 'span', `is-tenure-${tenureBand(row.ageDays)}`);
    seg.style.flexGrow = String(row.value / total);
    seg.title = [`#${row.rank} ${row.owner}`, `${vaultPercent(row.share)} of shares · ≈ ${compactAmount(row.value)} ${symbol}`, row.holdingSince ? `Holding since ${new Date(row.holdingSince).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} · ${Math.floor(row.ageDays)} days` : 'Holding since: checking', `Held as: ${row.heldAs}`].join('\n');
    if (row.value / total > 0.06) seg.append(node(doc, 'b', '', `#${row.rank}`));
    bar.append(seg);
  }
  const legend = node(doc, 'div', 'vault-chart-legend');
  for (const [band, text] of [[3, 'Over 90 days'], [2, '30–90 days'], [1, '7–30 days'], [0, 'Under 7 days'], ['unknown', 'Not checked yet']]) { const item = node(doc, 'span', `vault-chart-key vault-tenure-key-${band}`); item.append(node(doc, 'i'), text); legend.append(item); }
  wrap.append(node(doc, 'p', 'vault-lead', `The ${model.top.length} largest holders, sized by value and coloured by how long they have held. Hover a segment for the holder.`), bar, legend);
  const snaps = model.history?.snapshots || [];
  if (snaps.length >= 2) wrap.append(tenureOverTime(doc, model, snaps));
  else wrap.append(node(doc, 'p', 'vault-chart-note', 'Capital age over time appears after two 6-hourly holder snapshots. A shrinking long-term band means patient money is leaving.'));
  return wrap;
}

// Value-weighted mix of holding times per snapshot (top holders), as a 100% stack.
export function tenureMix(snaps, sinceByOwner) {
  return snaps.map(snap => {
    const t = Date.parse(snap.observedAt), bands = [0, 0, 0, 0, 0];
    for (const holder of snap.holders) {
      const since = sinceByOwner.get(holder.owner), shares = Number(holder.sharesRaw);
      const band = since ? tenureBand((t - Date.parse(since)) / 86_400_000) : 'unknown';
      bands[band === 'unknown' ? 4 : band] += shares;
    }
    const sum = bands.reduce((a, b) => a + b, 0) || 1;
    return { at: snap.observedAt, shares: bands.map(value => value / sum) };
  });
}
function tenureOverTime(doc, model, snaps) {
  const mix = tenureMix(snaps.slice(-28), new Map(model.top.filter(row => row.holdingSince).map(row => [row.owner, row.holdingSince])));
  const chart = node(doc, 'div', 'vault-tenure-time');
  chart.append(node(doc, 'h4', 'vault-subhead', 'Capital age over time'));
  const cols = node(doc, 'div', 'vault-tenure-cols');
  for (const column of mix) {
    const col = node(doc, 'span', 'vault-tenure-col');
    col.title = `${shortDate(column.at)} · over 90 d ${vaultPercent(column.shares[3])} · 30–90 d ${vaultPercent(column.shares[2])} · 7–30 d ${vaultPercent(column.shares[1])} · under 7 d ${vaultPercent(column.shares[0])}`;
    [3, 2, 1, 0, 4].forEach(index => { const part = node(doc, 'i', `is-tenure-${index === 4 ? 'unknown' : index}`); part.style.flexGrow = String(column.shares[index]); col.append(part); });
    cols.append(col);
  }
  const first = mix[0].shares[3], last = mix.at(-1).shares[3], change = last - first;
  chart.append(cols, node(doc, 'p', 'vault-chart-note', `Long-term (over 90 days) share of top-holder capital: ${vaultPercent(first)} → ${vaultPercent(last)}${Math.abs(change) >= 0.05 ? (change < 0 ? ' · long-term money is leaving' : ' · long-term money is growing') : ''}.`));
  return chart;
}
export function holdersModel(holders, liquidity) {
  const latest = liquidity?.latest, decimals = latest?.tokenDecimals, shares = RAW.test(holders.sharesIssuedRaw ?? '') ? BigInt(holders.sharesIssuedRaw) : 0n;
  const net = latest && RAW.test(latest.netAssetsRaw ?? '') ? BigInt(latest.netAssetsRaw) : null;
  const worth = sharesRaw => net === null || shares === 0n ? null : amount(String(BigInt(sharesRaw) * net / shares), decimals);
  const instant = latest?.status === 'complete' ? amount(latest.totalEstimatedWithdrawalRaw, decimals) : null;
  const top = holders.top.map(row => ({ ...row, share: row.shareBps / 10000, value: worth(row.sharesRaw), heldAs: row.stakedRaw === '0' ? 'Wallet' : row.walletRaw === '0' ? 'Staked in farm' : 'Wallet + farm' }));
  const largest = top[0] ?? null, nowMs = Date.now();
  for (const row of top) row.ageDays = row.holdingSince ? Math.max(0, (nowMs - Date.parse(row.holdingSince)) / 86_400_000) : null;
  const aged = top.filter(row => row.ageDays !== null && row.value !== null), agedValue = aged.reduce((sum, row) => sum + row.value, 0);
  const tenureDays = agedValue > 0 ? aged.reduce((sum, row) => sum + row.value * row.ageDays, 0) / agedValue : null;
  const longTermShare = agedValue > 0 ? aged.filter(row => row.ageDays >= 90).reduce((sum, row) => sum + row.value, 0) / agedValue : null;
  return {
    tenureDays, longTermShare, tenureKnown: aged.length,
    holderCount: holders.holderCount, top, largest, instant, topShare: holders.topShareBps === null ? null : holders.topShareBps / 10000,
    largestCovered: largest && largest.value !== null && instant !== null ? largest.value <= instant : null,
    slot: holders.slot, readAt: holders.observedAt, refreshSeconds: holders.refreshSeconds,
    unattributed: amount(holders.unattributedRaw, decimals), farm: holders.farm,
  };
}
const holderConcentration = {
  id: 'holders',
  title: 'Who else is in this vault?',
  description: 'Holder concentration and how long the money has stayed. Hover a cell for the holder behind it.',
  windowed: false,
  async load(ctx) {
    const [holders, liquidity] = await Promise.all([
      ctx.getJson(query('/api/vaults/holders', ctx), { timeoutMs: 45000 }),
      ctx.getJson(query('/api/vaults/withdrawal-liquidity', ctx, `&window=${ctx.window}`)).catch(() => null),
    ]);
    if (holders?.schemaVersion !== 'vault-holders/v1' || holders.targetId !== ctx.vault.targetId) throw new Error('wrong_target');
    const history = await ctx.getJson(query('/api/vaults/holders/history', ctx, '&window=7d')).catch(() => null);
    return { ...holdersModel(holders, liquidity?.targetId === ctx.vault.targetId ? liquidity : null), history };
  },
  summary(model) { return [{ section: 'holders', label: 'Largest holder', value: model.largest ? vaultPercent(model.largest.share) : '—', detail: `Top 10 own ${vaultPercent(model.topShare)}` }]; },
  render(section, model, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol, largest = model.largest;
    const covered = model.largestCovered === null ? '—' : model.largestCovered ? '✓ Covered' : '✕ Not covered';
    section.append(figureRow(doc, [
      { label: 'Holders', value: String(model.holderCount), detail: 'Wallets with shares, staked or not' },
      { label: 'Largest holder', value: largest ? vaultPercent(largest.share) : '—', detail: largest?.value != null ? `≈ ${compactAmount(largest.value)} ${symbol}` : 'Of all shares' },
      { label: 'Top 10 holders', value: vaultPercent(model.topShare), detail: 'Of all shares' },
      { label: 'Capital time in vault', value: model.tenureDays === null ? '…' : model.tenureDays >= 365 ? `${(model.tenureDays / 365).toFixed(1)} yrs` : `${Math.round(model.tenureDays)} days`, detail: model.tenureDays === null ? 'Checking holder history' : `Value-weighted, top ${model.tenureKnown} · ${vaultPercent(model.longTermShare)} held over 90 days` },
    ]));
    if (model.top.length) section.append(holderHeatmap(doc, model, symbol), holderChanges(doc, model, symbol));
    const hours = Math.round((model.refreshSeconds ?? 0) / 3600);
    section.append(about(doc, [`Read from chain ${model.readAt ? shortDate(model.readAt) : ''}`.trim(), model.slot ? `finalized slot ${model.slot}` : null, hours ? `refreshed every ${hours} h` : null].filter(Boolean).join(' · '), `Shares staked in the vault's Kamino farm are counted under their owner, not the farm. Values use the latest vault value per share. "Covered" means the largest position is no bigger than Tier 1 + Tier 2 right now.${model.unattributed ? ` ${compactAmount(model.unattributed)} ${symbol} of shares could not be attributed to a holder.` : ''}`));
  },
};

// ---- Exit order: who can leave before you ---------------------------------------------------------------
const INSIDER_LABELS = { vault_admin: 'Vault admin', allocation_admin: 'Allocation admin', funded_by_admin: 'Funded by admin', early_depositor: 'Early depositor' };
const HISTORY = 'vault-holder-history/v1';
// Holders in descending size, each with the cumulative value that must leave before them, against instant cash.
export function exitOrderModel({ holders, liquidity, history, profile, positionAmount }) {
  const latest = liquidity?.latest, decimals = latest?.tokenDecimals, issued = RAW.test(holders.sharesIssuedRaw ?? '') ? Number(holders.sharesIssuedRaw) : 0;
  const net = latest && RAW.test(latest.netAssetsRaw ?? '') ? amount(latest.netAssetsRaw, decimals) : null, price = net !== null && issued > 0 ? net / issued : null;
  const instant = latest?.status === 'complete' ? amount(latest.totalEstimatedWithdrawalRaw, decimals) : null;
  let cumulative = 0;
  const queue = holders.top.slice(0, 10).map(row => {
    const value = price === null ? null : Number(row.sharesRaw) * price, before = cumulative;
    cumulative += value ?? 0;
    return { rank: row.rank, owner: row.owner, value, before, after: cumulative, labels: row.labels || [], insider: Boolean(row.labels?.length), coveredInstantly: instant !== null && value !== null ? cumulative <= instant : null };
  });
  const coveredCount = queue.filter(row => row.coveredInstantly).length;
  // Exit race: largest holders' combined value at each recorded holder snapshot vs instant cash at that time.
  const prices = (profile?.value?.points || []).filter(point => RAW.test(point.netAssetsRaw ?? '') && RAW.test(point.sharesIssuedRaw ?? '') && BigInt(point.sharesIssuedRaw) > 0n)
    .map(point => ({ t: Date.parse(point.observedAt || point.t), price: amount(point.netAssetsRaw, decimals) / Number(point.sharesIssuedRaw) }));
  const priceAt = t => { let best = price; for (const row of prices) if (row.t <= t) best = row.price; return best; };
  const snapshots = history?.schemaVersion === HISTORY ? history.snapshots : [];
  const topOwners = new Set(holders.top.slice(0, 5).map(row => row.owner));
  const claimsAt = t => {
    let snap = null; for (const row of snapshots) if (Date.parse(row.observedAt) <= t) snap = row;
    if (!snap) return null;
    const p = priceAt(t);
    return p === null ? null : snap.holders.filter(row => topOwners.has(row.owner)).reduce((sum, row) => sum + Number(row.sharesRaw) * p, 0);
  };
  // Heatmap: change in each current top holder's shares between consecutive snapshots.
  const columns = snapshots.slice(-24), owners = holders.top.slice(0, 10).map(row => row.owner);
  const heat = owners.map(owner => ({ owner, cells: columns.map((snap, index) => {
    const now = Number(snap.holders.find(row => row.owner === owner)?.sharesRaw ?? 0), prev = index ? Number(columns[index - 1].holders.find(row => row.owner === owner)?.sharesRaw ?? 0) : now;
    return { at: snap.observedAt, change: prev > 0 ? now / prev - 1 : now > 0 ? 1 : 0 };
  }) }));
  const spanHours = snapshots.length > 1 ? (Date.parse(snapshots.at(-1).observedAt) - Date.parse(snapshots[0].observedAt)) / 3_600_000 : 0;
  return { queue, instant, price, coveredCount, position: positionAmount ?? null, claimsAt, snapshotCount: snapshots.length, historyReady: snapshots.length >= 4 && spanHours >= 12, heat, labelsReady: holders.labelsReady };
}

function exitQueue(doc, model, symbol) {
  const wrap = node(doc, 'div', 'vault-exit-queue'), track = node(doc, 'div', 'vault-exit-track');
  const total = Math.max(model.queue.at(-1)?.after ?? 0, model.instant ?? 0) * 1.04 || 1, pct = value => `${(value / total * 100).toFixed(3)}%`;
  for (const row of model.queue) {
    if (row.value === null) continue;
    const seg = node(doc, 'span', `vault-exit-seg${row.insider ? ' is-insider' : ''}${row.coveredInstantly === false ? ' is-uncovered' : ''}`);
    seg.style.left = pct(row.before); seg.style.width = pct(row.value);
    seg.title = `#${row.rank} ${shortAddress(row.owner)} · ${compactAmount(row.value)} ${symbol}${row.labels.length ? ` · ${row.labels.map(label => INSIDER_LABELS[label.kind] ?? label.kind).join(', ')}` : ''}`;
    if (row.value / total > 0.05) seg.append(node(doc, 'b', '', `#${row.rank}`));
    track.append(seg);
  }
  if (model.instant !== null) {
    const line = node(doc, 'span', 'vault-exit-cash'); line.style.left = pct(model.instant);
    line.append(node(doc, 'em', '', `Instant cash ${compactAmount(model.instant)}`));
    track.append(line);
  }
  wrap.append(track);
  const legend = node(doc, 'div', 'vault-chart-legend');
  for (const [cls, text] of [['vault-exit-key-covered', 'Can leave instantly'], ['vault-exit-key-uncovered', 'Waits for borrowers to repay'], ['vault-exit-key-insider', 'Insider-linked']]) { const item = node(doc, 'span', `vault-chart-key ${cls}`); item.append(node(doc, 'i'), text); legend.append(item); }
  wrap.append(legend);
  return wrap;
}

function holderChangeHeatmap(doc, model) {
  const grid = node(doc, 'div', 'vault-change-heatmap');
  grid.style.setProperty('--cols', String(Math.max(1, model.heat[0]?.cells.length ?? 1)));
  for (const row of model.heat) {
    const label = node(doc, 'span', 'vault-change-label', shortAddress(row.owner));
    grid.append(label);
    for (const cell of row.cells) {
      const box = node(doc, 'span', cell.change < -0.001 ? 'is-down' : cell.change > 0.001 ? 'is-up' : '');
      box.style.setProperty('--mag', Math.min(1, Math.abs(cell.change) * 4).toFixed(2));
      box.title = `${shortDate(cell.at)} · ${cell.change === 0 ? 'no change' : signedPercent(cell.change, 1)}`;
      grid.append(box);
    }
  }
  return grid;
}

const exitOrder = {
  id: 'exit-order',
  title: 'Who could leave before me?',
  description: 'Exit order: if the largest holders and insiders leave first, how far instant cash goes before exits have to wait.',
  windowed: true,
  async load(ctx) {
    const [holders, liquidity, history, profile] = await Promise.all([
      ctx.getJson(query('/api/vaults/holders', ctx), { timeoutMs: 45000 }),
      ctx.getJson(query('/api/vaults/withdrawal-liquidity', ctx, `&window=${ctx.window}`)),
      ctx.getJson(query('/api/vaults/holders/history', ctx, `&window=${ctx.window}`)).catch(() => null),
      loadProfile(ctx).catch(() => null),
    ]);
    if (holders?.schemaVersion !== 'vault-holders/v1' || holders.targetId !== ctx.vault.targetId) throw new Error('wrong_target');
    return { model: exitOrderModel({ holders, liquidity, history, profile, positionAmount: ctx.vault.positionAmount }), liquidity: vaultCompositionModel(liquidity) };
  },
  badge({ model }) { return model.instant === null ? null : `Instant cash covers top ${model.coveredCount}`; },
  summary({ model }) { return [{ section: 'exit-order', label: 'Top holders covered', value: model.instant === null ? '—' : `${model.coveredCount} of ${model.queue.length}`, detail: 'Could leave instantly, largest first' }]; },
  render(section, { model, liquidity }, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol, unit = symbol ? ` ${symbol}` : '';
    const insiders = model.queue.filter(row => row.insider);
    const firstWaiting = model.queue.find(row => row.coveredInstantly === false);
    section.append(figureRow(doc, [
      { label: 'Covered instantly', value: `Top ${model.coveredCount}`, detail: model.instant === null ? 'Instant cash unavailable' : `of the ${model.queue.length} largest holders` },
      { label: 'Instant cash', value: compactAmount(model.instant), unit: model.instant === null ? '' : symbol, detail: 'Tier 1 + Tier 2 now' },
      { label: 'First to wait', value: firstWaiting ? `#${firstWaiting.rank}` : 'None', detail: firstWaiting ? `after ${compactAmount(firstWaiting.before)}${unit} has left` : 'Every top holder could leave now', tone: firstWaiting && firstWaiting.rank <= 3 ? 'warn' : null },
      { label: 'Insider-linked holders', value: model.labelsReady ? String(insiders.length) : '…', detail: model.labelsReady ? (insiders.length ? `${compactAmount(insiders.reduce((sum, row) => sum + (row.value ?? 0), 0))}${unit} in the top ${model.queue.length}` : 'None in the top holders') : 'Checking admin links' },
    ]));
    const lead = model.queue[0], sentence = model.instant === null || !lead ? 'Instant cash is unavailable right now.'
      : model.coveredCount === 0 ? `The largest holder alone (${compactAmount(lead.value)}${unit}) holds more than the instant cash (${compactAmount(model.instant)}${unit}). If they withdraw first, everyone after them waits for borrowers to repay.`
      : model.coveredCount === model.queue.length ? `Instant cash (${compactAmount(model.instant)}${unit}) could pay all ${model.queue.length} largest holders at once.`
      : `Instant cash (${compactAmount(model.instant)}${unit}) runs out after the ${model.coveredCount === 1 ? 'largest holder' : `${model.coveredCount} largest holders`} withdraw${model.coveredCount === 1 ? 's' : ''}. Holders from #${model.coveredCount + 1} on would wait for borrowers to repay.`;
    section.append(node(doc, 'h4', 'vault-subhead', 'If the biggest holders leave first'), node(doc, 'p', 'vault-lead', sentence), exitQueue(doc, model, symbol));
    if (!model.historyReady) { section.append(node(doc, 'p', 'vault-chart-note', 'Holder history builds every 6 hours. Two more views appear after 12 hours: the top 5 holders\' claims against instant cash over time, and which big holders are selling or adding.')); return; }
    section.append(node(doc, 'h4', 'vault-subhead', 'Top 5 holders vs instant cash over time'), node(doc, 'p', 'vault-lead', 'Amber is cash an exit can use. The red line is what the 5 largest holders could withdraw; red shading marks when they held more than that cash.'));
    {
      const [tier1, tier2] = VAULT_TIERS;
      section.append(vaultStackChart({
        document: doc, window: liquidity.window, label: 'Instant cash', height: 170,
        points: liquidity.points.map(row => ({ t: row.t, observedAt: row.observedAt, parts: row.parts })),
        layers: [{ key: 'tier1', label: tier1.label, value: point => point.parts?.tier1 }, { key: 'tier2', label: tier2.label, value: point => point.parts?.tier2 }],
        overlay: { key: 'claims', label: 'Top 5 holders', value: point => model.claimsAt(Date.parse(point.observedAt || point.t)) },
        format: (value, { axis } = {}) => axis ? compactAmount(value) : `${compactAmount(value)}${unit}`,
        tip: point => { const claims = model.claimsAt(Date.parse(point.observedAt || point.t)); return [`Instant ${compactAmount(point.parts.tier1 + point.parts.tier2)}${unit}`, { key: 'claims', text: `Top 5 holders ${compactAmount(claims)}${unit}` }]; },
      }));
    }
    section.append(node(doc, 'h4', 'vault-subhead', 'Are the big holders selling?'), node(doc, 'p', 'vault-lead', 'One row per big holder, one square per 6 hours. Red = they reduced their position, lime = they added, grey = no change.'), holderChangeHeatmap(doc, model));
  },
};

// ---- Fees and control -------------------------------------------------------------------------------------
const TERM_LABELS = { performanceFeeBps: 'Performance fee', managementFeeBps: 'Management fee', vaultAdmin: 'Vault admin', allocationAdmin: 'Allocation admin', pendingAdmin: 'Pending admin' };
const feesAndControl = {
  id: 'fees-control',
  title: 'Who controls it?',
  description: 'Fees, admin keys, program upgrades and every change recorded in the window.',
  windowed: true,
  async load(ctx) {
    const [profile, risk] = await Promise.all([loadProfile(ctx), loadRisk(ctx).catch(() => null)]);
    if (!profile.terms) throw new Error('no_terms');
    return { ...profile.terms, window: profile.window, decimals: profile.tokenDecimals, risk };
  },
  summary(terms) { const last = terms.changes?.at(-1); return [{ section: 'fees-control', label: `Admin changes · ${terms.window}`, value: String(terms.changes?.length ?? 0), detail: last ? `Last ${shortDate(last.observedAt)}` : 'None recorded' }]; },
  render(section, terms, ctx) {
    const doc = ctx.document, symbol = ctx.vault.symbol, withdrawal = terms.withdrawal;
    const transfer = terms.pendingAdmin && terms.pendingAdmin !== terms.vaultAdmin && terms.pendingAdmin !== '11111111111111111111111111111111';
    const keyValue = address => address ? addressLink(doc, address, address) : doc.createTextNode('None');
    section.append(facts(doc, [
      ['Performance fee', doc.createTextNode(`${bpsPercent(terms.performanceFeeBps)} of yield`)],
      ['Management fee', doc.createTextNode(`${bpsPercent(terms.managementFeeBps)} per year`)],
      // Both penalty parameters are shown as configured; the IDL does not say how the program combines them.
      ['Withdrawal penalty rate', doc.createTextNode(withdrawal ? bpsPercent(withdrawal.penaltyBps) : 'Not recorded yet')],
      ['Withdrawal penalty amount', doc.createTextNode(withdrawal ? `${formatTokenAmount(amount(withdrawal.penaltyRaw, terms.decimals))} ${symbol}` : 'Not recorded yet')],
      ['Minimum withdrawal', doc.createTextNode(withdrawal ? `${formatTokenAmount(amount(withdrawal.minWithdrawRaw, terms.decimals))} ${symbol}` : 'Not recorded yet')],
      ['Vault admin', keyValue(terms.vaultAdmin)],
      ['Allocation admin', keyValue(terms.allocationAdmin)],
      ['Admin transfer', doc.createTextNode(transfer ? `! Pending to ${terms.pendingAdmin}` : 'None pending')],
      ...(terms.risk?.vault?.createdAt ? [['Vault created', doc.createTextNode(`${new Date(terms.risk.vault.createdAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })} · ${Math.max(0, Math.floor((Date.now() - Date.parse(terms.risk.vault.createdAt)) / 86400000))} days ago`)]] : []),
      ...(terms.risk?.programs || []).map(program => {
        const name = program.program.startsWith('KLend') ? 'Kamino Lend program' : 'Kamino Vault program', value = node(doc, 'span');
        value.append(program.upgradeable ? 'Upgradeable by ' : 'Immutable', ...(program.authority ? [addressLink(doc, program.authority)] : []), program.lastDeployedAt ? ` · last upgraded ${shortDate(program.lastDeployedAt)}` : '');
        return [name, value];
      }),
    ]));
    const changes = node(doc, 'div', 'vault-changes');
    changes.append(node(doc, 'h4', 'vault-subhead', `Changes · ${terms.window}`));
    if (!terms.changes.length) changes.append(node(doc, 'p', 'vault-meta-line', `No fee or admin changes recorded in ${terms.window}.`));
    else {
      const list = node(doc, 'ul', 'vault-change-list');
      for (const change of terms.changes) {
        const fees = change.field.endsWith('Bps'), show = value => value === null ? 'none' : fees ? bpsPercent(value) : shortAddress(value);
        list.append(node(doc, 'li', '', `${shortDate(change.observedAt)} · ${TERM_LABELS[change.field] ?? change.field}: ${show(change.from)} → ${show(change.to)} · slot ${change.slot}`));
      }
      changes.append(list);
      if (terms.changesTruncated) changes.append(node(doc, 'p', 'vault-meta-line', 'Only the first 20 changes are listed.'));
    }
    section.append(changes, about(doc, 'Read from the vault account. The admin can change fees and where the vault lends; for protected positions, Safeguards alerts on authority changes.'));
  },
};

// ---- On-chain references ----------------------------------------------------------------------------------
const references = {
  id: 'references',
  title: 'On-chain references',
  description: 'Accounts the figures above are read from.',
  windowed: false,
  async load(ctx) {
    const details = ctx.vault.details || {};
    return [['Vault', ctx.vault.address], ['Share token', details.sharesMint], ['Underlying token', details.underlyingMint]].filter(([, value]) => typeof value === 'string' && value);
  },
  render(section, rows, ctx) {
    const details = node(ctx.document, 'details', 'vault-history');
    details.append(node(ctx.document, 'summary', '', 'Show addresses'), facts(ctx.document, rows.map(([label, value]) => [label, addressLink(ctx.document, value, value)])));
    section.append(details);
  },
};

// The page reads as five questions: can I get out, who could leave first, is the lent cash safe, is it worth it, who controls it.
export const VAULT_METRICS = Object.freeze([withdrawalLiquidity, holderConcentration, exitOrder, lendingReserves, collateral, valueAndYield, feesAndControl, references]);
