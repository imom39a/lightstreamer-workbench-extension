import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { WorkbenchRuntime, WorkbenchSnapshot } from "../../workbench-runtime";
import { FACET_DESCRIPTORS, type EvidenceFacetKey } from "../../../../core/evidence-facets";
import type { FacetCount, TypedFacetValue } from "../../../../core/evidence-filter-contract";
import type { Filter, FilterMutation } from "../../../../core/filter-algebra";
import type { FilterValueState } from "../filter-value-control";
import { filterValueForDraft } from "../filter-workflow";
import { useLatestHandlers } from "./use-stable-value";

type FilterComposerStep = "composer" | "facets" | "explorer";

function cloneFilterCriteria(criteria: Filter["criteria"]): Filter["criteria"] {
  return Object.fromEntries(Object.entries(criteria).map(([facet, criterion]) => [facet, {
    include: [...criterion.include],
    exclude: [...criterion.exclude]
  }])) as Filter["criteria"];
}

function criterionSignature(criterion: Filter["criteria"][string] | undefined): string {
  if (!criterion) return "";
  return JSON.stringify({
    include: criterion.include.map(({ identity }) => identity).sort(),
    exclude: criterion.exclude.map(({ identity }) => identity).sort()
  });
}

function draftFilterOperations(
  applied: Filter,
  text: string,
  criteria: Filter["criteria"]
): readonly FilterMutation[] {
  const operations: FilterMutation[] = [];
  if (applied.text !== text.trim().toLocaleLowerCase()) operations.push({ type: "set-text", text });
  const facets = new Set([...Object.keys(applied.criteria), ...Object.keys(criteria)]);
  for (const facet of facets) {
    const current = applied.criteria[facet];
    const next = criteria[facet];
    if (criterionSignature(current) === criterionSignature(next)) continue;
    operations.push({
      type: "replace-facet",
      facet,
      criterion: next ?? { include: [], exclude: [] }
    });
  }
  return operations;
}

/**
 * Filter Draft composer state, facet discovery accumulation, and return
 * focus. The runtime owns the applied Filter and its revision.
 *
 * Registers the facet-discovery accumulation layout effect at the call
 * site; `useFilterSubmitResult`, `useFilterInputFocus`, and
 * `useFilterDraftSync` are called separately at their original positions.
 */
