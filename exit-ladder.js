// Exit ladder UI: plan view, arm flow (nonce setup → sign every step once → arm), drill (dry run) and
// revoke. Network and wallet access only through injected functions, so the flow is testable offline.
const LAMPORTS_PER_SOL = 1_000_000_000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const shortKey = value => (value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '');

export function ladderStepLabel(step, decimals = 6) {
  if (step.kind === 'unstake') return 'Unstake shares from the Kamino farm';
  if (step.kind === 'withdraw_reserve') return `Withdraw everything via reserve ${shortKey(step.reserve)}`;
  if (step.kind === 'withdraw_tranche') return `Withdraw ${(Number(step.sharesRaw) / 10 ** decimals).toFixed(decimals)} shares via reserve ${shortKey(step.reserve)}`;
  if (step.kind === 'withdraw_idle') return 'Withdraw from vault idle cash';
  return 'Unknown step';
}

const OUTCOME_LABELS = Object.freeze({
  would_submit: 'Would execute', confirmed: 'Executed', step_down: 'Skipped: not enough liquidity', pending_unstake: 'Runs after unstake',
  nonce_unavailable: 'Unavailable (nonce used)', already_used: 'Already used', no_progress: 'Skipped: nothing to withdraw',
  stop: 'Stopped: needs review', unconfirmed: 'Submitted, not confirmed',
});

export function ladderPlanViewModel(plan) {
  const decimals = Number(plan.tokenDecimals ?? 6);
  return {
    targetId: plan.targetId,
    value: (Number(plan.positionValueRaw ?? 0) / 10 ** decimals).toFixed(2),
    short: Boolean(plan.small),
    feeMicroLamports: plan.priorityMicroLamports,
    setupRentSol: Number(plan.setupRentLamports ?? 0) / LAMPORTS_PER_SOL,
    missingNonces: Number(plan.missingNonceAccounts ?? 0),
    rows: (plan.steps || []).map((step, index) => ({ order: index + 1, label: ladderStepLabel(step, decimals), kind: step.kind, ready: Boolean(step.nonceReady) })),
  };
}

export function ladderStatusViewModel(status, run = null) {
  if (!status?.armed) return { armed: false, rows: [], summary: 'No exit ladder armed.' };
  const ladder = status.ladder, outcomes = new Map((run?.steps || []).map(row => [row.stepId, row]));
  const rows = ladder.steps.map((step, index) => {
    const outcome = outcomes.get(step.stepId);
    return { order: index + 1, label: ladderStepLabel(step) + (step.kind !== 'unstake' ? (step.guarded ? ' · payout guarded' : ' · unguarded (no room)') : ''), guarded: Boolean(step.guarded), state: step.usedAt ? 'Executed' : outcome ? OUTCOME_LABELS[outcome.outcome] || outcome.outcome : 'Ready' };
  });
  const summary = ladder.revokedAt ? 'Exit ladder revoked.' : ladder.completedAt ? 'Position fully unloaded.' : run?.state === 'partially_unloaded' ? 'Partially unloaded: re-arm to cover the rest.' : run?.state === 'dry_run' ? 'Drill complete. Nothing was submitted.' : `${rows.length} signed steps ready.`;
  return { armed: true, revoked: Boolean(ladder.revokedAt), completed: Boolean(ladder.completedAt), rows, summary };
}

export function renderLadderPanel({ plan = null, status = null, run = null } = {}) {
  const view = status?.armed ? ladderStatusViewModel(status, run) : null, planned = !view && plan ? ladderPlanViewModel(plan) : null;
  const rows = (view?.rows || planned?.rows || []).map(row => `<li data-kind="${escapeHtml(row.kind || '')}"><span>${row.order}. ${escapeHtml(row.label)}</span><span>${escapeHtml(row.state || (row.ready ? 'Nonce ready' : 'Nonce needed'))}</span></li>`).join('');
  const meta = planned ? `<p>Position ≈ ${escapeHtml(planned.value)} · ${planned.short ? 'short ladder' : 'full ladder'} · fee ${escapeHtml(planned.feeMicroLamports)} µlamports/CU${planned.missingNonces ? ` · one-time nonce rent ${planned.setupRentSol.toFixed(5)} SOL (refunded on revoke)` : ''}</p>` : `<p>${escapeHtml(view?.summary || 'No exit ladder armed.')}</p>`;
  const actions = view?.armed && !view.revoked && !view.completed ? '<button type="button" data-ladder-action="drill">Run drill</button><button type="button" data-ladder-action="revoke">Revoke</button>' : '<button type="button" data-ladder-action="arm">Arm exit ladder</button>';
  return `<section class="exit-ladder" aria-label="Exit ladder"><h3>Exit ladder</h3>${meta}<ol>${rows}</ol><div class="exit-ladder-actions">${actions}</div><p class="exit-ladder-message" role="status"></p></section>`;
}

