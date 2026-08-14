import type { ActivityEvidence, ActivityReadPoint, ActivityScope } from "../../src/core/activity-projection";
import { createTypedFilterValue, type Filter } from "../../src/core/filter-algebra";
import type { LightstreamerEventEnvelope } from "../../src/core/event-envelope";

export const ACTIVITY_CAPACITY_RECORD_COUNT = 10_000;
export const ACTIVITY_CAPACITY_SERVER_RECORD_COUNT = 9_400;
export const ACTIVITY_CAPACITY_LOCAL_RECORD_COUNT = 300;
export const ACTIVITY_CAPACITY_LOSS_RECORD_COUNT = 100;
export const ACTIVITY_CAPACITY_ERROR_RECORD_COUNT = 100;
export const ACTIVITY_CAPACITY_STATUS_RECORD_COUNT = 100;
export const ACTIVITY_CAPACITY_INTERVAL_ID = "activity-capacity-interval-1";
export const ACTIVITY_CAPACITY_BASE_TIMESTAMP = Date.UTC(2026, 0, 15, 12, 0, 0);

const SERVER_CANONICAL_COUNT = 8_000;
const SERVER_FANOUT_COUNT = 1_000;
const SERVER_METRIC_OWNER_COUNT = 400;
const LOCAL_CANONICAL_COUNT = 240;
const LOCAL_FANOUT_COUNT = 60;
const CLIENT_COUNT = 4;
const SESSION_EPOCHS_PER_CLIENT = 2;

export type ActivityCapacityWorkload = Readonly<{
  evidence: readonly ActivityEvidence[];
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
}>;

export type ActivityCapacityBucketTotal = Readonly<{
  segment: number;
  start: number;
  end: number;
  logicalUpdates: number;
  snapshotLogicalUpdates: number;
  liveLogicalUpdates: number;
  updateDeliveries: number;
  localLogicalUpdates: number;
  localUpdateDeliveries: number;
}>;

export type ActivityCapacityOracle = Readonly<{
  matchingEvidence: number;
  serverRecords: number;
  localRecords: number;
  logicalUpdates: number;
  snapshotLogicalUpdates: number;
  liveLogicalUpdates: number;
  updateDeliveries: number;
  localLogicalUpdates: number;
  localUpdateDeliveries: number;
  markerCounts: Readonly<Record<"client-status" | "lost-updates" | "subscription-error", number>>;
  clientIds: readonly string[];
  sessionIds: readonly string[];
  rankingCount: number;
  topRankingLogicalUpdates: number;
  topRankingDeliveryCount: number;
  otherRankingLogicalUpdates: number;
  otherRankingDeliveryCount: number;
  buckets: readonly ActivityCapacityBucketTotal[];
}>;

export function createActivityCapacityWorkload(): ActivityCapacityWorkload {
  const evidence = Object.freeze(Array.from({ length: ACTIVITY_CAPACITY_RECORD_COUNT }, (_, offset) => {
    const sequence = offset + 1;
    return Object.freeze({ intervalId: ACTIVITY_CAPACITY_INTERVAL_ID, sequence, event: createEvent(sequence) });
  }));
  return Object.freeze({
    evidence,
    scope: Object.freeze({ kind: "PAGE" as const }),
    filter: emptyFilter(),
    readPoint: createActivityCapacityReadPoint(evidence)
  });
}

export function createActivityCapacityReadPoint(
  evidence: readonly ActivityEvidence[],
  options: Readonly<{ coverage?: ActivityReadPoint["coverage"]; terminal?: boolean }> = {}
): ActivityReadPoint {
  const first = evidence[0];
  const last = evidence.at(-1);
  return Object.freeze({
    intervalId: ACTIVITY_CAPACITY_INTERVAL_ID,
    committedEvidenceBoundary: last
      ? Object.freeze({ intervalId: ACTIVITY_CAPACITY_INTERVAL_ID, sequence: last.sequence, eventId: last.event.id })
      : null,
    retainedRange: first && last
      ? Object.freeze({
          first: Object.freeze({ timestamp: first.event.timestamp, sequence: first.sequence }),
          last: Object.freeze({ timestamp: last.event.timestamp, sequence: last.sequence })
        })
      : null,
    coverage: options.coverage ?? "USEFUL",
    terminal: options.terminal ?? false
  });
}

export function createActivityCapacityCompoundFilter(around: Filter["around"]): Filter {
  const server = createTypedFilterValue("provenance", "enum", "SERVER");
  const itemUpdate = createTypedFilterValue("kind", "enum", "item-update");
  return Object.freeze({
    version: 1,
    revision: 2,
    text: "",
    criteria: Object.freeze({
      kind: Object.freeze({ include: Object.freeze([itemUpdate]), exclude: Object.freeze([]) }),
      provenance: Object.freeze({ include: Object.freeze([server]), exclude: Object.freeze([]) })
    }),
    around,
    unsupported: Object.freeze([])
  });
}

