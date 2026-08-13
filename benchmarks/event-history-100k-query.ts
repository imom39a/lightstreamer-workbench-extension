import { HISTORY_CAPACITY_LIMITS, MIB } from "../src/core/event-history-capacity";

/**
 * Candidate-only query workload evidence for the eventual 100k release gate.
 *
 * This is deliberately a deterministic compact-key model rather than a
 * production capacity switch or a wall-clock benchmark. It proves the shape
 * of the retained heap and hydration work that the real IndexedDB runner must
 * satisfy, while the shipped normal and startup-memory limits remain owned by
 * event-history-capacity.ts.
 */
export const DORMANT_100K_QUERY_PROFILE = Object.freeze({
  id: "normal-100k-query-bounded-heap",
  status: "CANDIDATE_ONLY" as const,
  retainedEvidence: 100_000,
  pageSize: 100,
  findIdentityLimit: 1_000,
  findWindowSize: 8,
  maxPostingDriverSets: 1,
  productionNormalCapacity: Object.freeze({
    maxRetainedCount: HISTORY_CAPACITY_LIMITS.NORMAL.maxRetainedCount,
    maxRetainedBytes: HISTORY_CAPACITY_LIMITS.NORMAL.maxRetainedBytes
  }),
  productionStartupMemoryCapacity: Object.freeze({
    maxRetainedCount: HISTORY_CAPACITY_LIMITS.LOWER.maxRetainedCount,
    maxRetainedBytes: HISTORY_CAPACITY_LIMITS.LOWER.maxRetainedBytes
  }),
  productionCapacityUnchanged: true as const
});

export type Dormant100kQueryOperationKind =
  | "accepted-page"
  | "structured-query"
  | "residual-query"
  | "discovery"
  | "find"
  | "passive-capture";

export type Dormant100kQueryOperation = Readonly<{
  kind: Dormant100kQueryOperationKind;
  responseClass: "PAGE" | "STRUCTURED" | "RESIDUAL" | "DISCOVERY" | "FIND" | "INCREMENTAL";
  retainedEvidence: number;
  compactKeyWork: number;
  firstUsefulResultWork: number;
  exactTotal: number | null;
  pageSize: number;
  pagePayloadHydrations: number;
  selectedPayloadHydrations: number;
  payloadHydrations: number;
  maxRetainedPayloadRecords: number;
  maxRetainedCompactIdentities: number;
  maxRetainedPostingDriverSets: number;
  completePayloadCollection: false;
  bounded: true;
}>;

export type Dormant100kQueryProof = Readonly<{
  profileId: string;
  status: "CANDIDATE_ONLY";
  retainedEvidence: number;
  deterministicIdentityDigest: string;
  operations: Readonly<Record<Dormant100kQueryOperationKind, Dormant100kQueryOperation>>;
  acceptedPage: Readonly<{
    firstSequence: number;
    lastSequence: number;
    nextAnchorSequence: number;
  }>;
  structuredQuery: Readonly<{
    postingDriver: "key";
    postingDriverCandidateCount: number;
    residualCriteriaEvaluated: number;
    compoundCriteriaPostingSets: number;
  }>;
  residualQuery: Readonly<{
    exactMatchingTotal: number;
    firstUsefulSequence: number;
  }>;
  discovery: Readonly<{
    exactDistinctTotal: number;
    materializedValueCount: number;
    materializationBound: number;
  }>;
  find: Readonly<{
    exactTotal: number;
    retainedMatchIdentityBound: number;
    surroundingWindowBound: number;
  }>;
  passiveCapture: Readonly<{
    offeredEvents: number;
    compactIncrementalEvents: number;
    coalescedRefreshes: number;
    completeRescans: number;
  }>;
}>;

const TARGET = DORMANT_100K_QUERY_PROFILE.retainedEvidence;
const PAGE = DORMANT_100K_QUERY_PROFILE.pageSize;
const RARE_KEY_PERIOD = 997;
const DISCOVERY_VALUE_CARDINALITY = 1_000;

function rollDigest(hash: number, sequence: number): number {
  const text = `${sequence}\u0000history-100k-02\u0000`;
  let next = hash;
  for (let index = 0; index < text.length; index += 1) {
    next ^= text.charCodeAt(index);
    next = Math.imul(next, 16_777_619) >>> 0;
  }
  return next >>> 0;
}

