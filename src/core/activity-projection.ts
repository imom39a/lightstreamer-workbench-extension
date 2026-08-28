import { type LightstreamerEventEnvelope } from "./event-envelope";
import { extractEvidenceFacets } from "./evidence-facets";
import { createTypedFilterValue, type Filter, type FilterMutation, evaluateFilter, type FilterRecord } from "./filter-algebra";

export type ActivityScope = Readonly<{
  kind: "PAGE" | "CLIENT" | "SESSION" | "SUBSCRIPTION" | "ITEM" | "LISTENER";
  clientId?: string | null;
  sessionId?: string | null;
  subscriptionId?: string | null;
  item?: string | null;
  itemPosition?: number | null;
  listenerId?: string | null;
}>;

export type ActivityEvidence = Readonly<{
  intervalId: string;
  sequence: number;
  event: LightstreamerEventEnvelope;
  /** Canonical Evidence Filter data computed at acceptance, before payload release. */
  filterRecord?: FilterRecord;
}>;

export type ActivityReadPoint = Readonly<{
  intervalId: string;
  committedEvidenceBoundary: Readonly<{ intervalId: string; sequence: number; eventId: string }> | null;
  retainedRange: Readonly<{ first: Readonly<{ timestamp: number; sequence: number }>; last: Readonly<{ timestamp: number; sequence: number }> }> | null;
  coverage: "USEFUL" | "LIMITED" | "UNAVAILABLE";
  terminal: boolean;
}>;

export type ActivityState = "LOADING" | "AVAILABLE" | "EMPTY_MATCH" | "EMPTY_INTERVAL" | "LIMITED" | "UNAVAILABLE" | "AGGREGATION_FAILED";
export type ActivityCoverage = ActivityReadPoint["coverage"];

export type ActivityMarker = Readonly<{
  kind: "CLIENT_STATUS" | "SESSION_TRANSITION" | "LOST_UPDATES" | "SUBSCRIPTION_ERROR";
  timestamp: number;
  sequence: number;
  eventId: string;
  label: string;
  reportedCount: number | null;
  clientId: string | null;
  sessionId: string | null;
  subscriptionId: string | null;
  itemName: string | null;
  itemPosition: number | null;
  status: string | null;
  errorCode: string | number | null;
  errorMessage: string | null;
  provenance: "SERVER" | "LOCAL";
  consequenceLimit: string;
  supportingFilterMutations?: readonly FilterMutation[];
}>;

export const MAX_ACTIVITY_CONNECTION_LANES = 5;

export type ActivityConnectionSession = Readonly<{
  sessionId: string | null;
  label: string;
  firstTimestamp: number;
  latestTimestamp: number;
  status: string | null;
  supportingFilterMutations: readonly FilterMutation[];
}>;

export type ActivityConnectionLane = Readonly<{
  clientId: string;
  label: string;
  latestTimestamp: number;
  sessions: readonly ActivityConnectionSession[];
  markers: readonly ActivityMarker[];
  supportingFilterMutations: readonly FilterMutation[];
}>;

export type ActivityConnectionOverflow = Readonly<{
  label: "Other clients";
  clientIds: readonly string[];
  latestTimestamp: number;
  supportingFilterMutations: readonly FilterMutation[];
}>;

export type ActivityContextFact = Readonly<{
  key: "REQUESTED_MAX_BANDWIDTH" | "REAL_MAX_BANDWIDTH" | "REQUESTED_MAX_FREQUENCY" | "REAL_MAX_FREQUENCY";
  label: string;
  values: readonly Readonly<{ value: string; timestamp: number }>[];
  plotValues: readonly Readonly<{ value: number; timestamp: number }>[];
}>;

export type ActivityExcludedLayer = Readonly<{
  layer: "CONNECTION" | "LOSS" | "ERROR";
  label: "Connection transitions" | "Lost updates" | "Subscription errors";
  filterMutations: readonly FilterMutation[];
}>;

export type ActivityBucket = Readonly<{
  id: string;
  start: number;
  end: number;
  logicalUpdates: number;
  snapshotLogicalUpdates: number;
  liveLogicalUpdates: number;
  updateDeliveries: number;
  localLogicalUpdates: number;
  localUpdateDeliveries: number;
  firstPartial: boolean;
  currentPartial: boolean;
  finalPartial: boolean;
  segment: number;
}>;

/**
 * A bounded exact-time summary of one contiguous snapshot run. Bucket bounds
 * remain density geometry; these bounds are the actual captured timestamps
 * used when a renderer offers a snapshot range to Evidence.
 */
export type ActivitySnapshotBurst = Readonly<{
  start: number;
  end: number;
  logicalUpdates: number;
  segment: number;
}>;

export type ActivityTimeline = Readonly<{
  /** Earliest retained Evidence timestamp; this is not a Capture-start claim. */
  originTimestamp: number | null;
  /** Stable retained-domain bounds for elapsed-time geometry, half-open. */
  domain: ActivityTimeRange | null;
  /** Exact matching update bounds, half-open, independent from density buckets. */
  matchingRange: ActivityTimeRange | null;
  snapshotBursts: readonly ActivitySnapshotBurst[];
  snapshotBurstsTruncated: boolean;
  /** More than one segment means elapsed duration is ambiguous across a clock regression. */
  clockAmbiguous: boolean;
}>;

export type ActivityRanking = Readonly<{
  identity: string;
  label: string;
  logicalUpdates: number;
  updateDeliveries: number;
  range?: ActivityTimeRange | null;
  rangeReason?: string | null;
  subscriptionId?: string | null;
  itemName?: string | null;
  itemPosition?: number | null;
  supportingFilterMutations?: readonly FilterMutation[];
}>;

