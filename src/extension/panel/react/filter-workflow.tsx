import { useLayoutEffect, useMemo, useRef, type JSX, type RefObject, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { FACET_DESCRIPTORS, type EvidenceFacetKey } from "../../../core/evidence-facets";
import type { FacetCount, FacetDiscoveryResult, TypedFacetValue } from "../../../core/evidence-filter-contract";
import { createTypedFilterValue, type Filter, type FilterMutation, type TypedFilterValue } from "../../../core/filter-algebra";
import type { EvidenceFilterActionDescriptor } from "../../../core/evidence-filter-actions";
import type { WorkbenchSnapshot } from "../workbench-runtime";
import { FilterValueControl, type FilterValueState } from "./filter-value-control";

export function SelectedFilterActions({
  actions,
  filter,
  open,
  onOpenChange,
  onAction,
  onValueChange
}: Readonly<{
  actions: readonly EvidenceFilterActionDescriptor[];
  filter: Filter;
  open: boolean;
  onOpenChange(open: boolean): void;
  onAction(action: EvidenceFilterActionDescriptor): void;
  onValueChange(value: TypedFilterValue, state: FilterValueState): void;
}>): JSX.Element | null {
  const summaryRef = useRef<HTMLElement>(null);
  const focusWithin = useRef(false);
  const previousActionCount = useRef(actions.length);
  useLayoutEffect(() => {
    const actionsBecameUnavailable = previousActionCount.current > 0 && actions.length === 0;
    previousActionCount.current = actions.length;
    if (actionsBecameUnavailable && focusWithin.current) summaryRef.current?.focus();
  }, [actions.length]);
  return <details
    className="workbench-react__filter-actions workbench-context-disclosure"
    aria-label="Filter selected Evidence"
    open={open}
    onToggle={event => onOpenChange(event.currentTarget.open)}
    onFocusCapture={() => { focusWithin.current = true; }}
    onBlurCapture={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
    }}
  >
    <summary ref={summaryRef}>Filter selected Evidence</summary>
    <div className="workbench-react__filter-actions-content">
      {actions.length ? <SelectedFilterActionList actions={actions} filter={filter} onAction={onAction} onValueChange={onValueChange} /> : <p role="status">No Filter values are available for this Evidence.</p>}
    </div>
  </details>;
}

type SelectedFilterValue = Readonly<{
  facet: string;
  label: string;
  value: TypedFilterValue;
}>;

const PRIMARY_SELECTED_FILTER_FACETS = new Set(["client", "subscription", "mode", "item", "key"]);
const EXPANDABLE_FILTER_VALUE_LENGTH = 48;

function SelectedFilterActionList({
  actions,
  filter,
  onAction,
  onValueChange
}: Readonly<{
  actions: readonly EvidenceFilterActionDescriptor[];
  filter: Filter;
  onAction(action: EvidenceFilterActionDescriptor): void;
  onValueChange(value: TypedFilterValue, state: FilterValueState): void;
}>): JSX.Element {
  const { values, around } = useMemo(() => {
    const grouped = new Map<string, Partial<Record<"include" | "exclude", EvidenceFilterActionDescriptor>>>();
    const aroundActions: EvidenceFilterActionDescriptor[] = [];
    for (const action of actions) {
      if (action.kind === "around") { aroundActions.push(action); continue; }
      if (!action.facet || !action.value) continue;
      const pair = grouped.get(action.value.identity) ?? {};
      pair[action.kind] = action;
      grouped.set(action.value.identity, pair);
    }
    const paired = [...grouped.values()].flatMap((pair): SelectedFilterValue[] => {
      const include = pair.include;
      const exclude = pair.exclude;
      if (!include?.facet || !include.value || !exclude) return [];
      return [{ facet: include.facet, label: include.facetDescriptor?.label ?? include.facet, value: include.value }];
    });
    return { values: paired, around: aroundActions };
  }, [actions]);
  const primary = values.filter(({ facet }) => PRIMARY_SELECTED_FILTER_FACETS.has(facet));
  const secondary = values.filter(({ facet }) => !PRIMARY_SELECTED_FILTER_FACETS.has(facet));
  const activeSecondary = secondary.filter(({ value }) => filterValueState(filter.criteria[value.facet], value) !== "off").length;
  return <>
    <p>Changes apply immediately; other criteria stay unchanged.</p>
    <div className="workbench-react__filter-action-list" role="list" aria-label="Selected Evidence Filter values">
      {primary.map((value) => <SelectedFilterValueRow key={value.value.identity} value={value} state={filterValueState(filter.criteria[value.value.facet], value.value)} onChange={onValueChange} />)}
      {around.map((action) => <div className="workbench-react__filter-action-row" role="listitem" data-filter-action-kind="around" key={action.id}>
        <span>Retained Evidence interval</span><button type="button" aria-label={action.label} onClick={() => onAction(action)}>Around</button>
      </div>)}
    </div>
    {secondary.length ? <details className="workbench-react__filter-action-more">
      <summary>More properties{activeSecondary ? ` · ${activeSecondary} active` : ""}</summary>
      <div className="workbench-react__filter-action-list" role="list" aria-label="More selected Evidence Filter values">
        {secondary.map((value) => <SelectedFilterValueRow key={value.value.identity} value={value} state={filterValueState(filter.criteria[value.value.facet], value.value)} onChange={onValueChange} />)}
      </div>
    </details> : null}
  </>;
}