export function reduceActivityCapacity(
  evidence: readonly ActivityEvidence[],
  scope: ActivityScope,
  filter: Filter,
  readPoint: ActivityReadPoint,
  bucketDuration: number | null = null
): ActivityCapacityOracle {
  const matching = evidence.filter((entry) => belongsToScope(entry.event, scope) && passesFilter(entry.event, entry.intervalId, filter));
  const server = matching.filter((entry) => isItemUpdate(entry.event) && entry.event.source === "server" && !entry.event.synthetic);
  const local = matching.filter((entry) => isItemUpdate(entry.event) && (entry.event.source === "synthetic" || entry.event.synthetic));
  const serverLogical = uniqueLogical(server);
  const localLogical = uniqueLogical(local);
  const markerCounts = {
    "client-status": matching.filter(({ event }) => event.kind === "client-status").length,
    "lost-updates": matching.filter(({ event }) => event.kind === "lost-updates").length,
    "subscription-error": matching.filter(({ event }) => event.kind === "subscription-error").length
  } as const;
  const rankingCounts = new Map<string, { logicalUpdates: number; updateDeliveries: number }>();
  for (const entry of serverLogical) {
    const id = entry.event.subscription?.id ?? "<unknown-subscription>";
    const current = rankingCounts.get(id) ?? { logicalUpdates: 0, updateDeliveries: 0 };
    current.logicalUpdates += 1;
    rankingCounts.set(id, current);
  }
  for (const entry of server) {
    if (!entry.event.listener) continue;
    const id = entry.event.subscription?.id ?? "<unknown-subscription>";
    const current = rankingCounts.get(id) ?? { logicalUpdates: 0, updateDeliveries: 0 };
    current.updateDeliveries += 1;
    rankingCounts.set(id, current);
  }
  const rankings = [...rankingCounts.values()].sort((left, right) => right.logicalUpdates - left.logicalUpdates);
  const bucketResult = bucketDuration === null ? [] : reduceBuckets(serverLogical, localLogical, matching, readPoint, bucketDuration);
  return Object.freeze({
    matchingEvidence: matching.length,
    serverRecords: server.length,
    localRecords: local.length,
    logicalUpdates: serverLogical.length,
    snapshotLogicalUpdates: serverLogical.filter(({ event }) => event.update?.isSnapshot === true).length,
    liveLogicalUpdates: serverLogical.filter(({ event }) => event.update?.isSnapshot !== true).length,
    updateDeliveries: server.filter(({ event }) => Boolean(event.listener)).length,
    localLogicalUpdates: localLogical.length,
    localUpdateDeliveries: local.filter(({ event }) => Boolean(event.listener)).length,
    markerCounts,
    clientIds: uniqueIds(matching.map(({ event }) => event.client?.id)),
    sessionIds: uniqueIds(matching.map(({ event }) => event.client?.sessionId)),
    rankingCount: rankings.length,
    topRankingLogicalUpdates: rankings.slice(0, 10).reduce((total, value) => total + value.logicalUpdates, 0),
    topRankingDeliveryCount: rankings.slice(0, 10).reduce((total, value) => total + value.updateDeliveries, 0),
    otherRankingLogicalUpdates: rankings.slice(10).reduce((total, value) => total + value.logicalUpdates, 0),
    otherRankingDeliveryCount: rankings.slice(10).reduce((total, value) => total + value.updateDeliveries, 0),
    buckets: Object.freeze(bucketResult)
  });
}

