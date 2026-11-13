// Loading, slow and failed states shared by the console panes.
// Skeletons are shaped like each pane's final layout (same row heights), so nothing jumps when data arrives.
// One status per pane: visually hidden ("Loading governance…") until 8 s pass, then a calm visible line.
// A failure shows a short message and a Retry button that calls the pane's own load function.
export const SLOW_LOADING_MS = 8000;
export const SLOW_LOADING_COPY = 'Still loading — this is taking longer than usual.';

const node = (doc, tag, className, text) => {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};
// One grey bar; `size` picks a width/height class from the stylesheet (kv-skel-w60, kv-skel-h20, …).
export function skeletonBar(doc, ...sizes) {
  const bar = node(doc, 'i', ['kv-skel', ...sizes.map(size => `kv-skel-${size}`)].join(' '));
  bar.setAttribute('aria-hidden', 'true');
  return bar;
}
function root(doc, tag, className) {
  const element = node(doc, tag, `kv-skeleton ${className}`);
  element.dataset.kvSkeleton = 'true';
  element.setAttribute('aria-hidden', 'true');
  return element;
}
// Table-like rows (Overview and Positions lists, ExitRail rows, Safeguards vault rows, Activity events).
// Each cell is a recipe: '' (empty), 'icon', 'w40' (one bar), 'w60/w20' (stacked lines), 'icon+w60/w20' (icon beside lines).
// `rowClass` reuses the real row's class so the skeleton gets the same grid, padding and border.
function skeletonCell(doc, recipe) {
  const cell = node(doc, 'span', 'kv-skel-cell');
  if (!recipe) return cell;
  const [icon, lines] = recipe.includes('+') ? recipe.split('+') : recipe === 'icon' ? ['icon', ''] : ['', recipe];
  if (icon) cell.append(skeletonBar(doc, 'icon'));
  if (lines) {
    const stack = node(doc, 'span', 'kv-skel-stack');
    lines.split('/').forEach((size, index) => stack.append(skeletonBar(doc, size, index ? 'h10' : 'h14')));
    cell.append(stack);
  }
  return cell;
}
export function skeletonRows(doc, { rows = 3, cells = ['icon+w60/w20', 'w50', 'w50', 'w40'], rowClass = '', className = '' } = {}) {
  const list = root(doc, 'div', `kv-skel-rows ${className}`.trim());
  for (let index = 0; index < rows; index++) {
    const row = node(doc, 'div', `kv-skel-row ${rowClass}`.trim());
    row.append(...cells.map(recipe => skeletonCell(doc, recipe)));
    list.append(row);
  }
  return list;
}
// Positions detail column: title, two figures, one content block.
export function skeletonDetail(doc) {
  const box = root(doc, 'div', 'kv-skel-detail');
  const figures = node(doc, 'div', 'kv-skel-figures');
  for (let index = 0; index < 2; index++) {
    const cell = node(doc, 'div', 'kv-skel-figure');
    cell.append(skeletonBar(doc, 'w30', 'h10'), skeletonBar(doc, 'w50', 'h20'), skeletonBar(doc, 'w40', 'h10'));
    figures.append(cell);
  }
  box.append(skeletonBar(doc, 'w20', 'h10'), skeletonBar(doc, 'w60', 'h28'), skeletonBar(doc, 'w30', 'h10'), figures, skeletonBar(doc, 'block'));
  return box;
}
// Governance: the four-number summary row, then two vault blocks (header, status, facts, one proposal card, side panel).
export function governanceSkeleton(doc, { vaults = 2 } = {}) {
  const box = root(doc, 'div', 'kv-skel-governance');
  const summary = node(doc, 'div', 'kv-skel-summary');
  for (let index = 0; index < 4; index++) {
    const cell = node(doc, 'div', 'kv-skel-metric');
    cell.append(skeletonBar(doc, 'w40', 'h10'), skeletonBar(doc, 'w20', 'h28'), skeletonBar(doc, 'w60', 'h12'));
    summary.append(cell);
  }
  box.append(summary);
  for (let index = 0; index < vaults; index++) {
    const vault = node(doc, 'div', 'kv-skel-vault');
    const head = node(doc, 'div', 'kv-skel-vault-head');
    head.append(skeletonBar(doc, 'icon'), skeletonBar(doc, 'w30', 'h16'));
    const grid = node(doc, 'div', 'kv-skel-vault-grid');
    const main = node(doc, 'div', 'kv-skel-vault-main'), side = node(doc, 'div', 'kv-skel-vault-side');
    const card = node(doc, 'div', 'kv-skel-card');
    card.append(skeletonBar(doc, 'w60', 'h16'), skeletonBar(doc, 'w40', 'h12'), skeletonBar(doc, 'w80', 'h12'), skeletonBar(doc, 'w30', 'h12'), skeletonBar(doc, 'bar'));
    main.append(skeletonBar(doc, 'w15', 'h10'), card);
    side.append(skeletonBar(doc, 'w20', 'h10'));
    for (let row = 0; row < 4; row++) side.append(skeletonBar(doc, 'w80', 'h14'));
    grid.append(main, side);
    vault.append(head, skeletonBar(doc, 'w50', 'h14'), skeletonBar(doc, 'w30', 'h12'), grid);
    box.append(vault);
  }
  return box;
}

