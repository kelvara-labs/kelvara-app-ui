// Presents protection/wallet action errors as a readable alert: plain-language title and explanation,
// whether anything was sent, and the raw code behind a "Technical details" toggle. Text-only rendering.
const SAFE = 'Nothing was sent to the network. Your funds and accounts are unchanged.';
const short = value => (value && value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value || '');
const PROGRAM_NAMES = Object.freeze({
  L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95: 'Lighthouse (wallet safety check)',
  ComputeBudget111111111111111111111111111111: 'Compute Budget (priority fee)',
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: 'Memo',
});

// Returns { tone, title, message, safe, retry } for an error code or message.
export function describeActionError(raw) {
  const code = String(raw?.message ?? raw ?? '').trim();
  const [base, reason = '', detail = ''] = code.split(':');
  if (/user rejected|rejected the request|declined|cancell?ed/i.test(code)) return { tone: 'info', title: 'Cancelled in your wallet', message: 'You declined the request in your wallet.', safe: true, retry: true };
  if (/reconciliation required|status unknown/i.test(code)) return { tone: 'warning', title: 'Status unknown', message: 'The transaction may have been sent. Do not retry: Kelvara will reconcile it with the chain.', safe: false, retry: false };
  if (base === 'invalid_reclaim_transaction' || base === 'ladder_revoke_invalid' || base === 'ladder_nonce_setup_invalid') {
    const reasons = {
      unexpected_program: { title: 'Your wallet changed the transaction', message: `Your wallet added an instruction from ${PROGRAM_NAMES[detail] || `program ${short(detail)}`} that Kelvara does not accept for this action.` },
      unexpected_system_instruction: { title: 'Unexpected transfer in the transaction', message: 'The signed transaction contains a system instruction other than closing your protection accounts.' },
      unexpected_nonce_account: { title: 'Unknown account in the transaction', message: `The transaction tries to close an account (${short(detail)}) that is not part of your protection setup.` },
      lamports_changed: { title: 'Balances changed', message: 'An account balance changed after the transaction was prepared. Prepare it again.' },
      accounts_mismatch: { title: 'Incomplete transaction', message: 'The signed transaction does not close all of your protection accounts.' },
      destination_not_wallet: { title: 'Wrong destination', message: 'The transaction would send the recovered SOL somewhere other than your wallet.' },
      nonce_authority_not_wallet: { title: 'Wrong authority', message: 'These protection accounts are not controlled by the connected wallet.' },
      fee_payer_not_wallet: { title: 'Wrong fee payer', message: 'The transaction must be paid by the connected wallet.' },
      compute_budget_duplicated: { title: 'Duplicate fee instructions', message: 'Your wallet added the same priority-fee instruction twice.' },
      not_fully_signed: { title: 'Signature missing', message: 'The transaction came back from your wallet without a complete signature.' },
    };
    return { tone: 'error', ...(reasons[reason] || { title: 'Transaction rejected', message: 'The signed transaction did not match what Kelvara prepared.' }), safe: true, retry: true };
  }
  if (base === 'armed_wallet_modified_transaction' || base === 'ladder_wallet_modified_transaction') return { tone: 'error', title: 'Your wallet changed the exit transaction', message: 'The pre-signed exit came back different from what you approved, so Kelvara refused to store it. Try again; if it repeats, use the exit ladder.', safe: true, retry: true };
  if (base === 'armed_exit_needs_ladder') return { tone: 'warning', title: 'Use the exit ladder for this vault', message: 'This vault has too many lending markets to fit a protected one-step exit in a single transaction. The exit ladder splits it into steps that fit.', safe: true, retry: false };
  if (base === 'invalid_armed_instruction_sequence' || base === 'invalid_armed_signature') return { tone: 'error', title: 'Exit transaction rejected', message: 'The signed exit did not match what Kelvara prepared, usually because the wallet added its own instructions. Nothing was stored.', safe: true, retry: true };
  if (/^rpc_http_429/.test(code)) return { tone: 'warning', title: 'Solana RPC is busy', message: 'The network provider is rate-limiting requests. Wait a few seconds and try again.', safe: true, retry: true };
  if (/^rpc_/.test(code) || code === 'internal_error') return { tone: 'error', title: 'Network or server error', message: 'Kelvara could not complete the request. Try again in a moment.', safe: true, retry: true };
  if (code === 'protection_not_armed') return { tone: 'info', title: 'No protection setup found', message: 'There is no active protection for this position, so there is nothing to recover.', safe: true, retry: false };
  if (code === 'nonce_authority_mismatch') return { tone: 'error', title: 'Different wallet', message: 'These protection accounts belong to a different wallet than the one connected.', safe: true, retry: false };
  if (code === 'invalid_reclaim_accounts') return { tone: 'error', title: 'Protection setup incomplete', message: 'The stored protection setup does not have the expected accounts.', safe: true, retry: false };
  if (code === 'nonce_account_unavailable') return { tone: 'warning', title: 'Previous setup was closed', message: 'The accounts from your earlier setup no longer exist (for example after recovering locked SOL). Refresh the page and start the setup again.', safe: true, retry: true };
  if (/^nonce_/.test(code)) return { tone: 'error', title: 'Protection accounts changed', message: 'The protection accounts changed on chain. Refresh and try again.', safe: true, retry: true };
  return { tone: 'error', title: 'Something went wrong', message: 'The action could not be completed.', safe: false, retry: true };
}

