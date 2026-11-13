// Vaults workspace: pick a vault on the left, read its details on the right (same pattern as Positions).
// The detail panel is driven entirely by VAULT_METRICS (vault-metrics.js): key figures, one section per
// metric and the list badge. Vaults come from the connected wallet; the figures are vault-level.
import { protocolName } from './display-labels.js';
import { VAULT_METRICS, VAULT_WINDOWS, vaultFigure } from './vault-metrics.js';
import { startLoading, skeletonRows, skeletonDetail } from './loading-state.js';

const REFRESH_MS = 60000;
const node = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

// One request per URL per refresh, shared by every metric that reads the same hub endpoint.
export function createJsonCache(fetchImpl, ttlMs = 15000, now = () => Date.now()) {
  const entries = new Map();
  return (url, { timeoutMs = 10000 } = {}) => {
    const hit = entries.get(url);
    if (hit && now() - hit.at < ttlMs) return hit.promise;
    const promise = fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) }).then(async response => {
      if (!response.ok) throw new Error(`http_${response.status}`);
      return response.json();
    });
    entries.set(url, { at: now(), promise });
    promise.catch(() => entries.delete(url));
    return promise;
  };
}

// Skeleton shown while a section reads chain data or recorded observations; each section fills in on its own.
const LOADING_COPY = { 'withdrawal-liquidity': 'Reading vault and reserve cash…', holders: 'Scanning every share holder on chain…', 'exit-order': 'Lining up the largest holders…', reserves: 'Reading lending reserves…', collateral: 'Reading collateral in the lending markets…', value: 'Loading recorded value and flows…', 'fees-control': 'Reading fees, admins and program upgrades…', references: 'Collecting addresses…' };
function loadingPlaceholder(doc, metric) {
  const box = node(doc, 'div', 'vault-skeleton');
  box.setAttribute('role', 'status');
  const head = node(doc, 'div', 'vault-skeleton-status');
  head.append(node(doc, 'span', 'vault-skeleton-spinner'), node(doc, 'span', '', LOADING_COPY[metric.id] || 'Loading…'));
  const figures = node(doc, 'div', 'vault-skeleton-figures');
  for (let i = 0; i < 4; i++) { const cell = node(doc, 'div', 'vault-skeleton-figure'); cell.append(node(doc, 'i', 'is-short'), node(doc, 'i', 'is-big'), node(doc, 'i', 'is-short')); figures.append(cell); }
  box.append(head, figures, node(doc, 'div', 'vault-skeleton-block'));
  return box;
}