function clearSkeletons(region) {
  for (const child of [...(region.children || [])]) if (child.dataset?.kvSkeleton === 'true') child.remove();
}

/**
 * Marks regions busy and shows skeletons.
 * regions: [{ element, skeleton?: Node, mode?: 'replace' | 'prepend' }]; without a skeleton the region keeps its
 * own placeholders, which the stylesheet turns into bars while [aria-busy=true] (elements marked data-skeleton).
 * The single status node goes right before `anchor` (default: the first region).
 */
export function startLoading({ regions, label, anchor, doc = regions[0]?.element?.ownerDocument || globalThis.document, timers = globalThis, slowAfterMs = SLOW_LOADING_MS }) {
  const live = regions.filter(region => region?.element);
  for (const { element, skeleton, mode = 'replace' } of live) {
    element.setAttribute('aria-busy', 'true');
    element.dataset.kvLoading = 'true';
    if (!skeleton) continue;
    clearSkeletons(element);
    if (mode === 'prepend') element.prepend(skeleton); else element.replaceChildren(skeleton);
  }
  const status = node(doc, 'p', 'kv-loading-status', label);
  status.setAttribute('role', 'status');
  status.dataset.kvSkeleton = 'status';
  const before = anchor || live[0]?.element;
  before?.before?.(status);
  let timer = timers.setTimeout(() => { status.textContent = SLOW_LOADING_COPY; status.classList.add('is-slow'); timer = null; }, slowAfterMs);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (timer != null) timers.clearTimeout(timer);
    status.remove();
    for (const { element } of live) {
      element.removeAttribute('aria-busy');
      delete element.dataset.kvLoading;
      clearSkeletons(element);
    }
  };
  return {
    status,
    get done() { return done; },
    finish,
    // Replaces `into` (default: the first region) with a short explanation and a Retry button.
    fail({ title = 'Could not load this page', message = 'The data did not arrive. Nothing shown here is current.', onRetry, into, retryLabel = 'Retry' } = {}) {
      finish();
      const target = into || live[0]?.element;
      const box = loadError(doc, { title, message, onRetry, retryLabel });
      target?.replaceChildren?.(box);
      return box;
    },
  };
}

export function loadError(doc, { title, message, onRetry, retryLabel = 'Retry' }) {
  const box = node(doc, 'div', 'kv-load-error');
  box.setAttribute('role', 'alert');
  const copy = node(doc, 'div', 'kv-load-error-copy');
  copy.append(node(doc, 'strong', '', title), node(doc, 'p', '', message));
  box.append(copy);
  if (typeof onRetry === 'function') {
    const button = node(doc, 'button', 'kv-retry', retryLabel);
    button.type = 'button';
    button.addEventListener('click', () => { button.disabled = true; onRetry(); });
    box.append(button);
  }
  return box;
}
