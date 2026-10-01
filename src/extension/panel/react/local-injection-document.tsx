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
  hidden: boolean;
  discardConfirmation: boolean;
  blockedEntry: boolean;
}>;

/**
 * CodeMirror intentionally has no scrollable viewport in this document: the
 * Local Injection canvas owns both axes so the editor, diagnostics, and outcome
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
    ? `${draft.anchor.sourceEventId ?? "Unknown"} · immutable`
    : "Newly authored";
}

function deliveryCounts(localInjection: WorkbenchLocalInjectionSnapshot): string | null {
  const outcome = localInjection.draft?.outcome;
  if (!outcome || outcome.attemptedCount === undefined) return null;
  return `${outcome.deliveredCount ?? 0} delivered · ${outcome.failedCount ?? 0} failed · ${outcome.attemptedCount} attempted`;
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
  const draftHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const problemsRef = useRef<HTMLElement | null>(null);
  const pendingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const outcomeHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const discardDialogRef = useRef<HTMLElement | null>(null);
  const lastDraftFocusRef = useRef<HTMLElement | null>(null);
  const parkReturnFocusRef = useRef<HTMLElement | null>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const restoreDiscardFocusRef = useRef(false);
  const previousPresentationRef = useRef<LocalInjectionPresentation | null>(null);
  const scrollOwnerRef = useRef<HTMLDivElement | null>(null);
  const scrollPositionsRef = useRef<Record<string, Readonly<{ top: number; left: number }> | undefined>>({});
  const draft = localInjection.draft;
  const editing = draft?.phase === "edit";
  const authoring = draft?.phase === "edit" || draft?.phase === "review";
  const scrollKey = draft
    ? `${draft.id}:${authoring ? `author-${draft.compareOpen ? "compare" : "single"}` : draft.phase}`
    : "none";

  useLayoutEffect(() => {
    const owner = scrollOwnerRef.current;
    if (!owner || hidden) return;
    const position = scrollPositionsRef.current[scrollKey] ?? { top: 0, left: 0 };
    owner.scrollTop = position.top;
    owner.scrollLeft = position.left;
  }, [hidden, inlineCompare, scrollKey]);

  useLayoutEffect(() => {
    if (!draft) return;
    const previous = previousPresentationRef.current;
    const focusEditor = () => {
      const editor = regionRef.current?.querySelector<HTMLElement>('[aria-label="Local Injection JSON"]');
      editor?.focus();
      return editor ?? null;
    };
    const focusPhase = () => {
      if (draft.phase === "edit" || draft.phase === "review") return focusEditor();
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
      parkReturnFocusRef.current = null;
      discardReturnFocusRef.current = null;
      restoreDiscardFocusRef.current = false;
      if (!hidden) {
        if (authoring && inlineCompare && draft.compareOpen && draft.source.rawText !== null) {
          draftHeadingRef.current?.focus({ preventScroll: true });
          lastDraftFocusRef.current = draftHeadingRef.current;
        } else lastDraftFocusRef.current = focusPhase();
      }
    } else if (!previous.discardConfirmation && localInjection.discardConfirmation && !hidden) {
      discardDialogRef.current?.focus();
    } else if (previous.discardConfirmation && !localInjection.discardConfirmation && restoreDiscardFocusRef.current) {
      restoreDiscardFocusRef.current = false;
      restore(discardReturnFocusRef.current);
    } else if (previous.hidden && !hidden) {
      restore(parkReturnFocusRef.current ?? lastDraftFocusRef.current);
    } else if (previous.blockedEntry && !localInjection.blockedEntry && !hidden) {
      restore(lastDraftFocusRef.current);
    } else if (previous.phase !== draft.phase && !hidden) {
      lastDraftFocusRef.current = focusPhase();
    }

    previousPresentationRef.current = {
      draftId: draft.id,
      phase: draft.phase,
      hidden,
      discardConfirmation: localInjection.discardConfirmation,
      blockedEntry: !!localInjection.blockedEntry
    };
  }, [draft?.id, draft?.phase, hidden, localInjection.blockedEntry, localInjection.discardConfirmation]);

  if (!draft) return null;
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
      <div><span className="workbench-react__eyebrow">One event · one Local Injection</span><h1 ref={draftHeadingRef} tabIndex={-1}>Local Injection Draft</h1><span>{draft.id}</span></div>
      <div className="workbench-react__local-header-actions">
        <button type="button" disabled={pending} data-local-focus-transition="true" onClick={() => {
          rememberScroll();
          parkReturnFocusRef.current = currentDraftFocus();
          dispatch(runtime, { type: "park-local-injection" });
        }}>Park draft and return to Evidence</button>
        <button type="button" disabled={pending} data-local-focus-transition="true" onClick={(event) => requestDiscard(event.currentTarget)}>Discard draft</button>
      </div>
    </header>

    <dl className="workbench-react__local-boundary">
      <div data-protected-boundary="target"><dt>Target</dt><dd>{draft.anchor.subscriptionId} · {draft.anchor.itemName ?? `Item #${draft.anchor.itemPosition ?? "Unknown"}`} · {draft.anchor.subscriptionMode ?? "Unknown mode"}</dd></div>
      <div data-protected-boundary="session"><dt>Session</dt><dd>Session {draft.anchor.sessionId ?? "Unknown"} · Client {draft.anchor.clientId ?? "Unknown"}</dd></div>
      <div data-protected-boundary="source"><dt>Source</dt><dd>{sourceLabel(localInjection)}</dd></div>
      <div data-protected-boundary="delivery"><dt>Delivery</dt><dd>One Logical Update to each current listener on this Subscription</dd></div>
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

    <div className="workbench-react__local-canvas">
      <div
        className="workbench-react__local-scroll"
        data-shared-scroll-owner="true"
        tabIndex={0}
        ref={scrollOwnerRef}
        onKeyDownCapture={(event) => {
          const owner = scrollOwnerRef.current;
          if (!owner) return;
          if (event.target === owner && event.key === "Home" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            owner.scrollTop = 0;
            owner.scrollLeft = 0;
            return;
          }
          if ((event.key !== "PageDown" && event.key !== "PageUp")
            || event.altKey
            || event.ctrlKey
            || event.metaKey) return;
          event.preventDefault();
          scrollLocalInjectionOwnerByPage(owner, event.key);
        }}
        onScroll={(event) => {
          if (hidden) return;
          scrollPositionsRef.current[scrollKey] = {
            top: event.currentTarget.scrollTop,
            left: event.currentTarget.scrollLeft
          };
        }}
      >
        <section className="workbench-react__local-editor-document" hidden={!authoring} aria-label="Local Injection JSON document">
          <header className="workbench-react__local-editor-toolbar">
            <div><strong>Raw JSON</strong><span>{draft.compareStatus === "no-source" ? "Newly authored · no immutable Source" : `${draft.compareStatus === "unchanged" ? "Unchanged from" : "Changed from"} immutable Source`}</span></div>
            <div>
              {compareAvailable ? <button type="button" aria-pressed={draft.compareOpen} onClick={() => {
                carryScrollTo(`author-${draft.compareOpen ? "single" : "compare"}`);
                dispatch(runtime, { type: "set-local-injection-compare", open: !draft.compareOpen });
              }}>Compare Source</button> : null}
              <label><input type="checkbox" checked={tabIndents} onChange={(event) => setTabIndents(event.currentTarget.checked)} />Tab inserts indentation</label>
            </div>
          </header>
          {draft.diagnostics.length ? <section className="workbench-react__local-problems" aria-label="Local Injection validation" id="local-injection-problems" tabIndex={-1} ref={problemsRef}>
            <strong>{draft.diagnostics.length} blocking problem{draft.diagnostics.length === 1 ? "" : "s"}</strong>
            <ul>{draft.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${diagnostic.path ?? "document"}-${index}`}><b>{diagnostic.category.toUpperCase()}</b><span>{diagnostic.path ? `${diagnostic.path} · ` : ""}{diagnostic.message}</span></li>)}</ul>
          </section> : null}
          <LocalInjectionCodeEditor
            draftId={draft.id}
            value={draft.rawText}
            source={draft.source.rawText}
            compareOpen={draft.compareOpen}
            diagnostics={draft.diagnostics}
            tabIndents={tabIndents}
            readOnly={!editing}
            presentation={draft.editorPresentation}
            onChange={(text) => dispatch(runtime, { type: "set-local-injection-json", text })}
            onPresentationChange={(presentation) => dispatch(runtime, { type: "set-local-injection-editor-presentation", presentation })}
          />
        </section>

        {pending ? <section className="workbench-react__local-pending" role="status" aria-live="polite"><h2 ref={pendingHeadingRef} tabIndex={-1}>Local Injection pending</h2><p>Workbench is waiting for one trustworthy delivery acknowledgement. No repeat or automatic retry is available.</p><pre tabIndex={0}>{draft.rawText}</pre></section> : null}

        {outcome ? <section className="workbench-react__local-outcome" role="status" aria-live="polite" data-disposition={outcome.disposition}><h2 ref={outcomeHeadingRef} tabIndex={-1}>{outcome.headline}</h2><p>{outcome.detail}</p>{deliveryCounts(localInjection) ? <p>{deliveryCounts(localInjection)}</p> : null}<p>Execution {outcome.executionId}{outcome.requestId ? ` · request ${outcome.requestId}` : ""}</p>{outcome.disposition === "delivered" ? <p>Local Evidence was appended when retention succeeded.</p> : <p>No successful Local Evidence is inferred from this outcome.</p>}</section> : null}
      </div>

      <footer className="workbench-react__local-footer">
        {authoring ? <><button type="button" data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "convert-local-injection-to-scenario" })}>Convert to Scenario</button><span id="local-injection-readiness" data-protected-boundary="validation" data-readiness={draft.ready ? "ready" : "blocked"} role="status">{draft.ready ? "READY · JSON and target validated" : `BLOCKED · ${draft.diagnostics[0]?.message ?? "The protected target is unavailable."} · No Injection attempted.`}</span>{!draft.ready && draft.diagnostics.length ? <button type="button" data-local-focus-transition="true" onClick={() => {
          const owner = scrollOwnerRef.current;
          problemsRef.current?.focus({ preventScroll: true });
          if (owner) {
            owner.scrollTop = 0;
            owner.scrollLeft = 0;
            const firstProblem = problemsRef.current?.querySelector("li");
            const toolbar = owner.querySelector(".workbench-react__local-editor-toolbar");
            if (firstProblem && toolbar) {
              owner.scrollTop = Math.max(0, firstProblem.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom);
            }
          }
        }}>Show validation details</button> : null}<button type="button" disabled={!draft.ready} aria-describedby={!draft.ready ? "local-injection-readiness" : undefined} data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "execute-local-injection" })}>Inject locally</button></> : null}
        {pending ? <span>DELIVERY PENDING · keep this document open until the outcome is known.</span> : null}
        {outcome ? <><span>{outcome.headline} · outcome is retained in this document until you finish.</span><button type="button" data-local-focus-transition="true" onClick={() => dispatch(runtime, { type: "finish-local-injection" })}>Finish Local Injection</button></> : null}
      </footer>
    </div>
  </section>;
}
