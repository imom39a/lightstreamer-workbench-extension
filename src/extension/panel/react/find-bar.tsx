import type { JSX } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../workbench-runtime";
import { FindText } from "./evidence-row";
import type { FindController } from "./hooks/use-find-controller";

/** Find in ordered Evidence; the runtime owns the committed query and matches. */
export function FindBar({
  runtime,
  find,
  findState,
  onInspectMatch
}: Readonly<{
  runtime: WorkbenchRuntime;
  find: FindController;
  findState: WorkbenchSnapshot["evidence"]["findState"];
  onInspectMatch(): void;
}>): JSX.Element {
  const { findDraft, findInput, scheduleFind, submitFind, closeFind } = find;
  return <div className="workbench-react__find" role="search" aria-label="Find in ordered Evidence">
            <label className="workbench-react__eyebrow" htmlFor="workbench-find">Find in Evidence</label>
            <input
              id="workbench-find"
              ref={findInput}
              aria-label="Find in ordered Evidence"
              value={findDraft}
              aria-describedby="workbench-find-domain"
              onChange={(event) => scheduleFind(event.currentTarget.value)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter" && !keyEvent.nativeEvent.isComposing) {
                  keyEvent.preventDefault();
                  if (findDraft !== findState.query) submitFind(findDraft);
                  else if (!findState.loading) runtime.dispatch({ type: keyEvent.shiftKey ? "find-previous" : "find-next" });
                }
              }}
            />
            <span aria-live="polite">{findState.loading || findDraft !== findState.query ? "Searching…" : findState.expired ? "Results expired" : findState.matchCount ? `${findState.currentIndex + 1} of ${findState.matchCount} matches` : "0 matches"}{findState.wrapped ? " · Wrapped" : ""}</span>
            <button type="button" disabled={findState.loading || findDraft !== findState.query || !findState.matchCount || findState.expired} onClick={() => runtime.dispatch({ type: "find-previous" })}>Previous</button>
            <button type="button" disabled={findState.loading || findDraft !== findState.query || !findState.matchCount || findState.expired} onClick={() => runtime.dispatch({ type: "find-next" })}>Next</button>
            <button type="button" disabled={findState.loading || findDraft !== findState.query || !findState.currentEventId || findState.expired} onClick={onInspectMatch}>Inspect match</button>
            <button type="button" onClick={closeFind}>Close Find</button>
            <div className="workbench-react__find-detail" role="region" aria-label="Find match detail">
              <span id="workbench-find-domain">Current Scope + Filter · matching events</span>
              {findState.expired ? <span>The retained results changed. Refresh to search available Evidence.</span> : findState.snippet ? <span className="workbench-react__find-excerpt" title={`${findState.snippet.field}: ${findState.snippet.text}`}><b>{findState.snippet.field}</b>: <FindText text={findState.snippet.text} query={findState.query} /></span> : null}
              {findState.newerCount > 0 || findState.expired ? <button type="button" disabled={findState.loading} onClick={() => runtime.dispatch({ type: "refresh-find" })}>Refresh results{findState.newerCount > 0 ? ` · ${findState.newerCount.toLocaleString()} newer events` : ""}</button> : null}
            </div>
          </div>;
}