function createEvent(sequence: number): LightstreamerEventEnvelope {
  const offset = sequence - 1;
  const clientIndex = offset % CLIENT_COUNT;
  const epoch = Math.floor(offset / CLIENT_COUNT) % SESSION_EPOCHS_PER_CLIENT + 1;
  const clientId = `client-${clientIndex + 1}`;
  const sessionId = `${clientId}-session-${epoch}`;
  const subscriptionId = `${clientId}-${sessionId}-subscription-${offset % 6 + 1}`;
  const itemName = `item-${offset % 3 + 1}`;
  const timestamp = activityTimestamp(offset);
  const common = {
    id: `activity-capacity-event-${String(sequence).padStart(5, "0")}`,
    timestamp,
    direction: "inbound" as const,
    source: "server" as const,
    synthetic: false,
    kind: "item-update" as const,
    client: { id: clientId, sessionId },
    subscription: { id: subscriptionId, mode: "MERGE", requestedMaxFrequency: 4, realMaxFrequency: 2 },
    item: { name: itemName, position: offset % 3 + 1 }
  };
  if (offset < ACTIVITY_CAPACITY_SERVER_RECORD_COUNT) {
    const isMetricOwner = offset >= SERVER_CANONICAL_COUNT + SERVER_FANOUT_COUNT;
    const logicalEventId = offset < SERVER_CANONICAL_COUNT
      ? `server-logical-${offset + 1}`
      : offset < SERVER_CANONICAL_COUNT + SERVER_FANOUT_COUNT
        ? `server-logical-${offset % 500 + 1}`
        : undefined;
    const listener = isMetricOwner
      ? { id: `metric-owner-${offset - SERVER_CANONICAL_COUNT - SERVER_FANOUT_COUNT + 1}`, metricOwner: true }
      : offset % 5 === 0
        ? undefined
        : { id: `server-listener-${offset % 8 + 1}`, metricOwner: offset < SERVER_CANONICAL_COUNT };
    return { ...common, logicalEventId, listener, item: isMetricOwner ? { name: `metric-item-${offset + 1}`, position: offset % 3 + 1 } : common.item, update: { isSnapshot: offset < 2_000 } };
  }
  if (offset < ACTIVITY_CAPACITY_SERVER_RECORD_COUNT + ACTIVITY_CAPACITY_LOCAL_RECORD_COUNT) {
    const localOffset = offset - ACTIVITY_CAPACITY_SERVER_RECORD_COUNT;
    return {
      ...common,
      source: "synthetic",
      synthetic: true,
      logicalEventId: localOffset < LOCAL_CANONICAL_COUNT ? `local-logical-${localOffset + 1}` : `local-logical-${localOffset % 30 + 1}`,
      listener: localOffset % 5 === 0 ? undefined : { id: `local-listener-${localOffset % 4 + 1}` },
      update: { isSnapshot: localOffset < 60 }
    };
  }
  if (offset < ACTIVITY_CAPACITY_SERVER_RECORD_COUNT + ACTIVITY_CAPACITY_LOCAL_RECORD_COUNT + ACTIVITY_CAPACITY_LOSS_RECORD_COUNT) {
    return { ...common, kind: "lost-updates", update: { lostUpdates: offset - 9_700 + 1 } };
  }
  if (offset < ACTIVITY_CAPACITY_SERVER_RECORD_COUNT + ACTIVITY_CAPACITY_LOCAL_RECORD_COUNT + ACTIVITY_CAPACITY_LOSS_RECORD_COUNT + ACTIVITY_CAPACITY_ERROR_RECORD_COUNT) {
    return { ...common, kind: "subscription-error", raw: { code: 400 + offset - 9_800, message: "deterministic subscription error" } };
  }
  return { ...common, kind: "client-status", client: { ...common.client, status: offset % 2 === 0 ? "CONNECTED" : "DISCONNECTED" } };
}

function activityTimestamp(offset: number): number {
  if (offset < 5_000) return ACTIVITY_CAPACITY_BASE_TIMESTAMP + Math.floor(offset / 40) * 1_000;
  return ACTIVITY_CAPACITY_BASE_TIMESTAMP + 5_000 + Math.floor((offset - 5_000) / 40) * 1_000;
}

function emptyFilter(): Filter {
  return Object.freeze({ version: 1, revision: 1, text: "", criteria: Object.freeze({}), around: null, unsupported: Object.freeze([]) });
}

function belongsToScope(event: LightstreamerEventEnvelope, scope: ActivityScope): boolean {
  if (scope.kind === "PAGE") return true;
  if (scope.clientId !== undefined && event.client?.id !== scope.clientId) return false;
  if (scope.kind === "CLIENT") return true;
  if (scope.sessionId !== undefined && event.client?.sessionId !== scope.sessionId) return false;
  if (scope.kind === "SESSION") return true;
  if (scope.subscriptionId !== undefined && event.subscription?.id !== scope.subscriptionId) return false;
  if (scope.kind === "SUBSCRIPTION") return true;
  if (scope.item !== undefined && event.item?.name !== scope.item) return false;
  if (scope.itemPosition !== undefined && event.item?.position !== scope.itemPosition) return false;
  return scope.kind === "ITEM" || scope.kind === "LISTENER";
}

