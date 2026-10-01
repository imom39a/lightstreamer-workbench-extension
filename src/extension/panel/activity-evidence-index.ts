import type { LightstreamerEventEnvelope } from "../../core/event-envelope";
import { canonicalEvidenceSearchTextWithExtraction, extractEvidenceFacets } from "../../core/evidence-facets";
import type { ActivityScope, ActivityEvidence, ActivityProjectionInput } from "../../core/activity-projection";
import type { TopologySelectionTarget } from "./topology-view-model";

export function activityScopeFor(target: TopologySelectionTarget | null): ActivityScope {
  if (!target || target.kind === "page") return { kind: "PAGE" };
  if (target.kind === "client") return { kind: "CLIENT", clientId: target.client.id };
  if (target.kind === "session") return { kind: "SESSION", clientId: target.client.id, sessionId: target.session.id };
  if (target.kind === "subscription" || target.kind === "generation" || target.kind === "inferred-child") {
    return { kind: "SUBSCRIPTION", clientId: target.client?.id, sessionId: target.session?.id, subscriptionId: target.subscription.id };
  }
  if (target.kind === "item") {
    return { kind: "SUBSCRIPTION", clientId: target.client?.id, sessionId: target.session?.id, subscriptionId: target.subscription.id };
  }
  return { kind: "SUBSCRIPTION", clientId: target.client?.id, sessionId: target.session?.id, subscriptionId: target.subscription.id };
}

/** Builds the Activity-only metadata index without retaining update payloads. */
export function compactActivityEvidence(intervalId: string, sequence: number, event: LightstreamerEventEnvelope): ActivityEvidence {
  const client = event.client;
  const subscription = event.subscription;
  const listener = event.listener;
  const item = event.item;
  const update = event.update;
  const raw = compactActivityRaw(event.raw);
  const compact: LightstreamerEventEnvelope = Object.freeze({
    id: event.id,
    timestamp: event.timestamp,
    direction: event.direction,
    source: event.source,
    ...(event.captureSource ? { captureSource: event.captureSource } : {}),
    synthetic: event.synthetic,
    kind: event.kind,
    ...(event.logicalEventId ? { logicalEventId: event.logicalEventId } : {}),
    ...(client ? { client: Object.freeze({
      id: client.id,
      ...(client.status !== undefined ? { status: client.status } : {}),
      ...(client.sessionId !== undefined ? { sessionId: client.sessionId } : {}),
      ...(client.requestedMaxBandwidth !== undefined ? { requestedMaxBandwidth: client.requestedMaxBandwidth } : {}),
      ...(client.realMaxBandwidth !== undefined ? { realMaxBandwidth: client.realMaxBandwidth } : {}),
      ...(client.semanticValueStates ? { semanticValueStates: compactSemanticStates(client.semanticValueStates, ["id", "sessionId"]) } : {})
    }) } : {}),
    ...(subscription ? { subscription: Object.freeze({
      id: subscription.id,
      ...(subscription.mode !== undefined ? { mode: subscription.mode } : {}),
      ...(subscription.requestedMaxFrequency !== undefined ? { requestedMaxFrequency: subscription.requestedMaxFrequency } : {}),
      ...(subscription.realMaxFrequency !== undefined ? { realMaxFrequency: subscription.realMaxFrequency } : {}),
      ...(subscription.semanticValueStates ? { semanticValueStates: compactSemanticStates(subscription.semanticValueStates, ["id", "mode"]) } : {})
    }) } : {}),
    ...(listener ? { listener: Object.freeze({ id: listener.id, ...(listener.metricOwner !== undefined ? { metricOwner: listener.metricOwner } : {}) }) } : {}),
    ...(item ? { item: Object.freeze({ ...(item.name !== undefined ? { name: item.name } : {}), ...(item.position !== undefined ? { position: item.position } : {}) }) } : {}),
    ...(update ? { update: Object.freeze({
      ...(update.isSnapshot !== undefined ? { isSnapshot: update.isSnapshot } : {}),
      ...(update.command !== undefined ? { command: update.command } : {}),
      ...(update.key !== undefined ? { key: update.key } : {}),
      ...(update.lostUpdates !== undefined ? { lostUpdates: update.lostUpdates } : {})
    }) } : {}),
    ...(raw ? { raw } : {}),
    ...(event.topology ? { topology: compactActivityTopology(event.topology) } : {})
  });
  const identity = { intervalId, pageId: intervalId, ownerId: event.subscription?.id ?? event.client?.id ?? "page", sequence, eventId: event.id };
  const extracted = extractEvidenceFacets(event, { identity });
  return Object.freeze({
    intervalId,
    sequence,
    event: compact,
    filterRecord: Object.freeze({
      timestamp: event.timestamp,
      intervalId,
      searchText: canonicalEvidenceSearchTextWithExtraction(event, { identity }, extracted),
      facets: extracted.facets
    })
  });
}

function compactSemanticStates(
  states: NonNullable<LightstreamerEventEnvelope["client"]>["semanticValueStates"],
  keys: readonly string[]
): Record<string, NonNullable<NonNullable<LightstreamerEventEnvelope["client"]>["semanticValueStates"]>[string]> {
  return Object.freeze(Object.fromEntries(keys.flatMap((key) => states?.[key] ? [[key, Object.freeze({ ...states[key] })]] : [])));
}

function compactActivityRaw(raw: LightstreamerEventEnvelope["raw"]): LightstreamerEventEnvelope["raw"] | undefined {
  if (!raw) return undefined;
  const selected = Object.fromEntries(["status", "code", "message"].flatMap((key) => {
    const value = raw[key];
    return typeof value === "string" || typeof value === "number" ? [[key, value]] : [];
  }));
  return Object.keys(selected).length ? Object.freeze(selected) as LightstreamerEventEnvelope["raw"] : undefined;
}

function compactActivityTopology(topology: NonNullable<LightstreamerEventEnvelope["topology"]>): NonNullable<LightstreamerEventEnvelope["topology"]> {
  return Object.freeze({
    version: topology.version,
    kind: topology.kind,
    pageEpoch: topology.pageEpoch,
    captureSequence: topology.captureSequence,
    ...(topology.timestamp === undefined ? {} : { timestamp: topology.timestamp }),
    provenance: topology.provenance,
    coverage: Object.freeze({ status: topology.coverage.status, getters: {} }),
    ...(topology.client ? { client: compactActivityTopologyRecord(topology.client, ["id", "sessionId", "status"]) } : {}),
    ...(topology.subscription ? { subscription: compactActivityTopologyRecord(topology.subscription, ["id"]) } : {}),
    ...(topology.item ? { item: compactActivityTopologyRecord(topology.item, ["name", "position"]) } : {})
  }) as NonNullable<LightstreamerEventEnvelope["topology"]>;
}

function compactActivityTopologyRecord(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.freeze(Object.fromEntries(keys.flatMap((key) => record[key] === undefined ? [] : [[key, record[key]]])));
}

export function activityProjectionCacheKey(revision: number, input: ActivityProjectionInput): string {
  const boundary = input.readPoint.committedEvidenceBoundary;
  const range = input.readPoint.retainedRange;
  return JSON.stringify([
    revision,
    input.scope,
    input.filter.revision,
    boundary?.intervalId ?? null,
    boundary?.sequence ?? null,
    range?.first.timestamp ?? null,
    range?.first.sequence ?? null,
    range?.last.timestamp ?? null,
    range?.last.sequence ?? null,
    input.readPoint.coverage,
    input.readPoint.terminal,
    input.coherent !== false
  ]);
}
