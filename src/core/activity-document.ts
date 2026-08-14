import { clipActivityTimeRange, type ActivityProjection, type ActivityScope, type ActivityReadPoint, type ActivityTimeRange } from "./activity-projection";
import { applyFilterMutations, type Filter, type FilterMutation } from "./filter-algebra";

export type ActivityDocumentOrigin = Readonly<{
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
  evidenceSelectionId: string | null;
  evidenceFocusId?: string | null;
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
  selectionRange: ActivityTimeRange | null;
  timelineSeries: "SERVER_LOGICAL_UPDATES" | "UPDATE_DELIVERIES" | "SERVER_SNAPSHOT" | "SERVER_LIVE" | "LOCAL_LOGICAL_UPDATES" | "LOCAL_UPDATE_DELIVERIES";
  localSeries: boolean;
  rankingSort: "LOGICAL_UPDATES" | "UPDATE_DELIVERIES";
  documentScrollTop: number;
  plotScrollLeft: number;
  newerMatchingEvidence: number;
}>;

export type ActivityDocumentCommand =
  | { type: "select"; selection: ActivityDocumentState["selection"] }
  | { type: "set-local-series"; enabled: boolean }
  | { type: "set-timeline-series"; series: ActivityDocumentState["timelineSeries"] }
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
  return Object.freeze({ open: true, origin: Object.freeze({ ...context }), scope: context.scope, filter: context.filter, readPoint: context.readPoint, view: context.view, projection, selection: null, selectionRange: null, timelineSeries: "SERVER_LOGICAL_UPDATES", localSeries: false, rankingSort: "LOGICAL_UPDATES", documentScrollTop: 0, plotScrollLeft: 0, newerMatchingEvidence: 0 });
}

function bucketForSelection(projection: ActivityProjection, selection: ActivityDocumentState["selection"], allowLegacyIndex = false): ActivityProjection["buckets"][number] | null {
  if (!selection || selection.kind !== "bucket") return null;
  const byIdentity = projection.buckets.find((bucket) => bucket.id === selection.id);
  if (byIdentity) return byIdentity;
  if (!allowLegacyIndex) return null;
  const index = Number(selection.id);
  return Number.isInteger(index) ? projection.buckets[index] ?? null : null;
}

/** Rebinds a live document to a newer projection without changing its absolute selection. */
export function reconcileActivityDocumentProjection(
  state: ActivityDocumentState,
  readPoint: ActivityReadPoint,
  projection: ActivityProjection
): ActivityDocumentState {
  const selectedBucket = bucketForSelection(state.projection, state.selection);
  const selectionRange = state.selectionRange ?? (selectedBucket ? { start: selectedBucket.start, end: selectedBucket.end } : null);
  if (!state.selection || state.selection.kind !== "bucket") {
    return Object.freeze({ ...state, readPoint, projection });
  }
  const rebound = selectionRange
    ? projection.buckets.find((bucket) => bucket.start === selectionRange.start && bucket.end === selectionRange.end)
    : null;
  const selection = rebound
    ? Object.freeze({ ...state.selection, id: rebound.id })
    : state.selection;
  return Object.freeze({ ...state, readPoint, projection, selection, selectionRange });
}

export function reduceActivityDocument(state: ActivityDocumentState, command: ActivityDocumentCommand): ActivityDocumentResult {
  if (command.type === "supporting-evidence") {
    const selection = state.selection;
    if (!selection) return { state, supportingEvidence: null };
    const selected = selection.kind === "bucket"
      ? (state.selectionRange
        ? state.projection.buckets.find((bucket) => bucket.start === state.selectionRange?.start && bucket.end === state.selectionRange?.end)
        : bucketForSelection(state.projection, selection))
      : selection.kind === "marker"
        ? state.projection.buckets.find((bucket) => bucket.start <= (state.projection.markers[Number(selection.id)]?.timestamp ?? Number.NaN) && (state.projection.markers[Number(selection.id)]?.timestamp ?? Number.NaN) < bucket.end)
        : null;
    const marker = selection.kind === "marker" ? state.projection.markers[Number(selection.id)] : null;
    const selectedRange = selected ? { start: selected.start, end: selected.end } : state.selectionRange ?? (marker ? { start: marker.timestamp, end: marker.timestamp + 1 } : null);
    const clipped = selectedRange
      ? clipActivityTimeRange(
        selectedRange,
        state.readPoint.retainedRange
      )
      : null;
    const around = clipped ? { intervalId: state.readPoint.intervalId, ...clipped } : null;
    if (!around) return { state, supportingEvidence: null };
    const result = applyFilterMutations(state.filter, state.filter.revision, [{ type: "set-around", around } as FilterMutation]);
    return result.ok ? { state, supportingEvidence: { filter: result.filter, scope: state.scope, readPoint: state.readPoint } } : { state, supportingEvidence: null };
  }
  switch (command.type) {
    case "select": {
      const bucket = bucketForSelection(state.projection, command.selection, true);
      const selection = command.selection?.kind === "bucket" && bucket
        ? Object.freeze({ ...command.selection, id: bucket.id })
        : command.selection;
      return { state: Object.freeze({ ...state, selection, selectionRange: bucket ? { start: bucket.start, end: bucket.end } : null }), supportingEvidence: null };
    }
    case "set-local-series": return { state: Object.freeze({ ...state, localSeries: command.enabled }), supportingEvidence: null };
    case "set-timeline-series": return { state: Object.freeze({ ...state, timelineSeries: command.series }), supportingEvidence: null };
    case "set-ranking-sort": return { state: Object.freeze({ ...state, rankingSort: command.sort }), supportingEvidence: null };
    case "set-scroll": return { state: Object.freeze({ ...state, documentScrollTop: command.documentTop ?? state.documentScrollTop, plotScrollLeft: command.plotLeft ?? state.plotScrollLeft }), supportingEvidence: null };
    case "freeze": return { state: Object.freeze({ ...state, view: "FROZEN" }), supportingEvidence: null };
    case "follow-live": return { state: Object.freeze({ ...state, view: "FOLLOW LIVE", readPoint: command.readPoint, projection: command.projection, newerMatchingEvidence: 0 }), supportingEvidence: null };
    case "scope-or-filter-changed": return { state: Object.freeze({ ...state, scope: command.scope, filter: command.filter, readPoint: command.readPoint, projection: command.projection, selection: null, selectionRange: null }), supportingEvidence: null };
    case "captured-while-frozen": return { state: Object.freeze({ ...state, newerMatchingEvidence: command.newerMatchingEvidence }), supportingEvidence: null };
  }
}

export function closeActivityDocument(state: ActivityDocumentState): ActivityDocumentOrigin {
  return state.origin;
}
