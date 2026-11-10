// Vaults workspace: pick a vault on the left, read its details on the right (same pattern as Positions).
// The detail panel is driven entirely by VAULT_METRICS (vault-metrics.js): key figures, one section per
// metric and the list badge. Vaults come from the connected wallet; the figures are vault-level.
import { VAULT_METRICS, VAULT_WINDOWS, vaultFigure } from './vault-metrics.js';

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
  const state = { vaults: [], selected: null, window: '24h', epoch: 0, timer: null };
  const context = vault => ({ vault, window: state.window, document: doc, getJson });

  function showEmpty(text) {
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
      copy.append(node(doc, 'strong', '', vault.name), node(doc, 'span', 'vault-row-meta', [vault.protocol, networkLabel, vault.symbol].filter(Boolean).join(' · ')), badge);
      row.append(icon, copy, node(doc, 'span', 'vault-row-chevron', '›'));
      row.addEventListener('click', () => select(vault.targetId));
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
    title.append(node(doc, 'span', 'eyebrow', 'VAULT DETAILS'), nameRow, node(doc, 'p', 'vault-meta-line', [vault.protocol, networkLabel, vault.symbol].filter(Boolean).join(' · ')));
    const windows = node(doc, 'div', 'vault-window');
    windows.setAttribute('role', 'group'); windows.setAttribute('aria-label', 'History window');
    for (const value of VAULT_WINDOWS) {
      const button = node(doc, 'button', '', value);
      button.type = 'button'; button.setAttribute('aria-pressed', String(value === state.window));
      button.addEventListener('click', () => { if (state.window !== value) { state.window = value; renderDetail(); } });
      windows.append(button);
    }
    header.append(title, windows);
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
    update(vaults) {
      if (!vaults.length) return showEmpty('No supported vault positions in this wallet.');
      const changed = vaults.map(vault => vault.targetId).join() !== state.vaults.map(vault => vault.targetId).join();
      state.vaults = vaults;
      empty.hidden = true; root.classList.add('has-vaults');
      if (!vaults.some(vault => vault.targetId === state.selected)) state.selected = vaults[0].targetId;
      if (changed || !list.children.length) renderList();
      if (changed || !detail.children.length) renderDetail();
    },
    get selected() { return state.selected; },
    select,
  };
}
