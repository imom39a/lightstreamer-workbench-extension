import { useId, useLayoutEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";

import {
  createScopeSearchIndex,
  searchScopes,
  type ScopeSearchNode,
  type ScopeSearchStructureNode
} from "../../../core/scope-search";
import "./scope-search.css";

export type ScopeSearchProps = Readonly<{
  structure: readonly ScopeSearchStructureNode[];
  resolveNode(id: string): ScopeSearchNode | null;
  selectedScopeId: string | null;
  onChoose(scopeId: string): void;
  /** The owner restores the Scope tree's expansion, scroll, and exact trigger. */
  onClose(): void;
  focusRequest?: number;
}>;

const PAGE_SIZE = 50;
const label = (value: string): string => value ? `${value[0]!.toUpperCase()}${value.slice(1)}` : "Unknown";

function highlighted(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const normalized = text.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let match = normalized.indexOf(needle);
  while (match !== -1) {
    parts.push(text.slice(start, match), <mark key={match}>{text.slice(match, match + needle.length)}</mark>);
    start = match + needle.length;
    match = normalized.indexOf(needle, start);
  }
  parts.push(text.slice(start));
  return parts;
}

/** Search is a transient lens inside Scope; browsing results never commits Scope. */
export function ScopeSearch({ structure, resolveNode, selectedScopeId, onChoose, onClose, focusRequest }: ScopeSearchProps): JSX.Element {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef({ structure, resolveNode });
  latest.current = { structure, resolveNode };
  const [query, setQuery] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  // Capture can produce a new resolver for every Item Update. Re-index only at
  // a deliberate search boundary, so passive Capture cannot move a result or
  // repeatedly materialize complete Topology during an investigation.
  const index = useMemo(() => createScopeSearchIndex(latest.current.structure.flatMap((node) => {
    const resolved = latest.current.resolveNode(node.id);
    return resolved ? [resolved] : [];
  })), [query, refreshRevision]);
  const offset = Math.floor(activeIndex / PAGE_SIZE) * PAGE_SIZE;
  const results = useMemo(() => searchScopes(index, query, { offset, limit: PAGE_SIZE }), [index, query, offset]);
  const active = results.matches[activeIndex - offset];
  const activeOptionId = active ? `${id}-option-${activeIndex}` : undefined;
  const first = results.total ? offset + 1 : 0;
  const last = offset + results.matches.length;

  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); }, [focusRequest]);
  useLayoutEffect(() => {
    if (!activeOptionId || !list.current) return;
    const option = document.getElementById(activeOptionId);
    if (!option) return;
    // Scroll only this pane's content. scrollIntoView can also move the panel
    // shell or the underlying tree, breaking exact restoration on Escape.
    const bounds = option.getBoundingClientRect();
    const viewport = list.current.getBoundingClientRect();
    if (bounds.top < viewport.top) list.current.scrollTop -= viewport.top - bounds.top;
    else if (bounds.bottom > viewport.bottom) list.current.scrollTop += bounds.bottom - viewport.bottom;
  }, [activeOptionId, query, refreshRevision]);

  const choose = (scopeId: string) => {
    if (!latest.current.resolveNode(scopeId)) {
      setProblem("Scope is no longer available. Refresh scopes.");
      input.current?.focus({ preventScroll: true });
      return;
    }
    onChoose(scopeId);
  };
  const move = (position: number) => {
    setActiveIndex(Math.max(0, Math.min(results.total - 1, position)));
    setProblem(null);
  };
  const key = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (active) choose(active.node.id);
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowDown") next = activeIndex + 1;
    else if (event.key === "ArrowUp") next = activeIndex - 1;
    else if (event.key === "PageDown") next = activeIndex + PAGE_SIZE;
    else if (event.key === "PageUp") next = activeIndex - PAGE_SIZE;
    else if ((event.ctrlKey || event.metaKey || event.currentTarget === list.current) && event.key === "Home") next = 0;
    else if ((event.ctrlKey || event.metaKey || event.currentTarget === list.current) && event.key === "End") next = results.total - 1;
    if (next !== null) {
      event.preventDefault();
      event.stopPropagation();
      move(next);
    }
  };
  const page = (direction: -1 | 1) => {
    move(direction === -1 ? offset - PAGE_SIZE : offset + PAGE_SIZE);
    input.current?.focus({ preventScroll: true });
  };

  return <section className="workbench-scope-search" aria-label="Scope search" onKeyDown={(event) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (query) {
      setQuery("");
      setActiveIndex(0);
      setProblem(null);
      input.current?.focus({ preventScroll: true });
    } else onClose();
  }}>
    <div className="workbench-scope-search__controls">
      <input ref={input} className="workbench-scope-search__query" type="text" aria-label="Search scopes"
        placeholder="Search scopes" value={query} maxLength={2048}
        aria-controls={`${id}-results`} aria-activedescendant={activeOptionId}
        aria-describedby={`${id}-hint`} autoComplete="off" spellCheck={false}
        onChange={(event) => { setQuery(event.currentTarget.value); setActiveIndex(0); setProblem(null); }} onKeyDown={key} />
      <button type="button" aria-label="Close Scope search" title="Close Scope search (Escape)" onClick={onClose}>Close</button>
    </div>
    <div className="workbench-scope-search__summary">
      <span role="status" aria-live="polite" aria-atomic="true">{query.trim()
        ? `${results.total.toLocaleString()} ${results.total === 1 ? "match" : "matches"}`
        : `${index.totalNodes.toLocaleString()} scopes`}</span>
      <button type="button" aria-label="Refresh scopes" title="Search the latest captured Topology" onClick={() => {
        setRefreshRevision((revision) => revision + 1);
        setActiveIndex(0);
        setProblem(null);
        input.current?.focus({ preventScroll: true });
      }}>Refresh</button>
    </div>
    <p className="workbench-scope-search__hint" id={`${id}-hint`}>All captured Topology · ↑↓ browse · Enter chooses Scope</p>
    {problem ? <p className="workbench-scope-search__problem" role="alert">{problem}</p> : null}
    <div className="workbench-scope-search__results" ref={list} id={`${id}-results`} role={results.matches.length ? "listbox" : undefined} tabIndex={0} aria-activedescendant={activeOptionId} onKeyDown={key} aria-label="Matching scopes">
      {results.matches.map((match, position) => {
        const node = match.node;
        const selected = node.id === selectedScopeId;
        const lifecycle = node.retired ? "Retired · read-only" : label(node.lifecycle ?? "unknown");
        return <button type="button" role="option" tabIndex={-1} key={node.id} id={`${id}-option-${offset + position}`}
          className="workbench-scope-search__result" aria-selected={selected}
          aria-posinset={offset + position + 1} aria-setsize={results.total}
          aria-label={`${label(node.kind)} · ${node.label} · ${match.path} · ${node.id} · ${lifecycle}${selected ? " · Current Scope" : ""}`}
          data-active={offset + position === activeIndex || undefined} data-scope-id={node.id}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(node.id)}>
          <span className="workbench-scope-search__kind">{highlighted(label(node.kind), query)}</span>
          <span className="workbench-scope-search__lifecycle">{highlighted(lifecycle, query)}</span>
          <strong className="workbench-scope-search__label">{highlighted(node.label, query)}</strong>
          <span className="workbench-scope-search__path">{highlighted(match.path, query)}</span>
          <code className="workbench-scope-search__identity">{highlighted(node.id, query)}</code>
          {selected ? <span className="workbench-scope-search__current">Current Scope</span> : null}
          {match.matchedFields.includes("detail") && node.detail ? <span className="workbench-scope-search__detail">{highlighted(node.detail, query)}</span> : null}
        </button>;
      })}
      {results.matches.length === 0 ? <div className="workbench-scope-search__empty">
        <strong>{query.trim() ? "No matching scopes" : "Find a runtime object"}</strong>
        <span>{query.trim() ? "Search a label, type, identity, ancestor path, or lifecycle. Refresh includes the latest Topology." : "Search all captured clients, Sessions, Subscriptions, items, and listeners, including collapsed branches."}</span>
      </div> : null}
    </div>
    {results.total > PAGE_SIZE ? <div className="workbench-scope-search__pages" aria-label="Scope search pages">
      <button type="button" aria-label="Previous Scope results" disabled={!results.hasPrevious} onClick={() => page(-1)}>Previous</button>
      <span>{first.toLocaleString()}–{last.toLocaleString()} of {results.total.toLocaleString()}</span>
      <button type="button" aria-label="Next Scope results" disabled={!results.hasNext} onClick={() => page(1)}>Next</button>
    </div> : null}
  </section>;
}