function passesFilter(event: LightstreamerEventEnvelope, intervalId: string, filter: Filter): boolean {
  if (filter.unsupported.length > 0) return false;
  if (filter.text && !`${event.id} ${event.kind} ${event.source}`.toLowerCase().includes(filter.text.toLowerCase())) return false;
  if (filter.around && (filter.around.intervalId !== intervalId || event.timestamp < filter.around.start || event.timestamp >= filter.around.end)) return false;
  for (const [facet, criterion] of Object.entries(filter.criteria)) {
    const observed = facet === "kind" ? event.kind.toUpperCase() : facet === "provenance" ? event.synthetic || event.source === "synthetic" ? "LOCAL" : "SERVER" : null;
    if (criterion.include.length > 0 && (!observed || !criterion.include.some((value) => String(value.value) === observed))) return false;
    if (observed && criterion.exclude.some((value) => String(value.value) === observed)) return false;
  }
  return true;
}

function isItemUpdate(event: LightstreamerEventEnvelope): boolean { return event.kind === "item-update"; }

function uniqueLogical(entries: readonly ActivityEvidence[]): ActivityEvidence[] {
  const identities = new Set<string>();
  const result: ActivityEvidence[] = [];
  for (const entry of entries) {
    const event = entry.event;
    const identity = event.logicalEventId
      ? `logical:${event.logicalEventId}`
      : event.listener?.metricOwner === true
        ? `owner:${event.subscription?.id ?? "?"}:${event.item?.name ?? event.item?.position ?? "?"}:${event.timestamp}`
        : null;
    if (identity && !identities.has(identity)) {
      identities.add(identity);
      result.push(entry);
    }
  }
  return result;
}

function uniqueIds(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function reduceBuckets(
  serverLogical: readonly ActivityEvidence[],
  localLogical: readonly ActivityEvidence[],
  matching: readonly ActivityEvidence[],
  readPoint: ActivityReadPoint,
  duration: number
): ActivityCapacityBucketTotal[] {
  const ordered = [...serverLogical, ...localLogical].sort((left, right) => left.sequence - right.sequence);
  const segments: ActivityEvidence[][] = [];
  for (const entry of ordered) {
    const previous = segments.at(-1)?.at(-1);
    if (previous && entry.event.timestamp < previous.event.timestamp) segments.push([entry]);
    else if (segments.length) segments.at(-1)!.push(entry);
    else segments.push([entry]);
  }
  return segments.flatMap((segmentEntries, segment) => {
    const observedFirst = Math.min(...segmentEntries.map(({ event }) => event.timestamp));
    const observedLast = Math.max(...segmentEntries.map(({ event }) => event.timestamp));
    const includes = (sequence: number) => sequence >= segmentEntries[0]!.sequence && sequence <= segmentEntries.at(-1)!.sequence;
    const usesRetainedRange = segments.length === 1 || (readPoint.retainedRange !== null && (includes(readPoint.retainedRange.first.sequence) || includes(readPoint.retainedRange.last.sequence)));
    const retainedFirst = readPoint.retainedRange && usesRetainedRange && (segments.length === 1 || includes(readPoint.retainedRange.first.sequence)) ? readPoint.retainedRange.first.timestamp : observedFirst;
    const retainedLast = readPoint.retainedRange && usesRetainedRange && (segments.length === 1 || includes(readPoint.retainedRange.last.sequence)) ? readPoint.retainedRange.last.timestamp : observedLast;
    const first = Math.floor(Math.min(observedFirst, retainedFirst) / duration) * duration;
    const count = Math.max(1, Math.ceil((Math.max(observedLast, retainedLast) - first + 1) / duration));
    return Array.from({ length: count }, (_, index) => {
      const start = first + index * duration;
      const end = start + duration;
      const inSegment = (entry: ActivityEvidence) => entry.sequence >= segmentEntries[0]!.sequence && entry.sequence <= segmentEntries.at(-1)!.sequence;
      const inBucket = (entry: ActivityEvidence) => inSegment(entry) && entry.event.timestamp >= start && entry.event.timestamp < end;
      return { segment, start, end, logicalUpdates: serverLogical.filter(inBucket).length, snapshotLogicalUpdates: serverLogical.filter((entry) => inBucket(entry) && entry.event.update?.isSnapshot === true).length, liveLogicalUpdates: serverLogical.filter((entry) => inBucket(entry) && entry.event.update?.isSnapshot !== true).length, updateDeliveries: matching.filter((entry) => inBucket(entry) && entry.event.kind === "item-update" && entry.event.source === "server" && !entry.event.synthetic && Boolean(entry.event.listener)).length, localLogicalUpdates: localLogical.filter(inBucket).length, localUpdateDeliveries: matching.filter((entry) => inBucket(entry) && entry.event.kind === "item-update" && (entry.event.source === "synthetic" || entry.event.synthetic) && Boolean(entry.event.listener)).length };
    });
  });
}
