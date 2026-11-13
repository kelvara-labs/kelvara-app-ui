/** Poll a DOM renderer without discarding the last valid response. */
// paused(): timer ticks are skipped while it returns true (e.g. the tab is hidden); poll() still runs on demand.
export function createDomPoller({ fetchValue, render, renderUnavailable = () => {}, intervalMs = 3000, setTimer = setInterval, clearTimer = clearInterval, paused = () => false }) {
  if (intervalMs < 2000 || intervalMs > 60000) throw new RangeError('poll_interval_out_of_bounds');
  let stopped = false;
  let hasValid = false;
  let timer;
  async function poll() {
    try {
      const value = await fetchValue();
      if (stopped) return;
      hasValid = true;
      render(value);
    } catch (error) {
      if (!stopped && !hasValid) renderUnavailable(error);
    }
  }
  return {
    start() { if (!timer) { void poll(); timer = setTimer(() => { if (!paused()) void poll(); }, intervalMs); } return this; },
    stop() { stopped = true; if (timer) clearTimer(timer); timer = undefined; },
    poll,
  };
}
