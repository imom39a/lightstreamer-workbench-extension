/**
 * Runtime-internal Local Injection Draft and Scenario state shared by the
 * runtime and the agent adapter, plus pure helpers over that state. Public
 * snapshot types defined here are re-exported from workbench-runtime.ts.
 */
import {
  type LightstreamerEventEnvelope
} from "../../core/event-envelope";
import {
  type EvidenceRef
} from "../../core/event-history-authoritative";
import {
  type DeterministicEvidenceRecord,
  type EvidenceIdentity,
  type EvidenceReadPoint
} from "../../core/evidence-filter-contract";
import {
  type NativeReviewedChangeFacts
} from "../../core/local-injection-change-semantics";
import {
  type LocalInjectionDiagnostic,
  type LocalInjectionDocument
} from "../../core/local-injection-document";
import {
  createNewItemDraftFromContext,
  type ReinjectionDraft,
  type ReinjectionExecutionTarget
} from "../../core/reinjection-draft";
import {
  type TopologySelectionTarget
} from "./topology-view-model";
import {
  type LocalInjectionOutcome,
  type LocalInjectionReview
} from "./local-injection-execution-coordinator";
import {
  type LocalInjectionScenario,
  type ScenarioEditorState,
  type ScenarioMembershipPreview,
  type ScenarioRun
} from "../../core/local-injection-scenario";
import {
  type ScenarioRunner,
  type ScenarioRunnerSnapshot
} from "../../core/local-injection-scenario-runner";

export type WorkbenchLocalInjectionAnchor = Readonly<{
  sourceKind: "captured-event" | "authored";
  sourceEventId: string | null;
  pageEpoch: string | null;
  clientId: string | null;
  sessionId: string | null;
  subscriptionId: string;
  subscriptionMode: string | null;
  itemName: string | null;
  itemPosition: number | null;
  listenerId: string | null;
  captureSource: "listener" | "wire";
  executionTarget: ReinjectionExecutionTarget;
  fieldSchema: readonly string[];
}>;

export type WorkbenchLocalInjectionOutcome = LocalInjectionOutcome;

export type WorkbenchLocalInjectionRestorationOrigin = Readonly<{
  scopeId: string | null;
  selectionEventId: string | null;
  focusedEventId: string | null;
  contextId: string | null;
}>;

export type WorkbenchScenarioCaptureWorkspace = Readonly<{
  search: string;
  commandFilter: "ALL" | "ADD" | "UPDATE" | "DELETE";
  queryState: "idle" | "loading" | "ready" | "error";
  expired: boolean;
  newerAcceptedEvidenceCount: number;
  remainingStepCapacity: number;
  readPoint: EvidenceReadPoint | null;
  rows: readonly Readonly<{ identity: EvidenceIdentity; event: LightstreamerEventEnvelope; preview: string; available: boolean; reason: string | null; alreadyUsed: boolean; selected: boolean }>[];
  selected: readonly EvidenceIdentity[];
  total: number;
  pageOffset: number;
  pageSize: number;
  canShowOlder: boolean;
  canShowNewer: boolean;
  error: string | null;
  feedback: string | null;
  adding: boolean;
  scrollTop: number;
}>;

export type ScenarioCaptureWorkspaceState = {
  search: string;
  commandFilter: WorkbenchScenarioCaptureWorkspace["commandFilter"];
  queryState: WorkbenchScenarioCaptureWorkspace["queryState"];
  readPoint: EvidenceReadPoint | null;
  records: readonly DeterministicEvidenceRecord[];
  selected: Map<string, EvidenceIdentity>;
  total: number;
  pageOffset: number;
  cursors: Array<string | undefined>;
  nextCursor: string | null;
  error: string | null;
  feedback: string | null;
  adding: boolean;
  scrollTop: number;
  generation: number;
};

