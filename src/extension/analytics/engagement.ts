/** Accumulate foreground time, capped at one minute after the latest interaction. */
export function createEngagementClock(now: () => number = Date.now) {
  let visible = false;
  let focused = false;
  let lastInteraction = 0;
  let lastAccounted = now();
  let accumulated = 0;
  function account() {
    const time = now();
    if (visible && focused) accumulated += Math.max(0, Math.min(time, lastInteraction + 60_000) - lastAccounted);
    lastAccounted = time;
  }
  return {
    setVisible(value: boolean) { account(); visible = value; if (value) lastInteraction = now(); },
    setFocused(value: boolean) { account(); focused = value; if (value) lastInteraction = now(); },
    interact() { account(); lastInteraction = now(); },
    take() { account(); const time = Math.min(60_000, Math.floor(accumulated)); accumulated = 0; return time; },
    reset() { accumulated = 0; lastAccounted = now(); lastInteraction = now(); }
  };
}