function operation(
  kind: Dormant100kQueryOperationKind,
  responseClass: Dormant100kQueryOperation["responseClass"],
  compactKeyWork: number,
  firstUsefulResultWork: number,
  exactTotal: number | null,
  pagePayloadHydrations: number,
  selectedPayloadHydrations: number,
  maxRetainedCompactIdentities: number,
  maxRetainedPostingDriverSets: number
): Dormant100kQueryOperation {
  return Object.freeze({
    kind,
    responseClass,
    retainedEvidence: TARGET,
    compactKeyWork,
    firstUsefulResultWork,
    exactTotal,
    pageSize: PAGE,
    pagePayloadHydrations,
    selectedPayloadHydrations,
    payloadHydrations: pagePayloadHydrations + selectedPayloadHydrations,
    maxRetainedPayloadRecords: pagePayloadHydrations + selectedPayloadHydrations,
    maxRetainedCompactIdentities,
    maxRetainedPostingDriverSets,
    completePayloadCollection: false,
    bounded: true
  });
}

function countRareKeys(): number {
  let count = 0;
  for (let sequence = 1; sequence <= TARGET; sequence += 1) {
    if (sequence % RARE_KEY_PERIOD === 0) count += 1;
  }
  return count;
}

function countDiscoveryValues(): number {
  const values = new Set<number>();
  // This is a fixed-size catalog model, not a retained-sequence set. The
  // production adapter uses the facet aggregate/posting stores for this work.
  for (let sequence = 1; sequence <= TARGET; sequence += 1) values.add(sequence % DISCOVERY_VALUE_CARDINALITY);
  return values.size;
}

export function runDormant100kQueryProof(): Dormant100kQueryProof {
  let digest = 2_166_136_261;
  for (let sequence = 1; sequence <= TARGET; sequence += 1) digest = rollDigest(digest, sequence);

  const rareKeyCount = countRareKeys();
  const residualMatchingTotal = rareKeyCount;
  const discoveryDistinctTotal = countDiscoveryValues();
  const operations = {
    "accepted-page": operation("accepted-page", "PAGE", PAGE, PAGE, null, PAGE, 0, PAGE, 0),
    "structured-query": operation("structured-query", "STRUCTURED", rareKeyCount, rareKeyCount, rareKeyCount, PAGE, 1, PAGE + 1, 1),
    "residual-query": operation("residual-query", "RESIDUAL", TARGET, 1, residualMatchingTotal, PAGE, 0, PAGE, 0),
    discovery: operation("discovery", "DISCOVERY", TARGET, TARGET, discoveryDistinctTotal, 0, 0, PAGE, 0),
    find: operation("find", "FIND", TARGET, TARGET, residualMatchingTotal, 0, 0, DORMANT_100K_QUERY_PROFILE.findIdentityLimit, 0),
    "passive-capture": operation("passive-capture", "INCREMENTAL", TARGET, 1, null, 0, 0, PAGE, 0)
  } satisfies Record<Dormant100kQueryOperationKind, Dormant100kQueryOperation>;

  return Object.freeze({
    profileId: DORMANT_100K_QUERY_PROFILE.id,
    status: DORMANT_100K_QUERY_PROFILE.status,
    retainedEvidence: TARGET,
    deterministicIdentityDigest: digest.toString(16).padStart(8, "0"),
    operations: Object.freeze(operations),
    acceptedPage: Object.freeze({ firstSequence: 1, lastSequence: PAGE, nextAnchorSequence: PAGE }),
    structuredQuery: Object.freeze({
      postingDriver: "key" as const,
      postingDriverCandidateCount: rareKeyCount,
      residualCriteriaEvaluated: rareKeyCount,
      compoundCriteriaPostingSets: 1
    }),
    residualQuery: Object.freeze({ exactMatchingTotal: residualMatchingTotal, firstUsefulSequence: RARE_KEY_PERIOD }),
    discovery: Object.freeze({ exactDistinctTotal: discoveryDistinctTotal, materializedValueCount: PAGE, materializationBound: PAGE }),
    find: Object.freeze({
      exactTotal: residualMatchingTotal,
      retainedMatchIdentityBound: DORMANT_100K_QUERY_PROFILE.findIdentityLimit,
      surroundingWindowBound: DORMANT_100K_QUERY_PROFILE.findWindowSize
    }),
    passiveCapture: Object.freeze({ offeredEvents: TARGET, compactIncrementalEvents: TARGET, coalescedRefreshes: 1, completeRescans: 0 })
  });
}

export const DORMANT_100K_QUERY_PROOF = runDormant100kQueryProof();

export const DORMANT_100K_QUERY_CANONICAL_BYTES = 256 * MIB;