export function createVaultsPage({ root, metrics = VAULT_METRICS, fetchImpl = globalThis.fetch?.bind(globalThis), iconFor = () => '', networkLabel = 'Mainnet' } = {}) {
  const doc = root.ownerDocument;
  const list = root.querySelector('[data-vaults-list]'), detail = root.querySelector('[data-vaults-detail]'), empty = root.querySelector('[data-vaults-empty]');
  const getJson = createJsonCache(fetchImpl);
  const win = doc.defaultView;
  // Phones: the list leads; a tapped vault opens as its own view with "‹ All vaults" (browser Back closes it), as Positions.
  const phone = () => typeof win?.matchMedia === 'function' && win.matchMedia('(max-width:600px)').matches;
  function openDetailView() {
    if (!phone()) return;
    if (!root.classList.contains('is-detail-view')) {
      root.classList.add('is-detail-view');
      try { win.history.pushState({ kelvaraVaultDetail: true }, '', win.location.href); } catch {}
    }
    try { win.scrollTo({ top: 0, behavior: 'instant' }); } catch {}
    setTimeout(() => { const heading = detail.querySelector('h2'); if (heading && root.classList.contains('is-detail-view')) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); } }, 60);
  }
  function closeDetailView({ fromHistory = false, restoreFocus = true } = {}) {
    if (!root.classList.contains('is-detail-view')) return;
    root.classList.remove('is-detail-view');
    if (!fromHistory && win?.history?.state?.kelvaraVaultDetail) { try { win.history.back(); } catch {} }
    if (restoreFocus) { const row = [...list.querySelectorAll('.vault-row')].find((item) => item.dataset.targetId === state.selected); row?.focus({ preventScroll: true }); row?.scrollIntoView?.({ block: 'center' }); }
  }
  win?.addEventListener?.('popstate', () => { if (!win.history.state?.kelvaraVaultDetail) closeDetailView({ fromHistory: true }); });
  win?.addEventListener?.('hashchange', () => { if (win.location.hash !== '#vaults') closeDetailView({ restoreFocus: false }); });
  const state = { vaults: [], selected: null, window: '24h', epoch: 0, timer: null };
  const context = vault => ({ vault, window: state.window, document: doc, getJson });

  // While the wallet's positions are on their way: the list and the detail column as skeletons (same split layout).
  let loading = null, failed = false;
  function endLoading() { loading?.finish(); loading = null; failed = false; }
  function showLoading() {
    if (failed || (loading && !loading.done)) return;
    state.vaults = []; state.selected = null; clearTimeout(state.timer);
    empty.hidden = true; root.classList.add('has-vaults');
    loading = startLoading({ regions: [{ element: list, skeleton: skeletonRows(doc, { rows: 3, cells: ['icon', 'w70/w50', ''], rowClass: 'vault-row', className: 'kv-skel-vaults' }) }, { element: detail, skeleton: skeletonDetail(doc) }], anchor: root.querySelector('.vaults-split'), label: 'Loading your vaults…' });
  }
  function showError({ onRetry }) {
    if (!loading) showLoading();
    loading?.fail({ into: list, title: 'Vaults unavailable', message: 'Kelvara could not read the vaults you hold. Nothing here is shown as current.', onRetry: () => { failed = false; onRetry(); } });
    loading = null; failed = true; detail.replaceChildren();
  }

  function showEmpty(text) {
    endLoading();
    state.vaults = []; state.selected = null; clearTimeout(state.timer);
    root.classList.remove('has-vaults');
    list.replaceChildren(); detail.replaceChildren();
    empty.hidden = false; empty.textContent = text;
  }

  function renderList() {
    const rows = state.vaults.map(vault => {
      const row = node(doc, 'button', 'vault-row');
      row.type = 'button'; row.dataset.targetId = vault.targetId;
      row.setAttribute('aria-selected', String(vault.targetId === state.selected));
      const icon = node(doc, 'img', 'vault-row-icon'); icon.alt = ''; icon.src = iconFor(vault);
      const copy = node(doc, 'span', 'vault-row-copy');
      const badge = node(doc, 'small', 'vault-row-badge', '');
      copy.append(node(doc, 'strong', '', vault.name), node(doc, 'span', 'vault-row-meta', [protocolName(vault.protocol), networkLabel, vault.symbol].filter(Boolean).join(' · ')), badge);
      row.append(icon, copy, node(doc, 'span', 'vault-row-chevron', '›'));
      row.addEventListener('click', () => { select(vault.targetId); openDetailView(); });
      loadBadge(vault, badge);
      return row;
    });
    list.replaceChildren(...rows);
  }

  async function loadBadge(vault, slot) {
    for (const metric of metrics.filter(item => item.badge)) {
      try {
        const text = metric.badge(await metric.load({ ...context(vault), window: '24h' }), context(vault));
        if (text) { slot.textContent = text; return; }
      } catch {}
    }
  }

  async function renderDetail() {
    const epoch = ++state.epoch, vault = state.vaults.find(item => item.targetId === state.selected);
    clearTimeout(state.timer);
    if (!vault) { detail.replaceChildren(); return; }
    const header = node(doc, 'header', 'vault-detail-header');
    const title = node(doc, 'div', 'vault-detail-title');
    const nameRow = node(doc, 'div', 'vault-name-row');
    const icon = node(doc, 'img', 'vault-detail-icon'); icon.alt = ''; icon.src = iconFor(vault);
    nameRow.append(node(doc, 'h2', '', vault.name), icon);
    title.append(node(doc, 'span', 'eyebrow', 'VAULT DETAILS'), nameRow, node(doc, 'p', 'vault-meta-line', [protocolName(vault.protocol), networkLabel, vault.symbol].filter(Boolean).join(' · ')));
    const windows = node(doc, 'div', 'vault-window');
    windows.setAttribute('role', 'group'); windows.setAttribute('aria-label', 'History window');
    for (const value of VAULT_WINDOWS) {
      const button = node(doc, 'button', '', value);
      button.type = 'button'; button.setAttribute('aria-pressed', String(value === state.window));
      button.addEventListener('click', () => { if (state.window !== value) { state.window = value; renderDetail(); } });
      windows.append(button);
    }
    const back = node(doc, 'button', 'vault-back', 'All vaults');
    back.type = 'button';
    back.addEventListener('click', () => closeDetailView());
    header.append(back, title, windows);
    const figures = node(doc, 'div', 'vault-figures');
    figures.setAttribute('aria-label', 'Key figures');
    const sections = metrics.map(metric => {
      const section = node(doc, 'section', 'vault-section');
      section.id = `vault-metric-${metric.id}`; section.dataset.metric = metric.id;
      const head = node(doc, 'header', 'vault-section-head');
      head.append(node(doc, 'h3', '', metric.title));
      if (metric.description) head.append(node(doc, 'p', '', metric.description));
      const body = node(doc, 'div', 'vault-section-body');
      body.append(loadingPlaceholder(doc, metric));
      section.append(head, body);
      return { metric, body };
    });
    // Keep the previous key figures while reloading, so switching windows does not flash.
    const previousFigures = detail.querySelector('.vault-figures');
    if (previousFigures && detail.dataset.targetId === vault.targetId) figures.replaceChildren(...previousFigures.childNodes);
    detail.dataset.targetId = vault.targetId;
    detail.replaceChildren(header, figures, ...sections.map(item => item.body.parentElement));
    const summaries = await Promise.all(sections.map(async ({ metric, body }) => {
      const ctx = context(vault);
      try {
        const data = await metric.load(ctx);
        if (epoch !== state.epoch) return [];
        body.replaceChildren();
        metric.render(body, data, ctx);
        return metric.summary ? metric.summary(data, ctx) : [];
      } catch {
        if (epoch === state.epoch) body.replaceChildren(node(doc, 'p', 'vault-meta-line', 'Unavailable right now. No estimate is substituted for missing records.'));
        return [];
      }
    }));
    if (epoch !== state.epoch) return;
    const items = summaries.flat();
    figures.hidden = !items.length;
    figures.replaceChildren(...items.map(item => vaultFigure(doc, item)));
    state.timer = setTimeout(() => { if (root.isConnected && epoch === state.epoch) renderDetail(); }, REFRESH_MS);
  }

  // Positions → "Full vault analysis" asks for a specific vault (selected once the list has loaded).
  doc.defaultView?.addEventListener('kelvara:select-vault', event => { state.selected = event.detail; if (state.vaults.some(vault => vault.targetId === event.detail)) select(event.detail); });
  function select(targetId) {
    if (!state.vaults.some(vault => vault.targetId === targetId)) return;
    state.selected = targetId;
    for (const row of list.querySelectorAll('.vault-row')) row.setAttribute('aria-selected', String(row.dataset.targetId === targetId));
    renderDetail();
  }

  return {
    showEmpty,
    showLoading,
    showError,
    update(vaults) {
      if (!vaults.length) return showEmpty('No supported vault positions in this wallet.');
      endLoading();
      const changed = vaults.map(vault => vault.targetId).join() !== state.vaults.map(vault => vault.targetId).join();
      state.vaults = vaults;
      empty.hidden = true; root.classList.add('has-vaults');
      if (!vaults.some(vault => vault.targetId === state.selected)) state.selected = vaults[0].targetId;
      if (changed || !list.children.length) renderList();
      if (changed || !detail.children.length) renderDetail();
    },
    get selected() { return state.selected; },
    select,
    openDetailView,
    closeDetailView,
  };
}
