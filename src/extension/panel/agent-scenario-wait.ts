export type AgentScenarioProgress = Readonly<{
  pageEpoch: string | null;
  runId: string | null;
  revision: number;
  terminal: boolean;
  scenario: unknown;
}>;
export type AgentScenarioWaitResult = Readonly<{
  status: "CHANGED" | "TERMINAL" | "TIMED_OUT" | "UNAVAILABLE";
  runId: string;
  pageEpoch: string;
  revision: number;
  scenario: unknown | null;
  reason: string;
}>;

/** Observe progress of one exact Run. Notifications are subscribed before the
 * first read; elapsed clock time alone never changes its progress revision. */
export function waitForAgentScenario(source: {
  read(): AgentScenarioProgress;
  subscribe(listener: () => void): () => void;
}, input: { runId: string; pageEpoch: string; afterRevision?: number; timeoutMs: number; signal?: AbortSignal }): Promise<AgentScenarioWaitResult> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let unsubscribe = () => {};
    let deadline: ReturnType<typeof setTimeout> | undefined;
    function finish(value?: AgentScenarioWaitResult, error?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      unsubscribe();
      input.signal?.removeEventListener("abort", aborted);
      if (value) resolve(value);
      else reject(error ?? new Error("QUERY_CANCELLED: Scenario wait was cancelled. The Run was not repeated or resumed."));
    }
    function aborted() { finish(); }
    function read(timeout = false) {
      if (finished) return;
      try {
        const current = source.read();
        const same = current.runId === input.runId && current.pageEpoch === input.pageEpoch;
        const response = (status: AgentScenarioWaitResult["status"], reason: string): AgentScenarioWaitResult => ({
          status, runId: input.runId, pageEpoch: input.pageEpoch, revision: same ? current.revision : input.afterRevision ?? 0,
          scenario: same ? current.scenario : null, reason
        });
        if (!same) finish(response("UNAVAILABLE", "The exact Scenario Run or inspected page is no longer current. Inspect the current document; no control was dispatched."));
        else if (input.afterRevision !== undefined && input.afterRevision > current.revision) finish(response("UNAVAILABLE", "The supplied revision is ahead of this Run's progress. Read its current trace before waiting again."));
        else if (current.terminal) finish(response("TERMINAL", "The exact Run completed or stopped. Consult its trace for delivery and assertion outcomes."));
        else if (input.afterRevision === undefined || current.revision > input.afterRevision) finish(response("CHANGED", "The exact Run's progress changed. This does not assert application behavior."));
        else if (timeout) finish(response("TIMED_OUT", "No progress change was observed before timeout. The Run remains inspectable."));
      } catch (error) { finish(undefined, error); }
    }
    if (input.signal?.aborted) { aborted(); return; }
    input.signal?.addEventListener("abort", aborted, { once: true });
    try {
      unsubscribe = source.subscribe(() => read());
      if (finished) { unsubscribe(); return; }
      read(input.timeoutMs === 0);
      if (!finished) deadline = setTimeout(() => read(true), input.timeoutMs);
    } catch (error) { finish(undefined, error); }
  });
}