export function emptyScenarioCaptureWorkspace(): ScenarioCaptureWorkspaceState {
  return { search: "", commandFilter: "ALL", queryState: "idle", readPoint: null, records: [], selected: new Map(), total: 0, pageOffset: 0, cursors: [undefined], nextCursor: null, error: null, feedback: null, adding: false, scrollTop: 0, generation: 0 };
}

export type LocalInjectionEntryIntent =
  | { kind: "selected-event"; eventId: string }
  | { kind: "scope-author"; scopeId: string };

/** The per-Step document input for Scenario native-change review. */
export type ScenarioNativeChangeStep = Readonly<{
  id: string;
  document?: Readonly<LocalInjectionDocument>;
  draft?: { document: Readonly<LocalInjectionDocument> | null };
}>;

export type LocalInjectionDraftState = {
  id: string;
  baseDraft: ReinjectionDraft;
  anchor: WorkbenchLocalInjectionAnchor;
  rawText: string;
  document: LocalInjectionDocument | null;
  documentDiagnostics: readonly LocalInjectionDiagnostic[];
  targetDiagnostics: readonly LocalInjectionDiagnostic[];
  sourceDocument: LocalInjectionDocument | null;
  sourceRawText: string | null;
  explicitConcreteFields: Set<string>;
  phase: "edit" | "review" | "pending" | "outcome";
  compareOpen: boolean;
  editorPresentation: ScenarioEditorState;
  parked: boolean;
  open: boolean;
  restorationOrigin: WorkbenchLocalInjectionRestorationOrigin;
  executionId: string | null;
  preflightFingerprint: string | null;
  outcome: WorkbenchLocalInjectionOutcome | null;
  reviewedExecution: LocalInjectionReview | null;
  reviewRefusal: string | null;
  relativeDelayMs: number;
  nativeChanges?: NativeReviewedChangeFacts;
};

export type ScenarioState = {
  phase: "edit" | "review" | "running" | "paused" | "complete" | "stopped";
  parked: boolean;
  discardConfirmation: boolean;
  scenario: LocalInjectionScenario;
  drafts: Map<string, LocalInjectionDraftState>;
  run: ScenarioRun | null;
  reviews: Map<string, LocalInjectionReview>;
  membershipError: string | null;
  /** Invalid partial primitive authoring belongs to this Scenario until corrected or removed. */
  invalidPrimitiveAssertionIds: Set<string>;
  pickerOpen: boolean;
  captureWorkspace: ScenarioCaptureWorkspaceState;
  lastCaptureAddition?: { revision: number; ids: readonly string[] };
  membershipPreview: ScenarioMembershipPreview | null;
  focusedMemberId: string;
  focusedStepId: string;
  removedDrafts: Map<string, LocalInjectionDraftState>;
  priorRuns: ScenarioRun[];
  retainedRunBytes: number;
  runner: ScenarioRunner | null;
  runnerSnapshot: ScenarioRunnerSnapshot | null;
  serverInterleaves: EvidenceRef[];
};