function SelectedFilterValueRow({ value, state, onChange }: Readonly<{
  value: SelectedFilterValue;
  state: FilterValueState;
  onChange(value: TypedFilterValue, state: FilterValueState): void;
}>): JSX.Element {
  const label = `${value.label}: ${value.value.label}`;
  const expandable = value.value.label.length > EXPANDABLE_FILTER_VALUE_LENGTH;
  return <div className="workbench-react__filter-action-row" role="listitem" data-filter-facet={value.facet} data-filter-value-identity={value.value.identity}>
    {expandable
      ? <details className="workbench-react__filter-action-value"><summary><strong>{value.label}</strong><span>{value.value.label}</span></summary></details>
      : <span className="workbench-react__filter-action-value workbench-react__filter-action-value--plain"><strong>{value.label}</strong><span>{value.value.label}</span></span>}
    <FilterValueControl label={label} state={state} onChange={(next) => onChange(value.value, next)} />
  </div>;
}

/** Labels stay readable; only colliding labels expose their qualified identity. */
function FilterExplorerValueLabel({ value, collision }: Readonly<{ value: TypedFacetValue; collision: boolean }>): JSX.Element {
  let qualifier = value.type;
  if (collision && value.type === "item") {
    try {
      const parts = JSON.parse(value.value).at(-1);
      const position = Array.isArray(parts) ? parts.find(part => Array.isArray(part) && part[0] === "position")?.[1] : undefined;
      if (position !== undefined) qualifier = `Item #${position}`;
    } catch { /* The exact identity remains available in the disclosure. */ }
  }
  const expandable = collision || value.label.length > EXPANDABLE_FILTER_VALUE_LENGTH;
  const label = <><strong>{value.label}</strong>{collision ? <small>{qualifier}</small> : null}</>;
  return expandable
    ? <details className="workbench-react__filter-value-label workbench-react__filter-value-label--expandable"><summary>{label}</summary>{collision ? <code>{value.value}</code> : null}</details>
    : <span className="workbench-react__filter-value-label">{label}</span>;
}

export function filterValueState(
  criterion: Filter["criteria"][string] | undefined,
  value: TypedFilterValue
): FilterValueState {
  if (criterion?.include.some((candidate) => candidate.identity === value.identity)) return "include";
  if (criterion?.exclude.some((candidate) => candidate.identity === value.identity)) return "exclude";
  return "off";
}

export function filterValueMutations(value: TypedFilterValue, state: FilterValueState): readonly FilterMutation[] {
  return [state === "off"
    ? { type: "remove-criterion", facet: value.facet, value }
    : { type: "set-polarity", facet: value.facet, value, polarity: state }];
}

export function filterValueForDraft(value: TypedFacetValue): TypedFilterValue {
  let scalar: string | number | boolean | null = value.value;
  if (value.type === "number") scalar = Number(value.value);
  else if (value.type === "boolean") scalar = value.value === "true";
  else if (value.type === "null") scalar = null;
  return createTypedFilterValue(value.facet, value.type, scalar, value.label);
}

