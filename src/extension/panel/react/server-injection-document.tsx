import { useLayoutEffect, useRef, type JSX } from "react";

import {
  type WorkbenchRuntime,
  type WorkbenchServerInjectionSnapshot
} from "../workbench-runtime";
import type {
  ServerInjectionDiagnostic,
  ServerInjectionExecutionResult
} from "../../../core/server-injection";

export function ServerInjectionDocument({
  runtime,
  serverInjection
}: Readonly<{
  runtime: WorkbenchRuntime;
  serverInjection: WorkbenchServerInjectionSnapshot;
}>): JSX.Element | null {
  const state = serverInjection.draft;
  const firstField = useRef<HTMLTextAreaElement | null>(null);
  const reviewAction = useRef<HTMLButtonElement | null>(null);
  const pendingStatus = useRef<HTMLElement | null>(null);
  const outcomeAction = useRef<HTMLButtonElement | null>(null);
  const discardTrigger = useRef<HTMLButtonElement | null>(null);
  const discardDialog = useRef<HTMLElement | null>(null);
  const previousDiscardConfirmation = useRef(false);
  useLayoutEffect(() => {
    if (state?.phase === "edit") firstField.current?.focus();
    else if (state?.phase === "review") reviewAction.current?.focus();
    else if (state?.phase === "pending") pendingStatus.current?.focus();
    else if (state?.phase === "outcome") outcomeAction.current?.focus();
  }, [state?.id, state?.phase]);
  useLayoutEffect(() => {
    const current = state?.discardConfirmation ?? false;
    if (!previousDiscardConfirmation.current && current) discardDialog.current?.focus();
    else if (previousDiscardConfirmation.current && !current) discardTrigger.current?.focus();
    previousDiscardConfirmation.current = current;
  }, [state?.discardConfirmation]);
  if (!state) return null;

  const draft = state.value;
  const errors = state.diagnostics.filter(({ severity }) => severity === "error");
  const warnings = state.diagnostics.filter(({ severity }) => severity === "warning");
  const dispatch = (command: Parameters<WorkbenchRuntime["dispatch"]>[0]) => runtime.dispatch(command);
  const outcome = state.outcome;
  const outcomeTitle = outcome
    ? outcome.status === "processed"
      ? "Processed by Lightstreamer"
      : outcome.status === "unknown"
        ? "Outcome Unknown"
        : outcome.status === "denied"
          ? "Message denied"
          : outcome.status === "discarded"
            ? "Message discarded"
            : outcome.status === "aborted"
              ? "Message aborted before transmission"
              : "Server Injection not attempted"
    : null;

  return <section
    className="workbench-react__server-injection"
    aria-label="Server Injection Draft"
    data-phase={state.phase}
  >
    <header className="workbench-react__server-header">
      <div>
        <span className="workbench-react__eyebrow">Temporary promoted document</span>
        <h1>Server Injection Draft</h1>
        <span>{state.source.kind === "captured-message" ? `Immutable Source ${state.source.eventId}` : "Newly authored Client Message"}</span>
      </div>
      <strong>{state.phase === "pending" ? "SENDING" : state.phase === "outcome" ? outcome?.status.toUpperCase() : state.ready ? "READY" : "BLOCKED"}</strong>
    </header>

    <div className="workbench-react__server-boundary" aria-label="Protected Server Injection boundary">
      <div><span>Client</span><strong title={draft.target.clientId}>{draft.target.clientId}</strong></div>
      <div><span>Session</span><strong title={draft.target.sessionId}>{draft.target.sessionId}</strong></div>
      <div><span>Page epoch</span><strong title={draft.target.pageEpoch}>{draft.target.pageEpoch}</strong></div>
      <div><span>Delivery</span><strong>LightstreamerClient.sendMessage</strong></div>
      <p>One Client Message is sent through the reviewed current Session. This does not inject an inbound Item Update or contact a Data Adapter directly.</p>
    </div>

    {state.repeatWarning ? <p className="workbench-react__server-warning" role="alert">
      This is a separate Repeat Injection and may duplicate server-side effects. Review every argument before sending.
    </p> : null}

    <div className="workbench-react__server-body">
      {state.phase === "edit" ? <form onSubmit={(event) => {
        event.preventDefault();
        dispatch({ type: "review-server-injection" });
      }}>
        <DiagnosticList errors={errors} warnings={warnings} />
        {state.source.kind === "authored" ? <section
          className="workbench-react__server-recipes"
          aria-label="Application Message Recipes"
        >
          <strong>Application Message Recipe</strong>
          <p>
            The Client Message body must be accepted by this application's Metadata Adapter.
            Workbench cannot infer a Client Message from an inbound Item Update.
          </p>
          {state.recipes.status === "loading" ? <span role="status">Looking for recipes exposed by the inspected application…</span> : null}
          {state.recipes.status === "available" ? <ul>{state.recipes.items.map((recipe) => <li key={recipe.id}>
            <span><strong>{recipe.label}</strong>{recipe.description}</span>
            <button type="button" onClick={() => dispatch({
              type: "apply-server-injection-recipe",
              recipeId: recipe.id
            })}>Use {recipe.label}</button>
          </li>)}</ul> : null}
          {state.recipes.status === "unavailable" || state.recipes.status === "error" ? <span>
            {state.recipes.detail} Capture an outbound Client Message to clone its exact body, or author one from your application's message contract.
          </span> : null}
        </section> : null}
        <label htmlFor="workbench-server-message">Client Message body</label>
        <textarea
          ref={firstField}
          id="workbench-server-message"
          value={draft.message}
          rows={8}
          spellCheck={false}
          onChange={(event) => dispatch({
            type: "set-server-injection-message",
            message: event.currentTarget.value
          })}
        />
        <div className="workbench-react__server-options">
          <label htmlFor="workbench-server-sequence">Sequence
            <input
              id="workbench-server-sequence"
              value={draft.sequence}
              onChange={(event) => dispatch({
                type: "set-server-injection-sequence",
                sequence: event.currentTarget.value
              })}
            />
          </label>
          <label htmlFor="workbench-server-timeout">Delay timeout (ms)
            <input
              id="workbench-server-timeout"
              inputMode="numeric"
              placeholder="Server default"
              value={state.delayTimeoutText}
              onChange={(event) => dispatch({
                type: "set-server-injection-delay-timeout",
                value: event.currentTarget.value
              })}
            />
          </label>
          <label className="workbench-react__server-checkbox">
            <input
              type="checkbox"
              checked={draft.enqueueWhileDisconnected}
              onChange={(event) => dispatch({
                type: "set-server-injection-enqueue",
                enabled: event.currentTarget.checked
              })}
            />
            Enqueue while disconnected
          </label>
        </div>
        <footer className="workbench-react__server-actions">
          <div>
            <button type="submit" disabled={!state.ready} aria-describedby={!state.ready ? "workbench-server-blocked" : undefined}>Review Client Message</button>
            {!state.ready ? <span id="workbench-server-blocked">Resolve the errors above; no Injection will be attempted.</span> : null}
          </div>
          <button ref={discardTrigger} type="button" onClick={() => dispatch({ type: "request-discard-server-injection" })}>Discard draft…</button>
        </footer>
      </form> : state.phase === "review" ? <section className="workbench-react__server-review" aria-label="Reviewed Server Injection">
        <h2>Review exact sendMessage call</h2>
        <pre tabIndex={0}>{draft.message}</pre>
        <dl>
          <dt>Sequence</dt><dd>{draft.sequence}</dd>
          <dt>Delay timeout</dt><dd>{draft.delayTimeout === null ? "Server default" : `${draft.delayTimeout} ms`}</dd>
          <dt>Enqueue while disconnected</dt><dd>{draft.enqueueWhileDisconnected ? "Yes" : "No"}</dd>
        </dl>
        <p>A Processed outcome confirms Lightstreamer handled the message; it does not prove a downstream business effect or attribute later Server Updates.</p>
        <footer className="workbench-react__server-actions">
          <div>
            <button ref={reviewAction} type="button" onClick={() => dispatch({ type: "execute-server-injection" })}>Send Client Message once</button>
            <span>No automatic retry occurs, including when the outcome becomes Unknown.</span>
          </div>
          <button type="button" onClick={() => dispatch({ type: "edit-server-injection" })}>Back to edit</button>
          <button ref={discardTrigger} type="button" onClick={() => dispatch({ type: "request-discard-server-injection" })}>Discard draft…</button>
        </footer>
      </section> : state.phase === "pending" ? <section ref={pendingStatus} tabIndex={-1} className="workbench-react__server-pending" role="status" aria-live="polite" aria-busy="true">
        <strong>Waiting for ClientMessageListener outcome…</strong>
        <span>The reviewed sendMessage call was started exactly once. Workbench will not retry it.</span>
      </section> : outcome ? <section className="workbench-react__server-outcome" data-status={outcome.status} role="status">
        <h2>{outcomeTitle}</h2>
        <p>{serverOutcomeDetail(outcome)}</p>
        {typeof outcome.response === "string" && outcome.response.length > 0 ? <dl><dt>Response</dt><dd>{outcome.response}</dd></dl> : null}
        {outcome.code !== undefined && outcome.code !== null ? <dl><dt>Code</dt><dd>{outcome.code}</dd></dl> : null}
        <span>Request {outcome.requestId}</span>
        <footer className="workbench-react__server-actions">
          <button ref={outcomeAction} type="button" onClick={() => dispatch({ type: "finish-server-injection" })}>Finish</button>
          <button type="button" onClick={() => dispatch({ type: "prepare-server-injection-repeat" })}>Prepare separate Repeat…</button>
        </footer>
      </section> : null}
    </div>
    {state.discardConfirmation ? <section
      ref={discardDialog}
      className="workbench-react__server-confirmation"
      role="alertdialog"
      aria-label="Discard Server Injection Draft"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        dispatch({ type: "cancel-discard-server-injection" });
      }}
    >
      <strong>Discard this Server Injection Draft?</strong>
      <span>Its message, send arguments, review, and protected target cannot be recovered.</span>
      <div>
        <button type="button" onClick={() => dispatch({ type: "cancel-discard-server-injection" })}>Keep draft</button>
        <button type="button" onClick={() => dispatch({ type: "confirm-discard-server-injection" })}>Confirm discard</button>
      </div>
    </section> : null}
  </section>;
}

