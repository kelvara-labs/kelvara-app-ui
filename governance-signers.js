// Signer insights (Governance tab): opened from the Signers heading of a vault, fetched only then
// (GET /api/governance/signers, governance-signers/v1). Pure wording and time helpers first (testable without a DOM),
// then the renderers. Times arrive in UTC and are shown in this device's time zone, always labelled.
import { skeletonRows, loadError } from './loading-state.js';

export const SIGNERS_SCHEMA = 'governance-signers/v1';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ROW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const VERBS = { approve: 'Approved', reject: 'Voted to reject', cancel: 'Voted to cancel' };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Minutes to add to UTC to get local time (e.g. +60 for CET). */
export function localOffsetMinutes(date = new Date()) { return -date.getTimezoneOffset(); }
export function timeZoneLabel(date = new Date(), timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short', ...(timeZone ? { timeZone } : {}) }).formatToParts(date).find(p => p.type === 'timeZoneName');
    if (part?.value) return part.value;
  } catch { /* fall through */ }
  const offset = localOffsetMinutes(date), sign = offset < 0 ? '−' : '+', h = Math.floor(Math.abs(offset) / 60), m = Math.abs(offset) % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}
const pad = hour => `${String(((hour % 24) + 24) % 24).padStart(2, '0')}:00`;
/** The usual-hours window (UTC start hour, length) in local hours, e.g. "14:00–22:00". Whole-hour shift. */
export function localHourRange(window, offsetMinutes = localOffsetMinutes()) {
  if (!window || !Number.isInteger(window.startHour) || !Number.isInteger(window.hours)) return null;
  if (window.hours >= 24) return 'any time of day';
  const shift = Math.round(offsetMinutes / 60);
  return `${pad(window.startHour + shift)}–${pad(window.startHour + window.hours + shift)}`;
}
/** 7×24 UTC counts (row = getUTCDay) shifted into local time across the whole week; rows stay Sunday-first. */
export function localHeatmap(grid, offsetMinutes = localOffsetMinutes()) {
  const shift = Math.round(offsetMinutes / 60), out = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (let day = 0; day < 7; day++) for (let hour = 0; hour < 24; hour++) {
    const value = Number(grid?.[day]?.[hour]) || 0;
    if (!value) continue;
    const index = (((day * 24 + hour + shift) % 168) + 168) % 168;
    out[Math.floor(index / 24)][index % 24] += value;
  }
  return out;
}
export function formatDuration(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return null;
  if (s < 60) return 'under a minute';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) { const h = s / 3600; return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`; }
  const d = s / 86400; return `${d < 10 ? Math.round(d * 10) / 10 : Math.round(d)} d`;
}
const percent = value => `${Math.round(value * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export function shortAddress(value) { const text = String(value || ''); return text.length > 13 ? `${text.slice(0, 4)}…${text.slice(-4)}` : text; }

/** One word for what kind of signer this is, from their participation. */
export function signerRole(signer) {
  if (!signer.current) return 'Former signer';
  if (signer.participation?.canVote === false) return 'Cannot vote';
  const rate = signer.participation?.rate;
  if (!signer.votes?.total || rate == null) return 'Has not voted';
  if (rate >= 0.5) return 'Typical signer';
  if (rate >= 0.15) return 'Occasional signer';
  return 'Rarely signs';
}
/** The overview line, e.g. "Typical signer · approves 91% of proposals · usually signs within 2 h". */
export function signerSummary(signer) {
  const parts = [signerRole(signer)], p = signer.participation ?? {};
  if (p.approveRate != null && p.eligible) parts.push(`approves ${percent(p.approveRate)} of proposals`);
  const median = formatDuration(signer.timeToSign?.medianSeconds);
  if (median && signer.timeToSign.sample >= 3) parts.push(`usually signs within ${median}`);
  else if (signer.votes?.total && !signer.timeToSign?.sample) parts.push('votes on their own proposals');
  return parts.join(' · ');
}
/** Plain-language headline sentences for the detail view, before any chart. */
export function signerHeadlines(signer, { offsetMinutes = localOffsetMinutes(), zone = timeZoneLabel(), names = shortAddress, date = value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } = {}) {
  const lines = [], p = signer.participation ?? {}, v = signer.votes ?? {};
  if (!signer.current) lines.push(signer.removedAt ? `Removed from this multisig on ${date(signer.removedAt)}.` : 'No longer a member of this multisig (the removal was not observed).');
  if (p.canVote === false) lines.push('Has no vote permission, so they cannot approve or reject proposals.');
  else if (p.eligible) lines.push(`Voted on ${p.voted} of the ${plural(p.eligible, 'proposal')} open to them while a member (${percent(p.rate ?? 0)}), approving ${p.approved}.`);
  else lines.push('No proposal was open for voting while they were a member.');
  if (v.reject || v.cancel) lines.push(`Also voted to reject ${plural(v.reject, 'time')} and to cancel ${plural(v.cancel, 'time')}.`);
  const sign = signer.timeToSign ?? {};
  if (sign.sample) lines.push(`Signs within ${formatDuration(sign.medianSeconds)} of a proposal being created (median); 9 in 10 within ${formatDuration(sign.p90Seconds)}${sign.sample < 5 ? `, from only ${plural(sign.sample, 'vote')}` : ''}.`);
  else if (v.total) lines.push('Only votes on proposals they created themselves.');
  const range = localHourRange(signer.usualHoursUtc, offsetMinutes);
  if (range) lines.push(`Usually votes between ${range} (${zone}): 90% of their ${signer.usualHoursUtc.sample} votes.`);
  else if (v.total) lines.push(`Fewer than 10 votes, so Kelvara has no usual hours for them yet.`);
  const roles = [];
  if (signer.proposals?.created) roles.push(`proposed ${signer.proposals.created}`);
  if (signer.proposals?.executed) roles.push(`executed ${signer.proposals.executed}`);
  if (roles.length) lines.push(`${roles.join(', ').replace(/^./, c => c.toUpperCase())}.`);
  if (signer.completesThreshold?.usually) lines.push(`Usually casts the vote that reaches the threshold (${signer.completesThreshold.count} of ${signer.completesThreshold.of}).`);
  if (signer.executes?.usually) lines.push(`Usually executes what they approved (${signer.executes.count} of ${signer.executes.of}).`);
  if (signer.coSigners?.length) lines.push(`Signs most often with ${signer.coSigners.map(c => `${names(c.address)} (${c.count})`).join(', ')}.`);
  const notes = signer.notes ?? {};
  if (notes.unusualTime || notes.returnedAfterInactivity) lines.push([notes.unusualTime ? `${plural(notes.unusualTime, 'vote')} outside their usual hours` : null, notes.returnedAfterInactivity ? `${plural(notes.returnedAfterInactivity, 'return')} after more than 90 days away` : null].filter(Boolean).join('; ').replace(/^./, c => c.toUpperCase()) + '. Shown in Activity for information.');
  return lines;
}
/** The quiet warning on a proposal's Votes row. */
export function voteNoteText(note, { zone = timeZoneLabel(), offsetMinutes = localOffsetMinutes(), timeZone } = {}) {
  const who = shortAddress(note?.member);
  if (note?.kind === 'unusual_time') {
    const at = new Date(note.at), clock = Number.isNaN(at.getTime()) ? 'an unknown time' : at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) });
    const range = localHourRange(note.usualHoursUtc, offsetMinutes);
    return `${who}: voted at ${clock} ${zone}, outside this signer's usual hours${range ? ` (${range})` : ''}.`;
  }
  if (note?.kind === 'returned_after_inactivity') return `${who}: first vote after ${Number(note.gapDays) || 90}+ days without activity on this multisig.`;
  return null;
}