export type ActivityProjection = Readonly<{
  state: ActivityState;
  reason: string | null;
  scope: ActivityScope;
  filterRevision: number;
  readPoint: ActivityReadPoint;
  /** False while the current interval's accepted-Evidence feed is synchronizing. */
  coherent?: boolean;
  intervalId: string;
  retainedRange: ActivityReadPoint["retainedRange"];
  committedEvidenceBoundary: ActivityReadPoint["committedEvidenceBoundary"];
  bucketDuration: number | null;
  buckets: readonly ActivityBucket[];
  timeline: ActivityTimeline;
  logicalUpdateTotal: number;
  snapshotLogicalUpdateTotal: number;
  liveLogicalUpdateTotal: number;
  updateDeliveryTotal: number;
  localLogicalUpdateTotal: number;
  localUpdateDeliveryTotal: number;
  matchingEvidence: number;
  emptyMatchCause: "FILTER_EXCLUSION" | "NO_MATCHING_EVIDENCE" | null;
  markers: readonly ActivityMarker[];
  rankings: readonly ActivityRanking[];
  allRankings: readonly ActivityRanking[];
  rankingOther: ActivityRanking | null;
  rankingRangeReason: string | null;
  clockSegments: readonly Readonly<{ index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }>[];
  connectionLanes: readonly ActivityConnectionLane[];
  connectionOverflow: ActivityConnectionOverflow | null;
  contextFacts: readonly ActivityContextFact[];
  excludedLayers: readonly ActivityExcludedLayer[];
}>;

export type ActivityProjectionInput = Readonly<{
  evidence: readonly ActivityEvidence[];
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
  /** False while the current interval's accepted-Evidence feed is synchronizing. */
  coherent?: boolean;
  /** Test/diagnostic hook; production callers should let aggregation errors surface. */
  aggregate?: ((evidence: readonly ActivityEvidence[]) => void) | null;
}>;

export type ActivityTimeRange = Readonly<{ start: number; end: number }>;

/** Clips a user-selected half-open interval to the retained timestamp range. */
export function clipActivityTimeRange(
  range: ActivityTimeRange,
  retainedRange: ActivityReadPoint["retainedRange"]
): ActivityTimeRange | null {
  if (!retainedRange) return null;
  const start = Math.max(range.start, retainedRange.first.timestamp);
  const end = Math.min(range.end, retainedRange.last.timestamp + 1);
  return start < end ? { start, end } : null;
}

export const MAX_ACTIVITY_BUCKETS = 120;
const DURATIONS = Object.freeze([1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 14_400_000, 86_400_000]);
export const MAX_ACTIVITY_SNAPSHOT_BURSTS = 64;

export function createActivityProjection(input: ActivityProjectionInput): ActivityProjection {
  return project(input);
}

export function rebuildActivityProjection(input: ActivityProjectionInput): ActivityProjection {
  return project(input);
}

/** Creates a truthful renderer-safe failure projection after an unexpected aggregation error. */
export function failedActivityProjection(
  input: Pick<ActivityProjectionInput, "scope" | "filter" | "readPoint">,
  reason: string
): ActivityProjection {
  return Object.freeze({
    ...emptyProjection(input.scope, input.filter.revision, input.readPoint),
    state: "AGGREGATION_FAILED",
    reason
  });
}

/** An actual incremental accumulator: accepted entries are indexed once and never replayed by append. */
export type ActivityAccumulator = Readonly<{
  append(entry: ActivityEvidence, readPoint?: ActivityReadPoint): ActivityProjection;
  snapshot(): ActivityProjection;
}>;

export function createActivityAccumulator(base: Omit<ActivityProjectionInput, "evidence"> & { evidence?: readonly ActivityEvidence[] }): ActivityAccumulator {
  const entries = new Map<number, ActivityEvidence>();
  for (const entry of base.evidence ?? []) entries.set(entry.sequence, entry);
  let currentReadPoint = base.readPoint;
  let current = project({ ...base, evidence: [...entries.values()], readPoint: currentReadPoint });
  return {
    append(entry, readPoint = currentReadPoint) {
      if (!entries.has(entry.sequence)) entries.set(entry.sequence, entry);
      currentReadPoint = readPoint;
      current = project({ ...base, evidence: [...entries.values()], readPoint: currentReadPoint });
      return current;
    },
    snapshot() { return current; }
  };
}

export function appendActivityEvidence(input: ActivityProjectionInput, accepted: readonly ActivityEvidence[], readPoint = input.readPoint): ActivityProjection {
  const accumulator = createActivityAccumulator(input);
  let result = accumulator.snapshot();
  for (const entry of accepted) result = accumulator.append(entry, readPoint);
  return result;
}

export function sortActivityRankings(
  rankings: readonly ActivityRanking[],
  sort: "LOGICAL_UPDATES" | "UPDATE_DELIVERIES"
): readonly ActivityRanking[] {
  return [...rankings].sort((left, right) => {
    const leftValue = sort === "LOGICAL_UPDATES" ? left.logicalUpdates : left.updateDeliveries;
    const rightValue = sort === "LOGICAL_UPDATES" ? right.logicalUpdates : right.updateDeliveries;
    return rightValue - leftValue || left.identity.localeCompare(right.identity);
  });
}

