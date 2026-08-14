import { type ActivityProjection, type ActivityScope, type ActivityReadPoint } from "./activity-projection";
import { applyFilterMutations, type Filter, type FilterMutation } from "./filter-algebra";

export type ActivityDocumentOrigin = Readonly<{
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
  evidenceSelectionId: string | null;
  evidenceScrollTop: number;
  view: "FOLLOW LIVE" | "FROZEN";
  localDraftId: string | null;
}>;

export type ActivityDocumentState = Readonly<{
  open: boolean;
  origin: ActivityDocumentOrigin;
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
  view: "FOLLOW LIVE" | "FROZEN";
  projection: ActivityProjection;
  selection: Readonly<{ kind: "bucket" | "marker" | "ranking"; id: string }> | null;
  localSeries: boolean;
  rankingSort: "LOGICAL_UPDATES" | "UPDATE_DELIVERIES";
  documentScrollTop: number;
  plotScrollLeft: number;
  newerMatchingEvidence: number;
}>;

export type ActivityDocumentCommand =
  | { type: "select"; selection: ActivityDocumentState["selection"] }
  | { type: "set-local-series"; enabled: boolean }
  | { type: "set-ranking-sort"; sort: ActivityDocumentState["rankingSort"] }
  | { type: "set-scroll"; documentTop?: number; plotLeft?: number }
  | { type: "freeze" }
  | { type: "follow-live"; readPoint: ActivityReadPoint; projection: ActivityProjection }
  | { type: "scope-or-filter-changed"; scope: ActivityScope; filter: Filter; readPoint: ActivityReadPoint; projection: ActivityProjection }
  | { type: "captured-while-frozen"; newerMatchingEvidence: number }
  | { type: "supporting-evidence" };

export type ActivityDocumentResult = Readonly<{
  state: ActivityDocumentState;
  supportingEvidence: Readonly<{ filter: Filter; scope: ActivityScope; readPoint: ActivityReadPoint }> | null;
}>;

export function openActivityDocument(
  projection: ActivityProjection,
  context: Omit<ActivityDocumentOrigin, "scope" | "filter" | "readPoint"> & Pick<ActivityDocumentOrigin, "scope" | "filter" | "readPoint">
): ActivityDocumentState {
  return Object.freeze({ open: true, origin: Object.freeze({ ...context }), scope: context.scope, filter: context.filter, readPoint: context.readPoint, view: context.view, projection, selection: null, localSeries: false, rankingSort: "LOGICAL_UPDATES", documentScrollTop: 0, plotScrollLeft: 0, newerMatchingEvidence: 0 });
}

export function reduceActivityDocument(state: ActivityDocumentState, command: ActivityDocumentCommand): ActivityDocumentResult {
  if (command.type === "supporting-evidence") {
    const selection = state.selection;
    if (!selection) return { state, supportingEvidence: null };
    const selected = selection.kind === "bucket" ? state.projection.buckets[Number(selection.id)] : null;
    const around = selected ? { intervalId: state.readPoint.intervalId, start: Math.max(state.readPoint.retainedRange?.first.timestamp ?? selected.start, selected.start), end: Math.min(state.readPoint.retainedRange?.last.timestamp ?? selected.end, selected.end) } : null;
    if (!around) return { state, supportingEvidence: null };
    const result = applyFilterMutations(state.filter, state.filter.revision, [{ type: "set-around", around } as FilterMutation]);
    return result.ok ? { state, supportingEvidence: { filter: result.filter, scope: state.scope, readPoint: state.readPoint } } : { state, supportingEvidence: null };
  }
  switch (command.type) {
    case "select": return { state: Object.freeze({ ...state, selection: command.selection }), supportingEvidence: null };
    case "set-local-series": return { state: Object.freeze({ ...state, localSeries: command.enabled }), supportingEvidence: null };
    case "set-ranking-sort": return { state: Object.freeze({ ...state, rankingSort: command.sort }), supportingEvidence: null };
    case "set-scroll": return { state: Object.freeze({ ...state, documentScrollTop: command.documentTop ?? state.documentScrollTop, plotScrollLeft: command.plotLeft ?? state.plotScrollLeft }), supportingEvidence: null };
    case "freeze": return { state: Object.freeze({ ...state, view: "FROZEN" }), supportingEvidence: null };
    case "follow-live": return { state: Object.freeze({ ...state, view: "FOLLOW LIVE", readPoint: command.readPoint, projection: command.projection, newerMatchingEvidence: 0 }), supportingEvidence: null };
    case "scope-or-filter-changed": return { state: Object.freeze({ ...state, scope: command.scope, filter: command.filter, readPoint: command.readPoint, projection: command.projection, selection: null }), supportingEvidence: null };
    case "captured-while-frozen": return { state: Object.freeze({ ...state, newerMatchingEvidence: command.newerMatchingEvidence }), supportingEvidence: null };
  }
}

export function closeActivityDocument(state: ActivityDocumentState): ActivityDocumentOrigin {
  return state.origin;
}