const STYLE_ID = 'kelvara-action-error-style';
function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.action-error{display:grid;grid-template-columns:20px 1fr;gap:4px 10px;margin:12px 0 0;padding:12px 14px;border:1px solid var(--ae-line);border-radius:10px;background:var(--ae-bg);color:inherit;font-size:13px;line-height:1.45;text-align:left}
.action-error{--ae-line:rgba(220,38,38,.35);--ae-bg:rgba(220,38,38,.07);--ae-accent:#dc2626}
.action-error[data-tone=warning]{--ae-line:rgba(217,119,6,.4);--ae-bg:rgba(217,119,6,.08);--ae-accent:#d97706}
.action-error[data-tone=info]{--ae-line:rgba(37,99,235,.3);--ae-bg:rgba(37,99,235,.06);--ae-accent:#2563eb}
.action-error .ae-icon{grid-row:1/span 3;width:20px;height:20px;border-radius:50%;background:var(--ae-accent);color:#fff;font:700 12px/20px system-ui;text-align:center}
.action-error strong{font-weight:600}
.action-error p{margin:0;opacity:.85}
.action-error .ae-safe{opacity:.7;font-size:12px}
.action-error details{grid-column:2;margin-top:4px;font-size:12px}
.action-error summary{cursor:pointer;opacity:.7;list-style:none}.action-error summary::-webkit-details-marker{display:none}
.action-error summary::before{content:'▸ ';}.action-error details[open] summary::before{content:'▾ ';}
.action-error .ae-code{display:flex;gap:8px;align-items:flex-start;margin-top:6px}
.action-error code{flex:1;padding:6px 8px;border-radius:6px;background:rgba(127,127,127,.12);font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
.action-error button{flex:none;padding:3px 8px;border:1px solid var(--ae-line);border-radius:6px;background:transparent;color:inherit;font-size:11px;cursor:pointer}`;
  doc.head.appendChild(style);
}

// Renders into `node` (replacing its content). Returns the description for logging.
export function renderActionError(node, raw, doc = node?.ownerDocument) {
  if (!node || !doc) return null;
  const info = describeActionError(raw), code = String(raw?.message ?? raw ?? '');
  ensureStyle(doc);
  const el = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const box = el('div', 'action-error'); box.dataset.tone = info.tone; box.setAttribute('role', info.tone === 'info' ? 'status' : 'alert');
  box.append(el('span', 'ae-icon', info.tone === 'info' ? 'i' : '!'), el('strong', '', info.title), el('p', '', info.message));
  if (info.safe) box.append(el('p', 'ae-safe', SAFE + (info.retry ? ' You can try again.' : '')));
  if (code) {
    const details = el('details'), row = el('div', 'ae-code'), copy = el('button', '', 'Copy');
    copy.type = 'button';
    copy.addEventListener('click', () => { doc.defaultView?.navigator?.clipboard?.writeText(code).then(() => { copy.textContent = 'Copied'; }, () => {}); });
    row.append(el('code', '', code), copy);
    details.append(el('summary', '', 'Technical details'), row);
    box.append(details);
  }
  node.replaceChildren(box);
  return info;
}
