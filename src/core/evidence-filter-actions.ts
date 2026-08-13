import {
  createTypedFilterValue,
  type FilterAround,
  type FilterMutation,
  type TypedFilterValue
} from "./filter-algebra";
import {
  FACET_DESCRIPTORS,
  extractEvidenceFacets,
  type EvidenceFacetDescriptor,
  type EvidenceFacetKey,
  type EvidenceFacetContext
} from "./evidence-facets";
import type { EvidenceIdentity } from "./evidence-filter-contract";
import type { LightstreamerEventEnvelope } from "./event-envelope";

export type EvidenceFilterActionKind = "include" | "exclude" | "around";

/**
 * A typed, renderer-neutral action offered at an Evidence/Context decision
 * boundary. The facet descriptor and value are the identity; `label` is only
 * presentation text and is never used to reconstruct a mutation.
 */
export type EvidenceFilterActionDescriptor = Readonly<{
  id: string;
  kind: EvidenceFilterActionKind;
  label: string;
  facet?: EvidenceFacetKey;
  facetDescriptor?: EvidenceFacetDescriptor;
  value?: TypedFilterValue;
  anchor?: EvidenceIdentity;
  around?: FilterAround;
}>;

export type EvidenceFilterActionSource = Readonly<{
  identity?: EvidenceIdentity;
  timestamp?: number;
  retained?: boolean;
  retainedIntervalId?: string;
  pageId?: string;
  listenerOwner?: string;
}>;

/**
 * Builds all applicable actions for one immutable Evidence value. Around is
 * deliberately emitted only for a retained anchor in the current interval.
 */
export function createEvidenceFilterActionDescriptors(
  event: LightstreamerEventEnvelope,
  source: EvidenceFilterActionSource = {}
): readonly EvidenceFilterActionDescriptor[] {
  const context: EvidenceFacetContext = {
    ...(source.pageId === undefined ? {} : { pageId: source.pageId }),
    ...(source.listenerOwner === undefined ? {} : { listenerOwner: source.listenerOwner }),
    ...(source.identity === undefined ? {} : { identity: source.identity })
  };
  const extracted = extractEvidenceFacets(event, context);
  const actions: EvidenceFilterActionDescriptor[] = [];

  for (const descriptor of FACET_DESCRIPTORS) {
    const facetValue = extracted.facets[descriptor.key];
    if (!facetValue) continue;
    const value = createTypedFilterValue(
      facetValue.facet,
      facetValue.type,
      facetValue.value,
      facetValue.label
    );
    for (const kind of ["include", "exclude"] as const) {
      actions.push(Object.freeze({
        id: `filter:${kind}:${value.identity}`,
        kind,
        label: `${kind === "include" ? "Include" : "Exclude"} ${descriptor.label} ${value.label}`,
        facet: descriptor.key,
        facetDescriptor: descriptor,
        value
      }));
    }
  }

  const identity = source.identity;
  const timestamp = source.timestamp ?? event.timestamp;
  if (identity && source.retained === true && identity.intervalId &&
    (source.retainedIntervalId === undefined || source.retainedIntervalId === identity.intervalId) &&
    Number.isFinite(timestamp)) {
    const around = Object.freeze({
      intervalId: identity.intervalId,
      start: timestamp - 5_000,
      end: timestamp + 5_000
    });
    actions.push(Object.freeze({
      id: `filter:around:${identity.intervalId}:${identity.sequence}:${identity.eventId}`,
      kind: "around",
      label: "Around selected Evidence ±5 seconds",
      anchor: identity,
      around
    }));
  }

  return Object.freeze(actions);
}

/** Converts a typed contextual action into the canonical Filter algebra. */
export function filterMutationsForAction(action: EvidenceFilterActionDescriptor): readonly FilterMutation[] {
  if (action.kind === "around") {
    if (!action.around) throw new Error("Around action is missing its retained interval.");
    return Object.freeze([{ type: "set-around", around: action.around }]);
  }
  if (!action.facet || !action.value) throw new Error("Facet action is missing its typed value.");
  return Object.freeze([{
    type: "add-criterion",
    facet: action.facet,
    value: action.value,
    polarity: action.kind
  }]);
}