function project(input: ActivityProjectionInput): ActivityProjection {
  const readPoint = input.readPoint;
  const scope = input.scope;
  const ordered = [...input.evidence].sort((a, b) => a.sequence - b.sequence);
  const base = { ...emptyProjection(scope, input.filter.revision, readPoint), intervalId: readPoint.intervalId };
  if (input.coherent === false) return Object.freeze({ ...base, state: "LOADING", reason: "Activity is synchronizing accepted Evidence for the current History Interval." });
  if (scope.kind === "ITEM" || scope.kind === "LISTENER") return Object.freeze({ ...base, state: "UNAVAILABLE", reason: `Activity does not support ${scope.kind} Scope; choose its owning Subscription.` });
  if (ordered.some((entry) => entry.intervalId !== readPoint.intervalId)) return Object.freeze({ ...base, state: "UNAVAILABLE", reason: "Activity cannot combine multiple History Intervals." });
  if (!readPoint.committedEvidenceBoundary) return Object.freeze({ ...base, state: readPoint.coverage === "UNAVAILABLE" ? "UNAVAILABLE" : "EMPTY_INTERVAL", reason: readPoint.coverage === "UNAVAILABLE" ? "Observation Coverage is unavailable." : "The current History Interval has no Committed Evidence Boundary." });
  if (input.aggregate) {
    try { input.aggregate(ordered); } catch (error) { return Object.freeze({ ...base, state: "AGGREGATION_FAILED", reason: error instanceof Error ? error.message : "Activity aggregation failed." }); }
  }
  const scoped = ordered.filter((entry) => scopeMatches(entry.event, scope));
  const matching = ordered.filter((entry) => matchesActivityEvidence(entry, input.filter, scope));
  const activityMarkers = markers(matching);
  const laneSummary = connectionLanes(matching, activityMarkers);
  const server = matching.filter(({ event }) => isServerUpdate(event));
  const local = matching.filter(({ event }) => isLocalUpdate(event));
  const serverLogical = uniqueLogical(server);
  const localLogical = uniqueLogical(local);
  const segments = clockSegments([...serverLogical, ...localLogical].sort((a, b) => a.sequence - b.sequence));
  const range = readPoint.retainedRange;
  const duration = segments.length
    ? chooseDuration([...serverLogical, ...localLogical], segments, range)
    : null;
  const buckets = duration === null ? [] : makeBuckets(serverLogical, localLogical, matching, duration, segments, range, readPoint.terminal);
  const timeline = activityTimeline(serverLogical, localLogical, matching, segments, range);
  const state: ActivityState = readPoint.coverage === "UNAVAILABLE" ? "UNAVAILABLE" : matching.length === 0 ? "EMPTY_MATCH" : readPoint.coverage === "LIMITED" || readPoint.terminal ? "LIMITED" : "AVAILABLE";
  const reason = state === "UNAVAILABLE"
    ? "Observation Coverage is unavailable."
    : state === "EMPTY_MATCH" && readPoint.coverage === "LIMITED"
        ? "No matching accepted Evidence; Observation Coverage is limited."
        : state === "EMPTY_MATCH" && readPoint.terminal
          ? "No matching accepted Evidence through the terminal Committed Evidence Boundary."
          : state === "LIMITED"
            ? (readPoint.terminal ? "Activity is complete through the terminal Committed Evidence Boundary." : "Observation Coverage is limited.")
            : null;
  const plottedRange = buckets.length
    ? new Set(buckets.map((bucket) => bucket.segment)).size === 1
      ? clipActivityTimeRange({ start: buckets[0].start, end: buckets[buckets.length - 1].end }, range)
      : null
    : null;
  const rankingRangeReason = segments.length > 1 ? "Supporting Evidence interval unavailable across a clock discontinuity; identity Filter remains available." : null;
  const allRankings = rankings(serverLogical, server, scope, plottedRange, rankingRangeReason);
  const filterRemovedScopedEvidence = matching.length === 0 && ordered.some((entry) => scopeMatches(entry.event, scope)) && (
    input.filter.text.length > 0 || input.filter.around !== null || input.filter.unsupported.length > 0 || Object.keys(input.filter.criteria).length > 0
  );
  const emptyMatchCause = state === "EMPTY_MATCH"
    ? filterRemovedScopedEvidence ? "FILTER_EXCLUSION" : "NO_MATCHING_EVIDENCE"
    : null;
  const emptyMatchReason = emptyMatchCause === "FILTER_EXCLUSION" ? "No matching accepted Evidence after Filter exclusion." : null;
  return Object.freeze({
    ...base,
    state,
    reason: emptyMatchReason ?? reason,
    retainedRange: range,
    logicalUpdateTotal: serverLogical.length,
    snapshotLogicalUpdateTotal: serverLogical.filter(({ event }) => event.update?.isSnapshot === true).length,
    liveLogicalUpdateTotal: serverLogical.filter(({ event }) => event.update?.isSnapshot !== true).length,
    updateDeliveryTotal: deliveries(server),
    localLogicalUpdateTotal: localLogical.length,
    localUpdateDeliveryTotal: deliveries(local),
    matchingEvidence: matching.length,
    emptyMatchCause,
    bucketDuration: duration,
    buckets: Object.freeze(buckets),
    timeline,
    markers: Object.freeze(activityMarkers),
    rankings: Object.freeze(allRankings.slice(0, 10)),
    allRankings: Object.freeze(allRankings),
    rankingOther: otherRanking(allRankings),
    rankingRangeReason,
    clockSegments: Object.freeze(segments),
    connectionLanes: Object.freeze(laneSummary.lanes),
    connectionOverflow: laneSummary.overflow,
    contextFacts: Object.freeze(contextFacts(matching)),
    excludedLayers: Object.freeze(excludedLayers(scoped, matching, input.filter))
  });
}

function emptyProjection(scope: ActivityScope, revision: number, readPoint: ActivityReadPoint): ActivityProjection {
  return Object.freeze({ state: "EMPTY_INTERVAL", reason: null, scope, filterRevision: revision, readPoint, intervalId: readPoint.intervalId, retainedRange: readPoint.retainedRange, committedEvidenceBoundary: readPoint.committedEvidenceBoundary, bucketDuration: null, buckets: Object.freeze([]), timeline: emptyTimeline(readPoint.retainedRange), logicalUpdateTotal: 0, snapshotLogicalUpdateTotal: 0, liveLogicalUpdateTotal: 0, updateDeliveryTotal: 0, localLogicalUpdateTotal: 0, localUpdateDeliveryTotal: 0, matchingEvidence: 0, emptyMatchCause: null, markers: Object.freeze([]), rankings: Object.freeze([]), allRankings: Object.freeze([]), rankingOther: null, rankingRangeReason: null, clockSegments: Object.freeze([]), connectionLanes: Object.freeze([]), connectionOverflow: null, contextFacts: Object.freeze([]), excludedLayers: Object.freeze([]) });
}