function DiagnosticList({
  errors,
  warnings
}: Readonly<{
  errors: readonly ServerInjectionDiagnostic[];
  warnings: readonly ServerInjectionDiagnostic[];
}>): JSX.Element | null {
  if (errors.length === 0 && warnings.length === 0) return null;
  return <section className="workbench-react__server-diagnostics" aria-label="Server Injection validation">
    {errors.length ? <><strong>Errors · no Injection will be attempted</strong><ul>{errors.map(({ code, message }) => <li key={code}>{message}</li>)}</ul></> : null}
    {warnings.length ? <><strong>Warnings</strong><ul>{warnings.map(({ code, message }) => <li key={code}>{message}</li>)}</ul></> : null}
  </section>;
}

function serverOutcomeDetail(outcome: ServerInjectionExecutionResult): string {
  if (outcome.status === "processed") {
    return "Lightstreamer reports that the Client Message was processed. This is not proof of a downstream business effect.";
  }
  if (outcome.status === "unknown") {
    return `${outcome.error ?? "Workbench cannot determine whether the message was processed."} Repeating may duplicate server-side effects.`;
  }
  return outcome.error ?? (
    outcome.status === "denied"
      ? "The server processed the message request but denied its expected outcome."
      : outcome.status === "discarded"
        ? "The Client Message did not reach the Metadata Adapter."
        : outcome.status === "aborted"
          ? "The Client Message was aborted before network transmission."
          : "The exact target failed preflight, so no Server Injection was attempted."
  );
}
