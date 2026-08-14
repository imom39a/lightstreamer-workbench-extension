import { type LightstreamerEventEnvelope } from "./event-envelope";
import { extractEvidenceFacets } from "./evidence-facets";
import { type Filter, evaluateFilter, type FilterRecord } from "./filter-algebra";

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
}>;

export type ActivityReadPoint = Readonly<{
  intervalId: string;
  committedEvidenceBoundary: Readonly<{ intervalId: string; sequence: number; eventId: string }> | null;
  retainedRange: Readonly<{ first: Readonly<{ timestamp: number; sequence: number }>; last: Readonly<{ timestamp: number; sequence: number }> }> | null;
  coverage: "USEFUL" | "LIMITED" | "UNAVAILABLE";
  terminal: boolean;
}>;

export type ActivityState = "AVAILABLE" | "EMPTY_MATCH" | "EMPTY_INTERVAL" | "LIMITED" | "UNAVAILABLE" | "AGGREGATION_FAILED";
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

export type ActivityRanking = Readonly<{
  identity: string;
  label: string;
  logicalUpdates: number;
  updateDeliveries: number;
}>;

export type ActivityProjection = Readonly<{
  state: ActivityState;
  reason: string | null;
  scope: ActivityScope;
  filterRevision: number;
  readPoint: ActivityReadPoint;
  intervalId: string;
  retainedRange: ActivityReadPoint["retainedRange"];
  committedEvidenceBoundary: ActivityReadPoint["committedEvidenceBoundary"];
  bucketDuration: number | null;
  buckets: readonly ActivityBucket[];
  logicalUpdateTotal: number;
  snapshotLogicalUpdateTotal: number;
  liveLogicalUpdateTotal: number;
  updateDeliveryTotal: number;
  localLogicalUpdateTotal: number;
  localUpdateDeliveryTotal: number;
  matchingEvidence: number;
  markers: readonly ActivityMarker[];
  rankings: readonly ActivityRanking[];
  allRankings: readonly ActivityRanking[];
  rankingOther: ActivityRanking | null;
  clockSegments: readonly Readonly<{ index: number; startSequence: number; endSequence: number | null; startTimestamp: number; endTimestamp: number }>[];
}>;

export type ActivityProjectionInput = Readonly<{
  evidence: readonly ActivityEvidence[];
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
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
  if (scope.kind === "ITEM" || scope.kind === "LISTENER") return Object.freeze({ ...base, state: "UNAVAILABLE", reason: `Activity does not support ${scope.kind} Scope; choose its owning Subscription.` });
  if (ordered.some((entry) => entry.intervalId !== readPoint.intervalId)) return Object.freeze({ ...base, state: "UNAVAILABLE", reason: "Activity cannot combine multiple History Intervals." });
  if (!readPoint.committedEvidenceBoundary) return Object.freeze({ ...base, state: readPoint.coverage === "UNAVAILABLE" ? "UNAVAILABLE" : "EMPTY_INTERVAL", reason: readPoint.coverage === "UNAVAILABLE" ? "Observation Coverage is unavailable." : "The current History Interval has no Committed Evidence Boundary." });
  if (input.aggregate) {
    try { input.aggregate(ordered); } catch (error) { return Object.freeze({ ...base, state: "AGGREGATION_FAILED", reason: error instanceof Error ? error.message : "Activity aggregation failed." }); }
  }
  const matching = ordered.filter((entry) => matchesActivityEvidence(entry, input.filter, scope));
  const server = matching.filter(({ event }) => isServerUpdate(event));
  const local = matching.filter(({ event }) => isLocalUpdate(event));
  const serverLogical = uniqueLogical(server);
  const localLogical = uniqueLogical(local);
  const segments = clockSegments([...serverLogical, ...localLogical].sort((a, b) => a.sequence - b.sequence));
  const range = readPoint.retainedRange;
  const retainedSpan = range
    ? Math.max(0, range.last.timestamp - range.first.timestamp)
    : null;
  const duration = segments.length
    ? chooseDuration(retainedSpan ?? Math.max(...segments.map((segment) => segment.endTimestamp - segment.startTimestamp)))
    : null;
  const buckets = duration === null ? [] : makeBuckets(serverLogical, localLogical, matching, duration, segments, range, readPoint.terminal);
  const state: ActivityState = readPoint.coverage === "UNAVAILABLE" ? "UNAVAILABLE" : matching.length === 0 ? "EMPTY_MATCH" : serverLogical.length === 0 ? "EMPTY_MATCH" : readPoint.coverage === "LIMITED" || readPoint.terminal ? "LIMITED" : "AVAILABLE";
  const reason = state === "UNAVAILABLE"
    ? "Observation Coverage is unavailable."
    : state === "EMPTY_MATCH" && readPoint.coverage === "LIMITED"
        ? "No matching accepted Evidence; Observation Coverage is limited."
        : state === "EMPTY_MATCH" && readPoint.terminal
          ? "No matching accepted Evidence through the terminal Committed Evidence Boundary."
          : state === "LIMITED"
            ? (readPoint.terminal ? "Activity is complete through the terminal Committed Evidence Boundary." : "Observation Coverage is limited.")
            : null;
  const allRankings = rankings(serverLogical, server, scope);
  return Object.freeze({
    ...base,
    state,
    reason,
    retainedRange: range,
    logicalUpdateTotal: serverLogical.length,
    snapshotLogicalUpdateTotal: serverLogical.filter(({ event }) => event.update?.isSnapshot === true).length,
    liveLogicalUpdateTotal: serverLogical.filter(({ event }) => event.update?.isSnapshot !== true).length,
    updateDeliveryTotal: deliveries(server),
    localLogicalUpdateTotal: localLogical.length,
    localUpdateDeliveryTotal: deliveries(local),
    matchingEvidence: matching.length,
    bucketDuration: duration,
    buckets: Object.freeze(buckets),
    markers: Object.freeze(markers(matching)),
    rankings: Object.freeze(allRankings.slice(0, 10)),
    allRankings: Object.freeze(allRankings),
    rankingOther: otherRanking(allRankings),
    clockSegments: Object.freeze(segments)
  });
}