export function useFilterComposer({
  runtime,
  evidence,
  snapshotVersion
}: Readonly<{
  runtime: WorkbenchRuntime;
  evidence: WorkbenchSnapshot["evidence"];
  snapshotVersion: number;
}>) {
  const appliedFilter = evidence.investigation.filter;
  const queryState = evidence.investigation.queryState;
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState("");
  const [filterDraftCriteria, setFilterDraftCriteria] = useState<Filter["criteria"]>({});
  const [filterStep, setFilterStep] = useState<FilterComposerStep>("composer");
  const [filterFacet, setFilterFacet] = useState<EvidenceFacetKey | null>(null);
  const [filterDiscoverySearch, setFilterDiscoverySearch] = useState("");
  const [filterDiscoveryCursor, setFilterDiscoveryCursor] = useState<string | null>(null);
  const [filterDiscoveryValues, setFilterDiscoveryValues] = useState<readonly FacetCount[]>([]);
  const [filterDraftRevision, setFilterDraftRevision] = useState<number | null>(null);
  const [filterSubmitVersion, setFilterSubmitVersion] = useState<number | null>(null);
  const filterInput = useRef<HTMLInputElement | null>(null);
  const filterTrigger = useRef<HTMLButtonElement | null>(null);
  const structuredCriterionTrigger = useRef<HTMLButtonElement | null>(null);
  const facetPickerFirst = useRef<HTMLButtonElement | null>(null);
  const facetButtons = useRef(new Map<EvidenceFacetKey, HTMLButtonElement>());
  const facetReturnKey = useRef<EvidenceFacetKey | null>(null);
  const facetSearchInput = useRef<HTMLInputElement | null>(null);
  const filterOrigin = useRef<HTMLElement | null>(null);

  const activeFacetDescriptor = filterFacet
    ? FACET_DESCRIPTORS.find((descriptor) => descriptor.key === filterFacet) ?? null
    : null;
  const activeFacetDiscovery = filterFacet
    ? evidence.investigation.discoveries.get(filterFacet)
    : undefined;

  useLayoutEffect(() => {
    if (activeFacetDiscovery?.state !== "AVAILABLE" || queryState === "loading") return;
    setFilterDiscoveryValues((previous) => {
      if (!filterDiscoveryCursor) return activeFacetDiscovery.values;
      const identities = new Set(previous.map((entry) => entry.value.identity));
      return Object.freeze([...previous, ...activeFacetDiscovery.values.filter((entry) => !identities.has(entry.value.identity))]);
    });
  }, [activeFacetDiscovery, queryState, filterDiscoveryCursor]);

  const clearFilterDiscovery = () => {
    runtime.dispatch({ type: "request-filter-discovery", request: null });
  };

  const openFilter = (origin: HTMLElement) => {
    clearFilterDiscovery();
    filterOrigin.current = origin;
    setFilterDraft(appliedFilter.text);
    setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    setFilterStep("composer");
    setFilterFacet(null);
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    facetReturnKey.current = null;
    setFilterDraftRevision(appliedFilter.revision);
    setFilterOpen(true);
  };

  const closeFilter = () => {
    clearFilterDiscovery();
    setFilterDraft(appliedFilter.text);
    setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    setFilterStep("composer");
    setFilterFacet(null);
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    facetReturnKey.current = null;
    setFilterDraftRevision(null);
    setFilterOpen(false);
    window.requestAnimationFrame(() => {
      (filterOrigin.current?.isConnected ? filterOrigin.current : filterTrigger.current)?.focus();
    });
  };

  const openStructuredCriteria = () => {
    setFilterStep("facets");
    window.requestAnimationFrame(() => facetPickerFirst.current?.focus());
  };

  const openFacetExplorer = (facet: EvidenceFacetKey) => {
    facetReturnKey.current = facet;
    setFilterFacet(facet);
    setFilterStep("explorer");
    setFilterDiscoverySearch("");
    setFilterDiscoveryCursor(null);
    setFilterDiscoveryValues([]);
    runtime.dispatch({ type: "request-filter-discovery", request: { facet, size: 12 } });
    window.requestAnimationFrame(() => facetSearchInput.current?.focus());
  };

  const requestFacetDiscovery = (search: string, cursor: string | null = null) => {
    if (!filterFacet) return;
    runtime.dispatch({
      type: "request-filter-discovery",
      request: {
        facet: filterFacet,
        size: 12,
        ...(search ? { search } : {}),
        ...(cursor ? { cursor } : {})
      }
    });
  };

  const chooseFacetValue = (value: TypedFacetValue, state: FilterValueState) => {
    const draftValue = filterValueForDraft(value);
    setFilterDraftCriteria((previous) => {
      const current = previous[value.facet] ?? { include: [], exclude: [] };
      const include = current.include.filter((candidate) => candidate.identity !== draftValue.identity);
      const exclude = current.exclude.filter((candidate) => candidate.identity !== draftValue.identity);
      if (state === "include") include.push(draftValue);
      if (state === "exclude") exclude.push(draftValue);
      return {
        ...previous,
        [value.facet]: { include, exclude }
      };
    });
  };

  const handleFilterEscape = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (filterStep === "explorer") {
      clearFilterDiscovery();
      setFilterStep("facets");
      setFilterFacet(null);
      setFilterDiscoveryCursor(null);
      window.requestAnimationFrame(() => {
        const target = (facetReturnKey.current ? facetButtons.current.get(facetReturnKey.current) : null) ?? facetPickerFirst.current;
        target?.focus();
      });
      return;
    }
    if (filterStep === "facets") {
      setFilterStep("composer");
      window.requestAnimationFrame(() => structuredCriterionTrigger.current?.focus());
      return;
    }
    closeFilter();
  };

  const applyFilterDraft = () => {
    setFilterSubmitVersion(snapshotVersion);
    runtime.dispatch({ type: "apply-filter-mutations", expectedRevision: filterDraftRevision ?? appliedFilter.revision, operations: draftFilterOperations(appliedFilter, filterDraft, filterDraftCriteria) });
  };

  // Identity-stable delegates to this render's handlers, for the memoized
  // Filter document and for effects that must call the current closure.
  const handlers = useLatestHandlers({
    clearFilterDiscovery, closeFilter, openStructuredCriteria, openFacetExplorer,
    requestFacetDiscovery, chooseFacetValue, handleFilterEscape, applyFilterDraft
  });

  const filterMutation = evidence.filterMutation;
  // FilterDraftDocument reads only these two Evidence facts; a narrow object
  // keeps the memoized document independent of unrelated Evidence changes.
  const documentEvidence = useMemo(
    () => ({ filterMutation, investigation: { queryState } }),
    [filterMutation, queryState]
  );

  const documentProps = {
    filterStep, filterDraft, filterDraftCriteria, filterDiscoverySearch, filterDiscoveryValues,
    activeFacetDescriptor, activeFacetDiscovery, evidence: documentEvidence,
    filterInput, structuredCriterionTrigger, facetPickerFirst, facetButtons, facetSearchInput,
    setFilterDraft, setFilterStep, setFilterFacet, setFilterDiscoveryCursor, setFilterDiscoverySearch,
    clearFilterDiscovery: handlers.clearFilterDiscovery,
    closeFilter: handlers.closeFilter,
    openStructuredCriteria: handlers.openStructuredCriteria,
    openFacetExplorer: handlers.openFacetExplorer,
    requestFacetDiscovery: handlers.requestFacetDiscovery,
    chooseFacetValue: handlers.chooseFacetValue,
    onEscape: handlers.handleFilterEscape,
    onApply: handlers.applyFilterDraft
  };

  return {
    filterOpen, filterStep, filterTrigger, filterInput, facetSearchInput,
    filterSubmitVersion, setFilterSubmitVersion, setFilterDraftRevision,
    setFilterDraft, setFilterDraftCriteria,
    openFilter, closeFilter, handlers, documentProps
  };
}

