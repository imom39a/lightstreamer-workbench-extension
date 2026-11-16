import type { AgentPermission, AgentToolArguments, AgentToolName } from "../../../agent/protocol";
import type { BoundedMap } from "../../../core/bounded-map";
import type { EvidenceIdentity, EvidenceReadPoint, EvidenceSnapshot } from "../../../core/evidence-filter-contract";
import type { ScopeSearchIndex } from "../../../core/scope-search";
import type { AgentCommandRowsInput } from "../agent-command-rows";
import type { AgentQueryBoundary, AgentQueryInput, AgentRuntime, AgentScopeSearchSnapshot } from "../agent-runtime";
import type { safeDraft, safeScenario } from "./redaction";

export const SEARCH_CURSOR_LIFETIME_MS = 5 * 60 * 1000;
export const DEFAULT_QUERY_WORK = Object.freeze({ maxProjectionReads: 250000, maxPayloadHydrations: 1000, deadlineMs: 15000 });

export type EvidenceQueryCursor = { at: EvidenceReadPoint; cursor: string; query?: Omit<AgentQueryInput, "cursor" | "at">; fields?: readonly string[]; maxBytes?: number; pageEpoch?: string | null };
export type EvidenceSearch = { at: EvidenceReadPoint; after: EvidenceIdentity; boundary: AgentQueryBoundary; queryOptions?: Pick<AgentQueryInput, "sequenceWindow" | "workBudget">; within: "page" | "current-investigation"; scopeId?: string; text: string; size: number; includePayload: boolean; fields?: readonly string[]; maxBytes: number; pageEpoch: string | null; expiresAt: number };
export type SummaryCursor = { query: AgentQueryInput; facet: string; cursor: string; limit: number; maxBytes: number; at: EvidenceReadPoint; pageEpoch: string | null };
export type ScopeSearch = { index: ScopeSearchIndex; snapshot: Omit<AgentScopeSearchSnapshot, "nodes">; text: string; size: number; maxBytes: number; kind?: string; parentScopeId?: string; expiresAt: number };
export type ScopeCursor = { searchId: string; offset: number };
export type CommandRowCursor = { input: AgentCommandRowsInput; pageEpoch: string; maxBytes: number };

export type LocalOperationReceipt =
  | Readonly<{ state: "pending"; requestId: string }>
  | Readonly<{ state: "complete"; outcome: unknown; evidence?: unknown; correlation?: unknown }>
  | Readonly<{ state: "not-run"; validation: ReturnType<typeof safeDraft> }>;
export type ControlOperationReceipt = Readonly<{ requestId: string; accepted: true }>;
export type OperationEntry =
  | { signature: string; kind: "local"; draftId: string; value: LocalOperationReceipt }
  | { signature: string; kind: "scenario"; value: ControlOperationReceipt };
export type DocumentRequestEntry = { signature: string; promise: Promise<unknown>; token?: string; fingerprint?: string };
/** Outcomes are stored credential-safe (or as a constructed Unknown/stale receipt), so they are opaque here. */
export type ServerRequestEntry = { signature: string; token: string; state: "prepared" | "approved" | "pending" | "complete" | "aborted"; outcome?: unknown; promise?: Promise<unknown> };
export type PreparedDocument = { token: string; fingerprint: string; kind: "local" | "scenario"; consumed: boolean };
export type ServerPrepared = { requestId: string; token: string; signature: string; consumed: boolean };
export type ScenarioProgress = { runId: string; signature: string; revision: number };
export type ScopeIndexCache = { pageEpoch: string | null; structureRevision: number; nodes: AgentScopeSearchSnapshot["nodes"]; index: ScopeSearchIndex };

/** Mutable per-Panel-Session agent state shared by every tool handler. */
export type AgentServiceState = {
  readonly cursors: BoundedMap<string, EvidenceQueryCursor>;
  readonly evidenceSearches: BoundedMap<string, EvidenceSearch>;
  readonly summaries: BoundedMap<string, SummaryCursor>;
  // Multiple page cursors share one bounded Topology snapshot rather than copying it.
  readonly scopeSearches: BoundedMap<string, ScopeSearch>;
  readonly scopeCursors: BoundedMap<string, ScopeCursor>;
  readonly commandRowCursors: BoundedMap<string, CommandRowCursor>;
  readonly requests: Map<string, OperationEntry>;
  readonly documentRequests: Map<string, DocumentRequestEntry>;
  readonly serverRequests: Map<string, ServerRequestEntry>;
  readonly emergencyControlIds: Partial<Record<"pause" | "stop", string>>;
  readonly waits: Set<AbortController>;
  readonly operationListeners: Set<() => void>;
  readonly inFlight: Set<AbortController>;
  serverPrepared: ServerPrepared | null;
  documentRequestBytes: number;
  scopeIndexCache: ScopeIndexCache | null;
  prepared: PreparedDocument | null;
  busy: boolean;
  scenarioProgress: ScenarioProgress | null;
  grantGeneration: number;
};

export type AgentScenarioProgressRead = Readonly<{
  pageEpoch: string | null;
  runId: string | null;
  revision: number;
  terminal: boolean;
  scenario: ReturnType<typeof safeScenario>;
}>;

export type AgentServiceContext = Readonly<{
  runtime: AgentRuntime;
  panelSessionId: string;
  permission: () => AgentPermission;
  state: AgentServiceState;
  /** Runs one already-admitted inner call (used by read_bundle). */
  dispatch(name: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
  guardedQuery(input: AgentQueryInput, signal?: AbortSignal): Promise<EvidenceSnapshot>;
  saveNextCursor(query: AgentQueryInput, readPoint: EvidenceReadPoint, cursor: string | null, fields?: readonly string[], maxBytes?: number): string | null;
  fingerprint(scenario: boolean): string;
  snapshot(): { local: ReturnType<typeof safeDraft>; scenario: ReturnType<typeof safeScenario> };
  currentScenarioProgress(): AgentScenarioProgressRead;
  refreshOperations(): void;
}>;

export type AgentToolHandler<N extends AgentToolName> = (args: AgentToolArguments<N>, signal: AbortSignal | undefined) => unknown;
export type AgentToolHandlers = { [N in AgentToolName]?: AgentToolHandler<N> };

export function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("QUERY_CANCELLED: Agent call was cancelled. No read result was published.");
}

/** A cancelled duplicate lookup must not cancel the original publication call. */
export function awaitAgentCall<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(new Error("QUERY_CANCELLED: Document receipt lookup was cancelled.")); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Register a bounded wait that ends on caller cancellation or grant revocation. */
export function beginAgentWait(state: AgentServiceState, signal: AbortSignal | undefined, abortIfCancelled: boolean): { controller: AbortController; end(): void } {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  state.waits.add(controller); signal?.addEventListener("abort", cancel, { once: true });
  if (abortIfCancelled && signal?.aborted) cancel();
  return { controller, end() { signal?.removeEventListener("abort", cancel); state.waits.delete(controller); } };
}