function emptyProjection(scope: ActivityScope, revision: number, readPoint: ActivityReadPoint): ActivityProjection {
  return Object.freeze({ state: "EMPTY_INTERVAL", reason: null, scope, filterRevision: revision, readPoint, intervalId: readPoint.intervalId, retainedRange: readPoint.retainedRange, committedEvidenceBoundary: readPoint.committedEvidenceBoundary, bucketDuration: null, buckets: Object.freeze([]), logicalUpdateTotal: 0, snapshotLogicalUpdateTotal: 0, liveLogicalUpdateTotal: 0, updateDeliveryTotal: 0, localLogicalUpdateTotal: 0, localUpdateDeliveryTotal: 0, matchingEvidence: 0, markers: Object.freeze([]), rankings: Object.freeze([]), allRankings: Object.freeze([]), rankingOther: null, clockSegments: Object.freeze([]) });
}

function isServerUpdate(event: LightstreamerEventEnvelope): boolean { return event.kind === "item-update" && event.source === "server" && !event.synthetic; }
function isLocalUpdate(event: LightstreamerEventEnvelope): boolean { return event.kind === "item-update" && (event.synthetic || event.source === "synthetic"); }
function deliveries(entries: readonly ActivityEvidence[]): number { return entries.filter(({ event }) => Boolean(event.listener)).length; }

function uniqueLogical(entries: readonly ActivityEvidence[]): ActivityEvidence[] {
  const result = new Map<string, ActivityEvidence>();
  for (const entry of entries) {
    const event = entry.event;
    const identity = event.logicalEventId ? `identity:${event.logicalEventId}` : metricOwnerIdentity(entry);
    if (!identity) continue;
    if (!result.has(identity)) result.set(identity, entry);
  }
  return [...result.values()].sort((a, b) => a.sequence - b.sequence);
}

function metricOwnerIdentity(entry: ActivityEvidence): string | null {
  if (entry.event.listener && entry.event.listener.metricOwner !== true) return null;
  return `owner:${entry.event.subscription?.id ?? "?"}:${entry.event.item?.name ?? entry.event.item?.position ?? "?"}:${entry.event.timestamp}`;
}

/** Returns whether one accepted Evidence entry belongs to the supplied Activity view. */
export function matchesActivityEvidence(entry: ActivityEvidence, filter: Filter, scope: ActivityScope): boolean {
  const event = entry.event;
  if (!scopeMatches(event, scope)) return false;
  const facets = extractEvidenceFacets(event, { identity: { intervalId: entry.intervalId, pageId: "activity", ownerId: event.subscription?.id ?? event.client?.id ?? "page", sequence: entry.sequence, eventId: event.id } });
  const record: FilterRecord = { timestamp: event.timestamp, intervalId: entry.intervalId, searchText: `${event.id} ${event.kind} ${event.source}`, facets: facets.facets };
  return evaluateFilter(filter, record).matches;
}

