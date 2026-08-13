import { type CaptureKind } from "../bridge/messages";
import { type LightstreamerEventEnvelope } from "./event-envelope";
import { canonicalFilterFromLegacyScalars, type Filter, type LegacyScalarFilter } from "./filter-algebra";
import { canonicalEvidenceSearchText } from "./evidence-facets";

export type EventFilterState = {
  query?: string;
  clientId?: string | null;
  sessionId?: string | null;
  subscriptionId?: string;
  mode?: string;
  item?: string;
  itemPosition?: number;
  key?: string;
  command?: string;
  snapshot?: boolean;
  synthetic?: boolean;
  kind?: CaptureKind;
  listenerId?: string;
};

/**
 * Temporary scalar delegation for compatibility authors. New Evidence
 * criteria must not be silently translated into this Build 1 shape; the
 * canonical facet catalog owns that boundary in filter-impl-03.
 */
export function toCanonicalFilter(filters: EventFilterState = {}, revision = 1): Filter {
  return canonicalFilterFromLegacyScalars(filters satisfies LegacyScalarFilter, revision);
}

export function createEventSearchText(event: LightstreamerEventEnvelope): string {
  return canonicalEvidenceSearchText(event);
}

export function matchesEventFilters(
  event: LightstreamerEventEnvelope,
  filters: EventFilterState = {}
): boolean {
  if (filters.query && !createEventSearchText(event).includes(filters.query.trim().toLowerCase())) {
    return false;
  }

  if (filters.subscriptionId && event.subscription?.id !== filters.subscriptionId) {
    return false;
  }

  if (
    filters.clientId !== undefined &&
    (event.client?.id ?? null) !== filters.clientId
  ) {
    return false;
  }

  if (
    filters.sessionId !== undefined &&
    (event.client?.sessionId ?? null) !== filters.sessionId
  ) {
    return false;
  }

  if (filters.listenerId && event.listener?.id !== filters.listenerId) {
    return false;
  }

  if (filters.mode && event.subscription?.mode !== filters.mode) {
    return false;
  }

  if (filters.item && event.item?.name !== filters.item) {
    return false;
  }

  if (
    filters.itemPosition !== undefined &&
    event.item?.position !== filters.itemPosition
  ) {
    return false;
  }

  if (filters.key && event.update?.key !== filters.key) {
    return false;
  }

  if (filters.command && event.update?.command !== filters.command) {
    return false;
  }

  if (filters.snapshot !== undefined && Boolean(event.update?.isSnapshot) !== filters.snapshot) {
    return false;
  }

  if (filters.synthetic !== undefined && event.synthetic !== filters.synthetic) {
    return false;
  }

  if (filters.kind && event.kind !== filters.kind) {
    return false;
  }

  return true;
}

export function filterEvents(
  events: readonly LightstreamerEventEnvelope[],
  filters: EventFilterState = {}
): LightstreamerEventEnvelope[] {
  return events.filter((event) => matchesEventFilters(event, filters));
}

export function hasActiveFilters(filters: EventFilterState): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== "");
}
