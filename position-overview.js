// Position overview: only the connected wallet's own data in one vault.
//   at a glance   your value, time invested, earned so far, how much of it can exit now
//   exit          your position against the vault's instant cash
//   over time     your position value (shares held × recorded share price) with your deposits/withdrawals
//   actions       every deposit and withdrawal you made, from chain
// Vault-wide analysis (holders, collateral, control) stays on the Vaults page, one click away.
import { compactAmount, reserveHealthModel, shortAddress, vaultFigure } from './vault-metrics.js';
import { vaultCompositionModel, vaultPercent } from './vault-composition.js';
import { formatGrouped, formatTokenAmount } from './instant-liquidity.js';
import { vaultSeriesChart } from './vault-charts.js';

const EXPLORER_TX = 'https://orb.helius.dev/tx/';
const node = (doc, tag, className, text) => { const n = doc.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const day = 86_400_000;
const shortDate = iso => new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
const duration = ms => { const days = ms / day; return days >= 365 ? `${(days / 365).toFixed(1)} years` : days >= 2 ? `${Math.floor(days)} days` : `${Math.max(1, Math.round(ms / 3_600_000))} hours`; };

// Shares held over time and the age of what is held now (first-in, first-out over the recorded events).
export function positionTimeline(events, { currentSharesRaw, complete, now = Date.now() }) {
  const current = BigInt(currentSharesRaw ?? 0), signed = events.map(event => ({ ...event, delta: (event.kind === 'deposit' ? 1n : -1n) * BigInt(event.sharesRaw) }));
  const total = signed.reduce((sum, event) => sum + event.delta, 0n), start = complete ? 0n : current - total;
  const sharesAt = t => signed.filter(event => Date.parse(event.at) <= t).reduce((sum, event) => sum + event.delta, start);
  const lots = []; if (start > 0n) lots.push({ at: null, shares: start });
  for (const event of signed) {
    if (event.delta > 0n) { lots.push({ at: event.at, shares: event.delta }); continue; }
    let left = -event.delta;
    while (left > 0n && lots.length) { const lot = lots[0], used = lot.shares < left ? lot.shares : left; lot.shares -= used; left -= used; if (lot.shares === 0n) lots.shift(); }
  }
  const held = lots.filter(lot => lot.shares > 0n), dated = held.filter(lot => lot.at);
  const heldTotal = dated.reduce((sum, lot) => sum + Number(lot.shares), 0);
  const averageAgeMs = heldTotal ? dated.reduce((sum, lot) => sum + Number(lot.shares) * (now - Date.parse(lot.at)), 0) / heldTotal : null;
  return { sharesAt, since: held.length && held[0].at ? held[0].at : null, sinceUnknown: held.some(lot => !lot.at), averageAgeMs };
}

export async function renderPositionOverview(host, { position, symbol, name, loadHistory, document: doc = host.ownerDocument, fetchImpl = globalThis.fetch.bind(globalThis), onOpenVault = null }) {
  const unit = symbol ? ` ${symbol}` : '', amount = Number(position.underlyingAmount), targetId = position.targetId;
  const json = url => fetchImpl(url, { signal: AbortSignal.timeout(30000) }).then(r => { if (!r.ok) throw new Error(`http_${r.status}`); return r.json(); });
  const root = node(doc, 'div', 'position-modern'), glance = node(doc, 'div', 'vault-figures position-glance');
  const section = (title, description) => { const s = node(doc, 'section', 'vault-section'), head = node(doc, 'header', 'vault-section-head'), body = node(doc, 'div', 'vault-section-body'); head.append(node(doc, 'h3', '', title), node(doc, 'p', '', description)); const loading = node(doc, 'div', 'vault-skeleton'); loading.append(node(doc, 'div', 'vault-skeleton-status', 'Reading your position from chain…'), node(doc, 'div', 'vault-skeleton-block')); body.append(loading); s.append(head, body); root.append(s); return body; };
  glance.append(vaultFigure(doc, { label: 'Your position', value: Number.isFinite(amount) ? formatTokenAmount(amount) : '—', unit: symbol, detail: Number.isFinite(Number(position.totalShares)) ? `${formatGrouped(Number(position.totalShares))} shares` : 'Shares unavailable' }));
  root.append(glance);
  const exitBody = section('Can I get out now?', 'How much of your position the vault could pay out instantly right now.');
  const lentBody = section('Where is my money lent?', 'The lending reserves the vault allocates to, and how much of your position sits in each.');
  const valueBody = section('How has my position grown?', 'Your position value as interest accrues, with your own deposits and withdrawals marked.');
  const actionsBody = section('My deposits and withdrawals', 'Every time you added to or took from this vault, read from chain.');
  const more = node(doc, 'div', 'position-more'), open = node(doc, 'button', 'position-more-link', 'Vault analysis: holders, exit order, collateral, control →');
  open.type = 'button'; open.addEventListener('click', () => (onOpenVault ? onOpenVault(targetId) : (doc.defaultView.location.hash = '#vaults')));
  more.append(open); root.append(more);
  host.replaceChildren(root);
  const unavailable = body => body.replaceChildren(node(doc, 'p', 'vault-chart-note', 'Unavailable right now. No estimate is substituted for missing records.'));

  const [liquidity, profile, history] = await Promise.all([
    json(`/api/vaults/withdrawal-liquidity?targetId=${encodeURIComponent(targetId)}&window=24h`).then(data => vaultCompositionModel(data, { positionAmount: amount })).catch(() => null),
    json(`/api/vaults/profile?targetId=${encodeURIComponent(targetId)}&window=30d`).catch(() => null),
    (loadHistory ? loadHistory(targetId) : Promise.reject(new Error('no_history'))).catch(() => null),
  ]);

  // Exit capacity: your position as a bar, the part instant cash covers in lime.
  if (liquidity?.current && Number.isFinite(amount) && amount > 0) {
    const instant = liquidity.current.tier1 + liquidity.current.tier2, covered = Math.min(1, instant / amount);
    const bar = node(doc, 'div', 'position-exit'), track = node(doc, 'div', 'position-exit-track'), fill = node(doc, 'span', 'position-exit-covered');
    fill.style.width = `${(covered * 100).toFixed(2)}%`; track.append(fill);
    const text = covered >= 1 ? `All ${formatTokenAmount(amount)}${unit} could be withdrawn instantly. The vault holds ${compactAmount(instant)}${unit} of instant cash, ${(instant / amount).toFixed(instant / amount >= 100 ? 0 : 1)}× your position.`
      : `${formatTokenAmount(instant)}${unit} of your ${formatTokenAmount(amount)}${unit} could be withdrawn instantly; the rest waits for borrowers to repay.`;
    bar.append(track, node(doc, 'p', 'vault-lead', text));
    exitBody.replaceChildren(bar);
    glance.append(vaultFigure(doc, { label: 'Exit now', value: covered >= 1 ? 'Fully' : vaultPercent(covered), detail: covered >= 1 ? 'Instant cash covers your position' : 'Rest waits for repayments', tone: covered >= 1 ? null : 'warn' }));
  } else unavailable(exitBody);

  // Allocation: the vault's reserves with your proportional amount in each.
  const reserves = profile?.reserves?.latest?.length ? reserveHealthModel(profile).rows : [];
  if (reserves.length) {
    const table = node(doc, 'div', 'vault-data-table'), t = node(doc, 'table'), head = node(doc, 'tr'), labels = ['Reserve', 'Share of vault', 'Your amount', 'Utilization', 'Free cash', 'Status'];
    for (const label of labels) { const th = node(doc, 'th', '', label); th.scope = 'col'; head.append(th); }
    t.append(head);
    for (const row of reserves) {
      const tr = node(doc, 'tr'), link = node(doc, 'a', 'vault-address', shortAddress(row.reserve));
      link.setAttribute('aria-label', `Reserve ${row.reserve}, open in explorer`);
      link.href = `https://orb.helius.dev/address/${row.reserve}`; link.target = '_blank'; link.rel = 'noopener';
      const cells = [link, vaultPercent(row.share), row.share === null || !Number.isFinite(amount) ? '—' : `${formatTokenAmount(amount * row.share)}${unit}`, vaultPercent(row.utilization), `${compactAmount(row.free)}${unit}`, row.eligible ? '✓ Active' : '! Restricted'];
      // data-label: on phones each reserve is a panel of labelled rows (the table's header row is hidden there).
      cells.forEach((cell, index) => { const td = node(doc, 'td'); td.dataset.label = labels[index]; td.append(cell); tr.append(td); });
      t.append(tr);
    }
    table.append(t); lentBody.replaceChildren(table);
  } else unavailable(lentBody);

  if (!history) { unavailable(valueBody); unavailable(actionsBody); return; }
  const decimals = profile?.tokenDecimals ?? 6, sharesDecimals = profile?.sharesDecimals ?? decimals;
  const currentSharesRaw = BigInt(Math.round(Number(position.totalShares) * 10 ** sharesDecimals));
  const timeline = positionTimeline(history.events, { currentSharesRaw: String(currentSharesRaw), complete: history.complete });
  if (timeline.since || timeline.averageAgeMs) glance.append(vaultFigure(doc, { label: 'Time invested', value: timeline.since ? duration(Date.now() - Date.parse(timeline.since)) : 'Over 300 actions', detail: timeline.averageAgeMs ? `Since ${timeline.since ? shortDate(timeline.since) : 'before recorded history'} · average ${duration(timeline.averageAgeMs)} per dollar` : 'Held since before recorded history' }));
  const deposited = history.events.reduce((sum, event) => sum + (event.kind === 'deposit' ? 1 : -1) * Number(event.underlyingRaw) / 10 ** decimals, 0);
  if (history.complete && deposited > 0 && Number.isFinite(amount)) glance.append(vaultFigure(doc, { label: 'Earned so far', value: `${amount - deposited >= 0 ? '+' : '−'}${formatTokenAmount(Math.abs(amount - deposited))}`, unit: symbol, detail: `On ${formatTokenAmount(deposited)}${unit} net deposited` }));

  // Value over time: shares you held at each recorded interval × that interval's share price.
  const points = (profile?.value?.points || []).map(point => {
    const shares = timeline.sharesAt(Date.parse(point.observedAt || point.t)), ok = point.netAssetsRaw && point.sharesIssuedRaw && Number(point.sharesIssuedRaw) > 0;
    return { t: point.t, observedAt: point.observedAt, value: ok ? Number(shares) * Number(point.netAssetsRaw) / Number(point.sharesIssuedRaw) / 10 ** decimals : null };
  });
  const markers = history.events.map(event => ({ t: event.at, kind: event.kind, label: `${event.kind === 'deposit' ? 'Deposited' : 'Withdrew'} ${formatTokenAmount(Number(event.underlyingRaw) / 10 ** decimals)}${unit}` }));
  valueBody.replaceChildren(vaultSeriesChart({ document: doc, window: '30d', label: 'Your position', height: 180, points, markers, format: (value, { axis } = {}) => axis ? compactAmount(value) : `${formatTokenAmount(value)}${unit}` }));
  const legend = node(doc, 'div', 'vault-chart-legend');
  for (const [cls, text] of [['position-key-deposit', 'Your deposit'], ['position-key-withdraw', 'Your withdrawal']]) { const item = node(doc, 'span', `vault-chart-key ${cls}`); item.append(node(doc, 'i'), text); legend.append(item); }
  valueBody.append(legend);

  // Actions: newest first, with amounts and the transaction.
  if (!history.events.length) { actionsBody.replaceChildren(node(doc, 'p', 'vault-chart-note', 'No deposits or withdrawals found for this wallet.')); return; }
  const list = node(doc, 'div', 'position-actions');
  for (const event of [...history.events].reverse().slice(0, 50)) {
    const row = node(doc, 'div', `position-action is-${event.kind}`), link = node(doc, 'a', 'position-action-tx', 'View transaction ↗');
    link.href = `${EXPLORER_TX}${event.signature}`; link.target = '_blank'; link.rel = 'noopener';
    row.append(node(doc, 'span', 'position-action-badge', event.kind === 'deposit' ? '+ Deposit' : '− Withdraw'), node(doc, 'span', 'position-action-amount', `${formatTokenAmount(Number(event.underlyingRaw) / 10 ** decimals)}${unit}`),
      node(doc, 'span', 'position-action-shares', `${formatGrouped(Number(event.sharesRaw) / 10 ** sharesDecimals)} shares`), node(doc, 'span', 'position-action-date', event.at ? new Date(event.at).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'), link);
    list.append(row);
  }
  actionsBody.replaceChildren(list);
  if (!history.complete) actionsBody.append(node(doc, 'p', 'vault-chart-note', 'Showing your most recent 300 on-chain actions.'));
}