// ——— Renderers ———
const el = (doc, tag, className, text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = String(text); return node; };
const svg = (doc, tag, attrs = {}) => { const node = doc.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v)); return node; };

/** Single-series sparkline (votes per 30 days). Decorative next to its text; the detail chart is labelled. */
export function sparkline(doc, values, { width = 72, height = 22, label = null } = {}) {
  const data = (Array.isArray(values) ? values : []).map(v => Number(v) || 0), max = Math.max(1, ...data), step = data.length > 1 ? (width - 2) / (data.length - 1) : 0;
  const box = svg(doc, 'svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'governance-signers-spark', focusable: 'false' });
  if (label) { box.setAttribute('role', 'img'); box.setAttribute('aria-label', label); } else box.setAttribute('aria-hidden', 'true');
  const points = data.map((v, i) => `${(1 + i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  if (points.length) {
    box.append(svg(doc, 'polyline', { points: `1,${height - 2} ${points.join(' ')} ${(1 + (data.length - 1) * step).toFixed(1)},${height - 2}`, class: 'governance-signers-spark-area' }));
    box.append(svg(doc, 'polyline', { points: points.join(' '), class: 'governance-signers-spark-line' }));
    const [x, y] = points.at(-1).split(',');
    box.append(svg(doc, 'circle', { cx: x, cy: y, r: 2, class: 'governance-signers-spark-dot' }));
  }
  return box;
}
function heatmapNode(doc, grid, zone) {
  const local = localHeatmap(grid), max = Math.max(0, ...local.flat()), box = el(doc, 'div', 'governance-signers-heatmap');
  const total = local.flat().reduce((a, b) => a + b, 0);
  box.setAttribute('role', 'img');
  let busiest = null;
  for (const day of ROW_ORDER) for (let hour = 0; hour < 24; hour++) if (local[day][hour] && (!busiest || local[day][hour] > busiest.n)) busiest = { day, hour, n: local[day][hour] };
  box.setAttribute('aria-label', total ? `Votes by weekday and hour, ${zone}: ${total} in all; busiest ${WEEKDAYS[busiest.day]} ${pad(busiest.hour)}–${pad(busiest.hour + 1)} with ${plural(busiest.n, 'vote')}.` : `No votes to chart (${zone}).`);
  box.append(el(doc, 'span', 'governance-signers-heat-corner'));
  for (let hour = 0; hour < 24; hour++) box.append(el(doc, 'span', 'governance-signers-heat-hour', hour % 6 === 0 ? String(hour).padStart(2, '0') : ''));
  for (const day of ROW_ORDER) {
    box.append(el(doc, 'span', 'governance-signers-heat-day', WEEKDAYS[day]));
    for (let hour = 0; hour < 24; hour++) {
      const n = local[day][hour], cell = el(doc, 'span', 'governance-signers-heat-cell');
      cell.dataset.level = String(n && max ? Math.min(4, Math.ceil((n / max) * 4)) : 0);
      cell.title = `${WEEKDAYS[day]} ${pad(hour)}–${pad(hour + 1)} ${zone} · ${plural(n, 'vote')}`;
      box.append(cell);
    }
  }
  return box;
}
function bucketsNode(doc, buckets) {
  const list = el(doc, 'ul', 'governance-signers-buckets'), max = Math.max(1, ...buckets.map(b => b.count));
  for (const bucket of buckets) {
    const item = el(doc, 'li'), bar = el(doc, 'span', 'governance-signers-bucket-bar'), fill = el(doc, 'i');
    if (fill.style) fill.style.width = `${bucket.count ? Math.max(3, Math.round((bucket.count / max) * 100)) : 0}%`;
    bar.append(fill);
    bar.setAttribute('aria-hidden', 'true');
    item.append(el(doc, 'span', 'governance-signers-bucket-label', bucket.label), bar, el(doc, 'span', 'governance-signers-bucket-count', bucket.count));
    item.setAttribute('aria-label', `${bucket.label}: ${plural(bucket.count, 'vote')}`);
    list.append(item);
  }
  return list;
}
function chart(doc, title, body, note) {
  const box = el(doc, 'figure', 'governance-signers-chart'), caption = el(doc, 'figcaption', null, title);
  box.append(caption, body);
  if (note) box.append(el(doc, 'p', 'governance-signers-chart-note', note));
  return box;
}

/**
 * The module body. state: {loading, failed, data, selected}; ui: {avatar(address), address(address,label),
 * ago(iso), key, onSelect(address), onBack(), onRetry()}.
 */
export function renderSignerInsights(doc, state, ui) {
  const region = el(doc, 'div', 'governance-signers-insights');
  region.id = `${ui.domId}-insights`;
  region.dataset.governanceSigners = 'open';
  if (state.loading || (!state.data && !state.failed)) {
    region.setAttribute('aria-busy', 'true');
    const status = el(doc, 'p', 'governance-sr', 'Loading signer insights…');
    status.setAttribute('role', 'status');
    region.append(status, skeletonRows(doc, { rows: 4, cells: ['icon+w60/w40', 'w20'], rowClass: 'governance-signers-row', className: 'governance-signers-skeleton' }));
    return region;
  }
  if (state.failed) { region.append(loadError(doc, { title: 'Signer insights unavailable', message: 'Kelvara could not read this vault\'s signing history. The vote matrix is unchanged.', onRetry: ui.onRetry })); return region; }
  const data = state.data, zone = timeZoneLabel(), everyone = [...data.signers, ...data.former];
  const selected = state.selected ? everyone.find(s => s.address === state.selected) : null;
  if (selected) { region.append(detailNode(doc, selected, data, ui, zone)); return region; }
  const intro = el(doc, 'p', 'governance-signers-intro', `${plural(data.coverage.proposals, 'proposal')} since ${data.coverage.from ? new Date(data.coverage.from).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'the start of the record'}. Most active first; select a signer for their pattern.`);
  region.append(intro);
  const group = (title, list, className) => {
    if (!list.length) return;
    const box = el(doc, 'section', `governance-signers-group ${className}`), items = el(doc, 'ul', 'governance-signers-list');
    box.append(el(doc, 'h5', 'governance-signers-group-title', `${title} (${list.length})`));
    for (const signer of list) items.append(rowNode(doc, signer, ui));
    box.append(items);
    region.append(box);
  };
  group('Signers', data.signers, 'is-current');
  group('Former signers', data.former, 'is-former');
  if (!everyone.length) region.append(el(doc, 'p', 'governance-muted', 'No signing history recorded for this vault yet.'));
  return region;
}
function rowNode(doc, signer, ui) {
  const item = el(doc, 'li'), button = el(doc, 'button', 'governance-signers-row'), who = el(doc, 'span', 'governance-signers-who'), text = el(doc, 'span', 'governance-signers-text');
  button.type = 'button';
  button.dataset.governanceFocus = `${ui.key}:signer:${signer.address}`;
  button.dataset.role = signerRole(signer);
  const last = signer.lastActivityAt ? ui.ago(signer.lastActivityAt) : 'never active';
  button.setAttribute('aria-label', `${shortAddress(signer.address)}: ${signerSummary(signer)}. Last active ${last}. Show details.`);
  text.append(el(doc, 'strong', 'governance-signers-name', shortAddress(signer.address)), el(doc, 'span', 'governance-signers-summary', signerSummary(signer)));
  who.append(ui.avatar(signer.address), text);
  const side = el(doc, 'span', 'governance-signers-side');
  side.append(sparkline(doc, signer.frequency?.votes), el(doc, 'span', 'governance-signers-last', signer.lastActivityAt ? last : '—'));
  button.append(who, side);
  button.onclick = () => ui.onSelect(signer.address);
  item.append(button);
  return item;
}
function detailNode(doc, signer, data, ui, zone) {
  const box = el(doc, 'article', 'governance-signers-detail'), back = el(doc, 'button', 'governance-signers-back', '← All signers'), head = el(doc, 'header', 'governance-signers-detail-head'), title = el(doc, 'h5', 'governance-signers-detail-title');
  back.type = 'button';
  back.dataset.governanceFocus = `${ui.key}:signers-back`;
  back.onclick = () => ui.onBack();
  title.append(ui.avatar(signer.address), ui.address(signer.address, 'Signer'));
  head.append(title, el(doc, 'span', 'governance-signers-role', signerRole(signer)));
  const lines = el(doc, 'ul', 'governance-signers-headlines');
  for (const line of signerHeadlines(signer, { zone })) lines.append(el(doc, 'li', null, line));
  box.append(back, head, lines);
  const v = signer.votes;
  const breakdown = el(doc, 'dl', 'governance-signers-breakdown');
  for (const [label, value] of [['Approve', v.approve], ['Reject', v.reject], ['Cancel', v.cancel], ['Proposed', signer.proposals.created], ['Executed', signer.proposals.executed]]) { const row = el(doc, 'div'); row.append(el(doc, 'dt', null, label), el(doc, 'dd', null, value)); breakdown.append(row); }
  box.append(chart(doc, 'Votes and roles', breakdown));
  box.append(chart(doc, `When they vote (${zone})`, heatmapNode(doc, signer.heatmapUtc, zone), signer.usualHoursUtc ? `Usual hours ${localHourRange(signer.usualHoursUtc)}. Darker = more votes.` : 'Darker = more votes.'));
  const sign = signer.timeToSign;
  box.append(chart(doc, 'Time from proposal to their vote', sign.sample ? bucketsNode(doc, sign.buckets) : el(doc, 'p', 'governance-muted', 'No votes on other members\' proposals.'), sign.sample ? `Median ${formatDuration(sign.medianSeconds)} · 90th percentile ${formatDuration(sign.p90Seconds)} · ${plural(sign.sample, 'vote')}` : null));
  const bins = signer.frequency?.votes ?? [], months = bins.length * (signer.frequency?.binDays ?? 30) / 30;
  const freq = el(doc, 'div', 'governance-signers-frequency');
  freq.append(sparkline(doc, bins, { width: 280, height: 56, label: `Votes per 30 days over the last ${Math.round(months)} months: ${bins.join(', ')}` }));
  const axis = el(doc, 'p', 'governance-signers-axis');
  axis.append(el(doc, 'span', null, `${Math.round(months)} months ago`), el(doc, 'span', null, `peak ${Math.max(0, ...bins)} / 30 d`), el(doc, 'span', null, 'now'));
  freq.append(axis);
  box.append(chart(doc, 'Votes per 30 days', freq));
  if (signer.coSigners?.length) {
    const list = el(doc, 'ul', 'governance-signers-cosigners');
    for (const co of signer.coSigners) { const item = el(doc, 'li'); item.append(ui.avatar(co.address), ui.address(co.address, 'Co-signer'), el(doc, 'span', 'governance-signers-co-count', `${plural(co.count, 'proposal')} together`)); list.append(item); }
    box.append(chart(doc, 'Signs most often with', list));
  }
  const perms = Array.isArray(signer.permissions) ? signer.permissions : null, chips = el(doc, 'p', 'governance-signers-perms');
  if (perms === null) chips.textContent = 'Permissions not recorded.';
  else if (!perms.length) chips.textContent = 'No permissions.';
  else for (const [key, label] of [['initiate', 'Propose'], ['vote', 'Vote'], ['execute', 'Execute']]) if (perms.includes(key)) chips.append(el(doc, 'span', 'governance-signers-perm', label));
  box.append(chart(doc, signer.current ? 'Current permissions' : 'Permissions when last added', chips));
  box.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault?.(); ui.onBack(); } });
  return box;
}