function scopeMatches(event: LightstreamerEventEnvelope, scope: ActivityScope): boolean {
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

function chooseDuration(span: number): number { return DURATIONS.find((duration) => Math.ceil(Math.max(1, span) / duration) <= MAX_ACTIVITY_BUCKETS) ?? DURATIONS.at(-1)!; }

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
    const retainedFirst = retainedRange ? Math.min(retainedRange.first.timestamp, retainedRange.last.timestamp) : observedFirst;
    const retainedLast = retainedRange ? Math.max(retainedRange.first.timestamp, retainedRange.last.timestamp) : observedLast;
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

function markers(entries: readonly ActivityEvidence[]): ActivityMarker[] {
  return entries
    .filter(({ event }) => event.kind === "client-status" || event.kind === "subscription-error" || event.kind === "lost-updates" || event.topology?.kind === "session-established" || event.topology?.kind === "session-absent")
    .sort((a, b) => a.event.timestamp - b.event.timestamp || a.sequence - b.sequence)
    .map(({ event, sequence }) => {
      const kind = event.kind === "client-status" ? "CLIENT_STATUS" as const : event.kind === "subscription-error" ? "SUBSCRIPTION_ERROR" as const : event.kind === "lost-updates" ? "LOST_UPDATES" as const : "SESSION_TRANSITION" as const;
      const raw = event.raw ?? {};
      const rawString = (key: string): string | null => typeof raw[key] === "string" ? raw[key] as string : null;
      const rawScalar = (key: string): string | number | null => typeof raw[key] === "string" || typeof raw[key] === "number" ? raw[key] as string | number : null;
      return Object.freeze({
        kind,
        timestamp: event.timestamp,
        sequence,
        eventId: event.id,
        label: kind === "CLIENT_STATUS" ? event.client?.status ?? "Client status observed" : kind === "SUBSCRIPTION_ERROR" ? "Subscription error" : kind === "LOST_UPDATES" ? "Lost updates" : "Session transition",
        reportedCount: event.update?.lostUpdates ?? null,
        clientId: event.client?.id ?? null,
        sessionId: event.client?.sessionId ?? null,
        subscriptionId: event.subscription?.id ?? null,
        itemName: event.item?.name ?? null,
        itemPosition: event.item?.position ?? null,
        status: event.client?.status ?? rawString("status"),
        errorCode: kind === "SUBSCRIPTION_ERROR" ? rawScalar("code") : null,
        errorMessage: kind === "SUBSCRIPTION_ERROR" ? rawString("message") : null,
        provenance: event.synthetic || event.source === "synthetic" ? "LOCAL" as const : "SERVER" as const,
        consequenceLimit: kind === "LOST_UPDATES" ? "The reported loss does not establish its server-side cause." : kind === "SUBSCRIPTION_ERROR" ? "The captured error does not establish downstream application effect." : "This is a captured observation, not a continuous state interval."
      });
    });
}

function rankings(entries: readonly ActivityEvidence[], deliveriesFor: readonly ActivityEvidence[], scope: ActivityScope): ActivityRanking[] {
  const by = new Map<string, { label: string; logical: number; deliveries: number }>();
  for (const entry of entries) {
    const identity = scope.kind === "SUBSCRIPTION" ? `${entry.event.item?.name ?? "<unknown-item>"}:${entry.event.item?.position ?? ""}` : entry.event.subscription?.id ?? "<unknown-subscription>";
    const current = by.get(identity) ?? { label: identity, logical: 0, deliveries: 0 }; current.logical += 1; by.set(identity, current);
  }
  for (const entry of deliveriesFor) if (entry.event.listener) { const identity = scope.kind === "SUBSCRIPTION" ? `${entry.event.item?.name ?? "<unknown-item>"}:${entry.event.item?.position ?? ""}` : entry.event.subscription?.id ?? "<unknown-subscription>"; const current = by.get(identity); if (current) current.deliveries += 1; }
  return [...by.entries()].map(([identity, value]) => Object.freeze({ identity, label: value.label, logicalUpdates: value.logical, updateDeliveries: value.deliveries })).sort((a, b) => b.logicalUpdates - a.logicalUpdates || a.identity.localeCompare(b.identity));
}

function otherRanking(all: readonly ActivityRanking[]): ActivityRanking | null {
  const rest = all.slice(10);
  if (rest.length === 0) return null;
  return Object.freeze({ identity: "other", label: "Other", logicalUpdates: rest.reduce((total, value) => total + value.logicalUpdates, 0), updateDeliveries: rest.reduce((total, value) => total + value.updateDeliveries, 0) });
}