export function localInjectionFieldSchema(
  captured: readonly string[] | null | undefined,
  observed: Readonly<Record<string, unknown>> | undefined
): string[] {
  const fields: string[] = [];
  for (const field of captured ?? Object.keys(observed ?? {})) {
    if (field.trim() && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

export function anchorFromDraft(
  draft: ReinjectionDraft,
  sourceKind: WorkbenchLocalInjectionAnchor["sourceKind"],
  pageEpoch: string | null,
  fieldSchema: readonly string[]
): WorkbenchLocalInjectionAnchor {
  const executionTarget: ReinjectionExecutionTarget =
    draft.target.listenerId || draft.captureSource !== "wire"
      ? "captured-listener"
      : "captured-wire";
  return Object.freeze({
    sourceKind,
    sourceEventId: sourceKind === "captured-event" ? draft.sourceEventId : null,
    pageEpoch,
    clientId: draft.sourceClient?.id ?? null,
    sessionId: draft.sourceClient?.sessionId ?? null,
    subscriptionId: draft.target.subscriptionId!,
    subscriptionMode: draft.subscriptionMode ?? null,
    itemName: draft.item.name ?? null,
    itemPosition: draft.item.position ?? null,
    listenerId: draft.target.listenerId,
    captureSource: draft.captureSource ?? "listener",
    executionTarget,
    fieldSchema: Object.freeze([...fieldSchema])
  });
}

export function authoredDraftFromScope(
  target: TopologySelectionTarget | null,
  pageEpoch: string | null
): { draft: ReinjectionDraft; anchor: WorkbenchLocalInjectionAnchor } | null {
  if (!target || (target.kind !== "subscription" && target.kind !== "item" && target.kind !== "listener")) return null;
  if (!target.client || !target.session || target.session.historical || !target.session.active) return null;
  const subscription = target.subscription;
  const item = target.kind === "subscription"
    ? subscription.items.length === 1 ? subscription.items[0] ?? null : null
    : target.item;
  if (!item || !["COMMAND", "MERGE", "DISTINCT"].includes(subscription.mode ?? "") || subscription.historical || !subscription.active) return null;
  const listener = target.kind === "listener"
    ? target.listener
    : subscription.listeners.find(
        (candidate) => candidate.active && item.listenerIds.includes(candidate.id)
      ) ?? null;
  if (!listener?.active) return null;
  const fieldSchema = localInjectionFieldSchema(subscription.fields, undefined);
  if (fieldSchema.length === 0 || (subscription.mode === "COMMAND" && (!fieldSchema.includes("command") || !fieldSchema.includes("key")))) return null;
  const sourceClient = {
    id: target.client.id,
    status: target.client.status,
    sessionId: target.session.id,
    transport: target.session.transport
  };
  const sourceSubscription = {
    id: subscription.id,
    mode: subscription.mode,
    fields: [...fieldSchema],
    items: subscription.configuredItems ? [...subscription.configuredItems] : undefined,
    active: subscription.active,
    subscribed: subscription.serverEstablished
  };
  const draft = createNewItemDraftFromContext({
    subscriptionId: subscription.id,
    mode: subscription.mode,
    listenerId: listener.id,
    captureSource: "listener",
    itemName: item.name,
    itemPosition: item.position,
    fields: [...fieldSchema]
  });
  if (!draft) return null;
  const protectedDraft: ReinjectionDraft = {
    ...draft,
    sourceClient,
    sourceSubscription
  };
  return {
    draft: protectedDraft,
    anchor: anchorFromDraft(protectedDraft, "authored", pageEpoch, fieldSchema)
  };
}

export function localInjectionReady(draft: LocalInjectionDraftState): boolean {
  return Boolean(draft.document) &&
    draft.documentDiagnostics.every(({ severity }) => severity !== "error") &&
    draft.targetDiagnostics.every(({ severity }) => severity !== "error");
}

export function agentTarget(draft: LocalInjectionDraftState) {
  return Object.freeze({
    pageEpoch: draft.anchor.pageEpoch,
    clientId: draft.anchor.clientId,
    sessionId: draft.anchor.sessionId,
    subscriptionId: draft.anchor.subscriptionId,
    deliveryPath: draft.anchor.executionTarget === "captured-listener" ? "listener" as const : "wire" as const,
    mode: draft.anchor.subscriptionMode
  });
}

export function candidateReplayability(
  draft: LocalInjectionDraftState,
  fields: readonly Readonly<{ field: string; classification: string; reason?: string }>[]
) {
  if (!draft.sourceRawText) return Object.freeze({ source: "source-free" as const, replayable: true, fields: Object.freeze([]), limitation: "No captured Injection Source exists; field values are authored and are not evidence of application state." });
  const states = fields.map(field => {
    const removedWhereOptional = Boolean(draft.document) && !Object.prototype.hasOwnProperty.call(draft.document!.fields, field.field) && !draft.anchor.fieldSchema.includes(field.field);
    const resolved = field.classification === "executable" || draft.explicitConcreteFields.has(field.field) || removedWhereOptional;
    return Object.freeze({ ...field, resolved, limitation: resolved ? null : "Replace this captured value with a concrete Draft value or remove it where the target schema permits." });
  });
  return Object.freeze({ source: "captured" as const, replayable: states.every(field => field.resolved), fields: Object.freeze(states), limitation: null });
}

export function cloneReinjectionDraft(draft: ReinjectionDraft): ReinjectionDraft {
  return {
    ...draft,
    ...(draft.sourceClient ? { sourceClient: { ...draft.sourceClient } } : {}),
    ...(draft.sourceSubscription
      ? {
          sourceSubscription: {
            ...draft.sourceSubscription,
            ...(draft.sourceSubscription.items ? { items: [...draft.sourceSubscription.items] } : {}),
            ...(draft.sourceSubscription.fields ? { fields: [...draft.sourceSubscription.fields] } : {})
          }
        }
      : {}),
    target: { ...draft.target },
    item: { ...draft.item },
    fields: { ...draft.fields },
    sourceFields: { ...draft.sourceFields },
    fieldValueStates: { ...draft.fieldValueStates },
    sourceFieldValueStates: { ...draft.sourceFieldValueStates },
    changedFields: { ...draft.changedFields },
    originalChangedFields: { ...draft.originalChangedFields },
    provenance: { ...draft.provenance }
  };
}

export function lightstreamerPayload(value: unknown): LightstreamerEventEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<LightstreamerEventEnvelope>;
  return typeof candidate.id === "string" &&
      typeof candidate.timestamp === "number" &&
      (candidate.direction === "inbound" || candidate.direction === "outbound") &&
      (candidate.source === "server" ||
        candidate.source === "synthetic" ||
        candidate.source === "application" ||
        candidate.source === "workbench") &&
      typeof candidate.synthetic === "boolean" &&
      typeof candidate.kind === "string"
    ? candidate as LightstreamerEventEnvelope
    : null;
}

/**
 * The protected Draft for one Scenario Step. A missing entry means Scenario
 * membership and its Draft map diverged; report it by Step identity instead
 * of failing later on an undefined Draft.
 */
export function scenarioStepDraft(
  drafts: ReadonlyMap<string, LocalInjectionDraftState>,
  stepId: string
): LocalInjectionDraftState {
  const draft = drafts.get(stepId);
  if (!draft) throw new Error(`Scenario Step ${stepId} has no protected Draft.`);
  return draft;
}

/** The first Step's Draft, which anchors the Scenario's single target. */
export function scenarioReferenceDraft(state: Pick<ScenarioState, "scenario" | "drafts">): LocalInjectionDraftState {
  const first = state.scenario.steps[0];
  if (!first) throw new Error("A Scenario requires at least one Step.");
  return scenarioStepDraft(state.drafts, first.id);
}

export function rememberExplicitConcreteFields(
  fields: Set<string>,
  previous: LocalInjectionDocument | null,
  next: LocalInjectionDocument | null
): void {
  if (!previous || !next) return;
  const names = new Set([
    ...Object.keys(previous.fields),
    ...Object.keys(next.fields)
  ]);
  for (const name of names) {
    const previousHas = Object.prototype.hasOwnProperty.call(previous.fields, name);
    const nextHas = Object.prototype.hasOwnProperty.call(next.fields, name);
    if (
      previousHas !== nextHas ||
      (previousHas && stableJson(previous.fields[name]) !== stableJson(next.fields[name]))
    ) {
      fields.add(name);
    }
  }
}

export function isActiveLocalInjectionDeliveryListener(
  listener: Readonly<{ active: boolean; callbacks: readonly string[] }>
): boolean {
  return listener.active && listener.callbacks.includes("onItemUpdate");
}

export function hashLocalInjectionValue(value: unknown): string {
  const text = stableJson(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `li-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
