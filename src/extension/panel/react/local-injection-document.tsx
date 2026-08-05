import { useLayoutEffect, useRef, useState, type JSX } from "react";

import {
  type WorkbenchCommand,
  type WorkbenchLocalInjectionSnapshot,
  type WorkbenchRuntime
} from "../workbench-runtime";
import { LocalInjectionCodeEditor } from "./local-injection-code-editor";

type LocalInjectionDocumentProps = Readonly<{
  runtime: WorkbenchRuntime;
  localInjection: WorkbenchLocalInjectionSnapshot;
  hidden: boolean;
  inlineCompare: boolean;
}>;

type LocalInjectionPresentation = Readonly<{
  draftId: string;
  phase: NonNullable<WorkbenchLocalInjectionSnapshot["draft"]>["phase"];
  minimized: boolean;
  hidden: boolean;
  discardConfirmation: boolean;
  blockedEntry: boolean;
}>;

/**
 * CodeMirror intentionally has no scrollable viewport in this document: the
 * Local Injection canvas owns both axes so the editor, diagnostics, and review
 * material travel together.  Page navigation from CodeMirror therefore has to
 * target that outer owner explicitly.
 */
export function scrollLocalInjectionOwnerByPage(
  owner: HTMLElement,
  key: "PageDown" | "PageUp"
): void {
  const direction = key === "PageDown" ? 1 : -1;
  owner.scrollBy({ top: direction * Math.max(24, owner.clientHeight * .8) });
}

function dispatch(runtime: WorkbenchRuntime, command: WorkbenchCommand): void {
  runtime.dispatch(command);
}

function sourceLabel(localInjection: WorkbenchLocalInjectionSnapshot): string {
  const draft = localInjection.draft;
  if (!draft) return "No Injection Source";
  return draft.source.kind === "captured-event"
    ? `Source ${draft.anchor.sourceEventId ?? "Unknown"} · immutable`
    : "Source None · newly authored";
}

function phaseLabel(localInjection: WorkbenchLocalInjectionSnapshot): string {
  const draft = localInjection.draft;
  if (!draft) return "NO DRAFT";
  if (draft.phase === "pending") return "DELIVERY PENDING";
  if (draft.phase === "outcome") return draft.outcome?.headline ?? "OUTCOME";
  if (!draft.ready) return "BLOCKED";
  return draft.phase === "review" ? "READY TO INJECT" : "READY";
}

function deliveryCounts(localInjection: WorkbenchLocalInjectionSnapshot): string | null {
  const outcome = localInjection.draft?.outcome;
  if (!outcome || outcome.attemptedCount === undefined) return null;
  return `${outcome.deliveredCount ?? 0} delivered · ${outcome.failedCount ?? 0} failed · ${outcome.attemptedCount} attempted`;
}

function validationLabel(localInjection: WorkbenchLocalInjectionSnapshot): string {
  const draft = localInjection.draft;
  if (!draft) return "No Draft is available.";
  if (draft.ready) return "READY · JSON, COMMAND semantics, and the protected target are valid";
  const firstProblem = draft.diagnostics[0]?.message;
  return firstProblem
    ? `BLOCKED · ${firstProblem}`
    : "BLOCKED · The protected target is not currently valid for Local Injection.";
}