function emptyTimeline(retainedRange: ActivityReadPoint["retainedRange"]): ActivityTimeline {
  const domain = retainedRange && retainedRange.first.timestamp <= retainedRange.last.timestamp
    ? Object.freeze({ start: retainedRange.first.timestamp, end: retainedRange.last.timestamp + 1 })
    : null;
  return Object.freeze({
    originTimestamp: retainedRange?.first.timestamp ?? null,
    domain,
    matchingRange: null,
    snapshotBursts: Object.freeze([]),
    snapshotBurstsTruncated: false,
    clockAmbiguous: false
  });
}

function activityTimeline(
  server: readonly ActivityEvidence[],
  local: readonly ActivityEvidence[],
  matching: readonly ActivityEvidence[],
  segments: readonly Readonly<{ index: number; startSequence: number; endSequence: number | null }>[],
  retainedRange: ActivityReadPoint["retainedRange"]
): ActivityTimeline {
  const domain = retainedRange && retainedRange.first.timestamp <= retainedRange.last.timestamp
    ? Object.freeze({ start: retainedRange.first.timestamp, end: retainedRange.last.timestamp + 1 })
    : null;
  const logicalUpdates = [...server, ...local];
  const matchingRange = segments.length <= 1 && logicalUpdates.length
    ? Object.freeze({
        start: Math.min(...logicalUpdates.map((entry) => entry.event.timestamp)),
        end: Math.max(...logicalUpdates.map((entry) => entry.event.timestamp)) + 1
      })
    : null;
  const segmentFor = (sequence: number): number =>
    segments.find((segment) => sequence >= segment.startSequence && (segment.endSequence === null || sequence <= segment.endSequence))?.index ?? 0;
  const runs: Array<ActivitySnapshotBurst & Readonly<{ sequence: number }>> = [];
  let current: { start: number; end: number; logicalUpdates: number; segment: number; sequence: number } | null = null;
  const countedSnapshotLogicalIds = new Set<string>();
  for (const entry of [...matching].sort((left, right) => left.sequence - right.sequence)) {
    if (entry.event.kind === "end-of-snapshot") {
      if (current) runs.push(Object.freeze(current));
      current = null;
      continue;
    }
    if (!isServerUpdate(entry.event)) continue;
    const snapshot = entry.event.update?.isSnapshot === true;
    const segment = segmentFor(entry.sequence);
    if (!snapshot) {
      if (current) runs.push(Object.freeze(current));
      current = null;
      continue;
    }
    const identity = logicalIdentity(entry);
    if (!identity || countedSnapshotLogicalIds.has(identity)) continue;
    countedSnapshotLogicalIds.add(identity);
    if (current && current.segment === segment) {
      current.end = Math.max(current.end, entry.event.timestamp + 1);
      current.logicalUpdates += 1;
      current.sequence = entry.sequence;
      continue;
    }
    if (current) runs.push(Object.freeze(current));
    current = { start: entry.event.timestamp, end: entry.event.timestamp + 1, logicalUpdates: 1, segment, sequence: entry.sequence };
  }
  if (current) runs.push(Object.freeze(current));
  const snapshotBurstsTruncated = runs.length > MAX_ACTIVITY_SNAPSHOT_BURSTS;
  return Object.freeze({
    originTimestamp: retainedRange?.first.timestamp ?? null,
    domain,
    matchingRange,
    snapshotBursts: Object.freeze(runs.slice(0, MAX_ACTIVITY_SNAPSHOT_BURSTS).map(({ sequence: _sequence, ...burst }) => Object.freeze(burst))),
    snapshotBurstsTruncated,
    clockAmbiguous: segments.length > 1
  });
}

function isServerUpdate(event: LightstreamerEventEnvelope): boolean { return event.kind === "item-update" && event.source === "server" && !event.synthetic; }
function isLocalUpdate(event: LightstreamerEventEnvelope): boolean { return event.kind === "item-update" && (event.synthetic || event.source === "synthetic"); }
function deliveries(entries: readonly ActivityEvidence[]): number { return entries.filter(({ event }) => Boolean(event.listener)).length; }

function uniqueLogical(entries: readonly ActivityEvidence[]): ActivityEvidence[] {
  const result = new Map<string, ActivityEvidence>();
  for (const entry of entries) {
    const identity = logicalIdentity(entry);
    if (!identity) continue;
    if (!result.has(identity)) result.set(identity, entry);
  }
  return [...result.values()].sort((a, b) => a.sequence - b.sequence);
}

function logicalIdentity(entry: ActivityEvidence): string | null {
  return entry.event.logicalEventId ? `identity:${entry.event.logicalEventId}` : metricOwnerIdentity(entry);
}

function metricOwnerIdentity(entry: ActivityEvidence): string | null {
  if (entry.event.listener && entry.event.listener.metricOwner !== true) return null;
  return `owner:${eventSubscriptionId(entry.event) ?? "?"}:${eventItemName(entry.event) ?? eventItemPosition(entry.event) ?? "?"}:${entry.event.timestamp}`;
}

/** Returns whether one accepted Evidence entry belongs to the supplied Activity view. */
export function matchesActivityEvidence(entry: ActivityEvidence, filter: Filter, scope: ActivityScope): boolean {
  const event = entry.event;
  if (!scopeMatches(event, scope)) return false;
  if (entry.filterRecord) return evaluateFilter(filter, entry.filterRecord).matches;
  const facets = extractEvidenceFacets(event, { identity: { intervalId: entry.intervalId, pageId: entry.intervalId, ownerId: event.subscription?.id ?? event.client?.id ?? "page", sequence: entry.sequence, eventId: event.id } });
  const record: FilterRecord = { timestamp: event.timestamp, intervalId: entry.intervalId, searchText: `${event.id} ${event.kind} ${event.source}`, facets: facets.facets };
  return evaluateFilter(filter, record).matches;
}

