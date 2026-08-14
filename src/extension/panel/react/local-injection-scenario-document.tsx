import { useLayoutEffect, useRef, type JSX } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../workbench-runtime";

type Props = Readonly<{
  runtime: WorkbenchRuntime;
  snapshot: WorkbenchSnapshot;
}>;

export function LocalInjectionScenarioDocument({ runtime, snapshot }: Props): JSX.Element | null {
  const state = snapshot.scenario;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const previousPicker = useRef(false);
  useLayoutEffect(() => {
    if (!state) return;
    if (!previousPicker.current && state.pickerOpen) {
      document.querySelector<HTMLElement>('[aria-label="Scenario Evidence picker"] button:not(:disabled)')?.focus();
    } else if (previousPicker.current && !state.pickerOpen) {
      addButton.current?.focus();
    } else if (!previousPicker.current) {
      heading.current?.focus();
    }
    previousPicker.current = state.pickerOpen;
  }, [state?.phase, state?.pickerOpen]);
  if (!state) return null;
  const run = state.run;
  const next = run?.steps[run.nextOrdinal - 1] ?? null;
  return <section className="workbench-react__scenario" aria-label="Local Injection Scenario">
    <header className="workbench-react__scenario-header">
      <div><span className="workbench-react__eyebrow">Temporary promoted document</span><h1 tabIndex={-1} ref={heading}>Local Injection Scenario</h1><span>{state.scenario.id} · revision {state.scenario.revision}</span></div>
      <strong>{state.phase.toUpperCase()}</strong>
    </header>
    <dl className="workbench-react__local-boundary">
      <div><dt>Target</dt><dd>{state.scenario.target.subscriptionId} · Session {state.scenario.target.sessionId ?? "Unknown"}</dd></div>
      <div><dt>Delivery</dt><dd>{state.scenario.target.deliveryPath.toUpperCase()} · exact shared Subscription target</dd></div>
      <div><dt>Boundary</dt><dd>LOCAL ONLY · one ordinary Local Injection per Step · Lightstreamer Server is not contacted</dd></div>
      {run ? <><div><dt>Reviewed Run</dt><dd>{run.id} · Scenario revision {run.scenarioRevision} · target fingerprint {run.targetFingerprint}</dd></div><div><dt>Evidence seed</dt><dd>{run.committedEvidenceSeed ? `${run.committedEvidenceSeed.intervalId} · sequence ${run.committedEvidenceSeed.sequence}` : "Empty committed Evidence boundary"}</dd></div></> : null}
    </dl>
    {state.membershipError ? <p className="workbench-react__scenario-problem" role="alert"><strong>BLOCKED.</strong> {state.membershipError} No Injection was attempted.</p> : null}
    {state.pickerOpen ? <section className="workbench-react__scenario-picker" aria-label="Scenario Evidence picker">
      <header><strong>Add one captured update</strong><span>Visible Evidence is offered for deliberate choice; it is not Scenario membership.</span></header>
      <ul>{snapshot.evidence.events.map((event) => {
        const compatible = event.kind === "item-update" && event.source === "SERVER";
        return <li key={event.id}><div><strong>{event.id}</strong><span>{event.object} · {event.command ?? event.kind}</span>{!compatible ? <small>Unavailable · not a compatible captured Server Item Update.</small> : null}</div><button type="button" disabled={!compatible} onClick={() => {
          runtime.dispatch({ type: "select-evidence", eventId: event.id });
          runtime.dispatch({ type: "add-selected-evidence-to-scenario" });
        }}>Add this update</button></li>;
      })}</ul>
      {snapshot.evidence.events.length === 0 ? <p>No retained Evidence is available to add.</p> : null}
      <button type="button" onClick={() => runtime.dispatch({ type: "close-scenario-evidence-picker" })}>Cancel</button>
    </section> : null}
    <div className="workbench-react__scenario-steps" aria-label="Ordered Scenario Steps">
      {state.scenario.steps.map((step, index) => {
        const trace = run?.trace.find((entry) => entry.stepId === step.id);
        return <article key={step.id} data-step-state={trace ? "complete" : run?.nextOrdinal === index + 1 ? "next" : "waiting"}>
          <header><strong>Step {index + 1}</strong><span>{step.id} · stable identity · delay {step.draft.relativeDelayMs} ms</span></header>
          <dl><div><dt>Source</dt><dd>{step.draft.sourceEventId ?? "None · newly authored"}</dd></div><div><dt>Validation</dt><dd>{step.draft.ready ? "READY" : "BLOCKED"}</dd></div></dl>
          <pre tabIndex={0} aria-label={`Step ${index + 1} reviewed JSON`}>{step.draft.rawText}</pre>
          {trace ? <p><strong>{trace.outcome.headline}</strong> · Injection {trace.injectionId}{trace.evidence ? ` · Local Evidence ${trace.evidence.eventId}` : " · no committed Local Evidence"}</p> : null}
        </article>;
      })}
    </div>
    <footer className="workbench-react__local-footer">
      {state.phase === "edit" ? <><button type="button" ref={addButton} onClick={() => runtime.dispatch({ type: "open-scenario-evidence-picker" })}>Add captured update</button><span>{state.scenario.steps.length} explicit Step{state.scenario.steps.length === 1 ? "" : "s"} · no execution shortcut</span><button type="button" onClick={() => runtime.dispatch({ type: "review-scenario" })}>Review Scenario</button></> : null}
      {state.phase === "review" || state.phase === "paused" ? <><button type="button" onClick={() => runtime.dispatch({ type: "edit-scenario" })}>Edit Scenario</button><span>{next ? `Next: Step ${next.ordinal} · dispatches one Injection then pauses` : "All Steps settled"}</span><button type="button" disabled={!next} onClick={() => runtime.dispatch({ type: "step-next-scenario" })}>Step next</button></> : null}
      {state.phase === "running" ? <span role="status">STEP RUNNING · waiting for its Injection Outcome and committed Evidence settlement.</span> : null}
      {state.phase === "complete" ? <><span>RUN COMPLETE · {run?.trace.length ?? 0} independently traced Injections.</span><button type="button" onClick={() => runtime.dispatch({ type: "finish-scenario" })}>Finish Scenario</button></> : null}
    </footer>
  </section>;
}