// One wallet approval for all nonce setup transactions and one for all ladder steps.
async function signAll(provider, transactions) {
  return provider.signAllTransactions ? provider.signAllTransactions(transactions) : Promise.all(transactions.map(tx => provider.signTransaction(tx)));
}

export async function armExitLadder({ targetId, post, provider, web3, encode, decode, waitForConfirmation, onProgress = () => {} }) {
  onProgress('Planning exit ladder…');
  const plan = await post('/api/protection/ladder/plan', { targetId });
  if (plan.missingNonceAccounts > 0) {
    onProgress(`Creating ${plan.missingNonceAccounts} nonce accounts (one-time rent, refunded on revoke)…`);
    const setup = await post('/api/protection/ladder/nonce-setup/prepare', { targetId });
    const signed = await signAll(provider, setup.transactions.map(item => web3.Transaction.from(decode(item))));
    const submitted = await post('/api/protection/ladder/nonce-setup/submit', { targetId, signedTransactions: signed.map(tx => encode(tx.serialize())) });
    for (const signature of submitted.signatures) await waitForConfirmation(signature);
  }
  onProgress('Building and simulating every step…');
  const prepared = await post('/api/protection/ladder/prepare', { targetId });
  onProgress(`Approve ${prepared.steps.length} exit steps in your wallet…`);
  const signed = await signAll(provider, prepared.steps.map(step => web3.VersionedTransaction.deserialize(decode(step.transaction))));
  const steps = prepared.steps.map(({ transaction, simulation, transactionSize, ...step }, index) => ({ ...step, signedTransaction: encode(signed[index].serialize()) }));
  onProgress('Arming…');
  return post('/api/protection/ladder/arm', { targetId, steps });
}

export async function revokeExitLadder({ targetId, post, provider, web3, encode, decode, waitForConfirmation, onProgress = () => {} }) {
  const draft = await post('/api/protection/ladder/revoke/prepare', { targetId });
  if (!draft.transactions.length) return post('/api/protection/ladder/revoke/finalize', { targetId, signedTransactions: [] });
  onProgress(`Approve closing the nonce accounts (returns ${(draft.reclaimLamports / LAMPORTS_PER_SOL).toFixed(5)} SOL)…`);
  const signed = await signAll(provider, draft.transactions.map(item => web3.Transaction.from(decode(item))));
  const result = await post('/api/protection/ladder/revoke/finalize', { targetId, signedTransactions: signed.map(tx => encode(tx.serialize())) });
  for (const signature of result.signatures) await waitForConfirmation(signature);
  return result;
}

export const runLadderDrill = ({ targetId, post }) => post('/api/protection/ladder/run', { targetId, dryRun: true });

// Mounts the panel after `anchor` and wires its buttons. `deps` = { post, provider, web3, encode, decode, waitForConfirmation, toast }.
export function mountExitLadder(anchor, targetId, deps) {
  if (!anchor?.insertAdjacentHTML || !targetId) return null;
  anchor.parentElement?.querySelector?.('.exit-ladder')?.remove();
  let status = null, run = null, plan = null;
  const container = () => anchor.parentElement?.querySelector('.exit-ladder');
  const message = text => { const node = container()?.querySelector('.exit-ladder-message'); if (node) node.textContent = text; };
  const render = () => { container()?.remove(); anchor.insertAdjacentHTML('afterend', renderLadderPanel({ plan, status, run })); container()?.querySelectorAll('[data-ladder-action]').forEach(button => button.addEventListener('click', () => act(button.dataset.ladderAction))); };
  const refresh = async () => { status = await deps.post('/api/protection/ladder/status', { targetId }); if (!status.armed) plan = await deps.post('/api/protection/ladder/plan', { targetId }).catch(() => null); render(); };
  async function act(action) {
    try {
      if (action === 'arm') await armExitLadder({ targetId, ...deps, onProgress: message });
      if (action === 'revoke') await revokeExitLadder({ targetId, ...deps, onProgress: message });
      if (action === 'drill') { run = await runLadderDrill({ targetId, post: deps.post }); }
      await refresh();
    } catch (error) { message(error?.message || 'Exit ladder action failed'); deps.toast?.('Exit ladder action failed'); }
  }
  render();
  refresh().catch(() => message('Exit ladder unavailable'));
  return { refresh };
}