function scopeMatches(event: LightstreamerEventEnvelope, scope: ActivityScope): boolean {
  if (scope.kind === "PAGE") return true;
  if (scope.clientId !== undefined && eventClientId(event) !== scope.clientId) return false;
  if (scope.kind === "CLIENT") return true;
  if (scope.sessionId !== undefined && eventSessionId(event) !== scope.sessionId) return false;
  if (scope.kind === "SESSION") return true;
  if (scope.subscriptionId !== undefined && eventSubscriptionId(event) !== scope.subscriptionId) return false;
  if (scope.kind === "SUBSCRIPTION") return true;
  if (scope.item !== undefined && eventItemName(event) !== scope.item) return false;
  if (scope.itemPosition !== undefined && eventItemPosition(event) !== scope.itemPosition) return false;
  return scope.kind === "ITEM" || scope.kind === "LISTENER";
}

function eventClientId(event: LightstreamerEventEnvelope): string | null {
  return event.client?.id ?? topologyString(event.topology?.client, "id");
}

function eventSessionId(event: LightstreamerEventEnvelope): string | null {
  return event.client?.sessionId ?? topologyString(event.topology?.client, "sessionId");
}

function eventSubscriptionId(event: LightstreamerEventEnvelope): string | null {
  return event.subscription?.id ?? topologyString(event.topology?.subscription, "id");
}

function eventItemName(event: LightstreamerEventEnvelope): string | null {
  return event.item?.name ?? topologyString(event.topology?.item, "name");
}