/** Full-canvas, single-event Local Injection document. */
export function LocalInjectionDocument({
  runtime,
  localInjection,
  hidden,
  inlineCompare
}: LocalInjectionDocumentProps): JSX.Element | null {
  const [tabIndents, setTabIndents] = useState(false);
  const regionRef = useRef<HTMLElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const pendingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const outcomeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardDialogRef = useRef<HTMLElement | null>(null);
  const lastDraftFocusRef = useRef<HTMLElement | null>(null);
  const minimizeReturnFocusRef = useRef<HTMLElement | null>(null);
  const parkReturnFocusRef = useRef<HTMLElement | null>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreDiscardFocusRef = useRef(false);
  const previousPresentationRef = useRef<LocalInjectionPresentation | null>(null);
  const scrollOwnerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Record<string, Readonly<{ top: number; left: number }> | undefined>>({});
  const draft = localInjection.draft;
  const minimized = draft?.minimized ?? false;
  const editing = draft?.phase === "edit";
  const scrollKey = draft
    ? `${draft.id}:${editing ? `edit-${draft.compareOpen ? "compare" : "single"}` : draft.phase}`
    : "none";

  useLayoutEffect(() => {
    const owner = scrollOwnerRef.current;
    if (!owner || hidden || minimized) return;
    const position = scrollPositionsRef.current[scrollKey] ?? { top: 0, left: 0 };
    owner.scrollTop = position.top;
    owner.scrollLeft = position.left;
  }, [hidden, inlineCompare, minimized, scrollKey]);

  useLayoutEffect(() => {
    if (!draft) return;
    const previous = previousPresentationRef.current;
    const focusEditor = () => {
      const editor = regionRef.current?.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]');
      editor?.focus();
      return editor ?? null;
    };
    const focusPhase = () => {
      if (draft.phase === "edit") return focusEditor();
      if (draft.phase === "review") {
        reviewHeadingRef.current?.focus();
        return reviewHeadingRef.current;
      }
      if (draft.phase === "pending") {
        pendingHeadingRef.current?.focus();
        return pendingHeadingRef.current;
      }
      outcomeHeadingRef.current?.focus();
      return outcomeHeadingRef.current;
    };
    const restore = (target: HTMLElement | null) => {
      if (target?.isConnected) target.focus();
      else focusPhase();
    };

    if (!previous || previous.draftId !== draft.id) {
      lastDraftFocusRef.current = null;
      minimizeReturnFocusRef.current = null;
      parkReturnFocusRef.current = null;
      discardReturnFocusRef.current = null;
      restoreDiscardFocusRef.current = false;
      if (!hidden && !minimized) lastDraftFocusRef.current = focusPhase();
    } else if (!previous.discardConfirmation && localInjection.discardConfirmation && !hidden) {
      discardDialogRef.current?.focus();
    } else if (previous.discardConfirmation && !localInjection.discardConfirmation && restoreDiscardFocusRef.current) {
      restoreDiscardFocusRef.current = false;
      restore(discardReturnFocusRef.current);
    } else if (!previous.minimized && minimized && !hidden) {
      minimizeButtonRef.current?.focus();
    } else if (previous.minimized && !minimized && !hidden) {
      restore(minimizeReturnFocusRef.current ?? lastDraftFocusRef.current);
    } else if (previous.hidden && !hidden && !minimized) {
      restore(parkReturnFocusRef.current ?? lastDraftFocusRef.current);
    } else if (previous.blockedEntry && !localInjection.blockedEntry && !hidden && !minimized) {
      restore(lastDraftFocusRef.current);
    } else if (previous.phase !== draft.phase && !hidden && !minimized) {
      lastDraftFocusRef.current = focusPhase();
    }

    previousPresentationRef.current = {
      draftId: draft.id,
      phase: draft.phase,
      minimized,
      hidden,
      discardConfirmation: localInjection.discardConfirmation,
      blockedEntry: !!localInjection.blockedEntry
    };
  }, [draft?.id, draft?.phase, hidden, localInjection.blockedEntry, localInjection.discardConfirmation, minimized]);

  if (!draft) return null;
  const review = draft.phase === "review";
  const pending = draft.phase === "pending";
  const outcome = draft.phase === "outcome" ? draft.outcome : null;
  const compareAvailable = draft.source.rawText !== null;

  const currentScrollPosition = (): Readonly<{ top: number; left: number }> => {
    const owner = scrollOwnerRef.current;
    return owner
      ? { top: owner.scrollTop, left: owner.scrollLeft }
      : scrollPositionsRef.current[scrollKey] ?? { top: 0, left: 0 };
  };

  const rememberScroll = (): Readonly<{ top: number; left: number }> => {
    const position = currentScrollPosition();
    scrollPositionsRef.current[scrollKey] = position;
    return position;
  };

  const carryScrollTo = (targetPresentation: string): void => {
    const position = rememberScroll();
    const targetKey = `${draft.id}:${targetPresentation}`;
    scrollPositionsRef.current[targetKey] ??= position;
  };

  const currentDraftFocus = (): HTMLElement | null => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && regionRef.current?.contains(active) && !active.dataset.localFocusTransition) {
      return active;
    }
    return lastDraftFocusRef.current
      ?? regionRef.current?.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]')
      ?? null;
  };

  const requestDiscard = (trigger: HTMLButtonElement): void => {
    discardReturnFocusRef.current = trigger;
    dispatch(runtime, { type: "request-discard-local-injection" });
  };

  const cancelDiscard = (): void => {
    restoreDiscardFocusRef.current = true;
    dispatch(runtime, { type: "cancel-discard-local-injection" });
  };

  return <section
    className="workbench-react__local-injection"
    aria-label="Local Injection Draft"
    data-phase={draft.phase}
    data-compare-layout={inlineCompare ? "inline" : "side-by-side"}
    data-minimized={minimized || undefined}
    hidden={hidden}
    ref={regionRef}
    onFocusCapture={(event) => {
      const target = event.target;
      if (target instanceof HTMLElement && !target.dataset.localFocusTransition && !target.closest('[data-local-focus-transition="true"]')) {
        lastDraftFocusRef.current = target;
      }
    }}
  >
    <header className="workbench-react__local-header">
      <div><span className="workbench-react__eyebrow">One event · one Local Injection</span><h1>Local Injection Draft</h1><span>{draft.id}</span></div>
      <strong data-readiness={draft.ready ? "ready" : "blocked"}>{phaseLabel(localInjection)}</strong>
      <div className="workbench-react__local-header-actions">
        <button type="button" ref={minimizeButtonRef} data-local-focus-transition="true" onClick={() => {
          if (!minimized) {
            rememberScroll();
            minimizeReturnFocusRef.current = currentDraftFocus();
          }
          dispatch(runtime, { type: "set-local-injection-minimized", minimized: !minimized });
        }}>{minimized ? "Expand draft" : "Minimize"}</button>
        <button type="button" disabled={pending} data-local-focus-transition="true" onClick={() => {
          rememberScroll();
          parkReturnFocusRef.current = currentDraftFocus();
          dispatch(runtime, { type: "park-local-injection" });
        }}>Park draft</button>
        <button type="button" disabled={pending} data-local-focus-transition="true" onClick={(event) => requestDiscard(event.currentTarget)}>Discard draft</button>
      </div>
    </header>

    <dl className="workbench-react__local-boundary">
      <div data-protected-boundary="target"><dt>Target</dt><dd>{draft.anchor.subscriptionId} · {draft.anchor.itemName ?? `Item #${draft.anchor.itemPosition ?? "Unknown"}`} · {draft.anchor.subscriptionMode ?? "Unknown mode"}</dd></div>
      <div data-protected-boundary="session"><dt>Session</dt><dd>Session {draft.anchor.sessionId ?? "Unknown"} · Client {draft.anchor.clientId ?? "Unknown"}</dd></div>
      <div data-protected-boundary="source"><dt>Source</dt><dd>{sourceLabel(localInjection)}</dd></div>
      <div data-protected-boundary="validation"><dt>Validation</dt><dd>{validationLabel(localInjection)}</dd></div>
      <div data-protected-boundary="delivery"><dt>Delivery</dt><dd>One Logical Update → every current listener on this exact Subscription</dd></div>
      <div className="workbench-react__local-only" data-protected-boundary="local-only"><dt>Boundary</dt><dd>LOCAL ONLY · inspected-page runtime · Lightstreamer Server is not contacted</dd></div>
    </dl>

    {localInjection.blockedEntry ? <section className="workbench-react__local-conflict" role="alert">
      <strong>Another draft entry is blocked</strong>
      <span>{localInjection.blockedEntry.label} cannot replace this protected draft.</span>
      <button type="button" data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "resume-local-injection" })}>Keep current draft</button>
      <button type="button" disabled={pending} data-local-focus-transition="true" onClick={(event) => requestDiscard(event.currentTarget)}>Discard current and continue</button>
    </section> : null}

    {localInjection.discardConfirmation && !hidden ? <section className="workbench-react__local-confirmation" role="alertdialog" aria-label="Discard Local Injection Draft" tabIndex={-1} ref={discardDialogRef} onKeyDown={(event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      cancelDiscard();
    }}>
      <strong>Discard this Local Injection Draft?</strong>
      <span>Its JSON, editor history, and protected target cannot be recovered.</span>
      <button type="button" data-local-focus-transition="true" onClick={cancelDiscard}>Keep draft</button>
      <button type="button" disabled={pending} data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "confirm-discard-local-injection" })}>Confirm discard</button>
    </section> : null}

    <div className="workbench-react__local-canvas" hidden={minimized}>
      <div
        className="workbench-react__local-scroll"
        data-shared-scroll-owner="true"
        ref={scrollOwnerRef}
        onKeyDownCapture={(event) => {
          if ((event.key !== "PageDown" && event.key !== "PageUp")
            || event.altKey
            || event.ctrlKey
            || event.metaKey) return;
          const owner = scrollOwnerRef.current;
          if (!owner) return;
          event.preventDefault();
          scrollLocalInjectionOwnerByPage(owner, event.key);
        }}
        onScroll={(event) => {
          if (hidden || minimized) return;
          scrollPositionsRef.current[scrollKey] = {
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft
          };
        }}
      >
        <section className="workbench-react__local-editor-document" hidden={!editing} aria-label="Local Injection JSON document">
          <header className="workbench-react__local-editor-toolbar">
            <div><strong>Raw JSON</strong><span>{draft.compareStatus === "no-source" ? "Newly authored · no immutable Source" : `${draft.compareStatus === "unchanged" ? "Unchanged from" : "Changed from"} immutable Source`}</span></div>
            <div>
              <button type="button" disabled={!compareAvailable} aria-pressed={draft.compareOpen} onClick={() => {
                carryScrollTo(`edit-${draft.compareOpen ? "single" : "compare"}`);
                dispatch(runtime, { type: "set-local-injection-compare", open: !draft.compareOpen });
              }}>Compare Source</button>
              <label><input type="checkbox" checked={tabIndents} onChange={(event) => setTabIndents(event.currentTarget.checked)} />Tab inserts indentation</label>
            </div>
          </header>
          {draft.compareOpen && compareAvailable ? <div className="workbench-react__local-compare-labels"><strong>Immutable Source</strong><strong>Injection Draft</strong></div> : null}
          <LocalInjectionCodeEditor
            draftId={draft.id}
            value={draft.rawText}
            source={draft.source.rawText}
            compareOpen={draft.compareOpen}
            diagnostics={draft.diagnostics}
            tabIndents={tabIndents}
            readOnly={!editing}
            onChange={(text) => dispatch(runtime, { type: "set-local-injection-json", text })}
          />
          <section className="workbench-react__local-problems" aria-label="Local Injection validation">
            <strong>{draft.ready ? "Ready for Review" : `${draft.diagnostics.length} blocking problem${draft.diagnostics.length === 1 ? "" : "s"}`}</strong>
            {draft.diagnostics.length ? <ul>{draft.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${diagnostic.path ?? "document"}-${index}`}><b>{diagnostic.category.toUpperCase()}</b><span>{diagnostic.path ? `${diagnostic.path} · ` : ""}{diagnostic.message}</span></li>)}</ul> : <p>JSON, schema, COMMAND semantics, and the protected live target are valid.</p>}
          </section>
        </section>

        <section className="workbench-react__local-review" hidden={!review} aria-label="Review Local Injection" onKeyDown={(event) => {
          if (event.key !== "PageDown") return;
          const owner = scrollOwnerRef.current;
          if (!owner) return;
          event.preventDefault();
          scrollLocalInjectionOwnerByPage(owner, "PageDown");
        }}>
          <header><span className="workbench-react__eyebrow">Read-only execution boundary</span><h2 ref={reviewHeadingRef} tabIndex={-1}>Review Local Injection</h2></header>
          <p className="workbench-react__local-review-local-only"><strong>Local only:</strong> one Logical Update is delivered to every current listener. Lightstreamer Server is not contacted.</p>
          <p><strong>Projection boundary:</strong> successful delivery advances Local Effective COMMAND State only. Observed Server COMMAND State remains unchanged.</p>
          <p><strong>Target:</strong> {draft.anchor.subscriptionId} · {draft.anchor.itemName ?? `Item #${draft.anchor.itemPosition ?? "Unknown"}`} · Session {draft.anchor.sessionId ?? "Unknown"}</p>
          <pre aria-label="Reviewed Local Injection JSON" tabIndex={0}>{draft.rawText}</pre>
          {!draft.ready ? <p role="alert"><strong>NOT READY.</strong> The protected target or reviewed JSON changed. No Injection can be attempted.</p> : null}
        </section>

        {pending ? <section className="workbench-react__local-pending" role="status" aria-live="polite"><h2 ref={pendingHeadingRef} tabIndex={-1}>Local Injection pending</h2><p>Workbench is waiting for one trustworthy delivery acknowledgement. No repeat or automatic retry is available.</p><pre tabIndex={0}>{draft.rawText}</pre></section> : null}

        {outcome ? <section className="workbench-react__local-outcome" role="status" aria-live="polite" data-disposition={outcome.disposition}><h2 ref={outcomeHeadingRef} tabIndex={-1}>{outcome.headline}</h2><p>{outcome.detail}</p>{deliveryCounts(localInjection) ? <p>{deliveryCounts(localInjection)}</p> : null}<p>Execution {outcome.executionId}{outcome.requestId ? ` · request ${outcome.requestId}` : ""}</p>{outcome.disposition === "delivered" ? <p>Local Evidence was appended when retention succeeded. Observed Server COMMAND State remains unchanged.</p> : <p>No successful Local Evidence or Local Effective COMMAND State advance is inferred from this outcome.</p>}</section> : null}
      </div>

      <footer className="workbench-react__local-footer">
        {editing ? <><span>{draft.ready ? "READY · Review the protected payload and target before delivery." : "BLOCKED · No Injection will be attempted."}</span><button type="button" disabled={!draft.ready} data-local-focus-transition="true" onClick={() => {
          carryScrollTo("review");
          dispatch(runtime, { type: "review-local-injection" });
        }}>Review Local Injection</button></> : null}
        {review ? <><button type="button" data-local-focus-transition="true" onClick={() => {
          carryScrollTo(`edit-${draft.compareOpen ? "compare" : "single"}`);
          dispatch(runtime, { type: "edit-local-injection" });
        }}>Back to JSON</button><span>{draft.ready ? "Ready to deliver locally." : "Target changed after Review. No Injection will be attempted."}</span><button type="button" disabled={!draft.ready} data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "execute-local-injection" })}>Inject locally</button></> : null}
        {pending ? <span>DELIVERY PENDING · keep this document open until the outcome is known.</span> : null}
        {outcome ? <><span>{outcome.headline} · outcome is retained in this document until you finish.</span><button type="button" data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "finish-local-injection" })}>Finish Local Injection</button></> : null}
      </footer>
    </div>
  </section>;
}
