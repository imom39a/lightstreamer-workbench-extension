import { useLayoutEffect, useRef, type JSX } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../workbench-runtime";
import { LocalInjectionCodeEditor } from "./local-injection-code-editor";

type Props = Readonly<{
  runtime: WorkbenchRuntime;
  snapshot: WorkbenchSnapshot;
}>;

export function LocalInjectionScenarioDocument({ runtime, snapshot }: Props): JSX.Element | null {
  const state = snapshot.scenario;
  const heading = useRef<HTMLHeadingElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const previousPicker = useRef(false);
  const openedScenarioId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!state) return;
    if (!previousPicker.current && state.pickerOpen) {
      document.querySelector<HTMLElement>('[aria-label="Scenario Evidence picker"] button:not(:disabled)')?.focus();
    } else if (previousPicker.current && !state.pickerOpen) {
      addButton.current?.focus();
    } else if (openedScenarioId.current !== state.scenario.id) {
      heading.current?.focus();
      openedScenarioId.current = state.scenario.id;
    }
    previousPicker.current = state.pickerOpen;
  }, [state?.scenario.id, state?.pickerOpen]);
  if (!state) return null;
  const run = state.run;
  const next = run?.steps[run.nextOrdinal - 1] ?? null;
  return <section className="workbench-react__scenario" aria-label="Local Injection Scenario" data-phase={state.phase}>
    <header className="workbench-react__scenario-header">
      <div><span className="workbench-react__eyebrow">Temporary promoted document</span><h1 tabIndex={-1} ref={heading}>Local Injection Scenario</h1><span>{state.scenario.id} · revision {state.scenario.revision}</span></div>
      <strong>{(state.runner?.phase ?? state.phase).toUpperCase()}</strong>
    </header>
    <dl className="workbench-react__local-boundary">
      <div><dt>Target</dt><dd>{state.scenario.target.subscriptionId} · Session {state.scenario.target.sessionId ?? "Unknown"}</dd></div>
      <div><dt>Delivery</dt><dd>{state.scenario.target.deliveryPath.toUpperCase()} · exact shared Subscription target</dd></div>
      <div><dt>Boundary</dt><dd>LOCAL ONLY · one ordinary Local Injection per Step · Lightstreamer Server is not contacted</dd></div>
      <div><dt>Scenario Clock</dt><dd>{state.scenario.speed}× speed · monotonic active time · hidden and paused time excluded</dd></div>
      {run ? <><div><dt>Reviewed Run</dt><dd>{run.id} · Scenario revision {run.scenarioRevision} · target fingerprint {run.targetFingerprint}</dd></div><div><dt>Evidence seed</dt><dd>{run.committedEvidenceSeed ? `${run.committedEvidenceSeed.intervalId} · sequence ${run.committedEvidenceSeed.sequence}` : "Empty committed Evidence boundary"}</dd></div></> : null}
    </dl>
    {state.membershipError ? <p className="workbench-react__scenario-problem" role="alert"><strong>BLOCKED.</strong> {state.membershipError} No Injection was attempted.</p> : null}
    {state.pickerOpen ? <section className="workbench-react__scenario-picker" aria-label="Scenario Evidence picker" onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      runtime.dispatch({ type: "close-scenario-evidence-picker" });
    }}>
      <header><strong>Add captured updates</strong><span>Visible or filtered Evidence is only a candidate set. Membership changes after an individual add or confirmed preview.</span></header>
      <div className="workbench-react__scenario-picker-actions">
        <button type="button" onClick={() => runtime.dispatch({ type: "preview-visible-evidence-for-scenario" })}>Preview visible set</button>
        {state.membershipPreview ? <><span>{state.membershipPreview.members.filter(({ available }) => available).length} compatible · {state.membershipPreview.members.filter(({ available }) => !available).length} unavailable</span><button type="button" disabled={!state.membershipPreview.members.some(({ available }) => available)} onClick={() => runtime.dispatch({ type: "confirm-scenario-membership-preview" })}>Confirm compatible Steps</button></> : null}
      </div>
      <ul>{snapshot.evidence.events.map((event) => {
        const membership = state.membership.find(({ eventId }) => eventId === event.id);
        const preview = state.membershipPreview?.members.find(({ eventId }) => eventId === event.id);
        const compatible = membership?.available ?? false;
        const reasonId = `scenario-membership-${event.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
        return <li key={event.id}><div><strong>{event.id}</strong><span>{event.object} · {event.command ?? event.kind}{preview ? ` · retained ${preview.intervalId} sequence ${preview.retainedSequence}` : ""}</span>{preview ? <small>{preview.available ? "Will add after confirmation" : `Unavailable · ${preview.reason}`}</small> : !compatible ? <small id={reasonId}>Unavailable · {membership?.reason ?? "compatibility could not be proven."}</small> : null}</div><button type="button" disabled={!compatible} aria-describedby={!compatible ? reasonId : undefined} onClick={() => {
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
        const focused = state.focusedStepId === step.id;
        return <article key={step.id} data-step-state={trace ? "complete" : run?.nextOrdinal === index + 1 ? "next" : "waiting"} data-step-focused={focused ? "true" : "false"}>
          <header><button type="button" className="workbench-react__scenario-step-focus" aria-pressed={focused} onClick={() => runtime.dispatch({ type: "focus-scenario-step", stepId: step.id })}>Step {index + 1}</button><span>{step.id} · stable identity · delay {step.draft.relativeDelayMs} ms</span></header>
          {state.phase !== "stopped" ? <dl><div><dt>Source</dt><dd>{step.draft.sourceEventId ?? "None · newly authored"}</dd></div><div><dt>Validation</dt><dd>{step.draft.ready ? "READY" : "BLOCKED"}</dd></div></dl> : null}
          {state.phase === "edit" ? <div className="workbench-react__scenario-step-actions" aria-label={`Step ${index + 1} actions`}>
            <button type="button" disabled={index === 0} onClick={() => runtime.dispatch({ type: "move-scenario-step", stepId: step.id, direction: "earlier" })}>Move earlier</button>
            <button type="button" disabled={index === state.scenario.steps.length - 1} onClick={() => runtime.dispatch({ type: "move-scenario-step", stepId: step.id, direction: "later" })}>Move later</button>
            <button type="button" onClick={() => runtime.dispatch({ type: "duplicate-scenario-step", stepId: step.id })}>Duplicate Step</button>
            <button type="button" disabled={state.scenario.steps.length === 1} onClick={() => runtime.dispatch({ type: "remove-scenario-step", stepId: step.id })}>Remove Step</button>
            <label>Delay ms <input type="number" min={0} value={step.draft.relativeDelayMs} onChange={(event) => runtime.dispatch({ type: "set-scenario-step-delay", stepId: step.id, delayMs: Number(event.currentTarget.value) })} /></label>
          </div> : null}
          {state.phase === "edit" && !focused ? <button type="button" className="workbench-react__scenario-collapsed" onClick={() => runtime.dispatch({ type: "focus-scenario-step", stepId: step.id })}>{step.draft.ready ? "Collapsed Draft · Open editor" : `Collapsed Draft · BLOCKED · ${step.draft.diagnostics[0]?.message ?? "validation required"}`}</button> : null}
          {state.phase === "edit" && focused ? <section className="workbench-react__scenario-editor" aria-label={`Step ${index + 1} Injection Draft`}>
            <button type="button" disabled={step.draft.sourceRawText === null} aria-pressed={step.draft.editor.compareOpen} onClick={() => runtime.dispatch({ type: "set-scenario-step-compare", stepId: step.id, open: !step.draft.editor.compareOpen })}>Compare Source</button>
            <LocalInjectionCodeEditor
              draftId={step.draft.id}
              value={step.draft.rawText}
              source={step.draft.sourceRawText}
              compareOpen={step.draft.editor.compareOpen}
              diagnostics={step.draft.diagnostics}
              tabIndents={false}
              readOnly={false}
              presentation={step.draft.editor}
              ariaLabel={`Step ${index + 1} Local Injection JSON`}
              onChange={(text) => runtime.dispatch({ type: "set-scenario-step-json", stepId: step.id, text })}
              onPresentationChange={(presentation) => runtime.dispatch({ type: "set-scenario-step-editor-presentation", stepId: step.id, presentation })}
            />
          </section> : null}
          {state.phase !== "edit" && state.phase !== "stopped" ? <pre tabIndex={0} aria-label={`Step ${index + 1} reviewed JSON`}>{step.draft.rawText}</pre> : null}
          {trace ? trace.kind === "attempted" ? <><p><strong>{trace.outcome.headline}</strong>{` · Injection ${trace.injectionId}`}{trace.outcome.attemptedCount !== undefined ? ` · listeners ${trace.outcome.deliveredCount ?? 0}/${trace.outcome.attemptedCount} delivered${trace.outcome.failedCount ? `, ${trace.outcome.failedCount} failed` : ""}` : ""} · {trace.outcome.detail}{trace.evidence ? ` · Local Evidence ${trace.evidence.eventId}` : " · no committed Local Evidence"}</p>{trace.timing ? <p className="workbench-react__scenario-timing">Scenario Clock · delay {trace.timing.originalDelayMs} ms → {trace.timing.scaledDelayMs} ms · planned {trace.timing.plannedDispatchActiveOffsetMs} ms · dispatched {trace.timing.actualDispatchActiveOffsetMs} ms · settled {trace.timing.settlementActiveOffsetMs} ms · late {trace.timing.latenessMs} ms{trace.timing.manualOverride ? ` · STEP NEXT bypassed ${trace.timing.bypassedDelayMs} ms` : ""}</p> : null}{trace.outcome.limitations?.map((limitation) => <p role="note" key={limitation.field}><strong>TRACE VALUE LIMITED.</strong>{` ${limitation.field} retained ${limitation.retainedBytes} of ${limitation.originalBytes} UTF-8 bytes for bounded Scenario accounting. Delivery semantics are unchanged; inspect the page's own diagnostics for the original value.`}</p>)}</> : <p><strong>NOT RUN</strong> · {trace.reason} · no Injection attempted · {trace.detail}</p> : null}
        </article>;
      })}
    </div>
    <footer className="workbench-react__local-footer">
      {state.phase === "edit" ? <><button type="button" ref={addButton} onClick={() => runtime.dispatch({ type: "open-scenario-evidence-picker" })}>Add captured update</button><button type="button" onClick={() => runtime.dispatch({ type: "add-authored-scenario-step" })}>Add authored update</button>{state.canUndoRemoval ? <button type="button" onClick={() => runtime.dispatch({ type: "undo-scenario-step-removal" })}>Undo removal</button> : null}<label>Speed <select aria-label="Scenario speed" value={state.scenario.speed} onChange={(event) => runtime.dispatch({ type: "set-scenario-speed", speed: Number(event.currentTarget.value) as 0.25 | 0.5 | 1 | 2 | 4 })}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><span>{state.scenario.steps.length}/100 explicit Steps · {formatScenarioBytes(state.scenario.accountedBytes)}/8 MiB · no execution shortcut</span><button type="button" className="workbench-react__primary" onClick={() => runtime.dispatch({ type: "review-scenario" })}>Review Scenario</button></> : null}
      {state.phase === "review" ? <><button type="button" onClick={() => runtime.dispatch({ type: "edit-scenario" })}>Edit Scenario</button><span>{next ? `Next: Step ${next.ordinal} · delay ${state.runner?.remainingDelayMs ?? 0} ms` : "All Steps settled"}</span><button type="button" onClick={() => runtime.dispatch({ type: "step-next-scenario" })}>Step next</button><button type="button" className="workbench-react__primary" onClick={() => runtime.dispatch({ type: "play-scenario" })}>Play</button><button type="button" onClick={() => runtime.dispatch({ type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "paused" ? <><button type="button" onClick={() => runtime.dispatch({ type: "edit-scenario" })}>Edit Scenario</button><span>{state.runner?.pauseReason === "HIDDEN" ? "PAUSED — PANEL HIDDEN · explicit Resume required" : state.runner?.pauseReason === "DRIFT" ? "PAUSED — DRIFT · re-review required" : `PAUSED · ${state.runner?.remainingDelayMs ?? 0} ms remains before Step ${next?.ordinal ?? "—"}`}</span><button type="button" disabled={!next} onClick={() => runtime.dispatch({ type: "step-next-scenario" })}>Step next</button><button type="button" className="workbench-react__primary" disabled={!next || !snapshot.visible || state.runner?.pauseReason === "DRIFT"} onClick={() => runtime.dispatch({ type: "play-scenario" })}>Resume</button><button type="button" onClick={() => runtime.dispatch({ type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "running" ? <><span>{state.runner?.phase === "waiting" ? `WAITING · Step ${next?.ordinal ?? "—"} dispatch is scheduled on active time.` : state.runner?.phase === "in-flight" ? `IN FLIGHT · Step ${next?.ordinal ?? "—"} is settling its real Outcome and committed Evidence.` : state.runner?.phase === "pause-pending" ? "PAUSE PENDING · current Injection will settle truthfully." : "STOP PENDING · current Injection will settle truthfully; remainder will be NOT RUN."}</span>{state.runner?.phase === "waiting" || state.runner?.phase === "in-flight" ? <button type="button" className="workbench-react__primary" onClick={() => runtime.dispatch({ type: "pause-scenario" })}>Pause</button> : null}<button type="button" onClick={() => runtime.dispatch({ type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "complete" ? <><span>RUN COMPLETE · {run?.trace.length ?? 0} independently traced Injections.</span><button type="button" onClick={() => runtime.dispatch({ type: "finish-scenario" })}>Finish Scenario</button><button type="button" className="workbench-react__primary" onClick={() => runtime.dispatch({ type: "run-scenario-again" })}>Run again</button></> : null}
      {state.phase === "stopped" ? <><span>RUN STOPPED · remaining Steps were NOT RUN; settled outcomes were preserved.</span><button type="button" onClick={() => runtime.dispatch({ type: "finish-scenario" })}>Finish Scenario</button><button type="button" className="workbench-react__primary" onClick={() => runtime.dispatch({ type: "run-scenario-again" })}>Run again</button></> : null}
    </footer>
  </section>;
}

function formatScenarioBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}
