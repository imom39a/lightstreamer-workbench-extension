import { type CaptureKind } from "../bridge/messages";
import { type LightstreamerEventEnvelope } from "./event-envelope";

export type EventFilterState = {
  query?: string;
  subscriptionId?: string;
  mode?: string;
  item?: string;
  key?: string;
  command?: string;
  snapshot?: boolean;
  synthetic?: boolean;
  kind?: CaptureKind;
};

export function createEventSearchText(event: LightstreamerEventEnvelope): string {
  return [
    event.id,
    event.kind,
    event.source,
    event.synthetic ? "synthetic" : "server",
    event.direction,
    event.client?.id,
    event.client?.status,
    event.client?.serverAddress,
    event.client?.adapterSet,
    event.subscription?.id,
    event.subscription?.mode,
    event.subscription?.itemGroup,
    event.subscription?.items?.join(" "),
    event.subscription?.fieldSchema,
    event.subscription?.fields?.join(" "),
    event.subscription?.dataAdapter,
    event.listener?.id,
    event.item?.name,
    event.item?.position,
    event.update?.isSnapshot ? "snapshot" : "live",
    event.update?.command,
    event.update?.key,
    fieldsText(event.update?.fields),
    fieldsText(event.update?.changedFields),
    fieldsText(event.update?.jsonPatches),
    JSON.stringify(event)
  ]
    .filter((entry) => entry !== undefined && entry !== null && entry !== "")
    .join(" ")
    .toLowerCase();
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

  if (filters.mode && event.subscription?.mode !== filters.mode) {
    return false;
  }

  if (filters.item && event.item?.name !== filters.item) {
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

function fieldsText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  return Object.entries(value)
    .flatMap(([key, entry]) => [key, String(entry)])
    .join(" ");
}
