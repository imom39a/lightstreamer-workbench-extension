import { useLayoutEffect, useRef, type JSX } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../workbench-runtime";
import type { ScenarioAssertion, ScenarioCheckpoint, ScenarioStep, ScenarioTraceEntry } from "../../../core/local-injection-scenario";
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
  const focusIntent = useRef<"play" | "pause" | "resume" | "resume-or-run-again" | "stop-or-run-again" | "edit" | null>(null);
  const recoverTerminalFocus = useRef(false);
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
  useLayoutEffect(() => {
    const intent = focusIntent.current;
    if (!state || !intent) return;
    const keys = intent === "resume-or-run-again"
      ? ["resume", "run-again", "stop"]
      : intent === "stop-or-run-again"
        ? ["run-again", "stop"]
        : intent === "resume"
          ? ["resume", "stop"]
        : [intent];
    const target = keys.map((key) => document.querySelector<HTMLButtonElement>(`[aria-label="Local Injection Scenario"] [data-scenario-control="${key}"]:not(:disabled)`)).find(Boolean);
    if (!target) return;
    target.focus();
    recoverTerminalFocus.current = target.dataset.scenarioControl === "pause" || target.dataset.scenarioControl === "stop";
    if (target.dataset.scenarioControl !== "stop") focusIntent.current = null;
  }, [state?.phase, state?.runner?.phase, state?.runner?.pauseReason, state?.runner?.controlCapacityReached]);
  useLayoutEffect(() => {
    if (!state || (state.phase !== "complete" && state.phase !== "stopped") || !recoverTerminalFocus.current) return;
    document.querySelector<HTMLButtonElement>('[aria-label="Local Injection Scenario"] [data-scenario-control="run-again"]')?.focus();
    recoverTerminalFocus.current = false;
  }, [state?.phase]);
  const dispatchWithFocus = (intent: NonNullable<typeof focusIntent.current>, command: Parameters<WorkbenchRuntime["dispatch"]>[0]): void => {
    focusIntent.current = intent;
    runtime.dispatch(command);
  };
  if (!state) return null;
  const run = state.run;
  const focusedMemberId = state.focusedMemberId;
  const scenarioMembers: readonly (ScenarioStep | ScenarioCheckpoint)[] = state.scenario.members;
  const ledgerChronology = run ? [
    ...run.authorizations.map((entry) => ({ kind: "authorization" as const, entry })),
    ...run.drifts.map((entry) => ({ kind: "drift" as const, entry }))
  ].sort((left, right) => {
    const activeOffset = left.entry.activeOffsetMs - right.entry.activeOffsetMs;
    if (activeOffset !== 0) return activeOffset;
    const rank = (record: typeof left): number => record.kind === "drift" ? 1 : record.entry.kind === "INITIAL_REVIEW" ? 0 : 2;
    return rank(left) - rank(right);
  }) : [];
  const nextMember = state.runner?.cursor.members[state.runner.cursor.index] ?? (run ? run.members[run.nextMemberIndex] : null) ?? null;
  const nextStep = nextMember?.kind === "step" ? nextMember : null;
  const nextMemberLabel = nextMember?.kind === "checkpoint" ? `Checkpoint ${nextMember.name}` : nextStep ? `Step ${nextStep.ordinal}` : "—";
  return <section className="workbench-react__scenario" aria-label="Local Injection Scenario" data-phase={state.phase} onFocusCapture={(event) => {
    const control = (event.target as HTMLElement).dataset.scenarioControl;
    recoverTerminalFocus.current = control === "pause" || control === "stop";
  }} onBlurCapture={(event) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    recoverTerminalFocus.current = false;
  }}>
    <header className="workbench-react__scenario-header">
      <div><span className="workbench-react__eyebrow">Temporary promoted document</span><h1 tabIndex={-1} ref={heading}>Local Injection Scenario</h1><span>{state.scenario.id} · revision {state.scenario.revision}</span></div>
      <strong>{(state.runner?.phase ?? state.phase).toUpperCase()}</strong>
    </header>
    <dl className="workbench-react__local-boundary" aria-label="Protected Scenario target and execution boundary">
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
      {run ? <section className="workbench-react__scenario-ledger" aria-label="Scenario Run ledger">
        <header><strong>Persistent Run ledger</strong><span>Panel Session-local · append-only authorization, drift, outcome, retention, assertion, and Evidence correlations</span></header>
        <ol>
          {ledgerChronology.map((record) => record.kind === "authorization"
            ? <li key={record.entry.id}><strong>{record.entry.kind === "INITIAL_REVIEW" ? "AUTHORIZED" : "RE-AUTHORIZED"}</strong>{` · ${record.entry.id} · remaining from Step ${record.entry.authorizedRemainingFromOrdinal} · target ${record.entry.targetFingerprint} · listeners ${record.entry.listenerIds.join(", ") || "none"} · Evidence boundary ${record.entry.committedEvidenceBoundary?.eventId ?? "empty"}`}</li>
            : <li key={record.entry.id}><strong>DRIFT</strong>{` · ${record.entry.kind} before Step ${record.entry.detectedBeforeOrdinal} · added ${record.entry.addedListenerIds.join(", ") || "none"} · removed ${record.entry.removedListenerIds.join(", ") || "none"} · Evidence ${record.entry.evidence?.eventId ?? "none"} · ${record.entry.detail}`}</li>)}
        </ol>
      </section> : null}
      {state.priorRuns.length > 0 ? <section className="workbench-react__scenario-ledger" aria-label="Prior Scenario Run ledgers">
        <header><strong>Prior Run ledgers</strong><span>Preserved until this Panel Session closes</span></header>
        {state.priorRuns.map((prior) => <details key={prior.id}>
          <summary>{prior.id} · {prior.status.toUpperCase()} · revision {prior.scenarioRevision} · {prior.trace.length} terminal member records</summary>
          <ol>{prior.trace.map((entry) => entry.kind === "checkpoint"
            ? <li key={`checkpoint:${entry.checkpointId}:${entry.memberOrdinal}`}><strong>{entry.status.toUpperCase()}</strong>{` · Scenario ${prior.scenarioId} · Run ${prior.id} · Checkpoint ${entry.checkpointName}/${entry.memberOrdinal} · zero Injections · Evidence boundary ${entry.resultBoundary?.eventId ?? "unavailable"}`}</li>
            : <li key={`${entry.stepId}:${entry.ordinal}`}><strong>{entry.kind === "attempted" ? entry.outcome.headline : "NOT RUN"}</strong>{entry.kind === "attempted" ? ` · Scenario ${prior.scenarioId} · Run ${prior.id} · Step ${entry.stepId}/${entry.ordinal} · Injection ${entry.injectionId} · execution ${entry.outcome.executionId} · request ${entry.outcome.requestId ?? "not allocated"} · outcome ${entry.outcome.status} · retention ${entry.retention} · assertion ${entry.assertion} · Evidence ${entry.evidence?.eventId ?? entry.evidenceAvailability}` : ` · Scenario ${prior.scenarioId} · Run ${prior.id} · Step ${entry.stepId}/${entry.ordinal} · no Injection/execution/request · assertion ${entry.assertion}`}</li>)}</ol>
        </details>)}
      </section> : null}
      {scenarioMembers.map((member, index) => {
        if (member.kind === "checkpoint") {
          const checkpointOrdinal = scenarioMembers.slice(0, index + 1).filter(({ kind }) => kind === "checkpoint").length;
          const checkpointTrace = run?.trace.find((entry) => entry.kind === "checkpoint" && entry.checkpointId === member.id);
          const activeCheckpoint = state.runner && "activeCheckpoint" in state.runner && state.runner.activeCheckpoint?.checkpointId === member.id
            ? state.runner.activeCheckpoint
            : null;
          return <ScenarioCheckpointDocument key={member.id} runtime={runtime} checkpoint={member} ordinal={checkpointOrdinal} phase={state.phase} focused={focusedMemberId === member.id} canMoveEarlier={index > 0} canMoveLater={index < scenarioMembers.length - 1} precedingStepIds={scenarioMembers.slice(0, index).filter((candidate): candidate is ScenarioStep => candidate.kind === "step").map(({ id }) => id)} trace={checkpointTrace?.kind === "checkpoint" ? checkpointTrace : null} active={activeCheckpoint as ActiveCheckpointPresentation | null} />;
        }
        const step = member;
        const stepOrdinal = scenarioMembers.slice(0, index + 1).filter(({ kind }) => kind === "step").length;
        const trace = run?.trace.find((entry): entry is Exclude<ScenarioTraceEntry, { kind: "checkpoint" }> => entry.kind !== "checkpoint" && entry.stepId === step.id);
        const focused = focusedMemberId === step.id;
        return <article key={step.id} data-step-state={trace ? "complete" : nextMember?.id === step.id ? "next" : "waiting"} data-step-focused={focused ? "true" : "false"}>
          <header><button type="button" className="workbench-react__scenario-step-focus" aria-pressed={focused} onClick={() => runtime.dispatch({ type: "focus-scenario-step", stepId: step.id })}>Step {stepOrdinal}</button><span>{step.id} · stable identity · delay {step.draft.relativeDelayMs} ms</span></header>
          {state.phase !== "stopped" ? <dl><div><dt>Source</dt><dd>{step.draft.sourceEventId ?? "None · newly authored"}</dd></div><div><dt>Validation</dt><dd>{step.draft.ready ? "READY" : "BLOCKED"}</dd></div></dl> : null}
          {state.phase === "edit" ? <div className="workbench-react__scenario-step-actions" aria-label={`Step ${stepOrdinal} actions`}>
            <button type="button" disabled={index === 0} onClick={() => runtime.dispatch({ type: "move-scenario-step", stepId: step.id, direction: "earlier" })}>Move earlier</button>
            <button type="button" disabled={index === scenarioMembers.length - 1} onClick={() => runtime.dispatch({ type: "move-scenario-step", stepId: step.id, direction: "later" })}>Move later</button>
            <button type="button" onClick={() => runtime.dispatch({ type: "duplicate-scenario-step", stepId: step.id })}>Duplicate Step</button>
            <button type="button" disabled={state.scenario.steps.length === 1} onClick={() => runtime.dispatch({ type: "remove-scenario-step", stepId: step.id })}>Remove Step</button>
            <label>Delay ms <input type="number" min={0} value={step.draft.relativeDelayMs} onChange={(event) => runtime.dispatch({ type: "set-scenario-step-delay", stepId: step.id, delayMs: Number(event.currentTarget.value) })} /></label>
          </div> : null}
          {state.phase === "edit" && !focused ? <button type="button" className="workbench-react__scenario-collapsed" onClick={() => runtime.dispatch({ type: "focus-scenario-step", stepId: step.id })}>{step.draft.ready ? "Collapsed Draft · Open editor" : `Collapsed Draft · BLOCKED · ${step.draft.diagnostics[0]?.message ?? "validation required"}`}</button> : null}
          {state.phase === "edit" && focused ? <section className="workbench-react__scenario-editor" aria-label={`Step ${stepOrdinal} Injection Draft`}>
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
              ariaLabel={`Step ${stepOrdinal} Local Injection JSON`}
              onChange={(text) => runtime.dispatch({ type: "set-scenario-step-json", stepId: step.id, text })}
              onPresentationChange={(presentation) => runtime.dispatch({ type: "set-scenario-step-editor-presentation", stepId: step.id, presentation })}
            />
          </section> : null}
          {state.phase !== "edit" && state.phase !== "stopped" ? <pre tabIndex={0} aria-label={`Step ${stepOrdinal} reviewed JSON`}>{step.draft.rawText}</pre> : null}
          {trace ? trace.kind === "attempted" ? <><p><strong>{trace.outcome.headline}</strong>{` · Injection ${trace.injectionId} · execution ${trace.outcome.executionId} · request ${trace.outcome.requestId ?? "not allocated"}`}{trace.outcome.attemptedCount !== undefined ? ` · listeners ${trace.outcome.deliveredCount ?? 0}/${trace.outcome.attemptedCount} delivered${trace.outcome.failedCount ? `, ${trace.outcome.failedCount} failed` : ""}` : ""} · {trace.outcome.detail}{trace.evidence ? ` · Local Evidence ${trace.evidence.eventId}` : " · no committed Local Evidence"}{` · retention ${trace.retention} · assertion ${trace.assertion} · Evidence ${trace.evidenceAvailability}`}</p>{trace.timing ? <p className="workbench-react__scenario-timing">Scenario Clock · delay {trace.timing.originalDelayMs} ms → {trace.timing.scaledDelayMs} ms · planned {trace.timing.plannedDispatchActiveOffsetMs} ms · dispatched {trace.timing.actualDispatchActiveOffsetMs} ms · settled {trace.timing.settlementActiveOffsetMs} ms · late {trace.timing.latenessMs} ms{trace.timing.manualOverride ? ` · STEP NEXT bypassed ${trace.timing.bypassedDelayMs} ms` : ""}</p> : null}{trace.outcome.limitations?.map((limitation) => <p role="note" key={limitation.field}><strong>TRACE VALUE LIMITED.</strong>{` ${limitation.field} retained ${limitation.retainedBytes} of ${limitation.originalBytes} UTF-8 bytes for bounded Scenario accounting. Delivery semantics are unchanged; inspect the page's own diagnostics for the original value.`}</p>)}</> : <p><strong>NOT RUN</strong> · {trace.reason} · no Injection attempted · assertion {trace.assertion} · {trace.detail}</p> : null}
        </article>;
      })}
    </div>
    <footer className="workbench-react__local-footer">
      {state.phase === "edit" ? <><button type="button" ref={addButton} data-scenario-control="edit" onClick={() => runtime.dispatch({ type: "open-scenario-evidence-picker" })}>Add captured update</button><button type="button" onClick={() => runtime.dispatch({ type: "add-authored-scenario-step" })}>Add authored update</button><button type="button" onClick={() => runtime.dispatch({ type: "add-scenario-checkpoint" })}>Add checkpoint</button>{state.canUndoRemoval ? <button type="button" onClick={() => runtime.dispatch({ type: "undo-scenario-step-removal" })}>Undo removal</button> : null}<label>Speed <select aria-label="Scenario speed" value={state.scenario.speed} onChange={(event) => runtime.dispatch({ type: "set-scenario-speed", speed: Number(event.currentTarget.value) as 0.25 | 0.5 | 1 | 2 | 4 })}><option value={0.25}>0.25×</option><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label><span>{state.scenario.steps.length}/100 explicit Steps · {formatScenarioBytes(state.scenario.accountedBytes)}/8 MiB · no execution shortcut</span><button type="button" className="workbench-react__primary" onClick={() => dispatchWithFocus("play", { type: "review-scenario" })}>Review Scenario</button></> : null}
      {state.phase === "review" ? <><button type="button" onClick={() => dispatchWithFocus("edit", { type: "edit-scenario" })}>Edit Scenario</button><span>{nextMember ? `Next: ${nextMemberLabel}${nextStep ? ` · delay ${state.runner?.remainingDelayMs ?? 0} ms` : " · exact read boundary"}` : "All members settled"}</span><button type="button" onClick={() => dispatchWithFocus("resume-or-run-again", { type: "step-next-scenario" })}>Step next</button><button type="button" data-scenario-control="play" className="workbench-react__primary" onClick={() => dispatchWithFocus("pause", { type: "play-scenario" })}>Play</button><button type="button" data-scenario-control="stop" onClick={() => dispatchWithFocus("stop-or-run-again", { type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "paused" ? state.runner?.pauseReason === "DRIFT_REVIEW_REQUIRED" ? <><span>PAUSED — DRIFT REVIEW REQUIRED · immutable remaining payload, order, timing, and prior outcomes preserved.</span><button type="button" data-scenario-control="stop" onClick={() => dispatchWithFocus("stop-or-run-again", { type: "stop-scenario" })}>Stop</button><button type="button" data-scenario-control="resume" className="workbench-react__primary" onClick={() => dispatchWithFocus("resume", { type: "re-review-scenario" })}>Re-review immutable plan</button></> : <><button type="button" onClick={() => dispatchWithFocus("edit", { type: "edit-scenario" })}>Edit Scenario</button><span>{state.runner?.activeCheckpoint ? `PAUSED${state.runner.pauseReason === "HIDDEN" ? " — PANEL HIDDEN" : ""} · ${state.runner.remainingDelayMs} ms active assertion window remains for ${nextMemberLabel} · explicit Resume required` : state.runner?.pauseReason === "HIDDEN" ? "PAUSED — PANEL HIDDEN · explicit Resume required" : state.runner?.controlCapacityReached ? "PAUSED — CONTROL TRACE CAPACITY REACHED · Edit and Review again to continue." : `PAUSED · ${state.runner?.remainingDelayMs ?? 0} ms remains before ${nextMemberLabel}`}</span><button type="button" disabled={!nextMember || Boolean(state.runner?.activeCheckpoint) || state.runner?.controlCapacityReached} onClick={() => dispatchWithFocus("resume-or-run-again", { type: "step-next-scenario" })}>Step next</button><button type="button" data-scenario-control="resume" className="workbench-react__primary" disabled={!nextMember || !snapshot.visible || state.runner?.controlCapacityReached} onClick={() => dispatchWithFocus("pause", { type: "play-scenario" })}>Resume</button><button type="button" data-scenario-control="stop" onClick={() => dispatchWithFocus("stop-or-run-again", { type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "running" ? <><span>{state.runner?.phase === "checkpoint-waiting" ? `WAITING · ${nextMemberLabel} is observing committed Workbench Evidence on active time.` : state.runner?.phase === "waiting" ? `WAITING · ${nextMemberLabel} dispatch is scheduled on active time.` : state.runner?.phase === "in-flight" ? `IN FLIGHT · ${nextMemberLabel} is settling its real Outcome and committed Evidence.` : state.runner?.phase === "pause-pending" ? "PAUSE PENDING · current Injection will settle truthfully." : "STOP PENDING · current Injection will settle truthfully; remainder will be NOT RUN."}</span>{state.runner?.phase === "waiting" || state.runner?.phase === "checkpoint-waiting" || state.runner?.phase === "in-flight" ? <button type="button" data-scenario-control="pause" className="workbench-react__primary" onClick={() => dispatchWithFocus("resume", { type: "pause-scenario" })}>Pause</button> : null}<button type="button" data-scenario-control="stop" onClick={() => dispatchWithFocus("stop-or-run-again", { type: "stop-scenario" })}>Stop</button></> : null}
      {state.phase === "complete" ? <><span>RUN COMPLETE · {run?.trace.filter(({ kind }) => kind === "attempted").length ?? 0} independently traced Injections. {run?.trace.filter(({ kind }) => kind === "checkpoint").length ?? 0} evaluated Checkpoints.</span><button type="button" onClick={() => runtime.dispatch({ type: "finish-scenario" })}>Finish Scenario</button><button type="button" data-scenario-control="run-again" className="workbench-react__primary" onClick={() => dispatchWithFocus("play", { type: "run-scenario-again" })}>Run again</button></> : null}
      {state.phase === "stopped" ? <><span>RUN STOPPED · remaining Steps were NOT RUN; settled outcomes were preserved.</span><button type="button" onClick={() => runtime.dispatch({ type: "finish-scenario" })}>Finish Scenario</button><button type="button" data-scenario-control="run-again" className="workbench-react__primary" onClick={() => dispatchWithFocus("play", { type: "run-scenario-again" })}>Run again</button></> : null}
    </footer>
  </section>;
}

type ActiveCheckpointPresentation = Readonly<{
  checkpointId: string;
  checkpointName: string;
  startedActiveOffsetMs: number;
  deadlineActiveOffsetMs: number | null;
  boundary: Readonly<{ intervalId: string; sequence: number; eventId: string }> | null;
  status: "waiting";
  assertions: readonly import("../../../core/local-injection-scenario-checkpoint").ScenarioAssertionResult[];
}>;

function ScenarioCheckpointDocument({ runtime, checkpoint, ordinal, phase, focused, canMoveEarlier, canMoveLater, precedingStepIds, trace, active }: Readonly<{
  runtime: WorkbenchRuntime;
  checkpoint: ScenarioCheckpoint;
  ordinal: number;
  phase: NonNullable<WorkbenchSnapshot["scenario"]>["phase"];
  focused: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  precedingStepIds: readonly string[];
  trace: Extract<ScenarioTraceEntry, { kind: "checkpoint" }> | null;
  active: ActiveCheckpointPresentation | null;
}>): JSX.Element {
  const status = trace?.status ?? active?.status ?? (phase === "edit" ? "authoring" : "reviewed");
  const results = trace?.assertions ?? active?.assertions ?? [];
  const resultBoundary = trace?.resultBoundary ?? active?.boundary ?? null;
  const terminalFailure = status === "fail" || status === "expired" || status === "invalid" || status === "unavailable" || status === "not-evaluable";
  const updateCheckpoint = (next: ScenarioCheckpoint): void => runtime.dispatch({ type: "update-scenario-checkpoint", checkpoint: next });
  return <article className="workbench-react__scenario-checkpoint" aria-label={`Scenario Checkpoint ${checkpoint.name}`} data-checkpoint-state={status} data-step-focused={focused ? "true" : "false"}>
    <header><button type="button" className="workbench-react__scenario-step-focus" aria-pressed={focused} onClick={() => runtime.dispatch({ type: "focus-scenario-member", memberId: checkpoint.id })}><strong>CHECKPOINT {ordinal}</strong></button><span>{checkpoint.id} · stable identity · Zero Injections</span></header>
    {!focused ? <button type="button" className="workbench-react__scenario-collapsed" onClick={() => runtime.dispatch({ type: "focus-scenario-member", memberId: checkpoint.id })}>{status.toUpperCase()} · {checkpoint.name} · {checkpoint.assertions.length} assertion{checkpoint.assertions.length === 1 ? "" : "s"} · zero Injections</button> : <>
    <dl aria-label="Protected Checkpoint authoring">
      <div><dt>Name</dt><dd>{phase === "edit" ? <input aria-label={`Checkpoint ${ordinal} name`} value={checkpoint.name} onChange={(event) => updateCheckpoint({ ...checkpoint, name: event.currentTarget.value })} /> : checkpoint.name}</dd></div>
      <div><dt>Read boundary</dt><dd>Exact committed Evidence boundary at evaluation</dd></div>
    </dl>
    <ol className="workbench-react__scenario-assertions" aria-label={`${checkpoint.name} assertions`}>
      {checkpoint.assertions.map((assertion, assertionIndex) => {
        const result = results.find(({ assertionId }) => assertionId === assertion.id);
        const replace = (next: ScenarioAssertion): void => updateCheckpoint({ ...checkpoint, assertions: checkpoint.assertions.map((candidate, index) => index === assertionIndex ? next : candidate) });
        const remove = (): void => updateCheckpoint({ ...checkpoint, assertions: checkpoint.assertions.filter((_, index) => index !== assertionIndex) });
        return <li key={assertion.id}>{phase === "edit" ? <><CheckpointAssertionAuthoring assertion={assertion} precedingStepIds={precedingStepIds} onChange={replace} /><button type="button" disabled={checkpoint.assertions.length === 1} onClick={remove}>Remove assertion {assertionIndex + 1}</button></> : <><strong>{assertionLabel(assertion)}</strong>{assertionWithin(assertion)}</>}{result ? <span>{` · ${result.status.toUpperCase()} · observed ${formatObserved(result.observed.state, result.observed.value)} · ${result.observed.certainty} · ${result.observed.provenance}`}{result.observed.valueLimited ? ` · TRACE VALUE LIMITED: observed preview retained ${result.observed.valueLimited.retainedBytes} of ${result.observed.valueLimited.originalBytes} UTF-8 bytes; full value ${result.observed.valueLimited.comparison}` : ""}</span> : null}</li>;
      })}
    </ol>
    {phase === "edit" ? <div className="workbench-react__scenario-step-actions" aria-label={`${checkpoint.name} actions`}><button type="button" disabled={checkpoint.assertions.length >= 16} onClick={() => updateCheckpoint({ ...checkpoint, assertions: [...checkpoint.assertions, defaultAssertion(nextAssertionId(checkpoint), "correlated-local-evidence-exists", precedingStepIds.at(-1) ?? "")] })}>Add assertion</button><button type="button" disabled={!canMoveEarlier} onClick={() => runtime.dispatch({ type: "move-scenario-member", memberId: checkpoint.id, direction: "earlier" })}>Move checkpoint earlier</button><button type="button" disabled={!canMoveLater} onClick={() => runtime.dispatch({ type: "move-scenario-member", memberId: checkpoint.id, direction: "later" })}>Move checkpoint later</button><button type="button" onClick={() => runtime.dispatch({ type: "remove-scenario-checkpoint", checkpointId: checkpoint.id })}>Remove checkpoint</button></div> : null}
    {phase === "edit" ? <p>Protected Scenario authoring · assertions are outside raw Item Update JSON and invalidate Review when changed.</p>
      : <p role={terminalFailure ? "alert" : "status"} aria-live="polite"><strong>{status.toUpperCase()}</strong>{active ? ` · Scenario Clock ${active.startedActiveOffsetMs} ms${active.deadlineActiveOffsetMs === null ? "" : ` · deadline ${active.deadlineActiveOffsetMs} ms`}` : ""} · {resultBoundary ? `Evidence boundary ${resultBoundary.eventId} · sequence ${resultBoundary.sequence}` : "Evidence boundary unavailable"} · zero Injections dispatched.</p>}
    {trace?.evidenceAvailability === "UNAVAILABLE_AFTER_CLEAR"
      ? <p role="note">Related Evidence is unavailable after Clear; the immutable Checkpoint result and exact identity remain in this Trace.</p>
      : uniqueRelatedEvidence(results).map((evidence) => <button key={`${evidence.intervalId}:${evidence.sequence}:${evidence.eventId}`} type="button" onClick={() => runtime.dispatch({ type: "show-scenario-checkpoint-evidence", evidence })}>Inspect Evidence {evidence.eventId}</button>)}
    </>}
  </article>;
}

function CheckpointAssertionAuthoring({ assertion, precedingStepIds, onChange }: Readonly<{
  assertion: ScenarioAssertion;
  precedingStepIds: readonly string[];
  onChange(assertion: ScenarioAssertion): void;
}>): JSX.Element {
  const priorStepId = "stepId" in assertion ? assertion.stepId : precedingStepIds.at(-1) ?? "";
  const setKind = (kind: ScenarioAssertion["kind"]): void => onChange(defaultAssertion(assertion.id, kind, priorStepId));
  return <div className="workbench-react__scenario-assertion-authoring">
    <span>{assertionLabel(assertion)}{assertionWithin(assertion)}</span>
    <label>Assertion <select aria-label={`Assertion ${assertion.id} kind`} value={assertion.kind} onChange={(event) => setKind(event.currentTarget.value as ScenarioAssertion["kind"])}><option value="prior-injection-outcome">Preceding Injection Outcome</option><option value="listener-count">Listener count</option><option value="correlated-local-evidence-exists">Correlated committed Local Evidence</option><option value="command-key-exists">Local Effective COMMAND key</option><option value="command-field-equals">Primitive field equality</option></select></label>
    {"stepId" in assertion ? <label>Earlier Step <select value={assertion.stepId} onChange={(event) => onChange({ ...assertion, stepId: event.currentTarget.value })}>{precedingStepIds.map((stepId) => <option key={stepId} value={stepId}>{stepId}</option>)}</select></label> : null}
    {assertion.kind === "prior-injection-outcome" ? <label>Outcome <select value={assertion.expectedDisposition} onChange={(event) => onChange({ ...assertion, expectedDisposition: event.currentTarget.value as typeof assertion.expectedDisposition })}><option value="delivered">delivered</option><option value="partial">partial</option><option value="failed">failed</option><option value="acknowledgement-unknown">acknowledgement unknown</option><option value="blocked">blocked</option></select></label> : null}
    {assertion.kind === "listener-count" ? <><label>Count <select value={assertion.count} onChange={(event) => onChange({ ...assertion, count: event.currentTarget.value as "attempted" | "delivered" })}><option value="attempted">attempted</option><option value="delivered">delivered</option></select></label><label>Expected <input type="number" min={0} value={assertion.expected} onChange={(event) => onChange({ ...assertion, expected: Math.max(0, Number(event.currentTarget.value)) })} /></label></> : null}
    {assertion.kind === "command-key-exists" || assertion.kind === "command-field-equals" ? <><label>Item name <input value={assertion.item.name ?? ""} placeholder="Use item position" onChange={(event) => onChange({ ...assertion, item: { ...assertion.item, name: event.currentTarget.value || null } })} /></label><label>Item position <input type="number" min={1} value={assertion.item.position ?? ""} onChange={(event) => onChange({ ...assertion, item: { ...assertion.item, position: event.currentTarget.value === "" ? null : Math.max(1, Number(event.currentTarget.value)) } })} /></label></> : null}
    {assertion.kind === "command-key-exists" ? <><label>Key <input value={assertion.key} onChange={(event) => onChange({ ...assertion, key: event.currentTarget.value })} /></label><label>Expected <select value={assertion.expected} onChange={(event) => {
      const expected = event.currentTarget.value as "present" | "absent";
      onChange(expected === "absent" ? withWithin({ ...assertion, expected }, undefined) : { ...assertion, expected });
    }}><option value="present">present</option><option value="absent">absent</option></select></label></> : null}
    {assertion.kind === "command-field-equals" ? <><label>Key <input value={assertion.key} onChange={(event) => onChange({ ...assertion, key: event.currentTarget.value })} /></label><label>Field <input value={assertion.field} onChange={(event) => onChange({ ...assertion, field: event.currentTarget.value })} /></label><label>Primitive JSON <input value={JSON.stringify(assertion.expected)} onChange={(event) => { const parsed = parsePrimitive(event.currentTarget.value); if (parsed.ok) onChange({ ...assertion, expected: parsed.value }); }} /></label></> : null}
    {supportsWithin(assertion) ? <label>Within active ms <input type="number" min={1} max={300_000} value={assertion.withinActiveMs ?? ""} placeholder="Immediate" onChange={(event) => onChange(withWithin(assertion, event.currentTarget.value === "" ? undefined : Number(event.currentTarget.value)))} /></label> : null}
  </div>;
}

function defaultAssertion(id: string, kind: ScenarioAssertion["kind"], stepId: string): ScenarioAssertion {
  switch (kind) {
    case "prior-injection-outcome": return { id, kind, stepId, expectedDisposition: "delivered" };
    case "listener-count": return { id, kind, stepId, count: "delivered", expected: 1 };
    case "correlated-local-evidence-exists": return { id, kind, stepId };
    case "command-key-exists": return { id, kind, item: { name: null, position: 1 }, key: "", expected: "present" };
    case "command-field-equals": return { id, kind, item: { name: null, position: 1 }, key: "", field: "", expected: "" };
  }
}

function nextAssertionId(checkpoint: ScenarioCheckpoint): string {
  const used = new Set(checkpoint.assertions.map(({ id }) => id));
  let sequence = checkpoint.assertions.length + 1;
  while (used.has(`${checkpoint.id}-assertion-${sequence}`)) sequence += 1;
  return `${checkpoint.id}-assertion-${sequence}`;
}

function supportsWithin(assertion: ScenarioAssertion): assertion is Extract<ScenarioAssertion, { kind: "correlated-local-evidence-exists" | "command-key-exists" | "command-field-equals" }> {
  return assertion.kind === "correlated-local-evidence-exists" || assertion.kind === "command-field-equals" || (assertion.kind === "command-key-exists" && assertion.expected === "present");
}

function withWithin(assertion: Extract<ScenarioAssertion, { kind: "correlated-local-evidence-exists" | "command-key-exists" | "command-field-equals" }>, withinActiveMs: number | undefined): ScenarioAssertion {
  if (withinActiveMs !== undefined) return { ...assertion, withinActiveMs };
  const copy = { ...assertion } as ScenarioAssertion & { withinActiveMs?: number };
  delete copy.withinActiveMs;
  return copy;
}

function parsePrimitive(text: string): Readonly<{ ok: true; value: string | number | boolean | null }> | Readonly<{ ok: false }> {
  try {
    const value: unknown = JSON.parse(text);
    return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function formatObserved(state: string, value: unknown): string {
  if (value === undefined) return state;
  return `${state} ${JSON.stringify(value)}`;
}

function uniqueRelatedEvidence(results: readonly import("../../../core/local-injection-scenario-checkpoint").ScenarioAssertionResult[]): readonly Readonly<{ intervalId: string; sequence: number; eventId: string }>[] {
  const found = new Map<string, Readonly<{ intervalId: string; sequence: number; eventId: string }>>();
  for (const result of results) for (const evidence of result.relatedEvidence) found.set(`${evidence.intervalId}:${evidence.sequence}:${evidence.eventId}`, evidence);
  return [...found.values()];
}

function assertionLabel(assertion: ScenarioAssertion): string {
  switch (assertion.kind) {
    case "prior-injection-outcome": return `Step ${assertion.stepId.replace(/^step-/, "")} Injection Outcome is ${assertion.expectedDisposition}`;
    case "listener-count": return `Step ${assertion.stepId.replace(/^step-/, "")} ${assertion.count} listener count is ${assertion.expected}`;
    case "correlated-local-evidence-exists": return `Correlated committed Local Evidence exists after Step ${assertion.stepId.replace(/^step-/, "")}`;
    case "command-key-exists": return `Local Effective COMMAND key ${assertion.key} is ${assertion.expected}`;
    case "command-field-equals": return `Local Effective COMMAND field ${assertion.field} strictly equals ${JSON.stringify(assertion.expected)}`;
  }
}

function assertionWithin(assertion: ScenarioAssertion): string {
  return "withinActiveMs" in assertion && assertion.withinActiveMs !== undefined
    ? ` · within ${assertion.withinActiveMs} ms active time`
    : "";
}

function formatScenarioBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}