export type FilterComposer = ReturnType<typeof useFilterComposer>;

/** Closes the composer after the runtime applies the submitted Draft, or keeps it open for review. */
export function useFilterSubmitResult(
  filter: FilterComposer,
  filterMutation: WorkbenchSnapshot["evidence"]["filterMutation"],
  snapshotVersion: number
): void {
  const { filterSubmitVersion, setFilterSubmitVersion, setFilterDraftRevision, handlers } = filter;
  useLayoutEffect(() => {
    if (filterSubmitVersion === null || snapshotVersion <= filterSubmitVersion) return;
    const mutation = filterMutation;
    if (mutation.state === "stale") {
      setFilterDraftRevision(mutation.revision);
      setFilterSubmitVersion(null);
      return;
    }
    if (mutation.state === "invalid") {
      setFilterSubmitVersion(null);
      return;
    }
    if (mutation.state === "applied" || mutation.state === "no-op") {
      setFilterSubmitVersion(null);
      handlers.closeFilter();
    }
  }, [handlers, setFilterDraftRevision, setFilterSubmitVersion, filterMutation, filterSubmitVersion, snapshotVersion]);
}

/** Focuses the active composer input when the Filter opens or changes step. */
export function useFilterInputFocus(filter: FilterComposer): void {
  const { filterOpen, filterStep, filterInput, facetSearchInput } = filter;
  useLayoutEffect(() => {
    if (!filterOpen) return;
    if (filterStep === "composer") filterInput.current?.focus();
    if (filterStep === "explorer") facetSearchInput.current?.focus();
  }, [filterInput, facetSearchInput, filterOpen, filterStep]);
}

/** Keeps the closed Draft aligned with the applied Filter. */
export function useFilterDraftSync(filter: FilterComposer, appliedFilter: Filter): void {
  const { filterOpen, setFilterDraft, setFilterDraftCriteria } = filter;
  useLayoutEffect(() => {
    if (!filterOpen) {
      setFilterDraft(appliedFilter.text);
      setFilterDraftCriteria(cloneFilterCriteria(appliedFilter.criteria));
    }
  }, [setFilterDraft, setFilterDraftCriteria, appliedFilter.criteria, appliedFilter.text, filterOpen]);
}