function discoveryUnavailableMessage(result: Extract<FacetDiscoveryResult, { state: "UNAVAILABLE" }>): string {
  switch (result.reason) {
    case "ZERO_BASE": return "No Evidence is in the current Scope, so there are no values to discover.";
    case "NO_CONCRETE_VALUES": return "No observed concrete values exist for this facet at the current read point.";
    case "DISCOVERY_FAILED": return "Exact value discovery is unavailable for this read point. The Evidence query remains usable.";
    case "UNSUPPORTED_AT_READ_POINT": return "This facet is unavailable at the current read point.";
  }
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

type FilterDraftDocumentProps = Readonly<{
  filterStep: "composer" | "facets" | "explorer";
  filterDraft: string;
  filterDraftCriteria: Filter["criteria"];
  filterDiscoverySearch: string;
  filterDiscoveryValues: readonly FacetCount[];
  activeFacetDescriptor: (typeof FACET_DESCRIPTORS)[number] | null;
  activeFacetDiscovery: FacetDiscoveryResult | undefined;
  evidence: WorkbenchSnapshot["evidence"];
  filterInput: RefObject<HTMLInputElement | null>;
  structuredCriterionTrigger: RefObject<HTMLButtonElement | null>;
  facetPickerFirst: RefObject<HTMLButtonElement | null>;
  facetButtons: RefObject<Map<EvidenceFacetKey, HTMLButtonElement>>;
  facetSearchInput: RefObject<HTMLInputElement | null>;
  setFilterDraft(value: string): void;
  setFilterStep(value: "composer" | "facets" | "explorer"): void;
  setFilterFacet(value: EvidenceFacetKey | null): void;
  setFilterDiscoveryCursor(value: string | null): void;
  setFilterDiscoverySearch(value: string): void;
  clearFilterDiscovery(): void;
  closeFilter(): void;
  openStructuredCriteria(): void;
  openFacetExplorer(facet: EvidenceFacetKey): void;
  requestFacetDiscovery(search: string, cursor?: string | null): void;
  chooseFacetValue(value: TypedFacetValue, state: FilterValueState): void;
  onApply(): void;
  onEscape(event: ReactKeyboardEvent<HTMLElement>): void;
}>;

/** Presentation only; the panel owns draft state, read points, and return focus. */
export function FilterDraftDocument({ filterStep, filterDraft, filterDraftCriteria, filterDiscoverySearch, filterDiscoveryValues, activeFacetDescriptor, activeFacetDiscovery, evidence, filterInput, structuredCriterionTrigger, facetPickerFirst, facetButtons, facetSearchInput, setFilterDraft, setFilterStep, setFilterFacet, setFilterDiscoveryCursor, setFilterDiscoverySearch, clearFilterDiscovery, closeFilter, openStructuredCriteria, openFacetExplorer, requestFacetDiscovery, chooseFacetValue, onApply, onEscape }: FilterDraftDocumentProps): JSX.Element {
  return <form className={`workbench-react__filter${filterStep !== "composer" ? " workbench-react__filter--structured-open" : ""}${filterStep === "explorer" ? " workbench-react__filter--explorer-open" : ""}`} id="workbench-filter" aria-label="Filter ordered Evidence" onKeyDown={onEscape} onSubmit={(event) => { event.preventDefault(); onApply(); }}>
            {filterStep === "composer" ? <>
              <div className="workbench-react__filter-controls"><label htmlFor="workbench-filter-query">Filter Evidence</label><input ref={filterInput} id="workbench-filter-query" value={filterDraft} onChange={(event) => setFilterDraft(event.currentTarget.value)} /><button type="submit">Apply</button><button type="button" onClick={closeFilter}>Cancel</button></div>
              <div className="workbench-react__filter-draft-summary" aria-label="Structured criteria draft"><strong>Structured criteria draft</strong>{Object.entries(filterDraftCriteria).flatMap(([facet, criterion]) => [
                ...criterion.include.map((value) => <span key={`${facet}-include-${value.identity}`}>Include {facet}: {value.label}</span>),
                ...criterion.exclude.map((value) => <span key={`${facet}-exclude-${value.identity}`}>Exclude {facet}: {value.label}</span>)
              ])}{Object.values(filterDraftCriteria).every((criterion) => criterion.include.length === 0 && criterion.exclude.length === 0) ? <span>No structured criteria added.</span> : null}</div>
              <button ref={structuredCriterionTrigger} type="button" onClick={openStructuredCriteria}>Add structured criterion</button><span id="workbench-filter-structured-note" className="workbench-react__filter-note">Choose one of twelve Evidence facets to browse exact observed values.</span>
              {evidence.filterMutation.state === "stale" || evidence.filterMutation.state === "invalid" ? <p className="workbench-react__filter-status" role="alert">{evidence.filterMutation.message ?? "The Filter could not be applied."} Draft remains editable; review it and Apply again.</p> : null}
            </> : filterStep === "facets" ? <section className="workbench-react__filter-facet-step" role="dialog" aria-label="Choose structured facet">
              <header><div><strong>Add structured criterion</strong><span>Select a Lightstreamer-native facet.</span></div><button type="button" onClick={() => { setFilterStep("composer"); window.requestAnimationFrame(() => structuredCriterionTrigger.current?.focus()); }}>Back to Filter</button></header>
              <div className="workbench-react__filter-facet-grid" role="group" aria-label="Evidence facets">{FACET_DESCRIPTORS.map((descriptor, index) => <button ref={(element) => { if (index === 0) facetPickerFirst.current = element; if (element) facetButtons.current.set(descriptor.key, element); else facetButtons.current.delete(descriptor.key); }} type="button" key={descriptor.key} aria-label={`Add ${descriptor.label} criterion`} onClick={() => openFacetExplorer(descriptor.key)}><strong>{descriptor.label}</strong><span>{descriptor.valueType} · exact observed values</span></button>)}</div>
              <footer><span>All twelve facets are available without query syntax.</span><button type="button" onClick={closeFilter}>Cancel</button></footer>
            </section> : <section className="workbench-react__filter-explorer" role="dialog" aria-label={`${activeFacetDescriptor?.label ?? "Facet"} values`}>
              <header className="workbench-react__filter-explorer-header"><div><strong>{activeFacetDescriptor?.label ?? "Facet"} values</strong></div><button type="button" onClick={() => { clearFilterDiscovery(); setFilterStep("facets"); setFilterFacet(null); setFilterDiscoveryCursor(null); window.requestAnimationFrame(() => facetPickerFirst.current?.focus()); }}>Back to facets</button></header>
              <div className="workbench-react__filter-explorer-search"><label htmlFor="workbench-filter-value-search">Search values</label><input ref={facetSearchInput} id="workbench-filter-value-search" value={filterDiscoverySearch} onChange={(event) => { const search = event.currentTarget.value; setFilterDiscoverySearch(search); setFilterDiscoveryCursor(null); requestFacetDiscovery(search); }} /></div>
              {!activeFacetDiscovery || evidence.investigation.queryState === "loading" ? <div className="workbench-react__filter-explorer-empty" role="status"><strong>Loading values…</strong></div> : activeFacetDiscovery.state === "UNAVAILABLE" ? <div className="workbench-react__filter-explorer-empty" role="status"><strong>Exact values unavailable</strong><span>{discoveryUnavailableMessage(activeFacetDiscovery)}</span></div> : <>
                <p className="workbench-react__filter-explorer-counts" role="status">{countLabel(activeFacetDiscovery.distinctTotal, "value")}{filterDiscoverySearch ? ` matching “${filterDiscoverySearch}”` : ""} · {activeFacetDiscovery.baseEvidenceCount.toLocaleString()} Evidence in Scope and other Filter criteria.</p>
                <div className="workbench-react__filter-value-list" role="list" aria-label={`${activeFacetDescriptor?.label ?? "Facet"} values`}>
                  {filterDiscoveryValues.length ? filterDiscoveryValues.map((entry) => {
                    const draftValue = filterValueForDraft(entry.value);
                    const criterion = filterDraftCriteria[entry.value.facet];
                    const valueState = filterValueState(criterion, draftValue);
                    const completeIdentity = `${entry.value.facet} · ${entry.value.type} · ${entry.value.identity}`;
                    const controlLabel = `${activeFacetDescriptor?.label ?? entry.value.facet} value ${entry.value.label} (${entry.value.type})`;
                    return <div className="workbench-react__filter-value-row" role="listitem" data-filter-value-identity={entry.value.identity} key={entry.value.identity} title={completeIdentity}><FilterExplorerValueLabel value={entry.value} collision={filterDiscoveryValues.some(other => other.value.identity !== entry.value.identity && other.value.label === entry.value.label)} /><span className="workbench-react__filter-value-count">{entry.count.toLocaleString()} Evidence{entry.pinned ? ` · pinned${entry.count === 0 ? " · zero" : ""}` : ""}</span><div className="workbench-react__filter-value-actions"><FilterValueControl label={controlLabel} state={valueState} onChange={(state) => chooseFacetValue(entry.value, state)} /></div></div>;
                  }) : <div className="workbench-react__filter-explorer-empty" role="status"><strong>No values match this search.</strong><span>Clear Search to see observed values.</span></div>}
                </div>
                {activeFacetDiscovery.nextCursor ? <button className="workbench-react__filter-next" type="button" onClick={() => { const cursor = activeFacetDiscovery.nextCursor; setFilterDiscoveryCursor(cursor); requestFacetDiscovery(filterDiscoverySearch, cursor); }}>Show more values</button> : <span className="workbench-react__filter-complete">All values shown.</span>}
              </>}
              {evidence.filterMutation.state === "stale" || evidence.filterMutation.state === "invalid" ? <p className="workbench-react__filter-status" role="alert">{evidence.filterMutation.message ?? "The Filter could not be applied."} Draft remains editable; review it and Apply again.</p> : null}
              <footer><span>Draft · Apply to change Evidence</span><button type="submit">Apply</button><button type="button" onClick={closeFilter}>Cancel</button></footer>
            </section>}
          </form>;
}