function eventItemPosition(event: LightstreamerEventEnvelope): number | null {
  const value = event.item?.position ?? topologyScalar(event.topology?.item, "position");
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function eventClientStatus(event: LightstreamerEventEnvelope): string | null {
  return event.client?.status ?? topologyString(event.topology?.client, "status");
}

function topologyString(record: Record<string, unknown> | undefined, key: string): string | null {
  const value = topologyScalar(record, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function topologyScalar(record: Record<string, unknown> | undefined, key: string): string | number | boolean | null {
  if (!record) return null;
  const candidate = record[key];
  if (typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean") return candidate;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const state = (candidate as { state?: unknown }).state;
  if (state !== "requested" && state !== "real" && state !== "inferred") return null;
  const value = (candidate as { value?: unknown }).value;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null;
}

function chooseDuration(
  entries: readonly ActivityEvidence[],
  segments: readonly { index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }[],
  retainedRange: ActivityReadPoint["retainedRange"]
): number {
  return DURATIONS.find((duration) => bucketCount(entries, duration, segments, retainedRange) <= MAX_ACTIVITY_BUCKETS) ?? DURATIONS.at(-1)!;
}

function bucketCount(
  entries: readonly ActivityEvidence[],
  duration: number,
  segments: readonly { index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }[],
  retainedRange: ActivityReadPoint["retainedRange"]
): number {
  return segments.reduce((total, segment) => {
    const includesSequence = (sequence: number): boolean => sequence >= segment.startSequence && (segment.endSequence === null || sequence <= segment.endSequence);
    const segmentEntries = entries.filter((entry) => includesSequence(entry.sequence));
    if (!segmentEntries.length) return total;
    const observedFirst = Math.min(...segmentEntries.map(({ event }) => event.timestamp));
    const observedLast = Math.max(...segmentEntries.map(({ event }) => event.timestamp));
    const usesRetainedRange = segments.length === 1 || (retainedRange !== null && (includesSequence(retainedRange.first.sequence) || includesSequence(retainedRange.last.sequence)));
    const retainedFirst = retainedRange && usesRetainedRange && (segments.length === 1 || includesSequence(retainedRange.first.sequence)) ? retainedRange.first.timestamp : observedFirst;
    const retainedLast = retainedRange && usesRetainedRange && (segments.length === 1 || includesSequence(retainedRange.last.sequence)) ? retainedRange.last.timestamp : observedLast;
    const firstTimestamp = Math.min(observedFirst, retainedFirst);
    const lastTimestamp = Math.max(observedLast, retainedLast);
    const first = Math.floor(firstTimestamp / duration) * duration;
    return total + Math.max(1, Math.ceil((lastTimestamp - first + 1) / duration));
  }, 0);
}

function clockSegments(entries: readonly ActivityEvidence[]): Array<{ index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }> {
  const result: Array<{ index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }> = [];
  let previous: ActivityEvidence | null = null;
  for (const entry of entries) {
    if (!previous || entry.event.timestamp < previous.event.timestamp) {
      if (result.length) result[result.length - 1].endSequence = previous!.sequence;
      result.push({ index: result.length, startSequence: entry.sequence, endSequence: null, startTimestamp: entry.event.timestamp, endTimestamp: entry.event.timestamp });
    } else {
      result[result.length - 1].endTimestamp = entry.event.timestamp;
    }
    previous = entry;
  }
  if (previous && result.length) result[result.length - 1].endSequence = previous.sequence;
  return result;
}

function makeBuckets(
  server: readonly ActivityEvidence[],
  local: readonly ActivityEvidence[],
  matching: readonly ActivityEvidence[],
  duration: number,
  segments: readonly { index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }[],
  retainedRange: ActivityReadPoint["retainedRange"],
  terminal: boolean
): ActivityBucket[] {
  const inSegment = (entry: ActivityEvidence, segment: typeof segments[number]) => entry.sequence >= segment.startSequence && (segment.endSequence === null || entry.sequence <= segment.endSequence);
  return segments.flatMap((segment, segmentIndex) => {
    const segmentEntries = [...server, ...local].filter((entry) => inSegment(entry, segment));
    if (!segmentEntries.length) return [];
    const observedFirst = Math.min(...segmentEntries.map(({ event }) => event.timestamp));
    const observedLast = Math.max(...segmentEntries.map(({ event }) => event.timestamp));
    const includesSequence = (sequence: number): boolean => sequence >= segment.startSequence && (segment.endSequence === null || sequence <= segment.endSequence!);
    const usesRetainedRange = segments.length === 1 || (retainedRange !== null && (includesSequence(retainedRange.first.sequence) || includesSequence(retainedRange.last.sequence)));
    const retainedFirst = retainedRange && usesRetainedRange && (segments.length === 1 || includesSequence(retainedRange.first.sequence)) ? retainedRange.first.timestamp : observedFirst;
    const retainedLast = retainedRange && usesRetainedRange && (segments.length === 1 || includesSequence(retainedRange.last.sequence)) ? retainedRange.last.timestamp : observedLast;
    const firstTimestamp = Math.min(observedFirst, retainedFirst);
    const lastTimestamp = Math.max(observedLast, retainedLast);
    const first = Math.floor(firstTimestamp / duration) * duration;
    const count = Math.max(1, Math.ceil((lastTimestamp - first + 1) / duration));
    return Array.from({ length: count }, (_, index) => {
      const start = first + index * duration; const end = start + duration;
      const inBucket = (entry: ActivityEvidence) => inSegment(entry, segment) && entry.event.timestamp >= start && entry.event.timestamp < end;
      const firstPartial = firstTimestamp > start;
      const finalPartial = lastTimestamp + 1 < end;
      return Object.freeze({
        id: `${segment.index}:${start}`,
        start, end,
        logicalUpdates: server.filter(inBucket).length,
        snapshotLogicalUpdates: server.filter((entry) => inBucket(entry) && entry.event.update?.isSnapshot === true).length,
        liveLogicalUpdates: server.filter((entry) => inBucket(entry) && entry.event.update?.isSnapshot !== true).length,
        updateDeliveries: matching.filter((entry) => inBucket(entry) && isServerUpdate(entry.event) && Boolean(entry.event.listener)).length,
        localLogicalUpdates: local.filter(inBucket).length,
        localUpdateDeliveries: matching.filter((entry) => inBucket(entry) && isLocalUpdate(entry.event) && Boolean(entry.event.listener)).length,
        firstPartial,
        currentPartial: !terminal && segmentIndex === segments.length - 1 && finalPartial,
        finalPartial,
        segment: segment.index
      });
    });
  });
}

function connectionLanes(entries: readonly ActivityEvidence[], activityMarkers: readonly ActivityMarker[]): Readonly<{ lanes: readonly ActivityConnectionLane[]; overflow: ActivityConnectionOverflow | null }> {
  const byClient = new Map<string, ActivityEvidence[]>();
  for (const entry of entries) {
    const clientId = eventClientId(entry.event);
    if (!clientId) continue;
    const current = byClient.get(clientId) ?? [];
    current.push(entry);
    byClient.set(clientId, current);
  }
  const all = [...byClient.entries()]
    .map(([clientId, clientEntries]) => {
      const ordered = [...clientEntries].sort((left, right) => right.event.timestamp - left.event.timestamp || right.sequence - left.sequence);
      const bySession = new Map<string, ActivityEvidence[]>();
      for (const entry of clientEntries) {
        const sessionId = eventSessionId(entry.event);
        const key = sessionId ?? `<unavailable:${entry.sequence}>`;
        const current = bySession.get(key) ?? [];
        current.push(entry);
        bySession.set(key, current);
      }
      const sessions = [...bySession.entries()]
        .map(([key, sessionEntries]) => {
          const sessionOrdered = [...sessionEntries].sort((left, right) => right.event.timestamp - left.event.timestamp || right.sequence - left.sequence);
          const firstTimestamp = Math.min(...sessionEntries.map((entry) => entry.event.timestamp));
          const latest = sessionOrdered[0]!;
          const sessionId = key.startsWith("<unavailable:") ? null : key;
          return Object.freeze({ sessionId, label: sessionId ? `Session ${sessionId}` : `Session identity unavailable @ ${latest.event.timestamp}`, firstTimestamp, latestTimestamp: latest.event.timestamp, status: eventClientStatus(latest.event), supportingFilterMutations: Object.freeze(evidenceFilterMutations(latest, ["client", "session"])) });
        })
        .sort((left, right) => right.latestTimestamp - left.latestTimestamp || (left.sessionId ?? "").localeCompare(right.sessionId ?? ""));
      const latest = ordered[0]!;
      return Object.freeze({
        clientId,
        label: `Client ${clientId}`,
        latestTimestamp: latest.event.timestamp,
        sessions: Object.freeze(sessions),
        markers: Object.freeze(activityMarkers.filter((marker) => marker.clientId === clientId)),
        supportingFilterMutations: Object.freeze(evidenceFilterMutations(latest, ["client"]))
      });
    })
    .sort((left, right) => right.latestTimestamp - left.latestTimestamp || left.clientId.localeCompare(right.clientId));
  const limit = MAX_ACTIVITY_CONNECTION_LANES;
  const lanes = all.slice(0, limit);
  const overflowEntries = all.slice(limit);
  if (!overflowEntries.length) return Object.freeze({ lanes: Object.freeze(lanes), overflow: null });
  const overflowClientIds = overflowEntries.map((lane) => lane.clientId);
  const overflowClientMutations = uniqueFilterMutations(overflowEntries.flatMap((lane) => lane.supportingFilterMutations).filter((mutation) => mutation.type === "add-criterion" && mutation.facet === "client"));
  return Object.freeze({
    lanes: Object.freeze(lanes),
    overflow: Object.freeze({
      label: "Other clients" as const,
      clientIds: Object.freeze(overflowClientIds),
      latestTimestamp: overflowEntries[0]!.latestTimestamp,
      supportingFilterMutations: Object.freeze([{ type: "reset" as const }, ...overflowClientMutations])
    })
  });
}

function contextFacts(entries: readonly ActivityEvidence[]): ActivityContextFact[] {
  const definitions: readonly Readonly<{ key: ActivityContextFact["key"]; label: string; read: (entry: ActivityEvidence) => string | number | null }>[] = [
    { key: "REQUESTED_MAX_BANDWIDTH", label: "Requested max bandwidth", read: (entry) => entry.event.client?.requestedMaxBandwidth ?? null },
    { key: "REAL_MAX_BANDWIDTH", label: "Real max bandwidth", read: (entry) => entry.event.client?.realMaxBandwidth ?? null },
    { key: "REQUESTED_MAX_FREQUENCY", label: "Requested max frequency", read: (entry) => entry.event.subscription?.requestedMaxFrequency ?? null },
    { key: "REAL_MAX_FREQUENCY", label: "Real max frequency", read: (entry) => entry.event.subscription?.realMaxFrequency ?? null }
  ];
  return definitions.flatMap((definition) => {
    const values = entries
      .map((entry) => ({ value: definition.read(entry), timestamp: entry.event.timestamp }))
      .filter((value): value is { value: string | number; timestamp: number } => value.value !== null && value.value !== undefined && String(value.value).length > 0)
      .map((value) => ({ value: String(value.value), timestamp: value.timestamp }));
    if (!values.length) return [];
    const uniqueValues = values.filter((value, index, all) => all.findIndex((candidate) => candidate.value === value.value) === index);
    const numericValues = values
      .map((value) => ({ value: Number(value.value), timestamp: value.timestamp }))
      .filter((value) => Number.isFinite(value.value));
    const distinctNumeric = new Set(numericValues.map(({ value }) => value));
    const changes = numericValues.filter((value, index) => index === 0 || numericValues[index - 1]!.value !== value.value);
    return [Object.freeze({ key: definition.key, label: definition.label, values: Object.freeze(uniqueValues), plotValues: Object.freeze(distinctNumeric.size >= 2 ? changes : []) })];
  });
}

function excludedLayers(scoped: readonly ActivityEvidence[], matching: readonly ActivityEvidence[], filter: Filter): ActivityExcludedLayer[] {
  const definitions: readonly Readonly<{ layer: ActivityExcludedLayer["layer"]; label: ActivityExcludedLayer["label"]; matches: (entry: ActivityEvidence) => boolean }>[] = [
    { layer: "CONNECTION", label: "Connection transitions", matches: (entry) => isConnectionEvidence(entry.event) },
    { layer: "LOSS", label: "Lost updates", matches: (entry) => entry.event.kind === "lost-updates" },
    { layer: "ERROR", label: "Subscription errors", matches: (entry) => entry.event.kind === "subscription-error" }
  ];
  return definitions.flatMap((definition) => {
    const scopedLayer = scoped.filter(definition.matches);
    if (!scopedLayer.length || matching.some(definition.matches)) return [];
    return [Object.freeze({ layer: definition.layer, label: definition.label, filterMutations: Object.freeze(filterAmendment(filter, definition.layer)) })];
  });
}

function filterAmendment(filter: Filter, layer: ActivityExcludedLayer["layer"]): FilterMutation[] {
  const mutations: FilterMutation[] = [];
  const kinds = layer === "CONNECTION" ? ["CLIENT-STATUS"] : layer === "LOSS" ? ["LOST-UPDATES"] : ["SUBSCRIPTION-ERROR"];
  const kind = filter.criteria.kind;
  if (kind?.include.length) mutations.push({ type: "clear-facet", facet: "kind" });
  else if (kind) for (const value of kind.exclude) if (kinds.includes(String(value.value))) mutations.push({ type: "remove-criterion", facet: "kind", value });
  const provenance = filter.criteria.provenance;
  if (provenance?.include.length) mutations.push({ type: "clear-facet", facet: "provenance" });
  else if (provenance) for (const value of provenance.exclude) mutations.push({ type: "remove-criterion", facet: "provenance", value });
  return mutations.length ? mutations : [{ type: "reset" }];
}

function isConnectionEvidence(event: LightstreamerEventEnvelope): boolean {
  return event.kind === "client-status" || event.topology?.kind === "session-established" || event.topology?.kind === "session-absent";
}

function markers(entries: readonly ActivityEvidence[]): ActivityMarker[] {
  return entries
    .filter(({ event }) => event.kind === "client-status" || event.kind === "subscription-error" || event.kind === "lost-updates" || event.topology?.kind === "session-established" || event.topology?.kind === "session-absent")
    .sort((a, b) => a.event.timestamp - b.event.timestamp || a.sequence - b.sequence)
    .map((entry) => {
      const { event, sequence } = entry;
      const kind = event.kind === "client-status" ? "CLIENT_STATUS" as const : event.kind === "subscription-error" ? "SUBSCRIPTION_ERROR" as const : event.kind === "lost-updates" ? "LOST_UPDATES" as const : "SESSION_TRANSITION" as const;
      const raw = event.raw ?? {};
      const rawString = (key: string): string | null => typeof raw[key] === "string" ? raw[key] as string : null;
      const rawScalar = (key: string): string | number | null => typeof raw[key] === "string" || typeof raw[key] === "number" ? raw[key] as string | number : null;
      return Object.freeze({
        kind,
        timestamp: event.timestamp,
        sequence,
        eventId: event.id,
        label: kind === "CLIENT_STATUS" ? eventClientStatus(event) ?? "Client status observed" : kind === "SUBSCRIPTION_ERROR" ? "Subscription error" : kind === "LOST_UPDATES" ? "Lost updates" : "Session transition",
        reportedCount: event.update?.lostUpdates ?? null,
        clientId: eventClientId(event),
        sessionId: eventSessionId(event),
        subscriptionId: eventSubscriptionId(event),
        itemName: eventItemName(event),
        itemPosition: eventItemPosition(event),
        status: eventClientStatus(event) ?? rawString("status"),
        errorCode: kind === "SUBSCRIPTION_ERROR" ? rawScalar("code") : null,
        errorMessage: kind === "SUBSCRIPTION_ERROR" ? rawString("message") : null,
        provenance: event.synthetic || event.source === "synthetic" ? "LOCAL" as const : "SERVER" as const,
        consequenceLimit: kind === "LOST_UPDATES" ? "The reported loss does not establish its server-side cause." : kind === "SUBSCRIPTION_ERROR" ? "The captured error does not establish downstream application effect." : "This is a captured observation, not a continuous state interval.",
        supportingFilterMutations: evidenceFilterMutations(entry, ["client", "session", "subscription", "item"])
      });
    });
}

function rankings(entries: readonly ActivityEvidence[], deliveriesFor: readonly ActivityEvidence[], scope: ActivityScope, plottedRange: ActivityTimeRange | null, rangeReason: string | null): ActivityRanking[] {
  const by = new Map<string, { label: string; logical: number; deliveries: number; entries: ActivityEvidence[] }>();
  for (const entry of entries) {
    const identity = rankingIdentity(entry, scope);
    const current = by.get(identity) ?? { label: identity, logical: 0, deliveries: 0, entries: [] }; current.logical += 1; current.entries.push(entry); by.set(identity, current);
  }
  for (const entry of deliveriesFor) if (entry.event.listener) { const identity = rankingIdentity(entry, scope); const current = by.get(identity); if (current) { current.deliveries += 1; current.entries.push(entry); } }
  return [...by.entries()].map(([identity, value]) => {
    const first = value.entries[0];
    const supportingFilterMutations = evidenceFilterMutations(first, [scope.kind === "SUBSCRIPTION" ? "item" : "subscription"]);
    return Object.freeze({
      identity,
      label: value.label,
      logicalUpdates: value.logical,
      updateDeliveries: value.deliveries,
      range: plottedRange,
      rangeReason,
      subscriptionId: first ? eventSubscriptionId(first.event) : null,
      itemName: first ? eventItemName(first.event) : null,
      itemPosition: first ? eventItemPosition(first.event) : null,
      supportingFilterMutations: Object.freeze(supportingFilterMutations)
    });
  }).sort((a, b) => b.logicalUpdates - a.logicalUpdates || a.identity.localeCompare(b.identity));
}

function evidenceFilterMutations(
  entry: ActivityEvidence,
  contextualFacets: readonly ("client" | "session" | "subscription" | "item")[] = []
): readonly FilterMutation[] {
  const facets = extractEvidenceFacets(entry.event, { identity: { intervalId: entry.intervalId, pageId: entry.intervalId, ownerId: entry.event.subscription?.id ?? entry.event.client?.id ?? "page", sequence: entry.sequence, eventId: entry.event.id } }).facets;
  const selected = [facets.kind, facets.provenance, ...contextualFacets.map((facet) => structuralContextFacet(entry.event, facet))].filter((facet): facet is { facet: string; type: string; value: string; label: string } => Boolean(facet));
  const seen = new Set<string>();
  return Object.freeze(selected.flatMap((facet) => {
    const value = createTypedFilterValue(facet.facet, facet.type, facet.value, facet.label);
    if (seen.has(value.identity)) return [];
    seen.add(value.identity);
    return [{ type: "add-criterion" as const, facet: facet.facet, value, polarity: "include" as const }];
  }));
}

function structuralContextFacet(event: LightstreamerEventEnvelope, facet: "client" | "session" | "subscription" | "item"): { facet: string; type: string; value: string; label: string } | undefined {
  const clientId = eventClientId(event);
  const sessionId = eventSessionId(event);
  const subscriptionId = eventSubscriptionId(event);
  if (facet === "client" && clientId) return { facet, type: "structural-client", value: clientId, label: clientId };
  if (facet === "session" && sessionId) return { facet, type: "structural-session", value: sessionId, label: sessionId };
  if (facet === "subscription" && subscriptionId) return { facet, type: "structural-subscription", value: subscriptionId, label: subscriptionId };
  const itemName = eventItemName(event);
  const itemPosition = eventItemPosition(event);
  if (facet === "item" && (itemName !== null || itemPosition !== null)) {
    const name = itemName;
    const position = itemPosition;
    return { facet, type: "structural-item", value: JSON.stringify([name, position]), label: name ?? String(position) };
  }
  return undefined;
}

function uniqueFilterMutations(mutations: readonly FilterMutation[]): FilterMutation[] {
  const seen = new Set<string>();
  return mutations.filter((mutation) => {
    const identity = mutation.type === "add-criterion" || mutation.type === "remove-criterion" || mutation.type === "set-polarity"
      ? `${mutation.type}:${mutation.facet}:${mutation.value.identity}`
      : JSON.stringify(mutation);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function rankingIdentity(entry: ActivityEvidence, scope: ActivityScope): string {
  return scope.kind === "SUBSCRIPTION" ? `${eventItemName(entry.event) ?? "<unknown-item>"}:${eventItemPosition(entry.event) ?? ""}` : eventSubscriptionId(entry.event) ?? "<unknown-subscription>";
}

function otherRanking(all: readonly ActivityRanking[]): ActivityRanking | null {
  const rest = all.slice(10);
  if (rest.length === 0) return null;
  return Object.freeze({ identity: "other", label: "Other", logicalUpdates: rest.reduce((total, value) => total + value.logicalUpdates, 0), updateDeliveries: rest.reduce((total, value) => total + value.updateDeliveries, 0) });
}
