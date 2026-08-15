import { type CaptureMessage, type CaptureStatus, type TopologySyncFrame } from "../../bridge/messages";
import { createCommandStateProjections, type CommandState, type CommandStateProjections } from "../../core/command-state";
import type {
  ScenarioAssertionObservation,
  ScenarioCommittedBoundaryFeed,
  ScenarioCommittedBoundarySnapshot
} from "../../core/local-injection-scenario-checkpoint";
import {
  toPersistableEventEnvelope,
  type LightstreamerEventEnvelope
} from "../../core/event-envelope";
import { createEventNormalizer, type EventNormalizer } from "../../core/event-normalizer";
import {
  DIAGNOSTIC_TEXT_MAX_LENGTH,
  createMemoryDiagnosticObservationJournal,
  diagnosticObservationIdentity,
  type DiagnosticAffectedIdentity,
  type DiagnosticObservationInput,
  type DiagnosticObservationJournal
} from "../../core/diagnostic-observation";
import {
  DIAGNOSTIC_FILTER_FACETS,
  createDiagnosticObservationIndex,
  type DiagnosticFilterCriteria,
  type DiagnosticFilterFacet
} from "../../core/diagnostic-observation-index";
import {
  adaptCommittedEvidenceFinding,
  adaptWorkbenchConditionFinding
} from "../../core/diagnostic-observation-adapters";
import { presentDiagnosticObservation } from "../../core/diagnostic-observation-presentation";
import {
  commitSubscriptionDiagnosticProposalsAdvisory,
  createSubscriptionDiagnosticProducer,
  type SubscriptionDiagnosticProducer,
  type SubscriptionDiagnosticProposal
} from "../../core/subscription-diagnostic-producer";
import {
  createCommittedTopologyDiagnosticCoordinator,
  type CommittedTopologyDiagnosticCoordinator
} from "./committed-topology-diagnostic-coordinator";
import {
  createInMemoryEventHistory,
  type EvidenceRef,
  type EventHistory,
  type HistoryPublication,
  type HistoryProblem,
  type HistoryStatus
} from "../../core/event-history-authoritative";
import {
  type CommittedEvidence
} from "../../core/event-history-authoritative";
import {
  applyFilterMutations,
  createFilter,
  createTypedFilterValue,
  type FilterMutation,
  type Filter
} from "../../core/filter-algebra";
import {
  MAX_EVIDENCE_PAGE_SIZE,
  type DeterministicEvidenceRecord,
  type EvidenceFilterReadProblem,
  type EvidenceFindResult,
  type EvidenceIdentity,
  type EvidenceReadPoint,
  type EvidenceLookupResult,
  type EvidenceSnapshot,
  type RevealBlocker,
  type FacetDiscoveryRequest,
  type FacetDiscoveryResult,
  type TypedFacetValue
} from "../../core/evidence-filter-contract";
import { cloneAndFreezeJsonValue, expandJsonStringFields } from "../../core/json-string-fields";
import {
  analyzeLocalInjectionDocument,
  applyLocalInjectionDocumentToDraft,
  createLocalInjectionDocumentFromDraft,
  localInjectionDocumentsEqual,
  serializeLocalInjectionDocument,
  type LocalInjectionDiagnostic,
  type LocalInjectionDocument
} from "../../core/local-injection-document";
import {
  createDraftFromEvent,
  createNewCommandDraftFromContext,
  type ReinjectionDraft,
  type ReinjectionExecutionTarget
} from "../../core/reinjection-draft";
import { createTopologyProjection, type TopologyProjection } from "./topology-projection";
import {
  selectedUpdateSnapshot,
  type SelectedUpdateSnapshot
} from "./selected-update-view-model";
import {
  createTopologyStructuredSnapshot,
  serializeTopologySnapshot,
  topologySensitiveCategoryCounts,
  topologySnapshotFilename,
  TOPOLOGY_SENSITIVE_CATEGORIES,
  type TopologySensitiveCategory,
  type TopologyStructuredSnapshot
} from "./topology-export";
import {
  topologyClientNodePresentation,
  topologyItemNodePresentation,
  topologyListenerNodePresentation,
  topologyPageNodePresentation,
  topologySessionNodePresentation,
  topologySubscriptionNodePresentation,
  findTopologySelection,
  type TopologySelection,
  type TopologySelectionTarget
} from "./topology-view-model";
import {
  type TopologyConnectionState,
  type TopologyState,
  type TopologySubscription
} from "../../core/topology-state";
import { type TopologyProjectionStatus } from "./topology-projection";
import {
  bindCommittedEvidencePipeline,
  type CommittedEvidencePipeline,
  type CommittedEvidencePipelineFollowerState
} from "./committed-evidence-pipeline";
import {
  createEvidenceInvestigationQuery,
  type EvidenceInvestigationQuery,
  type EvidenceInvestigationQueryRequest,
  type StructuralEvidenceScope
} from "./evidence-investigation-query";
import {
  createEvidenceFilterActionDescriptors,
  filterMutationsForAction,
  type EvidenceFilterActionDescriptor
} from "../../core/evidence-filter-actions";
import {
  historyConditionFor,
  type WorkbenchHistoryCondition
} from "./history-condition";
import {
  storageHeadroomDiagnostic,
  type StorageEstimateObservation,
  type StorageHeadroomSampler,
  type StorageEstimateThreshold
} from "./storage-headroom";
import {
  createActivityProjection,
  failedActivityProjection,
  clipActivityTimeRange,
  matchesActivityEvidence,
  type ActivityEvidence,
  type ActivityProjection,
  type ActivityProjectionInput,
  type ActivityScope,
  type ActivityReadPoint
} from "../../core/activity-projection";
import {
  closeActivityDocument,
  openActivityDocument,
  reconcileActivityDocumentProjection,
  reduceActivityDocument,
  type ActivityDocumentState
} from "../../core/activity-document";
import {
  createLocalInjectionExecutionCoordinator,
  type LocalInjectionExecutionCoordinator,
  type LocalInjectionCoordinatorExecution,
  type LocalInjectionExecutionRequest,
  type LocalInjectionExecutionResult,
  type LocalInjectionExecutor,
  type LocalInjectionOutcome,
  type LocalInjectionReview
} from "./local-injection-execution-coordinator";
import {
  addScenarioCheckpoint,
  addScenarioStep,
  admitScenarioValidation,
  confirmScenarioMembershipPreview,
  createScenarioFromDraft,
  duplicateScenarioStep,
  moveScenarioMember,
  moveScenarioStep,
  previewScenarioMembership,
  removeScenarioStep,
  removeScenarioCheckpoint,
  reviewScenario,
  markScenarioEvidenceUnavailableAfterClear,
  terminalizeScenarioRun,
  scenarioTargetIncompatibility,
  undoScenarioStepRemoval,
  updateScenarioCheckpoint,
  updateScenarioStepDraft,
  updateScenarioStepPresentation,
  updateScenarioSpeed,
  type LocalInjectionScenario,
  type ScenarioDraftInput,
  type ScenarioCheckpoint,
  type ScenarioEditorState,
  type ScenarioMembershipPreview,
  type ScenarioRun,
  type ScenarioSpeed
} from "../../core/local-injection-scenario";
import {
  createLocalInjectionScenarioRunner,
  type ScenarioClock,
  type ScenarioRunner,
  type ScenarioRunnerSnapshot
} from "../../core/local-injection-scenario-runner";

export type {
  LocalInjectionExecutionRequest,
  LocalInjectionExecutionResult,
  LocalInjectionExecutor
} from "./local-injection-execution-coordinator";

export const DEFAULT_EVIDENCE_WINDOW_SIZE = 60;
export const DEFAULT_EVIDENCE_OUTPUT_BYTE_LIMIT = 32 * 1024 * 1024;

export type WorkbenchEvidenceOperationOutcome =
  | "CANCELLED"
  | "OUTPUT_REFUSED"
  | "HISTORY_UNAVAILABLE"
  | "HISTORY_TERMINAL"
  | "QUERY_FAILED"
  | "SERIALIZATION_FAILED";

export type WorkbenchEvidenceOperationProgress = Readonly<{
  phase: "LATCHING" | "READING" | "SERIALIZING" | "COMPLETE" | "CANCELLED" | "REFUSED" | "FAILED";
  completed: number;
  total: number | null;
  outputBytes: number;
  outputByteLimit: number;
  interval: EvidenceReadPoint["interval"] | null;
  committedEvidenceBoundary: EvidenceIdentity | null;
  excludedAfterLatch: number;
}>;

export type WorkbenchCaptureSnapshot = Readonly<{
  operation: "RUNNING" | "IDLE" | "STOPPED";
  coverage: "USEFUL" | "LIMITED" | "UNAVAILABLE";
  firstMissingEventId: string | null;
  committedEvidenceBoundary: EvidenceRef | null;
  detail?: string;
  recovery?: string;
}>;

export type WorkbenchEvidence = Readonly<{
  id: string;
  time: string;
  source: "SERVER" | "LOCAL" | "RUNTIME" | "WORKBENCH";
  phase: "SNAPSHOT" | "LIVE" | "END OF SNAPSHOT" | "—";
  command: string | null;
  commandKey: string | null;
  kind: string;
  object: string;
  summary: string;
  raw: LightstreamerEventEnvelope;
}>;

export type WorkbenchStructuralScopeKind =
  | "page"
  | "client"
  | "session"
  | "subscription"
  | "item"
  | "listener";

export type WorkbenchScopeLifecycle =
  | "active"
  | "inactive"
  | "recovering"
  | "stalled"
  | "disconnected"
  | "retired"
  | "unknown";

export type WorkbenchScopeNode = Readonly<{
  id: string;
  kind: WorkbenchStructuralScopeKind;
  label: string;
  detail?: string;
  parentId: string | null;
  depth: number;
  tone: string;
  lifecycle: WorkbenchScopeLifecycle;
  retired: boolean;
  selected: boolean;
}>;

export type WorkbenchScopeStructureNode = Readonly<
  Pick<WorkbenchScopeNode, "id" | "kind" | "label" | "parentId" | "depth">
>;

type ScopeSubscriptionLocator = Readonly<{
  clientIndex: number | null;
  sessionIndex: number | null;
  collection: "waiting" | "session" | "unassigned";
  subscriptionIndex: number;
}>;

type ScopeNodeDescriptor = WorkbenchScopeStructureNode & Readonly<{
  locator:
    | { kind: "page" }
    | { kind: "client"; clientIndex: number }
    | { kind: "session"; clientIndex: number; sessionIndex: number }
    | ({ kind: "subscription" } & ScopeSubscriptionLocator)
    | ({ kind: "item"; itemIndex: number } & ScopeSubscriptionLocator)
    | ({ kind: "listener"; itemIndex: number | null; listenerId: string } & ScopeSubscriptionLocator);
}>;

export type WorkbenchStorageSnapshot = Readonly<{
  mode: "indexeddb" | "memory";
  reason?: string;
}>;

export type WorkbenchRetentionSnapshot = Readonly<{
  historyStatus: HistoryStatus;
  clearState: "idle" | "confirming" | "clearing" | "error";
  clearError?: string;
}>;

export type WorkbenchExportSnapshot = Readonly<{
  activeScopeId: string | null;
  redactions: readonly TopologySensitiveCategory[];
  sensitiveCounts: Readonly<Record<TopologySensitiveCategory, number>>;
  completeEvidence: boolean;
  document: Readonly<TopologyStructuredSnapshot> | null;
  json: string | null;
  filename: string | null;
  html?: string | null;
  operation?: Readonly<{
    state: "preparing" | "ready" | "cancelled" | "refused" | "error";
    error?: string;
    outcome?: WorkbenchEvidenceOperationOutcome;
    recovery?: string;
    progress: WorkbenchEvidenceOperationProgress;
  }>;
}>;

export type WorkbenchContextSnapshot = Readonly<{
  kind: "evidence" | "runtime";
  title: string;
  fields: readonly (readonly [string, string])[];
  /** Full retained Item Update evidence, independent of the evidence window. */
  selectedUpdate: SelectedUpdateSnapshot | null;
  /** Typed Include, Exclude, and Around actions for selected Evidence. */
  filterActions?: readonly EvidenceFilterActionDescriptor[];
  diagnostics: readonly WorkbenchDiagnostic[];
  diagnosticFilter: Readonly<{
    criteria: DiagnosticFilterCriteria;
    active: boolean;
    options: Readonly<Record<DiagnosticFilterFacet, readonly Readonly<{ value: TypedFacetValue; count: number }>[]>>;
  }>;
}>;

export type WorkbenchCommandProjection = Readonly<{
  name: string;
  basis: string;
  rows: readonly (readonly [string, string])[];
  supportingLocalEvidenceId?: string;
}>;

export type WorkbenchDiagnostic = Readonly<{
  id?: string;
  code?: string;
  severity: "Information" | "Warning" | "Error";
  title: string;
  affected: string;
  detail: string;
  recovery?: string;
  limitation?: string;
  consequence?: string;
  route?:
    | Readonly<{ kind: "inspect-evidence"; evidence: EvidenceRef; label: string }>
    | Readonly<{ kind: "inspect-affected"; affected: DiagnosticAffectedIdentity; label: string }>;
  affectedIdentity?: DiagnosticAffectedIdentity;
  filterFacets?: Readonly<Record<DiagnosticFilterFacet, readonly TypedFacetValue[]>>;
  category?: "activity" | "history" | "capture" | "session" | "retention" | "storage";
}>;

export type WorkbenchEvidenceSnapshot = Readonly<{
  events: readonly WorkbenchEvidence[];
  loading: boolean;
  total: number;
  windowSize: number;
  mode: "live" | "frozen";
  newerCount: number;
  offset: number;
  scrollTop?: number;
  visibleStart: number;
  visibleEnd: number;
  hasOlder: boolean;
  hasNewer: boolean;
  find: string;
  findState: Readonly<{
    query: string;
    matchCount: number;
    currentIndex: number;
    currentEventId: string | null;
  }>;
  filterMutation: WorkbenchFilterMutationSnapshot;
  restoration: WorkbenchInvestigationRestorationSnapshot;
  filterRecoveryFocused: boolean;
  focusedEventId: string | null;
  selectedEventId: string | null;
  hiddenSelection: Readonly<{
    eventId: string;
    message: "Selected event outside current results";
    canReveal: boolean;
    revealUnavailableReason?: string;
    canClear: true;
  }> | null;
  investigation: WorkbenchEvidenceInvestigationSnapshot;
}>;

export type WorkbenchFilterMutationSnapshot = Readonly<{
  state: "idle" | "applied" | "no-op" | "stale" | "invalid" | "revealed";
  revision: number;
  changed: boolean;
  message: string | null;
  removedCriteria: number;
}>;

export type WorkbenchInvestigationRestorationSnapshot = Readonly<{
  canBack: boolean;
  canForward: boolean;
  barrier: number;
  current: number;
}>;

export type WorkbenchEvidenceInvestigationSnapshot = Readonly<{
  /** The exact structural axis and canonical user Filter used for this query. */
  scope: StructuralEvidenceScope;
  filter: Filter;
  /** The single read point represented by every published Evidence fact. */
  readPoint: EvidenceSnapshot["readPoint"] | null;
  historyInterval: EvidenceSnapshot["readPoint"]["interval"] | null;
  representedEvidenceBoundary: EvidenceIdentity | null;
  retainedRange: EvidenceSnapshot["readPoint"]["retainedRange"];
  page: Readonly<{
    evidence: readonly DeterministicEvidenceRecord[];
    nextCursor: string | null;
  }>;
  counts: Readonly<{
    shown: number;
    matching: number;
    inScope: number;
  }>;
  discoveries: ReadonlyMap<string, FacetDiscoveryResult>;
  lookup: EvidenceLookupResult | null;
  find: EvidenceFindResult | null;
  evaluation: EvidenceSnapshot["evaluation"] | null;
  coverage: EvidenceSnapshot["coverage"] | null;
  storage: EvidenceSnapshot["storage"] | null;
  queryState: "idle" | "loading" | "ready" | "error";
  problem: EvidenceFilterReadProblem | null;
}>;

export type WorkbenchEvidenceCopySnapshot = Readonly<{
  state: "idle" | "preparing" | "ready" | "cancelled" | "refused" | "error";
  eventCount: number;
  text: string | null;
  error?: string;
  outcome?: WorkbenchEvidenceOperationOutcome;
  recovery?: string;
  progress?: WorkbenchEvidenceOperationProgress;
}>;

export type WorkbenchActivitySnapshot = Readonly<{
  open: boolean;
  transition: Readonly<{
    sequence: number;
    kind: "idle" | "opened" | "explicit-close" | "supporting-evidence" | "back";
  }>;
  projection: ActivityProjection;
  scope: ActivityScope;
  filter: Filter;
  readPoint: ActivityReadPoint;
  document: ActivityDocumentState | null;
}>;

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

export type WorkbenchLocalInjectionSnapshot = Readonly<{
  state: "idle" | "active";
  availability: Readonly<{
    selectedUpdate: Readonly<{ available: boolean; reason: string | null }>;
    commandScope: Readonly<{ available: boolean; reason: string | null }>;
  }>;
  entryError: string | null;
  blockedEntry: Readonly<{ kind: "selected-event" | "scope-author"; label: string }> | null;
  discardConfirmation: boolean;
  draft: Readonly<{
    id: string;
    phase: "edit" | "review" | "pending" | "outcome";
    rawText: string;
    document: Readonly<LocalInjectionDocument> | null;
    diagnostics: readonly LocalInjectionDiagnostic[];
    ready: boolean;
    anchor: WorkbenchLocalInjectionAnchor;
    source: Readonly<{ kind: "captured-event" | "authored"; rawText: string | null }>;
    compareStatus: "unchanged" | "changed" | "no-source";
    compareOpen: boolean;
    editorPresentation: ScenarioEditorState;
    minimized: boolean;
    parked: boolean;
    open: boolean;
    restorationOrigin: WorkbenchLocalInjectionRestorationOrigin;
    executionId: string | null;
    preflightFingerprint: string | null;
    outcome: WorkbenchLocalInjectionOutcome | null;
  }> | null;
}>;

export type WorkbenchScenarioSnapshot = Readonly<{
  phase: "edit" | "review" | "running" | "paused" | "complete" | "stopped";
  scenario: LocalInjectionScenario;
  run: ScenarioRun | null;
  membershipError: string | null;
  pickerOpen: boolean;
  membership: readonly Readonly<{ eventId: string; available: boolean; reason: string | null }>[];
  membershipPreview: Readonly<{
    scenarioRevision: number;
    members: readonly Readonly<{ eventId: string; intervalId: string; retainedSequence: number; available: boolean; reason: string | null }>[];
  }> | null;
  focusedMemberId: string;
  focusedStepId: string;
  canUndoRemoval: boolean;
  priorRuns: readonly ScenarioRun[];
  retainedRunBytes: number;
  runner: ScenarioRunnerSnapshot | null;
}> | null;

/** The immutable, renderer-neutral investigation state for one panel session. */
export type WorkbenchSnapshot = Readonly<{
  version: number;
  /** Identity-only boundary represented by this immutable renderer snapshot. */
  renderedEvidenceBoundary: EvidenceRef | null;
  visible: boolean;
  theme: "auto" | "dark" | "light";
  captureStatus: CaptureStatus;
  capture: WorkbenchCaptureSnapshot;
  scopeId: string | null;
  scope: Readonly<{
    label: string;
    status: string;
    structureRevision: number;
    structure: readonly WorkbenchScopeStructureNode[];
    resolveNode(scopeId: string): WorkbenchScopeNode | null;
    nodes: readonly WorkbenchScopeNode[];
    focusedNodeId: string | null;
    selection: Readonly<{
      id: string;
      kind: WorkbenchStructuralScopeKind;
      retired: boolean;
    }> | null;
    coverage: Readonly<{
      semantic: boolean;
      status: "USEFUL" | "LIMITED";
      detail: string;
    }>;
  }>;
  selectionEventId: string | null;
  selectedEvidence?: WorkbenchEvidence | null;
  contextId: string | null;
  context: WorkbenchContextSnapshot;
  commandProjections: Readonly<{
    observed: WorkbenchCommandProjection;
    localEffective: WorkbenchCommandProjection;
    authoritativeLimit: string;
  }>;
  diagnostics: readonly WorkbenchDiagnostic[];
  historyCondition: WorkbenchHistoryCondition | null;
  historyAnnouncement: string;
  storage: WorkbenchStorageSnapshot;
  retention: WorkbenchRetentionSnapshot;
  export: WorkbenchExportSnapshot;
  evidenceCopy: WorkbenchEvidenceCopySnapshot;
  activity?: WorkbenchActivitySnapshot;
  localInjection: WorkbenchLocalInjectionSnapshot;
  scenario?: WorkbenchScenarioSnapshot;
  evidence: WorkbenchEvidenceSnapshot;
}>;

export type WorkbenchCommand =
  | { type: "set-visible"; visible: boolean }
  | { type: "set-theme"; theme: "auto" | "dark" | "light" }
  | { type: "set-capture-status"; status: CaptureStatus }
  | { type: "ingest-capture-message"; message: CaptureMessage }
  | { type: "apply-topology-sync-frame"; frame: TopologySyncFrame }
  | { type: "set-scope"; scopeId: string | null }
  | { type: "set-scope-focus"; scopeId: string | null }
  | { type: "set-storage-state"; storage: WorkbenchStorageSnapshot }
  | { type: "request-clear-history" }
  | { type: "cancel-clear-history" }
  | { type: "confirm-clear-history" }
  | { type: "set-export-redactions"; redactions: readonly TopologySensitiveCategory[] }
  | { type: "set-export-complete-evidence"; complete: boolean }
  | { type: "apply-filter-mutations"; expectedRevision: number; operations: readonly FilterMutation[] }
  | { type: "mutate-filter"; expectedRevision: number; operations: readonly FilterMutation[] }
  | { type: "reset-filter"; expectedRevision: number }
  | { type: "apply-filter-builder"; expectedRevision: number; operations: readonly FilterMutation[] }
  | { type: "apply-filter-action"; expectedRevision: number; action: EvidenceFilterActionDescriptor }
  | { type: "apply-contextual-filter-action"; expectedRevision: number; action: EvidenceFilterActionDescriptor }
  | { type: "request-filter-discovery"; request: FacetDiscoveryRequest | null }
  | { type: "reveal-selected-evidence" }
  | { type: "clear-evidence-selection" }
  | { type: "set-find"; value: string }
  | { type: "find-next" }
  | { type: "find-previous" }
  | { type: "clear-find" }
  | { type: "show-older-evidence" }
  | { type: "show-newer-evidence" }
  | { type: "show-oldest-evidence" }
  | { type: "show-newest-evidence" }
  | { type: "prepare-scoped-evidence-copy" }
  | { type: "clear-scoped-evidence-copy" }
  | { type: "cancel-evidence-operation" }
  | { type: "begin-local-injection-from-selection" }
  | { type: "begin-local-injection-from-scope" }
  | { type: "set-local-injection-json"; text: string }
  | { type: "set-local-injection-editor-presentation"; presentation: ScenarioEditorState }
  | { type: "review-local-injection" }
  | { type: "edit-local-injection" }
  | { type: "execute-local-injection" }
  | { type: "set-local-injection-compare"; open: boolean }
  | { type: "set-local-injection-minimized"; minimized: boolean }
  | { type: "park-local-injection" }
  | { type: "resume-local-injection" }
  | { type: "request-discard-local-injection" }
  | { type: "cancel-discard-local-injection" }
  | { type: "confirm-discard-local-injection" }
  | { type: "finish-local-injection" }
  | { type: "convert-local-injection-to-scenario" }
  | { type: "open-scenario-evidence-picker" }
  | { type: "close-scenario-evidence-picker" }
  | { type: "add-selected-evidence-to-scenario" }
  | { type: "preview-visible-evidence-for-scenario" }
  | { type: "confirm-scenario-membership-preview" }
  | { type: "add-authored-scenario-step" }
  | { type: "add-scenario-checkpoint" }
  | { type: "update-scenario-checkpoint"; checkpoint: ScenarioCheckpoint }
  | { type: "move-scenario-member"; memberId: string; direction: "earlier" | "later" }
  | { type: "remove-scenario-checkpoint"; checkpointId: string }
  | { type: "show-scenario-checkpoint-evidence"; evidence: EvidenceRef }
  | { type: "move-scenario-step"; stepId: string; direction: "earlier" | "later" }
  | { type: "duplicate-scenario-step"; stepId: string }
  | { type: "remove-scenario-step"; stepId: string }
  | { type: "undo-scenario-step-removal" }
  | { type: "focus-scenario-member"; memberId: string }
  | { type: "focus-scenario-step"; stepId: string }
  | { type: "set-scenario-step-delay"; stepId: string; delayMs: number }
  | { type: "set-scenario-speed"; speed: ScenarioSpeed }
  | { type: "review-scenario" }
  | { type: "re-review-scenario" }
  | { type: "edit-scenario" }
  | { type: "play-scenario" }
  | { type: "pause-scenario" }
  | { type: "stop-scenario" }
  | { type: "step-next-scenario" }
  | { type: "run-scenario-again" }
  | { type: "finish-scenario" }
  | { type: "set-scenario-step-json"; stepId: string; text: string }
  | { type: "set-scenario-step-compare"; stepId: string; open: boolean }
  | { type: "set-scenario-step-editor-presentation"; stepId: string; presentation: ScenarioEditorState }
  | { type: "select-evidence"; eventId: string | null }
  | { type: "focus-evidence"; eventId: string | null }
  | { type: "set-evidence-scroll"; scrollTop: number }
  | { type: "set-context"; contextId: string | null }
  | { type: "open-command-projection-comparison" }
  | { type: "close-command-projection-comparison" }
  | { type: "open-context" }
  | { type: "open-scope" }
  | { type: "open-raw-evidence"; eventId: string }
  | { type: "inspect-diagnostic-evidence"; evidence: EvidenceRef }
  | { type: "inspect-diagnostic-affected"; affected: DiagnosticAffectedIdentity }
  | { type: "apply-diagnostic-filter"; facet: DiagnosticFilterFacet; value: TypedFacetValue; polarity: "include" | "exclude" }
  | { type: "remove-diagnostic-filter"; facet: DiagnosticFilterFacet; value: TypedFacetValue; polarity: "include" | "exclude" }
  | { type: "reset-diagnostic-filter" }
  | { type: "export-scope" }
  | { type: "open-actions" }
  | { type: "close-actions" }
  | { type: "open-activity" }
  | { type: "close-activity" }
  | { type: "show-activity-supporting-evidence"; start?: number; end?: number; filterMutations?: readonly FilterMutation[] }
  | { type: "select-activity"; selection: ActivityDocumentState["selection"] }
  | { type: "set-activity-local-series"; enabled: boolean }
  | { type: "set-activity-timeline-series"; series: ActivityDocumentState["timelineSeries"] }
  | { type: "set-activity-ranking-sort"; sort: ActivityDocumentState["rankingSort"] }
  | { type: "set-activity-scroll"; documentTop?: number; plotLeft?: number }
  | { type: "freeze-activity" }
  | { type: "follow-activity" }
  | { type: "freeze-evidence" }
  | { type: "follow-live" }
  | { type: "back-investigation" }
  | { type: "forward-investigation" }
  | { type: "restore-investigation"; checkpoint: number }
  | { type: "refresh-evidence" };

/**
 * The only renderer-facing seam. It intentionally leaves scheduling, history
 * queries, hidden-panel consolidation, and immutable snapshot caching inside
 * the runtime implementation.
 */
export interface WorkbenchRuntime {
  getSnapshot(): WorkbenchSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: WorkbenchCommand): void;
  dispose(): void;
  disposeAndWait(): Promise<void>;
  /** Settles normalized observations queued by the latest runtime state transition. */
  settleDiagnosticObservations?(): Promise<void>;
  /** Reports the first animation frame after the named React snapshot rendered. */
  reportVisibleFrame?(renderedBoundary?: EvidenceRef | null): void;
  /** Snapshot of identity-only state for the deliberate real-Chrome performance gate. */
  getPerformanceDiagnostics?(): WorkbenchRuntimePerformanceDiagnostics;
  /** Records renderer lifecycle facts for timeout diagnosis; never carries Evidence payloads. */
  reportPanelPerformanceEvent?(event: WorkbenchPanelPerformanceEvent): void;
}

export type WorkbenchPanelPerformanceEvent =
  | Readonly<{ type: "root-mounted"; mounted: boolean }>
  | Readonly<{ type: "subscription-active"; active: boolean }>
  | Readonly<{ type: "layout-effect"; snapshotVersion: number; boundary: EvidenceRef | null }>
  | Readonly<{ type: "animation-frame-requested"; timestampMs: number }>
  | Readonly<{ type: "animation-frame-callback"; timestampMs: number }>
  | Readonly<{ type: "animation-frame-cancelled" }>;

export type WorkbenchPanelPerformanceDiagnostics = Readonly<{
  rootMounted: boolean;
  subscriptionActive: boolean;
  lastLayoutEffectSnapshotVersion: number | null;
  lastLayoutEffectBoundary: EvidenceRef | null;
  animationFramePending: boolean;
  animationFrameRequestCount: number;
  lastAnimationFrameRequestedAtMs: number | null;
  animationFrameCallbackCount: number;
  lastAnimationFrameCallbackAtMs: number | null;
  animationFrameCancelCount: number;
}>;

export type WorkbenchRuntimePerformanceDiagnostics = Readonly<{
  disposed: boolean;
  visible: boolean;
  committedEvidenceBoundary: EvidenceRef | null;
  renderedEvidenceBoundary: EvidenceRef | null;
  pendingVisibleCount: number;
  pendingVisibleHead: EvidenceRef | null;
  pendingVisibleTail: EvidenceRef | null;
  evidenceQueryPending: boolean;
  passiveRefreshPending: boolean;
  queryGeneration: number;
  liveEvidenceTotal: number;
  liveEvidenceTail: Readonly<{ eventId: string }> | null;
  lastEvidenceQueryError: string | null;
  documentVisibilityState: DocumentVisibilityState | "unavailable";
  visibleFrameHeartbeat: number;
  lastVisibleFrameAtMs: number | null;
  panel: WorkbenchPanelPerformanceDiagnostics;
}>;

export type WorkbenchRuntimeScheduler = {
  requestFrame(callback: () => void): unknown;
  cancelFrame(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
};

/** Observational hooks used only by the deliberate real-Chrome performance gate. */
export type WorkbenchRuntimePerformanceHooks = Readonly<{
  onCommittedEvidenceBoundary?(boundary: EvidenceRef, timestampMs: number): void;
  onCheckpointStagingStart?(syncId: string, timestampMs: number): void;
  onCheckpointStagingEnd?(syncId: string, timestampMs: number): void;
  /**
   * Reports the first production React layout effect that publishes a
   * committed Evidence boundary into the panel DOM. This is a separate
   * publication seam; it is never a substitute for the headed compositor
   * frame proof.
   */
  onLayoutCommit?(boundary: EvidenceRef, timestampMs: number, coveredBoundaries: readonly EvidenceRef[]): void;
  onVisibleFrame?(boundary: EvidenceRef, timestampMs: number, coveredBoundaries: readonly EvidenceRef[]): void;
}>;

export type WorkbenchRuntimeOptions = {
  history?: EventHistory;
  visible?: boolean;
  theme?: "auto" | "dark" | "light";
  captureStatus?: CaptureStatus;
  capture?: Partial<WorkbenchCaptureSnapshot>;
  storage?: WorkbenchStorageSnapshot;
  storageEstimate?: StorageEstimateObservation | null;
  storageHeadroomSampler?: StorageHeadroomSampler;
  normalizer?: EventNormalizer;
  diagnosticObservations?: DiagnosticObservationJournal;
  windowSize?: number;
  scheduler?: WorkbenchRuntimeScheduler;
  scenarioClock?: ScenarioClock;
  localInjectionExecutor?: LocalInjectionExecutor;
  performanceHooks?: WorkbenchRuntimePerformanceHooks;
  evidenceQuery?: EvidenceInvestigationQuery;
  /** Test seam for proving Activity projection failures stay renderer-local. */
  activityProjectionFactory?: (input: ActivityProjectionInput) => ActivityProjection;
  /** Delay for visible Activity projection publication; production uses approximately one second. */
  activityPublicationDelayMs?: number;
  investigationDiscoveries?: readonly FacetDiscoveryRequest[];
  /** Safety ceiling for any complete Evidence copy or export artifact. */
  outputByteLimit?: number;
};

type EvidenceData = {
  events: readonly LightstreamerEventEnvelope[];
  total: number;
  offset: number;
  records: readonly DeterministicEvidenceRecord[];
};

type LocalInjectionEntryIntent =
  | { kind: "selected-event"; eventId: string }
  | { kind: "scope-author"; scopeId: string };

type LocalInjectionDraftState = {
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
  minimized: boolean;
  parked: boolean;
  open: boolean;
  restorationOrigin: WorkbenchLocalInjectionRestorationOrigin;
  executionId: string | null;
  preflightFingerprint: string | null;
  outcome: WorkbenchLocalInjectionOutcome | null;
  reviewedExecution: LocalInjectionReview | null;
  reviewRefusal: string | null;
  relativeDelayMs: number;
};

type ScenarioState = {
  phase: "edit" | "review" | "running" | "paused" | "complete" | "stopped";
  scenario: LocalInjectionScenario;
  drafts: Map<string, LocalInjectionDraftState>;
  run: ScenarioRun | null;
  reviews: Map<string, LocalInjectionReview>;
  membershipError: string | null;
  pickerOpen: boolean;
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

type InvestigationCheckpoint = Readonly<{
  scopeId: string | null;
  filter: Filter;
  find: string;
  findCurrentEventId: string | null;
  selectionEventId: string | null;
  focusedEventId: string | null;
  contextId: string | null;
  mode: "live" | "frozen";
  offset: number;
  readPoint: EvidenceReadPoint | null;
  activityDocument: ActivityDocumentState | null;
}>;

const emptyEvidence: EvidenceData = Object.freeze({
  events: Object.freeze([]),
  total: 0,
  offset: 0,
  records: Object.freeze([])
});
const MAX_EVIDENCE_EVENT_CACHE = 256;

const emptyInvestigation: WorkbenchEvidenceInvestigationSnapshot = Object.freeze({
  scope: Object.freeze({ kind: "PAGE" as const }),
  filter: createFilter(1),
  readPoint: null,
  historyInterval: null,
  representedEvidenceBoundary: null,
  retainedRange: null,
  page: Object.freeze({ evidence: Object.freeze([]), nextCursor: null }),
  counts: Object.freeze({ shown: 0, matching: 0, inScope: 0 }),
  discoveries: new Map(),
  lookup: null,
  find: null,
  evaluation: null,
  coverage: null,
  storage: null,
  queryState: "idle",
  problem: null
});

export function createWorkbenchRuntime(options: WorkbenchRuntimeOptions = {}): WorkbenchRuntime {
  return new Runtime(options);
}

class Runtime implements WorkbenchRuntime {
  private readonly history: EventHistory;
  private readonly evidencePipeline: CommittedEvidencePipeline;
  private readonly scheduler: WorkbenchRuntimeScheduler;
  private readonly scenarioClock: ScenarioClock;
  private readonly windowSize: number;
  private readonly outputByteLimit: number;
  private readonly captureOverride: Partial<WorkbenchCaptureSnapshot>;
  private readonly normalizer: EventNormalizer;
  private readonly diagnosticObservations: DiagnosticObservationJournal;
  private subscriptionDiagnosticProducer: SubscriptionDiagnosticProducer = createSubscriptionDiagnosticProducer();
  private committedTopologyDiagnostics: CommittedTopologyDiagnosticCoordinator = createCommittedTopologyDiagnosticCoordinator();
  private readonly activeRuntimeDiagnosticConditions = new Map<string, Readonly<{
    code: string;
    conditionId: string;
    affected: DiagnosticAffectedIdentity;
  }>>();
  private diagnosticObservationSettlement: Promise<void> = Promise.resolve();
  private readonly diagnosticEvidenceSequences = new Map<string, number>();
  private readonly committedDiagnosticPresentations = new Map<string, WorkbenchDiagnostic>();
  private readonly committedDiagnosticObservations = new Map<string, DiagnosticObservationInput>();
  private diagnosticFilterCriteria: DiagnosticFilterCriteria = Object.freeze({});
  private readonly localInjectionExecutor: LocalInjectionExecutor | null;
  private readonly localInjectionExecutionCoordinator: LocalInjectionExecutionCoordinator;
  private readonly performanceHooks: WorkbenchRuntimePerformanceHooks | null;
  private readonly activityProjectionFactory: (input: ActivityProjectionInput) => ActivityProjection;
  private readonly activityPublicationDelayMs: number;
  private readonly evidenceQuery: EvidenceInvestigationQuery;
  private readonly investigationDiscoveries: readonly FacetDiscoveryRequest[];
  private filterDiscovery: FacetDiscoveryRequest | null = null;
  private readonly activeTopologyStagingSyncIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private commandStateProjections: CommandStateProjections = createCommandStateProjections();
  private readonly retainedLocalEvidenceIds = new Set<string>();
  private readonly offeredTopologyCheckpointSyncIds = new Set<string>();
  private readonly activityEvidence: ActivityEvidence[] = [];
  private readonly activityEvidenceKeys = new Set<string>();
  private activityOpen = false;
  private activityTransition: WorkbenchActivitySnapshot["transition"] = Object.freeze({ sequence: 0, kind: "idle" });
  private activityDocumentState: ActivityDocumentState | null = null;
  private activityHydrationPromise: Promise<void> | null = null;
  private activityHydrated = false;
  private activityPublicationHandle: unknown | null = null;
  private activityPublicationPending = false;
  private activityPublishedProjection: ActivityProjection | null = null;
  private activityOriginCheckpoint: InvestigationCheckpoint | null = null;
  private topologyProjection: TopologyProjection = createTopologyProjection();
  private readonly evidencePresentationCache = new WeakMap<LightstreamerEventEnvelope, WorkbenchEvidence>();
  private readonly evidenceEventCache = new Map<string, LightstreamerEventEnvelope>();
  private visible: boolean;
  private theme: "auto" | "dark" | "light";
  private captureStatus: CaptureStatus;
  private scopeId: string | null = "page";
  private scopeFocusedNodeId: string | null = "page";
  private selectionEventId: string | null = null;
  private selectedEventEnvelope: LightstreamerEventEnvelope | null = null;
  private focusedEventId: string | null = null;
  private evidenceScrollTop = 0;
  private selectionHiddenByFilter = false;
  private filterRecoveryFocused = false;
  private contextId: string | null = null;
  private commandProjectionReturnContextId: string | null = null;
  private actionsReturnContextId: string | null = null;
  private canonicalFilter: Filter = createFilter(1);
  private filterMutation: WorkbenchFilterMutationSnapshot = Object.freeze({
    state: "idle", revision: 1, changed: false, message: null, removedCriteria: 0
  });
  private readonly restorationCheckpoints: InvestigationCheckpoint[] = [];
  private restorationIndex = -1;
  private restorationBarrier = 0;
  private restorationReadPoint: EvidenceReadPoint | null = null;
  private find = "";
  private findCurrentEventId: string | null = null;
  private mode: "live" | "frozen" = "live";
  private liveEvidence: EvidenceData = emptyEvidence;
  private frozenEvidence: EvidenceData | null = null;
  private liveInvestigation: EvidenceSnapshot | null = null;
  private frozenInvestigation: EvidenceSnapshot | null = null;
  private liveInvestigationContract: Readonly<{
    scope: StructuralEvidenceScope;
    filter: Filter;
  }> | null = null;
  private frozenInvestigationContract: Readonly<{
    scope: StructuralEvidenceScope;
    filter: Filter;
  }> | null = null;
  private lastCoherentEvidence: EvidenceData = emptyEvidence;
  private lastCoherentInvestigation: EvidenceSnapshot | null = null;
  private lastCoherentInvestigationContract: Readonly<{
    scope: StructuralEvidenceScope;
    filter: Filter;
  }> | null = null;
  private investigationState: WorkbenchEvidenceInvestigationSnapshot["queryState"] = "idle";
  private investigationProblem: EvidenceFilterReadProblem | null = null;
  private selectedEvidenceIdentity: EvidenceIdentity | null = null;
  private selectedPayloadLoadedForEventId: string | null = null;
  private evidenceLoading = false;
  private snapshot: WorkbenchSnapshot;
  private version = 0;
  private disposed = false;
  private disposePromise: Promise<void> = Promise.resolve();
  private queryGeneration = 0;
  private evidenceQueryAbortController: AbortController | null = null;
  /** Opaque cursors are bound to the query and its read point. */
  private readonly evidencePageCursors = new Map<number, string>();
  private evidenceQueryPending = false;
  private initialEvidenceSettled = false;
  private passiveRefreshPending = false;
  private lastEvidenceQueryError: string | null = null;
  private frameHandle: unknown | null = null;
  private fallbackHandle: unknown | null = null;
  private hiddenDirty = false;
  private captureBoundary: WorkbenchCaptureSnapshot | null = null;
  private committedEvidenceBoundary: EvidenceRef | null = null;
  private scenarioFollowerPhase: CommittedEvidencePipelineFollowerState["progress"]["phase"] = "IDLE";
  private readonly scenarioBoundaryListeners = new Set<(snapshot: ScenarioCommittedBoundarySnapshot) => void>();
  private scenarioBoundaryPublicationPending = false;
  private renderedEvidenceBoundary: EvidenceRef | null = null;
  private pendingVisibleBoundaries: EvidenceRef[] = [];
  private pendingLayoutCommitBoundaries: EvidenceRef[] = [];
  private visibleFrameHeartbeat = 0;
  private lastVisibleFrameAtMs: number | null = null;
  private panelPerformanceDiagnostics: WorkbenchPanelPerformanceDiagnostics = {
    rootMounted: false,
    subscriptionActive: false,
    lastLayoutEffectSnapshotVersion: null,
    lastLayoutEffectBoundary: null,
    animationFramePending: false,
    animationFrameRequestCount: 0,
    lastAnimationFrameRequestedAtMs: null,
    animationFrameCallbackCount: 0,
    lastAnimationFrameCallbackAtMs: null,
    animationFrameCancelCount: 0
  };
  private topologyCoverage: WorkbenchCaptureSnapshot["coverage"] | null = null;
  private projectionRecovery: {
    intervalId: string | null;
    topology: TopologyProjection;
    command: CommandStateProjections;
    diagnostics: SubscriptionDiagnosticProducer;
    topologyDiagnostics: CommittedTopologyDiagnosticCoordinator;
    topologyCoverage: WorkbenchCaptureSnapshot["coverage"] | null;
  } | null = null;
  private historyCondition: WorkbenchHistoryCondition | null = null;
  private historyAnnouncement = "";
  private storage: WorkbenchStorageSnapshot;
  private storageEstimate: StorageEstimateObservation | null;
  private readonly storageHeadroomSampler: StorageHeadroomSampler | null;
  private readonly storageEstimateThresholdsSampled = new Set<StorageEstimateThreshold>();
  private historyStatus: HistoryStatus;
  private clearState: WorkbenchRetentionSnapshot["clearState"] = "idle";
  private clearError: string | null = null;
  private clearedSelectionEventId: string | null = null;
  private exportRedactions = new Set<TopologySensitiveCategory>();
  private exportCompleteEvidence = false;
  private evidenceCopy: WorkbenchEvidenceCopySnapshot = Object.freeze({
    state: "idle",
    eventCount: 0,
    text: null
  });
  private evidenceCopyGeneration = 0;
  private evidenceCopyAbortController: AbortController | null = null;
  private localInjectionDraft: LocalInjectionDraftState | null = null;
  private scenarioState: ScenarioState | null = null;
  private pendingLocalInjectionEntry: {
    intent: LocalInjectionEntryIntent;
    rawText: string | null;
    review: boolean;
    execute: boolean;
  } | null = null;
  private localInjectionBlockedEntry: LocalInjectionEntryIntent | null = null;
  private localInjectionDiscardConfirmation = false;
  private localInjectionEntryError: string | null = null;
  private localInjectionSequence = 0;
  private scenarioVisibilityTransition = false;
  private currentPageEpoch: string | null = null;
  private scopeStructureCache: {
    revision: number;
    descriptors: readonly ScopeNodeDescriptor[];
    descriptorById: ReadonlyMap<string, ScopeNodeDescriptor>;
  } | null = null;
  private scopeNodePresentationCache: {
    revision: number;
    nodes: Map<string, WorkbenchScopeNode>;
  } | null = null;
  private exportSensitiveCountsCache: {
    revision: number;
    scopeId: string | null;
    counts: Readonly<Record<TopologySensitiveCategory, number>>;
  } | null = null;
  private preparedExport: {
    document: TopologyStructuredSnapshot;
    json: string;
    html?: string | null;
    filename: string;
  } | null = null;
  private exportPreparationGeneration = 0;
  private exportAbortController: AbortController | null = null;
  private exportOperation: WorkbenchExportSnapshot["operation"] = undefined;

  constructor(options: WorkbenchRuntimeOptions) {
    this.history = options.history ?? createInMemoryEventHistory();
    this.historyStatus = this.history.status();
    this.scheduler = options.scheduler ?? browserScheduler();
    this.scenarioClock = options.scenarioClock ?? {
      now: () => performance.now(),
      setTimer: (callback, delayMs) => this.scheduler.setTimeout(callback, delayMs),
      clearTimer: (handle) => this.scheduler.clearTimeout(handle)
    };
    this.windowSize = normalizeWindowSize(options.windowSize);
    this.outputByteLimit = normalizeOutputByteLimit(options.outputByteLimit);
    this.visible = options.visible ?? true;
    this.theme = options.theme ?? "auto";
    this.captureStatus = options.captureStatus ?? "idle";
    this.captureOverride = options.capture ?? {};
    this.normalizer = options.normalizer ?? createEventNormalizer();
    this.diagnosticObservations = options.diagnosticObservations ?? createMemoryDiagnosticObservationJournal({ panelSessionId: `runtime-${Date.now().toString(36)}` });
    this.localInjectionExecutor = options.localInjectionExecutor ?? null;
    this.performanceHooks = options.performanceHooks ?? null;
    this.activityProjectionFactory = options.activityProjectionFactory ?? createActivityProjection;
    this.activityPublicationDelayMs = Math.max(0, options.activityPublicationDelayMs ?? 1_000);
    this.investigationDiscoveries = Object.freeze([...(options.investigationDiscoveries ?? [])]);
    this.storage = options.storage ?? { mode: "indexeddb" };
    this.storageEstimate = options.storageEstimate ?? null;
    this.storageHeadroomSampler = options.storageHeadroomSampler ?? null;
    if (options.storageEstimate !== undefined) {
      this.storageEstimateThresholdsSampled.add("BEFORE_CAPTURE");
    }
    this.evidencePipeline = bindCommittedEvidencePipeline({
      history: this.history,
      replayChunkSize: 256,
      onCommittedEvidence: (entry) => this.handleCommittedEvidence(entry),
      onHistoryPublication: (publication) => this.handleHistoryPublication(publication),
      onFollowerState: (state) => this.handleFollowerState(state)
    });
    this.localInjectionExecutionCoordinator = createLocalInjectionExecutionCoordinator({
      execute: (request) => this.localInjectionExecutor
        ? this.localInjectionExecutor.execute(request)
        : Promise.resolve({
            requestId: request.executionId,
            ok: false,
            status: "bridge-error",
            timestamp: Date.now(),
            error: "Local Injection executor is unavailable."
          }),
      admitEvidence: (event) => this.evidencePipeline.offer(event).settled.then(
        (settled) => settled.outcome === "BECAME_EVIDENCE"
          ? { retained: true as const, evidence: settled.evidence }
          : { retained: false as const },
        () => ({ retained: false as const })
      ),
      readExecutionFacts: (review) => {
        const draft = this.localInjectionDraft;
        const scenarioStepId = this.scenarioState
          ? [...this.scenarioState.reviews].find(([, candidate]) => candidate === review)?.[0] ?? null
          : null;
        const scenarioDraft = scenarioStepId ? this.scenarioState?.drafts.get(scenarioStepId) ?? null : null;
        const currentDraft = scenarioDraft ?? draft;
        if (this.disposed || !currentDraft || (scenarioStepId === null && draft?.reviewedExecution !== review)) {
          return {
            fingerprint: "local-injection-target-unavailable",
            targetProblem: "The protected Local Injection execution is no longer current."
          };
        }
        const targetProblem = this.validateLocalInjectionTarget(currentDraft.anchor)[0]?.message;
        return {
          fingerprint: this.localInjectionFingerprint(currentDraft),
          ...(targetProblem ? { targetProblem } : {})
        };
      },
      canAcceptEvidence: (review) => {
        const draft = this.localInjectionDraft;
        const scenarioOwnsReview = this.scenarioState ? [...this.scenarioState.reviews.values()].includes(review) : false;
        return !this.disposed && (scenarioOwnsReview
          ? this.scenarioState?.phase === "running"
          : draft?.phase === "pending" && draft.reviewedExecution === review);
      }
    });
    this.evidenceQuery = options.evidenceQuery ?? createEvidenceInvestigationQuery({
      query: (request) => this.evidencePipeline.query(request)
    });
    this.evidenceLoading = true;
    this.investigationState = "loading";
    this.recordInvestigationCheckpoint();
    this.refreshRuntimeDiagnosticObservations();
    this.snapshot = this.createSnapshot();

    this.evidencePipeline.start();
    this.refreshEvidence("initial");
    this.hydrateProjections();
    if (options.storageEstimate === undefined && this.storageHeadroomSampler) {
      this.sampleStorageEstimate("BEFORE_CAPTURE");
    }
  }

  private applyFilterCommand(
    expectedRevision: number,
    operations: readonly FilterMutation[]
  ): void {
    const result = applyFilterMutations(this.canonicalFilter, expectedRevision, operations);
    if (!result.ok) {
      this.filterMutation = Object.freeze({
        state: result.problem.code === "STALE_FILTER_REVISION" ? "stale" : "invalid",
        revision: result.filter.revision,
        changed: false,
        message: result.problem.message,
        removedCriteria: 0
      });
      this.publish();
      return;
    }
    this.filterMutation = Object.freeze({
      state: result.changed ? "applied" : "no-op",
      revision: result.filter.revision,
      changed: result.changed,
      message: result.changed ? "Filter applied." : "Filter unchanged.",
      removedCriteria: 0
    });
    if (!result.changed) {
      this.publish();
      return;
    }
    this.canonicalFilter = result.filter;
    this.filterDiscovery = null;
    this.recordInvestigationCheckpoint();
    this.clearedSelectionEventId = null;
    this.refreshEvidence("filter");
  }

  private applyContextualFilterAction(
    expectedRevision: number,
    requestedAction: EvidenceFilterActionDescriptor
  ): void {
    const available = this.selectedContextFilterActions();
    const action = available.find((candidate) => candidate.id === requestedAction.id);
    if (!action) {
      this.filterMutation = Object.freeze({
        state: "invalid",
        revision: this.canonicalFilter.revision,
        changed: false,
        message: "This contextual Filter action is no longer available for the selected Evidence.",
        removedCriteria: 0
      });
      this.publish();
      return;
    }
    this.applyFilterCommand(expectedRevision, filterMutationsForAction(action));
  }

  private revealSelectedEvidence(): void {
    const lookup = this.displayedInvestigation()?.lookup ?? this.liveInvestigation?.lookup;
    if (!lookup || lookup.state !== "RETAINED" || lookup.evidence.identity.eventId !== this.selectionEventId) return;
    const operations = blockersToMutations(lookup.blockingCriteria);
    if (operations.length === 0) return;
    const removedCriteria = operations.filter((operation) => operation.type !== "reset").length;
    const result = applyFilterMutations(this.canonicalFilter, this.canonicalFilter.revision, operations);
    if (!result.ok) {
      this.filterMutation = Object.freeze({ state: "invalid", revision: result.filter.revision, changed: false, message: result.problem.message, removedCriteria: 0 });
      this.publish();
      return;
    }
    this.canonicalFilter = result.filter;
    if (result.changed) this.recordInvestigationCheckpoint();
    this.filterMutation = Object.freeze({
      state: "revealed",
      revision: result.filter.revision,
      changed: result.changed,
      message: `Reveal removed ${removedCriteria} Filter ${removedCriteria === 1 ? "Criterion" : "Criteria"}.`,
      removedCriteria
    });
    this.clearedSelectionEventId = null;
    this.selectionHiddenByFilter = false;
    this.filterRecoveryFocused = false;
    this.focusedEventId = this.selectionEventId;
    this.refreshEvidence("reveal-selection");
  }

  private markActivityTransition(kind: Exclude<WorkbenchActivitySnapshot["transition"]["kind"], "idle">): void {
    this.activityTransition = Object.freeze({ sequence: this.activityTransition.sequence + 1, kind });
  }

  private recordInvestigationCheckpoint(activityDocument: ActivityDocumentState | null = null): void {
    const checkpoint: InvestigationCheckpoint = Object.freeze({
      scopeId: this.scopeId,
      filter: this.canonicalFilter,
      find: this.find,
      findCurrentEventId: this.findCurrentEventId,
      selectionEventId: this.selectionEventId,
      focusedEventId: this.focusedEventId,
      contextId: this.contextId,
      mode: this.mode,
      offset: this.displayedEvidence().offset,
      readPoint: this.mode === "frozen" ? this.frozenInvestigation?.readPoint ?? this.restorationReadPoint : null,
      activityDocument
    });
    if (this.restorationIndex < this.restorationCheckpoints.length - 1) {
      this.restorationCheckpoints.splice(this.restorationIndex + 1);
    }
    this.restorationCheckpoints.push(checkpoint);
    this.restorationIndex = this.restorationCheckpoints.length - 1;
  }

  private restoreCheckpoint(index: number): void {
    if (index < 0 || index >= this.restorationCheckpoints.length || index === this.restorationIndex) return;
    const checkpoint = this.restorationCheckpoints[index];
    if (!checkpoint || index < this.restorationBarrier) return;
    this.restorationIndex = index;
    this.scopeId = checkpoint.scopeId;
    this.canonicalFilter = checkpoint.filter;
    this.find = checkpoint.find;
    this.findCurrentEventId = checkpoint.findCurrentEventId;
    this.selectionEventId = checkpoint.selectionEventId;
    this.focusedEventId = checkpoint.focusedEventId;
    this.contextId = checkpoint.contextId;
    this.mode = checkpoint.mode;
    this.restorationReadPoint = checkpoint.readPoint;
    if (checkpoint.activityDocument) {
      this.markActivityTransition("back");
      this.activityDocumentState = Object.freeze({ ...checkpoint.activityDocument, open: true });
      this.activityOpen = true;
      this.activityPublishedProjection = checkpoint.activityDocument.projection;
    }
    if (checkpoint.mode === "live") {
      this.frozenEvidence = null;
      this.frozenInvestigation = null;
      this.frozenInvestigationContract = null;
    }
    this.refreshEvidence("navigation", checkpoint.offset);
  }

  readonly getSnapshot = (): WorkbenchSnapshot => {
    return this.snapshot;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly reportVisibleFrame = (renderedBoundary = this.renderedEvidenceBoundary): void => {
    if (!this.visible) return;
    this.visibleFrameHeartbeat += 1;
    this.lastVisibleFrameAtMs = performance.now();
    const boundary = renderedBoundary;
    if (!boundary || !this.performanceHooks?.onVisibleFrame || this.pendingVisibleBoundaries.length === 0) return;
    const coveredBoundaries: EvidenceRef[] = [];
    const pendingBoundaries: EvidenceRef[] = [];
    for (const pending of this.pendingVisibleBoundaries) {
      if (pending.intervalId === boundary.intervalId && pending.sequence <= boundary.sequence) {
        coveredBoundaries.push(pending);
      } else {
        pendingBoundaries.push(pending);
      }
    }
    if (coveredBoundaries.length === 0) return;
    this.pendingVisibleBoundaries = pendingBoundaries;
    this.performanceHooks.onVisibleFrame(boundary, performance.now(), coveredBoundaries);
  };

  private reportLayoutCommit(boundary: EvidenceRef | null): void {
    if (!boundary || !this.performanceHooks?.onLayoutCommit || this.pendingLayoutCommitBoundaries.length === 0) return;
    const coveredBoundaries: EvidenceRef[] = [];
    const pendingBoundaries: EvidenceRef[] = [];
    for (const pending of this.pendingLayoutCommitBoundaries) {
      if (pending.intervalId === boundary.intervalId && pending.sequence <= boundary.sequence) {
        coveredBoundaries.push(pending);
      } else {
        pendingBoundaries.push(pending);
      }
    }
    if (coveredBoundaries.length === 0) return;
    this.pendingLayoutCommitBoundaries = pendingBoundaries;
    this.performanceHooks.onLayoutCommit(boundary, performance.now(), coveredBoundaries);
  }

  readonly reportPanelPerformanceEvent = (event: WorkbenchPanelPerformanceEvent): void => {
    const current = this.panelPerformanceDiagnostics;
    switch (event.type) {
      case "root-mounted":
        this.panelPerformanceDiagnostics = { ...current, rootMounted: event.mounted };
        return;
      case "subscription-active":
        this.panelPerformanceDiagnostics = { ...current, subscriptionActive: event.active };
        return;
      case "layout-effect":
        this.panelPerformanceDiagnostics = {
          ...current,
          lastLayoutEffectSnapshotVersion: event.snapshotVersion,
          lastLayoutEffectBoundary: event.boundary
            ? Object.freeze({ intervalId: event.boundary.intervalId, sequence: event.boundary.sequence, eventId: event.boundary.eventId })
            : null
        };
        this.reportLayoutCommit(event.boundary);
        return;
      case "animation-frame-requested":
        this.panelPerformanceDiagnostics = {
          ...current,
          animationFramePending: true,
          animationFrameRequestCount: current.animationFrameRequestCount + 1,
          lastAnimationFrameRequestedAtMs: event.timestampMs
        };
        return;
      case "animation-frame-callback":
        this.panelPerformanceDiagnostics = {
          ...current,
          animationFramePending: false,
          animationFrameCallbackCount: current.animationFrameCallbackCount + 1,
          lastAnimationFrameCallbackAtMs: event.timestampMs
        };
        return;
      case "animation-frame-cancelled":
        this.panelPerformanceDiagnostics = {
          ...current,
          animationFramePending: false,
          animationFrameCancelCount: current.animationFrameCancelCount + 1
        };
    }
  };

  readonly getPerformanceDiagnostics = (): WorkbenchRuntimePerformanceDiagnostics => {
    const liveTail = this.liveEvidence.events.at(-1);
    const identity = (boundary: EvidenceRef | null | undefined): EvidenceRef | null => boundary
      ? Object.freeze({ intervalId: boundary.intervalId, sequence: boundary.sequence, eventId: boundary.eventId })
      : null;
    return Object.freeze({
      disposed: this.disposed,
      visible: this.visible,
      committedEvidenceBoundary: identity(this.committedEvidenceBoundary),
      renderedEvidenceBoundary: identity(this.renderedEvidenceBoundary),
      pendingVisibleCount: this.pendingVisibleBoundaries.length,
      pendingVisibleHead: identity(this.pendingVisibleBoundaries[0]),
      pendingVisibleTail: identity(this.pendingVisibleBoundaries.at(-1)),
      evidenceQueryPending: this.evidenceQueryPending,
      passiveRefreshPending: this.passiveRefreshPending,
      queryGeneration: this.queryGeneration,
      liveEvidenceTotal: this.liveEvidence.total,
      liveEvidenceTail: liveTail ? Object.freeze({ eventId: liveTail.id }) : null,
      lastEvidenceQueryError: this.lastEvidenceQueryError,
      documentVisibilityState: typeof document === "undefined" ? "unavailable" : document.visibilityState,
      visibleFrameHeartbeat: this.visibleFrameHeartbeat,
      lastVisibleFrameAtMs: this.lastVisibleFrameAtMs,
      panel: Object.freeze({
        ...this.panelPerformanceDiagnostics,
        lastLayoutEffectBoundary: identity(this.panelPerformanceDiagnostics.lastLayoutEffectBoundary)
      })
    });
  };

  dispatch(command: WorkbenchCommand): void {
    if (this.disposed) {
      return;
    }

    switch (command.type) {
      case "set-visible":
        this.setVisible(command.visible);
        return;
      case "set-theme":
        this.theme = command.theme;
        this.publish();
        return;
      case "set-capture-status":
        this.captureStatus = command.status;
        this.refreshRuntimeDiagnosticObservations(this.topologyProjection.snapshot(), true);
        this.publish();
        return;
      case "ingest-capture-message":
        this.ingestCaptureMessage(command.message);
        return;
      case "apply-topology-sync-frame":
        this.applyTopologySyncFrame(command.frame);
        return;
      case "set-scope":
        this.invalidateEvidenceCopy();
        this.filterDiscovery = null;
        this.scopeId = command.scopeId ?? "page";
        this.scopeFocusedNodeId = command.scopeId ?? "page";
        this.clearedSelectionEventId = null;
        this.recordInvestigationCheckpoint();
        this.invalidatePreparedExport();
        this.refreshEvidence("scope");
        return;
      case "set-scope-focus":
        this.scopeFocusedNodeId = command.scopeId;
        this.publish();
        return;
      case "set-storage-state":
        this.storage = { ...command.storage };
        this.publish();
        return;
      case "request-clear-history":
        if (this.scenarioState && !["edit", "complete", "stopped"].includes(this.scenarioState.phase)) {
          this.clearState = "error";
          this.clearError = "Clear is unavailable while a Scenario Run is active or awaiting drift re-review.";
          this.publish();
          return;
        }
        this.clearState = "confirming";
        this.clearError = null;
        this.publish();
        return;
      case "cancel-clear-history":
        this.clearState = "idle";
        this.clearError = null;
        this.publish();
        return;
      case "confirm-clear-history":
        this.clearHistory();
        return;
      case "set-export-redactions":
        this.exportRedactions = new Set(
          command.redactions.filter((category) =>
            TOPOLOGY_SENSITIVE_CATEGORIES.includes(category)
          )
        );
        this.invalidatePreparedExport();
        this.publish();
        return;
      case "set-export-complete-evidence":
        this.exportCompleteEvidence = command.complete;
        this.invalidatePreparedExport();
        this.publish();
        return;
      case "apply-filter-mutations":
      case "mutate-filter":
      case "apply-filter-builder":
        this.invalidateEvidenceCopy();
        this.applyFilterCommand(command.expectedRevision, command.operations);
        return;
      case "apply-filter-action":
      case "apply-contextual-filter-action":
        this.invalidateEvidenceCopy();
        this.applyContextualFilterAction(command.expectedRevision, command.action);
        return;
      case "request-filter-discovery":
        this.filterDiscovery = command.request === null
          ? null
          : Object.freeze({
              facet: command.request.facet,
              size: command.request.size,
              ...(command.request.search === undefined ? {} : { search: command.request.search }),
              ...(command.request.cursor === undefined ? {} : { cursor: command.request.cursor })
            });
        this.refreshEvidence("command");
        return;
      case "reset-filter":
        this.invalidateEvidenceCopy();
        this.applyFilterCommand(command.expectedRevision, [{ type: "reset" }]);
        return;
      case "reveal-selected-evidence":
        if (!this.selectionEventId || !this.selectionHiddenByFilter) return;
        this.invalidateEvidenceCopy();
        this.revealSelectedEvidence();
        return;
      case "clear-evidence-selection": {
        const selectedEventId = this.selectionEventId;
        this.selectionEventId = null;
        this.selectedEvidenceIdentity = null;
        this.selectedEventEnvelope = null;
        this.focusedEventId = null;
        this.selectionHiddenByFilter = false;
        this.filterRecoveryFocused = false;
        this.selectedPayloadLoadedForEventId = null;
        this.clearedSelectionEventId = null;
        this.pendingLocalInjectionEntry = null;
        if (
          selectedEventId &&
          (this.contextId === `context:${selectedEventId}` || this.contextId === `raw:${selectedEventId}`)
        ) {
          this.contextId = "context:scope";
        }
        this.publish();
        return;
      }
      case "set-find":
        this.find = command.value;
        this.refreshEvidence("command");
        return;
      case "find-next":
        this.navigateFind(1);
        return;
      case "find-previous":
        this.navigateFind(-1);
        return;
      case "clear-find":
        this.find = "";
        this.clearFindResults();
        this.publish();
        return;
      case "show-older-evidence":
        this.navigateEvidenceWindow("older");
        return;
      case "show-newer-evidence":
        this.navigateEvidenceWindow("newer");
        return;
      case "show-oldest-evidence":
        this.navigateEvidenceWindow("oldest");
        return;
      case "show-newest-evidence":
        this.navigateEvidenceWindow("newest");
        return;
      case "prepare-scoped-evidence-copy":
        this.prepareScopedEvidenceCopy();
        return;
      case "clear-scoped-evidence-copy":
        this.invalidateEvidenceCopy();
        this.publish();
        return;
      case "cancel-evidence-operation":
        this.cancelEvidenceOperation();
        return;
      case "begin-local-injection-from-selection":
        this.beginLocalInjectionFromSelection();
        return;
      case "begin-local-injection-from-scope":
        this.beginLocalInjectionFromScope();
        return;
      case "set-local-injection-json":
        this.setLocalInjectionJson(command.text);
        return;
      case "set-local-injection-editor-presentation":
        if (!this.localInjectionDraft) return;
        this.localInjectionDraft.editorPresentation = Object.freeze({ ...command.presentation, compareOpen: this.localInjectionDraft.compareOpen });
        return;
      case "review-local-injection":
        this.reviewLocalInjection();
        return;
      case "edit-local-injection":
        this.editLocalInjection();
        return;
      case "execute-local-injection":
        this.executeLocalInjection();
        return;
      case "set-local-injection-compare":
        if (!this.localInjectionDraft) return;
        this.localInjectionDraft.compareOpen = command.open;
        this.localInjectionDraft.editorPresentation = Object.freeze({ ...this.localInjectionDraft.editorPresentation, compareOpen: command.open });
        this.publish();
        return;
      case "set-local-injection-minimized":
        if (!this.localInjectionDraft) return;
        this.localInjectionDraft.minimized = command.minimized;
        this.publish();
        return;
      case "park-local-injection":
        this.parkLocalInjection();
        return;
      case "resume-local-injection":
        this.resumeLocalInjection();
        return;
      case "request-discard-local-injection":
        if (!this.localInjectionDraft) return;
        this.localInjectionDiscardConfirmation = true;
        this.publish();
        return;
      case "cancel-discard-local-injection":
        if (!this.localInjectionDraft) return;
        this.localInjectionDiscardConfirmation = false;
        this.publish();
        return;
      case "confirm-discard-local-injection":
        this.confirmDiscardLocalInjection();
        return;
      case "finish-local-injection":
        this.finishLocalInjection();
        return;
      case "convert-local-injection-to-scenario":
        this.convertLocalInjectionToScenario();
        return;
      case "open-scenario-evidence-picker":
        if (!this.scenarioState || this.scenarioState.phase !== "edit") return;
        this.scenarioState.pickerOpen = true;
        this.scenarioState.membershipError = null;
        this.publish();
        return;
      case "close-scenario-evidence-picker":
        if (!this.scenarioState) return;
        this.scenarioState.pickerOpen = false;
        this.publish();
        return;
      case "add-selected-evidence-to-scenario":
        this.addSelectedEvidenceToScenario();
        return;
      case "preview-visible-evidence-for-scenario":
        this.previewVisibleEvidenceForScenario();
        return;
      case "confirm-scenario-membership-preview":
        this.confirmScenarioMembershipPreview();
        return;
      case "add-authored-scenario-step":
        this.addAuthoredScenarioStep();
        return;
      case "add-scenario-checkpoint": {
        const state = this.scenarioState;
        if (!state || state.phase !== "edit") return;
        const earlierStep = state.scenario.members.filter((member) => member.kind === "step").at(-1);
        if (!earlierStep) return;
        const nextSequence = state.scenario.members.reduce((highest, member) => {
          const match = /^checkpoint-(\d+)$/.exec(member.id);
          return match ? Math.max(highest, Number(match[1])) : highest;
        }, 0) + 1;
        const checkpoint: ScenarioCheckpoint = Object.freeze({
          id: `checkpoint-${nextSequence}`,
          kind: "checkpoint",
          name: `Checkpoint ${nextSequence}`,
          assertions: Object.freeze([{ id: `checkpoint-${nextSequence}-assertion-1`, kind: "correlated-local-evidence-exists" as const, stepId: earlierStep.id }])
        });
        const addition = addScenarioCheckpoint(state.scenario, checkpoint, { retainedRunBytes: state.retainedRunBytes });
        if (!addition.ok) state.membershipError = addition.reason;
        else {
          state.scenario = addition.scenario;
          state.focusedMemberId = checkpoint.id;
          state.membershipError = null;
        }
        this.publish();
        return;
      }
      case "update-scenario-checkpoint": {
        const state = this.scenarioState;
        if (!state || state.phase !== "edit") return;
        const update = updateScenarioCheckpoint(state.scenario, command.checkpoint, { retainedRunBytes: state.retainedRunBytes });
        if (!update.ok) {
          state.membershipError = update.reason;
        } else {
          state.scenario = update.scenario;
          state.membershipError = null;
        }
        this.publish();
        return;
      }
      case "move-scenario-member": {
        const state = this.scenarioState;
        if (!state || state.phase !== "edit") return;
        const moved = moveScenarioMember(state.scenario, command.memberId, command.direction, { retainedRunBytes: state.retainedRunBytes });
        if (!moved.ok) state.membershipError = moved.reason;
        else {
          state.scenario = moved.scenario;
          state.focusedMemberId = command.memberId;
          state.membershipError = null;
        }
        this.publish();
        return;
      }
      case "remove-scenario-checkpoint": {
        const state = this.scenarioState;
        if (!state || state.phase !== "edit") return;
        const index = state.scenario.members.findIndex(({ id }) => id === command.checkpointId);
        const removal = removeScenarioCheckpoint(state.scenario, command.checkpointId, { retainedRunBytes: state.retainedRunBytes });
        if (!removal.ok) state.membershipError = removal.reason;
        else {
          state.scenario = removal.scenario;
          state.focusedMemberId = removal.scenario.members[Math.min(index, removal.scenario.members.length - 1)]?.id ?? state.focusedStepId;
          state.membershipError = null;
        }
        this.publish();
        return;
      }
      case "show-scenario-checkpoint-evidence": {
        const state = this.scenarioState;
        if (!state) return;
        const status = this.history.status();
        const retained = status.interval.id === command.evidence.intervalId
          && status.retainedRange !== null
          && command.evidence.sequence >= status.retainedRange.first.sequence
          && command.evidence.sequence <= status.retainedRange.last.sequence;
        if (!retained) {
          state.membershipError = `Evidence ${command.evidence.eventId} is unavailable after Clear or retention.`;
          this.publish();
          return;
        }
        state.membershipError = null;
        this.dispatch({ type: "select-evidence", eventId: command.evidence.eventId });
        return;
      }
      case "move-scenario-step":
        this.moveCurrentScenarioStep(command.stepId, command.direction);
        return;
      case "duplicate-scenario-step":
        this.duplicateCurrentScenarioStep(command.stepId);
        return;
      case "remove-scenario-step":
        this.removeCurrentScenarioStep(command.stepId);
        return;
      case "undo-scenario-step-removal":
        this.undoCurrentScenarioStepRemoval();
        return;
      case "focus-scenario-member":
        if (!this.scenarioState || !this.scenarioState.scenario.members.some(({ id }) => id === command.memberId)) return;
        this.scenarioState.focusedMemberId = command.memberId;
        if (this.scenarioState.scenario.steps.some(({ id }) => id === command.memberId)) this.scenarioState.focusedStepId = command.memberId;
        this.publish();
        return;
      case "focus-scenario-step":
        if (!this.scenarioState || !this.scenarioState.scenario.steps.some(({ id }) => id === command.stepId)) return;
        this.scenarioState.focusedMemberId = command.stepId;
        this.scenarioState.focusedStepId = command.stepId;
        this.publish();
        return;
      case "set-scenario-step-delay":
        this.setScenarioStepDelay(command.stepId, command.delayMs);
        return;
      case "set-scenario-speed":
        this.setScenarioSpeed(command.speed);
        return;
      case "review-scenario":
        this.reviewCurrentScenario();
        return;
      case "re-review-scenario":
        this.reReviewCurrentScenario();
        return;
      case "edit-scenario":
        if (!this.scenarioState || this.scenarioState.phase === "running") return;
        this.archiveCurrentScenarioRun(this.scenarioState);
        this.scenarioState.runner?.dispose();
        this.scenarioState.phase = "edit";
        this.scenarioState.run = null;
        this.scenarioState.runner = null;
        this.scenarioState.runnerSnapshot = null;
        this.scenarioState.reviews.clear();
        this.publish();
        return;
      case "play-scenario":
        this.scenarioState?.runner?.play();
        return;
      case "pause-scenario":
        this.scenarioState?.runner?.pause();
        return;
      case "stop-scenario":
        this.scenarioState?.runner?.stop();
        return;
      case "step-next-scenario":
        this.stepNextScenario();
        return;
      case "run-scenario-again":
        this.runScenarioAgain();
        return;
      case "finish-scenario":
        this.finishScenario();
        return;
      case "set-scenario-step-json":
        this.setScenarioStepJson(command.stepId, command.text);
        return;
      case "set-scenario-step-compare":
        this.setScenarioStepCompare(command.stepId, command.open);
        return;
      case "set-scenario-step-editor-presentation":
        this.setScenarioStepEditorPresentation(command.stepId, command.presentation);
        return;
      case "select-evidence":
        this.selectionEventId = command.eventId;
        this.focusedEventId = command.eventId;
        this.selectionHiddenByFilter = false;
        this.filterRecoveryFocused = false;
        this.selectedPayloadLoadedForEventId = null;
        this.resolveSelectedEvent(command.eventId);
        if (command.eventId !== this.clearedSelectionEventId) {
          this.clearedSelectionEventId = null;
        }
        this.publish();
        if (
          !this.selectedEventEnvelope ||
          this.selectedEventEnvelope.id !== command.eventId ||
          this.selectedPayloadLoadedForEventId !== command.eventId
        ) {
          if (this.evidenceQueryPending) return;
          this.refreshEvidence("command");
        }
        return;
      case "focus-evidence":
        this.focusedEventId = command.eventId;
        this.selectionEventId = command.eventId;
        this.selectionHiddenByFilter = false;
        this.selectedPayloadLoadedForEventId = null;
        this.resolveSelectedEvent(command.eventId);
        if (command.eventId !== this.clearedSelectionEventId) {
          this.clearedSelectionEventId = null;
        }
        this.publish();
        if (
          !this.selectedEventEnvelope ||
          this.selectedEventEnvelope.id !== command.eventId ||
          this.selectedPayloadLoadedForEventId !== command.eventId
        ) {
          if (this.evidenceQueryPending) return;
          this.refreshEvidence("command");
        }
        return;
      case "set-evidence-scroll":
        this.evidenceScrollTop = Math.max(0, command.scrollTop);
        this.publish();
        return;
      case "set-context":
        this.contextId = command.contextId;
        this.publish();
        return;
      case "open-command-projection-comparison":
        this.commandProjectionReturnContextId = this.contextId;
        this.contextId = "command-projections";
        this.publish();
        return;
      case "close-command-projection-comparison":
        this.contextId = this.commandProjectionReturnContextId;
        this.commandProjectionReturnContextId = null;
        this.publish();
        return;
      case "open-context":
        this.contextId = this.selectionEventId ? `context:${this.selectionEventId}` : "context:scope";
        this.publish();
        return;
      case "open-scope":
        this.contextId = "context:scope";
        this.publish();
        return;
      case "open-raw-evidence":
        this.selectionEventId = command.eventId;
        this.focusedEventId = command.eventId;
        this.resolveSelectedEvent(command.eventId, true);
        this.contextId = `raw:${command.eventId}`;
        this.publish();
        return;
      case "inspect-diagnostic-evidence": {
        this.recordInvestigationCheckpoint();
        this.scopeId = "page";
        this.scopeFocusedNodeId = "page";
        this.selectionEventId = command.evidence.eventId;
        this.focusedEventId = command.evidence.eventId;
        this.selectedEvidenceIdentity = Object.freeze({
          intervalId: command.evidence.intervalId,
          pageId: command.evidence.intervalId,
          ownerId: "memory-event-history",
          sequence: command.evidence.sequence,
          eventId: command.evidence.eventId
        });
        this.selectedEventEnvelope = null;
        this.contextId = `context:${command.evidence.eventId}`;
        this.recordInvestigationCheckpoint();
        this.refreshEvidence("command");
        return;
      }
      case "inspect-diagnostic-affected":
        this.inspectDiagnosticAffected(command.affected);
        return;
      case "apply-diagnostic-filter":
        this.applyDiagnosticFilter(command.facet, command.value, command.polarity);
        return;
      case "remove-diagnostic-filter":
        this.removeDiagnosticFilter(command.facet, command.value, command.polarity);
        return;
      case "reset-diagnostic-filter":
        this.diagnosticFilterCriteria = Object.freeze({});
        this.publish();
        return;
      case "export-scope":
        this.contextId = "context:export";
        this.prepareExport();
        this.publish();
        return;
      case "open-actions":
        if (this.contextId !== "context:actions") {
          this.actionsReturnContextId = this.contextId;
        }
        this.contextId = "context:actions";
        this.publish();
        return;
      case "close-actions":
        if (this.contextId !== "context:actions") return;
        this.contextId = this.actionsReturnContextId;
        this.actionsReturnContextId = null;
        this.publish();
        return;
      case "open-activity":
        if (!this.activityOpen) {
          this.markActivityTransition("opened");
          const checkpoint = this.restorationCheckpoints[this.restorationIndex] ?? null;
          this.activityOriginCheckpoint = checkpoint
            ? Object.freeze({
              ...checkpoint,
              selectionEventId: this.selectionEventId,
              focusedEventId: this.focusedEventId,
              mode: this.mode,
              offset: this.displayedEvidence().offset
            })
            : null;
        }
        this.activityOpen = true;
        if (this.activityDocumentState) this.activityDocumentState = Object.freeze({ ...this.activityDocumentState, open: true });
        if (!this.activityHydrated && this.activityHydrationPromise === null) {
          this.activityHydrationPromise = this.hydrateActivityEvidence().finally(() => {
            this.activityHydrationPromise = null;
          });
        }
        this.publish();
        return;
      case "close-activity":
        if (this.activityOpen) this.markActivityTransition("explicit-close");
        if (this.activityDocumentState) {
          const origin = closeActivityDocument(this.activityDocumentState);
          this.selectionEventId = origin.evidenceSelectionId;
          this.focusedEventId = origin.evidenceFocusId ?? origin.evidenceSelectionId;
          this.evidenceScrollTop = Math.max(0, origin.evidenceScrollTop);
          this.activityDocumentState = Object.freeze({
            ...this.activityDocumentState,
            scope: origin.scope,
            filter: origin.filter,
            readPoint: origin.readPoint,
            view: origin.view
          });
        }
        this.activityOpen = false;
        this.cancelActivityPublication();
        if (this.activityDocumentState) this.activityDocumentState = Object.freeze({ ...this.activityDocumentState, open: false });
        const activityOrigin = this.activityOriginCheckpoint;
        this.activityOriginCheckpoint = null;
        if (activityOrigin) {
          this.scopeId = activityOrigin.scopeId;
          this.canonicalFilter = activityOrigin.filter;
          this.find = activityOrigin.find;
          this.findCurrentEventId = activityOrigin.findCurrentEventId;
          this.selectionEventId = activityOrigin.selectionEventId;
          this.focusedEventId = activityOrigin.focusedEventId;
          this.contextId = activityOrigin.contextId;
          this.mode = activityOrigin.mode;
          this.restorationReadPoint = activityOrigin.readPoint;
          if (activityOrigin.mode === "live") {
            this.frozenEvidence = null;
            this.frozenInvestigation = null;
            this.frozenInvestigationContract = null;
          }
          this.refreshEvidence("navigation", activityOrigin.offset);
          return;
        }
        this.publish();
        return;
      case "show-activity-supporting-evidence": {
        const retained = this.activitySnapshot(this.scopeSnapshot()).readPoint.retainedRange;
        const clipped = command.start !== undefined && command.end !== undefined
          ? clipActivityTimeRange({ start: command.start, end: command.end }, retained)
          : null;
        if (command.start !== undefined && command.end !== undefined && !clipped) return;
        const result = applyFilterMutations(this.canonicalFilter, this.canonicalFilter.revision, [
          ...(command.filterMutations ?? []),
          ...(clipped ? [{ type: "set-around" as const, around: { intervalId: this.historyStatus.interval.id, ...clipped } }] : [])
        ]);
        if (result.ok) {
          this.markActivityTransition("supporting-evidence");
          const activityDocument = this.activityDocumentState;
          if (activityDocument) this.recordInvestigationCheckpoint(activityDocument);
          this.canonicalFilter = result.filter;
          this.activityOpen = false;
          if (this.activityDocumentState) this.activityDocumentState = Object.freeze({ ...this.activityDocumentState, open: false });
          this.recordInvestigationCheckpoint();
          this.refreshEvidence("filter");
        }
        return;
      }
      case "select-activity":
      case "set-activity-local-series":
      case "set-activity-timeline-series":
      case "set-activity-ranking-sort":
      case "set-activity-scroll": {
        const document = this.activityDocumentState ?? this.activitySnapshot(this.scopeSnapshot()).document;
        if (!document) return;
        const documentCommand = command.type === "select-activity"
          ? { type: "select" as const, selection: command.selection }
          : command.type === "set-activity-local-series"
            ? { type: "set-local-series" as const, enabled: command.enabled }
            : command.type === "set-activity-timeline-series"
              ? { type: "set-timeline-series" as const, series: command.series }
            : command.type === "set-activity-ranking-sort"
              ? { type: "set-ranking-sort" as const, sort: command.sort }
              : { type: "set-scroll" as const, documentTop: command.documentTop, plotLeft: command.plotLeft };
        this.activityDocumentState = reduceActivityDocument(document, documentCommand).state;
        this.publish();
        return;
      }
      case "freeze-activity":
        this.mode = "frozen";
        this.restorationReadPoint = null;
        this.frozenEvidence = this.liveEvidence;
        this.frozenInvestigation = this.liveInvestigation;
        this.frozenInvestigationContract = this.liveInvestigationContract;
        if (this.activityDocumentState) this.activityDocumentState = reduceActivityDocument(this.activityDocumentState, { type: "freeze" }).state;
        this.refreshEvidence("command");
        return;
      case "follow-activity":
        this.flushActivityPublication();
        this.mode = "live";
        this.restorationReadPoint = null;
        this.frozenEvidence = null;
        this.frozenInvestigation = null;
        this.frozenInvestigationContract = null;
        if (this.activityDocumentState) this.activityDocumentState = Object.freeze({ ...this.activityDocumentState, view: "FOLLOW LIVE", newerMatchingEvidence: 0 });
        this.refreshEvidence("command");
        return;
      case "freeze-evidence":
        this.mode = "frozen";
        this.restorationReadPoint = null;
        this.frozenEvidence = this.liveEvidence;
        this.frozenInvestigation = this.liveInvestigation;
        this.frozenInvestigationContract = this.liveInvestigationContract;
        this.refreshEvidence("command");
        return;
      case "follow-live":
        this.mode = "live";
        this.restorationReadPoint = null;
        this.frozenEvidence = null;
        this.frozenInvestigation = null;
        this.frozenInvestigationContract = null;
        this.refreshEvidence("command");
        return;
      case "back-investigation":
        this.restoreCheckpoint(this.restorationIndex - 1);
        return;
      case "forward-investigation":
        this.restoreCheckpoint(this.restorationIndex + 1);
        return;
      case "restore-investigation":
        this.restoreCheckpoint(command.checkpoint);
        return;
      case "refresh-evidence":
        this.refreshEvidence("command");
        return;
    }
  }

  private resolveSelectedEvent(
    eventId: string | null,
    reconcileFilterVisibility = false
  ): void {
    if (!eventId) {
      this.selectedEventEnvelope = null;
      this.selectedEvidenceIdentity = null;
      this.selectedPayloadLoadedForEventId = null;
      return;
    }
    const visibleIndex = this.displayedEvidence().events.findIndex(({ id }) => id === eventId);
    const visible = visibleIndex >= 0 ? this.displayedEvidence().events[visibleIndex] : undefined;
    const visibleRecord = this.displayedEvidence().records[visibleIndex];
    if (visible) {
      this.selectedEventEnvelope = visible;
      this.selectedEvidenceIdentity = visibleRecord?.identity ?? this.selectedEvidenceIdentity;
      if (visibleRecord?.payload !== undefined) this.selectedPayloadLoadedForEventId = eventId;
      return;
    }
    const retainedIndex = this.lastCoherentEvidence.events.findIndex(({ id }) => id === eventId);
    const retainedEvent = retainedIndex >= 0 ? this.lastCoherentEvidence.events[retainedIndex] : undefined;
    const retainedRecord = retainedIndex >= 0 ? this.lastCoherentEvidence.records[retainedIndex] : undefined;
    if (retainedEvent) {
      this.selectedEventEnvelope = retainedEvent;
      this.selectedEvidenceIdentity = retainedRecord?.identity ?? this.selectedEvidenceIdentity;
      if (retainedRecord?.payload !== undefined) this.selectedPayloadLoadedForEventId = eventId;
      return;
    }
    if (this.selectedEventEnvelope?.id === eventId) {
      return;
    }
    this.selectedEventEnvelope = null;
    if (reconcileFilterVisibility) {
      this.selectionHiddenByFilter = false;
      this.filterRecoveryFocused = false;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.scenarioState?.runner?.dispose();
    this.scenarioBoundaryListeners.clear();
    this.cancelPassivePublication();
    this.cancelActivityPublication();
    this.evidenceQueryAbortController?.abort();
    this.evidenceQueryAbortController = null;
    this.evidenceCopyGeneration += 1;
    this.evidenceCopyAbortController?.abort();
    this.evidenceCopyAbortController = null;
    this.exportPreparationGeneration += 1;
    this.exportAbortController?.abort();
    this.exportAbortController = null;
    this.listeners.clear();
    this.disposePromise = this.evidencePipeline.close().then(
      (result) => {
        if (!result.ok) {
          console.error("Failed to close panel event history.", result.problem.message);
        }
      },
      (error: unknown) => {
        console.error(
          "Failed to close panel event history.",
          error instanceof Error ? error.message : String(error)
        );
      }
    ).then(async () => {
      await this.diagnosticObservationSettlement.catch(() => undefined);
      await this.diagnosticObservations.close().catch(() => undefined);
    });
  }

  async disposeAndWait(): Promise<void> {
    this.dispose();
    await this.disposePromise;
  }

  readonly settleDiagnosticObservations = (): Promise<void> => this.diagnosticObservationSettlement;

  private ingestCaptureMessage(message: CaptureMessage): void {
    const event = this.normalizer.normalize(message);
    if (this.captureStatus !== "bridge disconnected") {
      this.captureStatus = "capturing";
    }
    this.evidencePipeline.offer(event);
  }

  private applyTopologySyncFrame(frame: TopologySyncFrame): void {
    this.currentPageEpoch = frame.pageEpoch;
    const projectionRecovery = this.projectionRecovery;
    const topologyProjection = projectionRecovery?.topology ?? this.topologyProjection;
    const result = topologyProjection.applySyncFrame(frame);
    this.invalidatePreparedExport(false);
    const coverage = frame.coverage.status === "partial" ? "LIMITED" : "USEFUL";
    if (projectionRecovery) projectionRecovery.topologyCoverage = coverage;
    else this.topologyCoverage = coverage;
    if (!result.accepted) {
      if (projectionRecovery) projectionRecovery.topologyCoverage = "LIMITED";
      else this.topologyCoverage = "LIMITED";
    }
    const candidate = result.candidate;
    const syncId = candidate ? topologyCheckpointSyncId(candidate) : null;
    const stagingKey = `${frame.pageEpoch}\u0000${frame.syncId}`;
    if (
      result.accepted &&
      frame.type === "lsew:topology-sync-begin" &&
      !this.activeTopologyStagingSyncIds.has(stagingKey)
    ) {
      this.activeTopologyStagingSyncIds.add(stagingKey);
      this.performanceHooks?.onCheckpointStagingStart?.(frame.syncId, performance.now());
    }
    if (
      result.accepted &&
      frame.type === "lsew:topology-sync-complete" &&
      candidate &&
      syncId === frame.syncId &&
      this.activeTopologyStagingSyncIds.delete(stagingKey)
    ) {
      this.performanceHooks?.onCheckpointStagingEnd?.(frame.syncId, performance.now());
    }
    if (candidate && syncId !== null && !this.offeredTopologyCheckpointSyncIds.has(syncId)) {
      this.offeredTopologyCheckpointSyncIds.add(syncId);
      const receipt = this.evidencePipeline.offer(candidate);
      void receipt.settled.then((settled) => {
        if (settled.outcome === "NOT_EVIDENCE") {
          this.offeredTopologyCheckpointSyncIds.delete(syncId);
        }
      }).catch(() => {
        this.offeredTopologyCheckpointSyncIds.delete(syncId);
      });
    }
    this.publish();
  }

  private displayedEvidence(): EvidenceData {
    return this.mode === "frozen" ? this.frozenEvidence ?? emptyEvidence : this.liveEvidence;
  }

  private displayedInvestigation(): EvidenceSnapshot | null {
    return this.mode === "frozen"
      ? this.frozenInvestigation ?? this.liveInvestigation
      : this.liveInvestigation;
  }

  private displayedInvestigationContract(): Readonly<{
    scope: StructuralEvidenceScope;
    filter: Filter;
  }> | null {
    return this.mode === "frozen"
      ? this.frozenInvestigationContract ?? this.liveInvestigationContract
      : this.liveInvestigationContract;
  }

  private investigationSnapshot(): WorkbenchEvidenceInvestigationSnapshot {
    const investigation = this.displayedInvestigation();
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const currentScope = structuralEvidenceScope(target);
    const committedContract = this.displayedInvestigationContract();
    if (!investigation) {
      return Object.freeze({
        ...emptyInvestigation,
        scope: committedContract?.scope ?? currentScope,
        filter: committedContract?.filter ?? this.canonicalFilter,
        queryState: this.investigationState,
        problem: this.investigationProblem
      });
    }
    return Object.freeze({
      scope: committedContract?.scope ?? currentScope,
      filter: committedContract?.filter ?? this.canonicalFilter,
      readPoint: investigation.readPoint,
      historyInterval: investigation.readPoint.interval,
      representedEvidenceBoundary: investigation.readPoint.committedEvidenceBoundary,
      retainedRange: investigation.readPoint.retainedRange,
      page: investigation.page,
      counts: Object.freeze({
        shown: investigation.page.evidence.length,
        matching: investigation.totals.matching,
        inScope: investigation.totals.inScope
      }),
      discoveries: investigation.discoveries,
      lookup: investigation.lookup,
      find: investigation.find,
      evaluation: investigation.evaluation,
      coverage: this.historyStatus.phase === "STOPPED" ? "LIMITED" : investigation.coverage,
      storage: investigation.storage,
      queryState: this.investigationState,
      problem: this.investigationProblem
    });
  }

  private clearFindResults(): void {
    this.findCurrentEventId = null;
  }

  private navigateFind(direction: 1 | -1): void {
    const find = this.displayedInvestigation()?.find;
    if (!find || find.total === 0) {
      this.clearFindResults();
      this.publish();
      return;
    }
    const matches = find.matches ?? [];
    const current = matches.findIndex((identity) => identity.eventId === this.findCurrentEventId);
    const target = matches.length > 0
      ? matches[(current < 0 ? (direction > 0 ? 0 : matches.length - 1) : (current + direction + matches.length) % matches.length)]
      : direction > 0 ? find.next ?? find.first : find.previous ?? find.first;
    this.findCurrentEventId = target?.eventId ?? null;
    if (direction > 0 && target && find.nextWindow && find.nextWindow.length > 0) {
      const investigation = this.displayedInvestigation();
      if (investigation) {
        this.applyInvestigationSnapshot(
          Object.freeze({
            ...investigation,
            find: Object.freeze({ ...find, current: target, window: find.nextWindow })
          }),
          "command",
          this.displayedEvidence().offset
        );
        this.publish();
      }
    }
    this.refreshEvidence("command");
  }

  private clearHistory(): void {
    if (this.clearState !== "confirming") {
      return;
    }
    this.invalidatePreparedExport();
    this.clearState = "clearing";
    this.clearError = null;
    this.clearedSelectionEventId = this.selectionEventId;
    this.publish();
    void this.evidencePipeline.clear().then(
      (result) => {
        if (this.disposed) return;
        if (!result.ok) {
          this.clearState = "error";
          this.clearError = result.problem.message;
          this.publish();
          return;
        }
        const preservedMode = this.mode;
        const hadAround = this.canonicalFilter.around !== null;
        if (hadAround) {
          const withoutAround = applyFilterMutations(this.canonicalFilter, this.canonicalFilter.revision, [{ type: "clear-around" }]);
          if (withoutAround.ok) this.canonicalFilter = withoutAround.filter;
          this.filterMutation = Object.freeze({
            state: "applied",
            revision: this.canonicalFilter.revision,
            changed: true,
            message: "Clear removed Around Evidence because its anchor belonged to the cleared History Interval.",
            removedCriteria: 1
          });
        }
        if (this.scenarioState) {
          this.scenarioState.serverInterleaves = [];
          if (this.scenarioState.run) this.scenarioState.run = markScenarioEvidenceUnavailableAfterClear(this.scenarioState.run);
          this.scenarioState.priorRuns = this.scenarioState.priorRuns.map(markScenarioEvidenceUnavailableAfterClear);
          this.scenarioState.runnerSnapshot = this.scenarioState.runnerSnapshot && this.scenarioState.run
            ? Object.freeze({ ...this.scenarioState.runnerSnapshot, run: this.scenarioState.run })
            : this.scenarioState.runnerSnapshot;
        }
        this.mode = preservedMode;
        this.restorationCheckpoints.splice(0);
        this.restorationIndex = -1;
        this.restorationBarrier = 0;
        this.restorationReadPoint = null;
        this.historyStatus = this.history.status();
        this.clearState = "idle";
        this.refreshEvidence("command");
      },
      (error) => {
        if (this.disposed) return;
        this.clearState = "error";
        this.clearError = errorMessage(error);
        this.publish();
      }
    );
  }

  private resetCoherentStateAfterClear(): void {
    this.activeRuntimeDiagnosticConditions.clear();
    this.diagnosticEvidenceSequences.clear();
    this.committedDiagnosticPresentations.clear();
    this.committedDiagnosticObservations.clear();
    this.diagnosticFilterCriteria = Object.freeze({});
    this.subscriptionDiagnosticProducer.clear();
    this.committedTopologyDiagnostics.clear();
    this.queueDiagnosticMutation(() => this.diagnosticObservations.clear());
    this.activityEvidence.splice(0, this.activityEvidence.length);
    this.activityEvidenceKeys.clear();
    this.activityHydrationPromise = null;
    this.activityHydrated = false;
    this.queryGeneration += 1;
    this.evidenceQueryAbortController?.abort();
    this.evidenceQueryAbortController = null;
    this.evidenceQueryPending = false;
    this.evidenceLoading = false;
    this.investigationState = "loading";
    this.investigationProblem = null;
    this.lastEvidenceQueryError = null;
    this.cancelPassivePublication();
    this.cancelActivityPublication();
    this.passiveRefreshPending = false;
    this.projectionRecovery = null;
    this.commandStateProjections.clear();
    this.retainedLocalEvidenceIds.clear();
    this.topologyProjection.clear();
    this.committedEvidenceBoundary = this.history.status().retainedRange?.last ?? null;
    this.invalidateEvidenceCopy();
    this.pendingVisibleBoundaries = [];
    this.pendingLayoutCommitBoundaries = [];
    this.renderedEvidenceBoundary = null;
    this.mode = "live";
    this.frozenEvidence = null;
    this.frozenInvestigation = null;
    this.frozenInvestigationContract = null;
    this.liveEvidence = emptyEvidence;
    this.liveInvestigation = null;
    this.liveInvestigationContract = null;
    this.lastCoherentEvidence = emptyEvidence;
    this.lastCoherentInvestigation = null;
    this.lastCoherentInvestigationContract = null;
    this.selectionEventId = null;
    this.selectedEvidenceIdentity = null;
    this.selectedEventEnvelope = null;
    this.selectedPayloadLoadedForEventId = null;
    this.selectionHiddenByFilter = false;
    this.filterRecoveryFocused = false;
    this.focusedEventId = null;
    this.evidenceScrollTop = 0;
    this.clearedSelectionEventId = null;
    this.contextId = "context:scope";
    this.commandProjectionReturnContextId = null;
    this.actionsReturnContextId = null;
    this.clearFindResults();
    this.evidencePageCursors.clear();
    this.filterDiscovery = null;
  }

  private prepareExport(): void {
    const generation = ++this.exportPreparationGeneration;
    this.exportAbortController?.abort();
    const controller = new AbortController();
    this.exportAbortController = controller;
    this.preparedExport = null;
    this.exportOperation = {
      state: "preparing",
      progress: operationProgress(
        "LATCHING",
        0,
        null,
        1,
        null,
        this.outputByteLimit,
        this.excludedAfterLatch(null)
      )
    };
    this.publish();

    let topologyAtLatch: TopologyState | null = null;
    let topologyStatusAtLatch: TopologyProjectionStatus | null = null;
    void import("./evidence-history-operation")
      .then(({ streamEvidencePages }) => streamEvidencePages({
        query: this.evidenceQuery,
        scope: Object.freeze({ kind: "PAGE" }),
        filter: createFilter(this.canonicalFilter.revision),
        order: "OLDEST_FIRST",
        signal: controller.signal,
        onLatch: (readPoint, total) => {
          topologyAtLatch = this.topologyProjection.snapshot();
          topologyStatusAtLatch = this.topologyProjection.status();
          this.updateExportProgress(generation, "READING", 0, total, 1, readPoint);
        },
        onPage: (page, readPoint) => {
          if (controller.signal.aborted) return;
          this.updateExportProgress(
            generation,
            "SERIALIZING",
            (this.exportOperation?.progress.completed ?? 0) + page.length,
            this.exportOperation?.progress.total ?? null,
            1,
            readPoint
          );
          // The page is deliberately released after this callback. Export keeps
          // only its latched count; it never retains the complete Evidence set.
        }
      }))
      .then(
      async (result) => {
        if (this.disposed || generation !== this.exportPreparationGeneration) return;
        if (!result.ok) {
          this.finishExportProblem(generation, result.problem, controller.signal);
          return;
        }
        if (controller.signal.aborted) {
          this.finishExportProblem(generation, { code: "QUERY_CANCELLED", message: "The Complete History operation was cancelled before its artifact was published." }, controller.signal);
          return;
        }
        try {
          if (!topologyAtLatch || !topologyStatusAtLatch) {
            throw new Error("The Complete History export could not latch its topology state.");
          }
          const scopedTopology = topologyStateForScope(topologyAtLatch, this.scopeId);
          const document = createTopologyStructuredSnapshot(
            scopedTopology,
            topologyStatusAtLatch,
            {
              retainedEventCount: result.count,
              completeEvidence: this.exportCompleteEvidence,
              redact: this.exportRedactions
            }
          );
          let json: string;
          try {
            json = serializeTopologySnapshot(document);
          } catch (error) {
            throw serializationFailure(error);
          }
          const outputBytes = utf8ByteLength(json);
          ensureOutputByteLimit(outputBytes, this.outputByteLimit);
          this.preparedExport = {
            document,
            json,
            html: null,
            filename: topologySnapshotFilename(document, "json")
          };
          this.exportOperation = {
            state: "ready",
            progress: operationProgress(
              "COMPLETE",
              result.count,
              result.count,
              outputBytes,
              result.readPoint,
              this.outputByteLimit,
              this.excludedAfterLatch(result.readPoint)
            )
          };
          this.publish();
        } catch (error) {
          this.finishExportProblem(generation, error, controller.signal);
        }
      },
      (error) => {
        if (this.disposed || generation !== this.exportPreparationGeneration) return;
        this.finishExportProblem(generation, error, controller.signal);
      }
    ).finally(() => {
      if (this.exportAbortController === controller) this.exportAbortController = null;
    });
  }

  private invalidatePreparedExport(cancelPreparing = true): void {
    if (!cancelPreparing && this.exportOperation?.state === "preparing") return;
    this.exportPreparationGeneration += 1;
    this.exportAbortController?.abort();
    this.exportAbortController = null;
    this.preparedExport = null;
    this.exportOperation = undefined;
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) {
      return;
    }
    this.scenarioVisibilityTransition = true;
    this.scenarioState?.runner?.setVisible(visible);
    this.visible = visible;
    this.scenarioVisibilityTransition = false;
    if (!visible) {
      this.cancelPassivePublication();
      this.cancelActivityPublication();
      this.publish(true);
      return;
    }

    this.hiddenDirty = false;
    this.refreshEvidence("visibility");
  }

  private handleCommittedEvidence(entry: CommittedEvidence): void {
    if (this.disposed) {
      return;
    }
    this.historyStatus = this.history.status();
    this.committedEvidenceBoundary = Object.freeze({
      intervalId: entry.intervalId,
      sequence: entry.sequence,
      eventId: entry.eventId
    });
    if (this.performanceHooks?.onVisibleFrame) {
      this.pendingVisibleBoundaries.push(Object.freeze({
        intervalId: entry.intervalId,
        sequence: entry.sequence,
        eventId: entry.eventId
      }));
    }
    if (this.performanceHooks?.onLayoutCommit) {
      this.pendingLayoutCommitBoundaries.push(Object.freeze({
        intervalId: entry.intervalId,
        sequence: entry.sequence,
        eventId: entry.eventId
      }));
    }
    this.performanceHooks?.onCommittedEvidenceBoundary?.(entry, performance.now());
    const projectionRecovery = this.projectionRecovery;
    const topologyProjection = projectionRecovery?.topology ?? this.topologyProjection;
    const commandStateProjections = projectionRecovery?.command ?? this.commandStateProjections;
    const diagnosticProducer = projectionRecovery?.diagnostics ?? this.subscriptionDiagnosticProducer;
    const topologyDiagnostics = projectionRecovery?.topologyDiagnostics ?? this.committedTopologyDiagnostics;
    this.recordSubscriptionDiagnosticProposals(
      diagnosticProducer.applyCommittedEvidence(entry)
    );
    if (!isLightstreamerEvidenceCandidate(entry.candidate)) {
      const syncId = topologyCheckpointSyncId(entry.candidate);
      if (syncId !== null) {
        this.offeredTopologyCheckpointSyncIds.add(syncId);
      }
      const topologyResult = topologyProjection.ingestCommittedEvidence(entry);
      if (!topologyResult.accepted) {
        if (projectionRecovery) projectionRecovery.topologyCoverage = "LIMITED";
        else this.topologyCoverage = "LIMITED";
      }
      this.recordSubscriptionDiagnosticProposals(topologyDiagnostics.apply(
        entry,
        topologyProjection.snapshot(),
        typeof entry.candidate.checkpoint.pageEpoch === "string"
          ? entry.candidate.checkpoint.pageEpoch
          : this.currentPageEpoch,
        { historyStatus: this.history.status() }
      ));
      if (this.acceptDiagnosticEvidenceTransition(entry)) {
        this.refreshRuntimeDiagnosticObservations(topologyProjection.snapshot(), true);
      }
      this.invalidatePreparedExport(false);
      this.scheduleScenarioBoundaryPublication();
      if (this.visible) this.schedulePassivePublication();
      else this.hiddenDirty = true;
      return;
    }
    const event = entry.candidate;
    const scenario = this.scenarioState;
    const scenarioDraft = scenario ? [...scenario.drafts.values()].find((draft) =>
      event.client?.id === draft.anchor.clientId &&
      event.client?.sessionId === draft.anchor.sessionId &&
      event.subscription?.id === draft.anchor.subscriptionId &&
      ((draft.anchor.itemName !== null && event.item?.name === draft.anchor.itemName) ||
        (draft.anchor.itemPosition !== null && event.item?.position === draft.anchor.itemPosition))) : null;
    if (
      scenario && scenarioDraft && scenario.run && !event.synthetic && event.kind === "item-update" &&
      event.subscription?.id === scenarioDraft.anchor.subscriptionId
    ) {
      if (scenario.serverInterleaves.length === 0) {
        scenario.serverInterleaves = [Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId })];
      }
    }
    const activityKey = `${entry.intervalId}\u0000${entry.sequence}`;
    if (!this.activityEvidenceKeys.has(activityKey)) {
      this.activityEvidenceKeys.add(activityKey);
      this.activityEvidence.push(Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, event }));
    }
    // The canonical page projection is intentionally payload-light. Retain
    // the already-observed immutable envelope as a presentation cache so
    // fields that are legitimately unavailable to the facet catalog (for
    // example an item before Session attribution) still honor the existing
    // renderer contract without issuing a second Evidence read.
    this.cacheEvidenceEvent(event);
    this.currentPageEpoch = event.topology?.pageEpoch ?? this.currentPageEpoch;
    if (this.captureStatus !== "bridge disconnected") {
      this.captureStatus = "capturing";
    }
    const topologyResult = topologyProjection.ingestCommittedEvidence(entry);
    if (!topologyResult.accepted) {
      if (projectionRecovery) projectionRecovery.topologyCoverage = "LIMITED";
      else this.topologyCoverage = "LIMITED";
    }
    this.recordSubscriptionDiagnosticProposals(topologyDiagnostics.apply(
      entry,
      topologyProjection.snapshot(),
      event.topology?.pageEpoch ?? this.currentPageEpoch,
      { historyStatus: this.history.status() }
    ));
    commandStateProjections.apply(event);
    this.recordCommittedServerDiagnosticFindings(entry, event);
    if (this.acceptDiagnosticEvidenceTransition(entry)) {
      this.refreshRuntimeDiagnosticObservations(topologyProjection.snapshot(), true);
    }
    if (event.synthetic) this.retainedLocalEvidenceIds.add(event.id);
    this.scheduleScenarioBoundaryPublication();
    this.invalidatePreparedExport(false);
    if (!this.visible) {
      this.hiddenDirty = true;
      return;
    }
    this.scheduleActivityPublication();
    this.schedulePassivePublication();
  }

  private handleFollowerState(state: CommittedEvidencePipelineFollowerState): void {
    if (this.disposed) return;
    this.scenarioFollowerPhase = state.progress.phase;
    this.scheduleScenarioBoundaryPublication();
    if (state.progress.phase === "RECOVERING") {
      const intervalId = state.interval?.id ?? state.progress.intervalId;
      if (
        this.projectionRecovery === null ||
        (this.projectionRecovery.intervalId !== null && intervalId !== null && this.projectionRecovery.intervalId !== intervalId)
      ) {
        this.projectionRecovery = {
          intervalId,
          topology: createTopologyProjection(),
          command: createCommandStateProjections(),
          diagnostics: createSubscriptionDiagnosticProducer(),
          topologyDiagnostics: createCommittedTopologyDiagnosticCoordinator(),
          topologyCoverage: null
        };
      } else if (this.projectionRecovery.intervalId === null && intervalId !== null) {
        this.projectionRecovery.intervalId = intervalId;
      }
      return;
    }
    if (state.progress.phase === "LIVE") {
      const recovery = this.projectionRecovery;
      if (recovery !== null) {
        this.topologyProjection = recovery.topology;
        this.commandStateProjections = recovery.command;
        this.subscriptionDiagnosticProducer = recovery.diagnostics;
        this.committedTopologyDiagnostics = recovery.topologyDiagnostics;
        this.topologyCoverage = recovery.topologyCoverage;
        this.projectionRecovery = null;
        this.invalidatePreparedExport();
        if (this.initialEvidenceSettled && this.visible) this.schedulePassivePublication();
      }
      return;
    }
    if (state.progress.phase === "FAILED") {
      this.projectionRecovery = null;
      this.investigationState = "error";
      this.investigationProblem = {
        code: "QUERY_FAILED",
        message: state.problem?.message ?? "Evidence recovery unavailable."
      };
      this.lastEvidenceQueryError = this.investigationProblem.code;
      if (this.visible) this.publish();
      else this.hiddenDirty = true;
      return;
    }
    if (state.progress.phase === "CANCELLED") {
      this.projectionRecovery = null;
    }
  }

  private scenarioBoundarySnapshot(): ScenarioCommittedBoundarySnapshot {
    const status = this.history.status();
    return Object.freeze({
      boundary: this.committedEvidenceBoundary,
      intervalId: status.interval.id,
      retainedRange: status.retainedRange,
      history: status.phase === "RUNNING" ? "accepting" as const : status.phase === "CLOSED" ? "closed" as const : "unavailable" as const,
      projection: this.scenarioFollowerPhase === "LIVE" && this.projectionRecovery === null
        ? "live" as const
        : this.scenarioFollowerPhase === "FAILED" ? "failed" as const : "recovering" as const
    });
  }

  private scheduleScenarioBoundaryPublication(): void {
    if (this.scenarioBoundaryPublicationPending) return;
    this.scenarioBoundaryPublicationPending = true;
    queueMicrotask(() => {
      this.scenarioBoundaryPublicationPending = false;
      if (this.disposed) return;
      const snapshot = this.scenarioBoundarySnapshot();
      for (const listener of this.scenarioBoundaryListeners) listener(snapshot);
    });
  }

  private scenarioBoundaryFeed(): ScenarioCommittedBoundaryFeed {
    return Object.freeze({
      snapshot: () => this.scenarioBoundarySnapshot(),
      subscribe: (_after, listener) => {
        this.scenarioBoundaryListeners.add(listener);
        return () => this.scenarioBoundaryListeners.delete(listener);
      }
    });
  }

  private handleHistoryPublication(publication: HistoryPublication): void {
    if (this.disposed) return;
    let shouldPublish = false;
    if (publication.type === "status") {
      this.historyStatus = publication.status;
      this.scheduleScenarioBoundaryPublication();
      shouldPublish = this.updateHistoryCondition(publication.status, publication.problem);
      this.maybeSampleStorageEstimate(publication.status);
    } else if (publication.type === "interval-cleared") {
      this.historyStatus = publication.status;
      this.scheduleScenarioBoundaryPublication();
      // A frame after Clear can only prove visibility for the new History
      // Interval. Boundaries accepted before the clear are no longer part of
      // the rendered Evidence snapshot and must not be coalesced into it.
      this.resetCoherentStateAfterClear();
      this.updateHistoryCondition(publication.status);
      this.maybeSampleStorageEstimate(publication.status);
      shouldPublish = true;
    } else if (publication.type === "terminal") {
      this.historyStatus = publication.status;
      this.scheduleScenarioBoundaryPublication();
      shouldPublish = this.updateHistoryCondition(publication.status);
      this.maybeSampleStorageEstimate(publication.status);
    }
    if (shouldPublish) this.refreshRuntimeDiagnosticObservations(this.topologyProjection.snapshot(), true);
    let reason: string | undefined;
    const terminal = publication.type === "terminal"
      ? publication.terminal
      : publication.type === "status"
        ? publication.status.terminal
        : undefined;
    if (publication.type === "status") {
      if (publication.status.phase !== "DRAINING_TO_STOP" && publication.status.phase !== "STOPPED") {
        if (shouldPublish) this.publish();
        return;
      }
      reason = publication.problem?.reason ?? terminal?.reason;
    } else if (publication.type === "terminal") {
      reason = publication.terminal.reason;
    }
    if (!reason) return;
    const exactBoundary = terminal?.committedEvidenceBoundary ??
      (publication.type === "status" ? publication.status.committedEvidenceBoundary : null);
    const exactFirstMissingEventId = terminal?.firstMissingEventId ?? null;
    if (this.captureBoundary) {
      if (
        this.captureBoundary.committedEvidenceBoundary !== exactBoundary ||
        this.captureBoundary.firstMissingEventId !== exactFirstMissingEventId
      ) {
        this.captureBoundary = Object.freeze({
          ...this.captureBoundary,
          committedEvidenceBoundary: exactBoundary,
          firstMissingEventId: exactFirstMissingEventId
        });
        shouldPublish = true;
      }
      if (shouldPublish) this.publish();
      if (publication.type === "terminal") this.refreshEvidence("command");
      return;
    }
    this.captureBoundary = Object.freeze({
      operation: "STOPPED",
      coverage: "LIMITED",
      firstMissingEventId: exactFirstMissingEventId,
      committedEvidenceBoundary: exactBoundary,
      detail: `Capture stopped at the committed Evidence boundary because ${reason}.`,
      recovery: "Reload the inspected page with DevTools open"
    });
    if (shouldPublish || reason) this.publish();
    if (publication.type === "terminal") this.refreshEvidence("command");
  }

  private updateHistoryCondition(
    status: HistoryStatus,
    problem?: HistoryProblem
  ): boolean {
    const next = historyConditionFor({ status, problem });
    const changed = this.historyCondition?.announcementKey !== next?.announcementKey;
    this.historyCondition = next;
    if (changed) {
      this.historyAnnouncement = next?.announcement ?? "";
    }
    return changed;
  }

  private maybeSampleStorageEstimate(status: HistoryStatus): void {
    const threshold: StorageEstimateThreshold | null =
      status.capacity.state === "EXHAUSTED"
        ? "EXHAUSTED"
        : status.capacity.state === "NEAR_LIMIT"
          ? "NEAR_LIMIT"
          : null;
    if (!threshold || !this.storageHeadroomSampler || this.storageEstimateThresholdsSampled.has(threshold)) {
      return;
    }
    this.storageEstimateThresholdsSampled.add(threshold);
    this.sampleStorageEstimate(threshold);
  }

  private sampleStorageEstimate(threshold: StorageEstimateThreshold): void {
    if (!this.storageHeadroomSampler) return;
    void this.storageHeadroomSampler.sample(threshold).then((observation) => {
      if (this.disposed) return;
      this.storageEstimate = observation;
      this.refreshRuntimeDiagnosticObservations(this.topologyProjection.snapshot(), true);
      this.publish();
    });
  }

  private schedulePassivePublication(): void {
    if (!this.initialEvidenceSettled) {
      this.passiveRefreshPending = true;
      return;
    }
    if (this.frameHandle !== null || this.fallbackHandle !== null) {
      return;
    }
    this.frameHandle = this.scheduler.requestFrame(() => {
      this.frameHandle = null;
      if (this.fallbackHandle !== null) {
        this.scheduler.clearTimeout(this.fallbackHandle);
        this.fallbackHandle = null;
      }
      this.refreshEvidence("passive");
    });
    this.fallbackHandle = this.scheduler.setTimeout(() => {
      this.fallbackHandle = null;
      if (this.frameHandle !== null) {
        this.scheduler.cancelFrame(this.frameHandle);
        this.frameHandle = null;
      }
      this.refreshEvidence("passive");
    }, 32);
  }

  private cancelPassivePublication(): void {
    if (this.frameHandle !== null) {
      this.scheduler.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.fallbackHandle !== null) {
      this.scheduler.clearTimeout(this.fallbackHandle);
      this.fallbackHandle = null;
    }
  }

  private scheduleActivityPublication(): void {
    if (!this.activityOpen || !this.visible || this.activityPublicationHandle !== null) {
      if (this.activityOpen && this.visible) this.activityPublicationPending = true;
      return;
    }
    this.activityPublicationPending = true;
    this.activityPublicationHandle = this.scheduler.setTimeout(() => {
      this.activityPublicationHandle = null;
      this.activityPublicationPending = false;
      this.activityPublishedProjection = null;
      if (!this.disposed && this.visible && this.activityOpen) this.publish();
    }, this.activityPublicationDelayMs);
  }

  private cancelActivityPublication(): void {
    if (this.activityPublicationHandle !== null) {
      this.scheduler.clearTimeout(this.activityPublicationHandle);
      this.activityPublicationHandle = null;
    }
    this.activityPublicationPending = false;
    this.activityPublishedProjection = null;
  }

  private flushActivityPublication(): void {
    this.cancelActivityPublication();
  }

  private navigateEvidenceWindow(
    direction: "older" | "newer" | "oldest" | "newest"
  ): void {
    const displayed = this.displayedEvidence();
    const total = this.liveEvidence.total;
    const visibleEnd = Math.max(0, displayed.total - displayed.offset);
    const currentOffset = Math.max(0, total - visibleEnd);
    const oldestOffset = Math.max(0, total - Math.min(total, this.windowSize));
    const offset =
      direction === "older"
        ? Math.min(oldestOffset, currentOffset + this.windowSize)
        : direction === "newer"
          ? Math.max(0, currentOffset - this.windowSize)
          : direction === "oldest"
            ? oldestOffset
          : 0;
    if (offset === currentOffset && this.mode === "frozen") return;
    this.mode = "frozen";
    this.refreshEvidence("navigation", offset);
  }

  private invalidateEvidenceCopy(): void {
    this.evidenceCopyAbortController?.abort();
    this.evidenceCopyAbortController = null;
    this.evidenceCopyGeneration += 1;
    this.evidenceCopy = Object.freeze({ state: "idle", eventCount: 0, text: null });
  }

  private prepareScopedEvidenceCopy(): void {
    const generation = ++this.evidenceCopyGeneration;
    this.evidenceCopyAbortController?.abort();
    const controller = new AbortController();
    this.evidenceCopyAbortController = controller;
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const scope = this.scopeSnapshot();
    const scopeId = this.scopeId ?? "page";
    let copyStats: { bytes: number; count: number } = { bytes: 1, count: 0 };
    this.evidenceCopy = Object.freeze({
      state: "preparing",
      eventCount: 0,
      text: null,
      progress: operationProgress(
        "LATCHING",
        0,
        null,
        copyStats.bytes,
        null,
        this.outputByteLimit,
        this.excludedAfterLatch(null)
      )
    });
    this.publish();
    void import("./evidence-history-operation")
      .then(({ createScopedEvidenceCopy }) => createScopedEvidenceCopy({
        query: this.evidenceQuery,
        scope: structuralEvidenceScope(target),
        filter: this.canonicalFilter,
        order: "OLDEST_FIRST",
        signal: controller.signal,
        maxBytes: this.outputByteLimit,
        scopeId,
        scopeLabel: scope.label,
        serializeRecord: (record) => toPersistableEventEnvelope(eventFromDeterministicRecord(record)),
        onLatch: (readPoint, total) => {
          this.updateEvidenceCopyProgress(generation, "READING", 0, total, copyStats.bytes, readPoint);
        },
        onProgress: ({ completed, outputBytes, readPoint }) => {
          copyStats = { bytes: outputBytes, count: completed };
          this.updateEvidenceCopyProgress(
            generation,
            "SERIALIZING",
            completed,
            this.evidenceCopy.progress?.total ?? null,
            outputBytes,
            readPoint
          );
        }
      }))
      .then(
        (result) => {
        if (this.disposed || generation !== this.evidenceCopyGeneration) return;
        if (!result.ok) {
          this.finishEvidenceCopyProblem(generation, result.problem, controller.signal, copyStats);
          this.publish();
          return;
        }
        copyStats = { bytes: result.outputBytes, count: result.count };
        this.evidenceCopy = Object.freeze({
          state: "ready",
          eventCount: result.count,
          text: result.text,
          progress: operationProgress(
            "COMPLETE",
            result.count,
            result.count,
            result.outputBytes,
            result.readPoint,
            this.outputByteLimit,
            this.excludedAfterLatch(result.readPoint)
          )
        });
        this.publish();
      },
      (error) => {
        if (this.disposed || generation !== this.evidenceCopyGeneration) return;
        this.finishEvidenceCopyProblem(generation, error, controller.signal, copyStats);
        this.publish();
      }
    ).finally(() => {
      if (this.evidenceCopyAbortController === controller) this.evidenceCopyAbortController = null;
    });
  }

  private updateEvidenceCopyProgress(
    generation: number,
    phase: WorkbenchEvidenceOperationProgress["phase"],
    completed: number,
    total: number | null,
    outputBytes: number,
    readPoint: EvidenceSnapshot["readPoint"] | null
  ): void {
    if (this.disposed || generation !== this.evidenceCopyGeneration || this.evidenceCopy.state !== "preparing") return;
    this.evidenceCopy = Object.freeze({
      ...this.evidenceCopy,
      eventCount: completed,
      progress: operationProgress(
        phase,
        completed,
        total,
        outputBytes,
        readPoint,
        this.outputByteLimit,
        this.excludedAfterLatch(readPoint)
      )
    });
    this.publish();
  }

  private excludedAfterLatch(readPoint: EvidenceSnapshot["readPoint"] | null): number {
    if (!readPoint?.committedEvidenceBoundary) return 0;
    const current = this.history.status().committedEvidenceBoundary;
    if (!current) return 0;
    return Math.max(0, current.sequence - readPoint.committedEvidenceBoundary.sequence);
  }

  private updateExportProgress(
    generation: number,
    phase: WorkbenchEvidenceOperationProgress["phase"],
    completed: number,
    total: number | null,
    outputBytes: number,
    readPoint: EvidenceSnapshot["readPoint"] | null
  ): void {
    if (this.disposed || generation !== this.exportPreparationGeneration || this.exportOperation?.state !== "preparing") return;
    this.exportOperation = {
      ...this.exportOperation,
      progress: operationProgress(
        phase,
        completed,
        total,
        outputBytes,
        readPoint,
        this.outputByteLimit,
        this.excludedAfterLatch(readPoint)
      )
    };
    this.publish();
  }

  private cancelEvidenceOperation(): void {
    if (this.evidenceCopy.state === "preparing") {
      const progress = this.evidenceCopy.progress ?? operationProgress("CANCELLED", 0, null, 0, null, this.outputByteLimit, 0);
      this.evidenceCopyGeneration += 1;
      this.evidenceCopyAbortController?.abort();
      this.evidenceCopyAbortController = null;
      this.evidenceCopy = Object.freeze({
        state: "cancelled",
        eventCount: progress.completed,
        text: null,
        error: "The Complete History copy was cancelled before its artifact was published.",
        outcome: "CANCELLED",
        recovery: "Run Copy complete scoped Evidence again when you are ready.",
        progress: operationProgress("CANCELLED", progress.completed, progress.total, progress.outputBytes, readPointFromProgress(progress), this.outputByteLimit, progress.excludedAfterLatch)
      });
      this.publish();
      return;
    }
    if (this.exportOperation?.state === "preparing") {
      const progress = this.exportOperation.progress;
      this.exportPreparationGeneration += 1;
      this.exportAbortController?.abort();
      this.exportAbortController = null;
      this.preparedExport = null;
      this.exportOperation = {
        state: "cancelled",
        error: "The Complete History export was cancelled before its artifact was published.",
        outcome: "CANCELLED",
        recovery: "Run Export Scope again when you are ready.",
        progress: { ...progress, phase: "CANCELLED" }
      };
      this.publish();
    }
  }

  private finishEvidenceCopyProblem(
    generation: number,
    failure: unknown,
    signal: AbortSignal,
    writer: { readonly bytes: number; readonly count: number }
  ): void {
    if (this.disposed || generation !== this.evidenceCopyGeneration) return;
    const detail = operationFailure(failure, signal);
    if (detail.outcome === "CANCELLED") {
      this.evidenceCopy = Object.freeze({
        state: "cancelled",
        eventCount: writer.count,
        text: null,
        error: detail.message,
        outcome: detail.outcome,
        recovery: detail.recovery,
        progress: operationProgress("CANCELLED", writer.count, this.evidenceCopy.progress?.total ?? null, writer.bytes, readPointFromProgress(this.evidenceCopy.progress), this.outputByteLimit, this.evidenceCopy.progress?.excludedAfterLatch ?? 0)
      });
      return;
    }
    this.evidenceCopy = Object.freeze({
      state: detail.outcome === "OUTPUT_REFUSED" ? "refused" : "error",
      eventCount: 0,
      text: null,
      error: detail.message,
      outcome: detail.outcome,
      recovery: detail.recovery,
      progress: operationProgress(
        detail.outcome === "OUTPUT_REFUSED" ? "REFUSED" : "FAILED",
        writer.count,
        this.evidenceCopy.progress?.total ?? null,
        writer.bytes,
        readPointFromProgress(this.evidenceCopy.progress),
        this.outputByteLimit,
        this.evidenceCopy.progress?.excludedAfterLatch ?? 0
      )
    });
  }

  private finishExportProblem(generation: number, failure: unknown, signal: AbortSignal): void {
    if (this.disposed || generation !== this.exportPreparationGeneration) return;
    const detail = operationFailure(failure, signal);
    const progress = this.exportOperation?.progress ?? operationProgress("FAILED", 0, null, 0, null, this.outputByteLimit, 0);
    this.preparedExport = null;
    this.exportOperation = {
      state: detail.outcome === "OUTPUT_REFUSED" ? "refused" : detail.outcome === "CANCELLED" ? "cancelled" : "error",
      error: detail.message,
      outcome: detail.outcome,
      recovery: detail.recovery,
      progress: {
        ...progress,
        phase: detail.outcome === "OUTPUT_REFUSED" ? "REFUSED" : detail.outcome === "CANCELLED" ? "CANCELLED" : "FAILED"
      }
    };
    this.publish();
  }

  private beginLocalInjectionFromSelection(): void {
    const eventId = this.selectionEventId;
    if (!eventId) {
      this.localInjectionEntryError = "Select one captured Item Update before creating a Local Injection draft.";
      this.publish();
      return;
    }
    if (this.selectedPayloadLoadedForEventId !== eventId && this.evidenceQueryPending) {
      this.pendingLocalInjectionEntry = {
        intent: { kind: "selected-event", eventId },
        rawText: null,
        review: false,
        execute: false
      };
      this.localInjectionEntryError = null;
      this.publish();
      return;
    }
    this.enterLocalInjection({ kind: "selected-event", eventId });
  }

  private beginLocalInjectionFromScope(): void {
    this.enterLocalInjection({ kind: "scope-author", scopeId: this.scopeId ?? "page" });
  }

  private resumePendingLocalInjection(): void {
    const pending = this.pendingLocalInjectionEntry;
    if (!pending || this.localInjectionDraft) return;
    if (pending.intent.kind === "selected-event" && this.selectedPayloadLoadedForEventId !== pending.intent.eventId) return;
    this.pendingLocalInjectionEntry = null;
    this.enterLocalInjection(pending.intent);
    const draft = this.localInjectionDraft as LocalInjectionDraftState | null;
    if (!draft) return;
    if (pending.rawText !== null) {
      draft.rawText = pending.rawText;
      draft.preflightFingerprint = null;
      draft.reviewedExecution = null;
      draft.reviewRefusal = null;
      draft.outcome = null;
      this.refreshLocalInjectionValidation(draft);
    }
    if (pending.review) this.reviewLocalInjection();
    if (pending.execute) this.executeLocalInjection();
  }

  private enterLocalInjection(intent: LocalInjectionEntryIntent): void {
    this.localInjectionEntryError = null;
    if (this.localInjectionDraft) {
      this.localInjectionBlockedEntry = intent;
      this.localInjectionDiscardConfirmation = false;
      this.localInjectionDraft.open = true;
      this.localInjectionDraft.parked = false;
      this.publish();
      return;
    }

    const candidate = this.createLocalInjectionCandidate(intent);
    if (!candidate) {
      this.publish();
      return;
    }
    this.localInjectionDraft = candidate;
    this.localInjectionBlockedEntry = null;
    this.localInjectionDiscardConfirmation = false;
    this.publish();
  }

  private createLocalInjectionCandidate(
    intent: LocalInjectionEntryIntent
  ): LocalInjectionDraftState | null {
    const sourceEvent = intent.kind === "selected-event"
      ? this.selectedEventEnvelope?.id === intent.eventId
        ? this.selectedEventEnvelope
        : this.displayedEvidence().events.find(({ id }) => id === intent.eventId) ?? null
      : null;
    let baseDraft: ReinjectionDraft | null = null;
    let anchor: WorkbenchLocalInjectionAnchor | null = null;
    let sourceDocument: LocalInjectionDocument | null = null;

    if (intent.kind === "selected-event") {
      if (!sourceEvent || !isCompatibleLocalInjectionSource(sourceEvent)) {
        this.localInjectionEntryError = "Selected Evidence is not a compatible captured Item Update with a live delivery target.";
        return null;
      }
      baseDraft = createDraftFromEvent(sourceEvent);
      if (!baseDraft) return null;
      const fieldSchema = localInjectionFieldSchema(
        sourceEvent.subscription?.fields,
        sourceEvent.update?.fields
      );
      baseDraft = {
        ...baseDraft,
        sourceSubscription: {
          ...baseDraft.sourceSubscription!,
          fields: [...fieldSchema]
        }
      };
      anchor = anchorFromDraft(
        baseDraft,
        "captured-event",
        sourceEvent.topology?.pageEpoch ?? this.currentPageEpoch,
        fieldSchema
      );
      sourceDocument = createLocalInjectionDocumentFromDraft(baseDraft);
    } else {
      const target = findTopologySelection(this.topologyProjection.snapshot(), intent.scopeId);
      const authored = authoredDraftFromScope(target, this.currentPageEpoch);
      if (!authored) {
        this.localInjectionEntryError = "Authoring requires a live COMMAND Item Scope, Listener Scope, or a Subscription with exactly one current item and a captured listener context.";
        return null;
      }
      ({ draft: baseDraft, anchor } = authored);
    }

    const document = createLocalInjectionDocumentFromDraft(baseDraft);
    const rawText = serializeLocalInjectionDocument(document);
    const state: LocalInjectionDraftState = {
      id: `local-injection-draft-${++this.localInjectionSequence}`,
      baseDraft,
      anchor,
      rawText,
      document,
      documentDiagnostics: Object.freeze([]),
      targetDiagnostics: Object.freeze([]),
      sourceDocument,
      sourceRawText: sourceDocument ? serializeLocalInjectionDocument(sourceDocument) : null,
      explicitConcreteFields: new Set<string>(),
      phase: "edit",
      compareOpen: false,
      editorPresentation: emptyScenarioEditorState(false),
      minimized: false,
      parked: false,
      open: true,
      restorationOrigin: Object.freeze({
        scopeId: this.scopeId,
        selectionEventId: this.selectionEventId,
        focusedEventId: this.focusedEventId,
        contextId: this.contextId
      }),
      executionId: null,
      preflightFingerprint: null,
      outcome: null,
      reviewedExecution: null,
      reviewRefusal: null,
      relativeDelayMs: 0
    };
    this.refreshLocalInjectionValidation(state);
    return state;
  }

  private setLocalInjectionJson(text: string): void {
    const draft = this.localInjectionDraft;
    if (!draft) {
      if (this.pendingLocalInjectionEntry) this.pendingLocalInjectionEntry.rawText = text;
      return;
    }
    if (draft.phase !== "edit") return;
    draft.rawText = text;
    draft.preflightFingerprint = null;
    draft.reviewedExecution = null;
    draft.reviewRefusal = null;
    draft.outcome = null;
    this.refreshLocalInjectionValidation(draft);
    this.publish();
  }

  private reviewLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft) {
      if (this.pendingLocalInjectionEntry) this.pendingLocalInjectionEntry.review = true;
      return;
    }
    if (draft.phase !== "edit") return;
    this.refreshLocalInjectionValidation(draft);
    if (localInjectionReady(draft)) {
      const fingerprint = this.localInjectionFingerprint(draft);
      const executionDraft = applyLocalInjectionDocumentToDraft(
        draft.baseDraft,
        draft.document!,
        draft.explicitConcreteFields
      );
      const reviewed = this.localInjectionExecutionCoordinator.review({
        fingerprint,
        executionTarget: draft.anchor.executionTarget,
        document: freezeLocalInjectionDocument(draft.document!),
        draft: cloneReinjectionDraft(executionDraft),
        correlation: {}
      });
      if (reviewed.kind === "reviewed") {
        draft.phase = "review";
        draft.preflightFingerprint = fingerprint;
        draft.reviewedExecution = reviewed;
        draft.reviewRefusal = null;
      } else {
        draft.phase = "review";
        draft.preflightFingerprint = fingerprint;
        draft.reviewedExecution = reviewed;
        draft.reviewRefusal = reviewed.reason;
      }
    }
    this.publish();
  }

  private editLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft || draft.phase !== "review") return;
    draft.phase = "edit";
    draft.preflightFingerprint = null;
    draft.reviewedExecution = null;
    draft.reviewRefusal = null;
    this.publish();
  }

  private executeLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft) {
      if (this.pendingLocalInjectionEntry) this.pendingLocalInjectionEntry.execute = true;
      return;
    }
    if (
      draft.phase !== "review" ||
      !draft.document ||
      !draft.preflightFingerprint ||
      (!draft.reviewedExecution && !draft.reviewRefusal)
    ) return;
    this.refreshLocalInjectionValidation(draft);
    const currentFingerprint = this.localInjectionFingerprint(draft);
    if (draft.reviewRefusal && draft.reviewedExecution?.kind === "refused") {
      if (currentFingerprint !== draft.preflightFingerprint) {
        draft.phase = "edit";
        draft.preflightFingerprint = null;
        draft.reviewRefusal = null;
        this.publish();
        return;
      }
    }
    const reviewedExecution = draft.reviewedExecution!;
    const executionCheck = reviewedExecution.kind === "reviewed"
      ? this.localInjectionExecutionCoordinator.revalidateReview(reviewedExecution)
      : { kind: "current" as const };
    if (executionCheck.kind === "review-invalidated") {
      draft.phase = "edit";
      draft.preflightFingerprint = null;
      draft.reviewedExecution = null;
      draft.reviewRefusal = null;
      this.publish();
      return;
    }

    const executionId = `local-injection-execution-${++this.localInjectionSequence}`;
    draft.executionId = executionId;
    draft.phase = "pending";
    this.publish();

    void this.localInjectionExecutionCoordinator.execute(reviewedExecution, {
      executionId,
      onTerminal: (record) => {
        if (!this.disposed) this.setLocalInjectionOutcome(executionId, record.outcome);
      }
    }).then((result) => {
      if (result.kind === "review-invalidated") {
        const current = this.localInjectionDraft;
        if (!current || current.phase !== "pending" || current.executionId !== executionId) return;
        current.phase = "edit";
        current.preflightFingerprint = null;
        current.reviewedExecution = null;
        current.reviewRefusal = null;
        this.publish();
        return;
      }
    });
  }

  private setLocalInjectionOutcome(
    executionId: string,
    outcome: WorkbenchLocalInjectionOutcome
  ): void {
    const draft = this.localInjectionDraft;
    if (!draft || draft.phase !== "pending" || draft.executionId !== executionId || draft.outcome) return;
    draft.outcome = Object.freeze(outcome);
    draft.phase = "outcome";
    this.publish();
  }

  private refreshLocalInjectionValidation(draft: LocalInjectionDraftState): void {
    const previousDocument = draft.document;
    const analysis = analyzeLocalInjectionDocument(draft.rawText, {
      mode: draft.anchor.subscriptionMode,
      commandSemantics:
        draft.anchor.sourceKind === "authored" || draft.anchor.subscriptionMode === "COMMAND"
          ? "required"
          : "not-applicable",
      schemaFields: draft.anchor.fieldSchema,
      jsonStringFields: expandJsonStringFields(draft.baseDraft.fields).encodedFieldNames,
      commandState: this.commandStateProjections.snapshot("local-effective"),
      subscriptionId: draft.anchor.subscriptionId,
      itemName: draft.anchor.itemName,
      itemPosition: draft.anchor.itemPosition
    });
    rememberExplicitConcreteFields(
      draft.explicitConcreteFields,
      previousDocument,
      analysis.document
    );
    draft.document = analysis.document;
    draft.documentDiagnostics = analysis.diagnostics;
    draft.targetDiagnostics = Object.freeze(this.validateLocalInjectionTarget(draft.anchor));
  }

  private validateLocalInjectionTarget(
    anchor: WorkbenchLocalInjectionAnchor
  ): LocalInjectionDiagnostic[] {
    const diagnostics: LocalInjectionDiagnostic[] = [];
    const stale = (code: string, message: string) => diagnostics.push(Object.freeze({
      category: "target" as const,
      severity: "error" as const,
      code,
      message
    }));
    if (this.captureStatus === "bridge disconnected") {
      stale("stale-page-delivery", "The inspected-page Local Injection delivery target is disconnected.");
    }
    if (anchor.pageEpoch && this.currentPageEpoch && anchor.pageEpoch !== this.currentPageEpoch) {
      stale("stale-page-delivery", "The inspected page changed after this draft was created.");
    }
    const state = this.topologyProjection.snapshot();
    const client = anchor.clientId
      ? state.clients.find(({ id }) => id === anchor.clientId) ?? null
      : null;
    if (!client) {
      stale("stale-client", "The protected Lightstreamer Client is no longer available.");
      return diagnostics;
    }
    const session = anchor.sessionId
      ? client.sessions.find((candidate) => candidate.id === anchor.sessionId && !candidate.historical) ?? null
      : null;
    if (!session || !session.active) {
      stale("stale-session", "The protected Lightstreamer Session is no longer active.");
      return diagnostics;
    }
    const subscription = session.subscriptions.find(
      (candidate) => candidate.id === anchor.subscriptionId && !candidate.historical
    );
    if (!subscription || !subscription.active) {
      stale("stale-subscription", "The protected Subscription is no longer active.");
      return diagnostics;
    }
    const item = subscription.items.find(
      (candidate) =>
        (anchor.itemName !== null && candidate.name === anchor.itemName) ||
        (anchor.itemPosition !== null && candidate.position === anchor.itemPosition)
    );
    if (!item) stale("stale-item", "The protected Subscription item is no longer available.");
    if (anchor.executionTarget === "captured-listener") {
      if (!subscription.listeners.some(isActiveLocalInjectionDeliveryListener)) {
        stale("stale-listener", "The protected Subscription has no current Item Update listeners.");
      }
    } else if (anchor.itemPosition === null || anchor.captureSource !== "wire") {
      stale("stale-wire-target", "The protected captured wire delivery target is unavailable.");
    }
    return diagnostics;
  }

  private localInjectionFingerprint(draft: LocalInjectionDraftState): string {
    const target = this.validateLocalInjectionTarget(draft.anchor).map(({ code }) => code);
    return hashLocalInjectionValue({
      anchor: draft.anchor,
      document: draft.document,
      target,
      deliveryIdentity: this.localInjectionDeliveryIdentity(draft.anchor)
    });
  }

  private localInjectionDeliveryIdentity(
    anchor: WorkbenchLocalInjectionAnchor
  ): unknown {
    const state = this.topologyProjection.snapshot();
    const client = state.clients.find(({ id }) => id === anchor.clientId);
    const session = client?.sessions.find(
      (candidate) => candidate.id === anchor.sessionId && !candidate.historical
    );
    const subscription = session?.subscriptions.find(
      (candidate) => candidate.id === anchor.subscriptionId && !candidate.historical
    );
    const item = subscription?.items.find(
      (candidate) =>
        (anchor.itemName !== null && candidate.name === anchor.itemName) ||
        (anchor.itemPosition !== null && candidate.position === anchor.itemPosition)
    );
    const deliveryListenerIds = subscription?.listeners
      .filter(isActiveLocalInjectionDeliveryListener)
      .map(({ id }) => id)
      .sort() ?? [];
    return {
      pageEpoch: this.currentPageEpoch,
      captureStatus: this.captureStatus,
      clientId: client?.id ?? null,
      sessionId: session?.id ?? null,
      sessionActive: session?.active ?? false,
      subscriptionId: subscription?.id ?? null,
      subscriptionActive: subscription?.active ?? false,
      serverEstablished: subscription?.serverEstablished ?? false,
      itemId: item?.id ?? null,
      deliveryListenerIds
    };
  }

  private parkLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft || draft.phase === "pending") return;
    draft.open = false;
    draft.parked = true;
    draft.minimized = false;
    this.localInjectionBlockedEntry = null;
    this.localInjectionDiscardConfirmation = false;
    this.publish();
  }

  private resumeLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft) return;
    draft.open = true;
    draft.parked = false;
    this.localInjectionBlockedEntry = null;
    this.localInjectionDiscardConfirmation = false;
    this.publish();
  }

  private confirmDiscardLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft || !this.localInjectionDiscardConfirmation || draft.phase === "pending") return;
    const blocked = this.localInjectionBlockedEntry;
    this.localInjectionDraft = null;
    this.localInjectionBlockedEntry = null;
    this.localInjectionDiscardConfirmation = false;
    if (blocked) {
      const candidate = this.createLocalInjectionCandidate(blocked);
      this.localInjectionDraft = candidate;
    }
    this.publish();
  }

  private finishLocalInjection(): void {
    const draft = this.localInjectionDraft;
    if (!draft || draft.phase !== "outcome") return;
    this.localInjectionDraft = null;
    this.localInjectionBlockedEntry = null;
    this.localInjectionDiscardConfirmation = false;
    this.localInjectionEntryError = null;
    this.publish();
  }

  private convertLocalInjectionToScenario(): void {
    const draft = this.localInjectionDraft;
    if (!draft || draft.phase === "pending" || this.scenarioState) return;
    if (draft.phase !== "edit") this.editLocalInjection();
    let scenario: LocalInjectionScenario;
    try {
      scenario = createScenarioFromDraft(this.scenarioDraftInput(draft), {
        scenarioId: `local-injection-scenario-${++this.localInjectionSequence}`
      });
    } catch (error) {
      this.localInjectionEntryError = error instanceof Error ? error.message : "Scenario capacity could not be established.";
      this.publish();
      return;
    }
    this.scenarioState = {
      phase: "edit",
      scenario,
      drafts: new Map([[scenario.steps[0]!.id, draft]]),
      run: null,
      reviews: new Map(),
      membershipError: null,
      pickerOpen: false,
      membershipPreview: null,
      focusedMemberId: scenario.steps[0]!.id,
      focusedStepId: scenario.steps[0]!.id,
      removedDrafts: new Map(),
      priorRuns: [],
      retainedRunBytes: 0,
      runner: null,
      runnerSnapshot: null,
      serverInterleaves: []
    };
    draft.open = false;
    draft.parked = false;
    this.publish();
  }

  private addSelectedEvidenceToScenario(): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit" || !state.pickerOpen || !this.selectionEventId) return;
    const candidate = this.createLocalInjectionCandidate({ kind: "selected-event", eventId: this.selectionEventId });
    if (!candidate) {
      state.membershipError = this.localInjectionEntryError ?? "Selected Evidence is unavailable for this Scenario.";
      this.publish();
      return;
    }
    const addition = addScenarioStep(state.scenario, this.scenarioDraftInput(candidate), { retainedRunBytes: state.retainedRunBytes });
    if (!addition.ok) {
      state.membershipError = addition.reason;
      this.publish();
      return;
    }
    state.scenario = addition.scenario;
    state.focusedStepId = addition.scenario.steps.at(-1)!.id;
    state.focusedMemberId = state.focusedStepId;
    state.drafts.set(state.focusedStepId, candidate);
    state.membershipError = null;
    state.pickerOpen = false;
    state.membershipPreview = null;
    this.localInjectionEntryError = null;
    this.publish();
  }

  private previewVisibleEvidenceForScenario(): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit" || !state.pickerOpen) return;
    const displayed = this.displayedEvidence();
    const existing = new Set(state.scenario.steps.map(({ draft }) => draft.sourceEventId).filter(Boolean));
    const candidates = displayed.events.map((event, index) => {
      const record = displayed.records[index];
      const evidence = Object.freeze({
        intervalId: record?.identity.intervalId ?? "unavailable",
        sequence: record?.identity.sequence ?? index,
        eventId: event.id
      });
      if (existing.has(event.id)) return {
        evidence,
        draft: null,
        unavailableReason: "Already an explicit Scenario Step."
      };
      const availability = this.scenarioMembershipAvailability(event);
      if (!availability.available) return {
        evidence,
        draft: null,
        unavailableReason: availability.reason ?? "Compatibility could not be proven."
      };
      const candidate = this.createLocalInjectionCandidate({ kind: "selected-event", eventId: event.id });
      return {
        evidence,
        draft: candidate ? this.scenarioDraftInput(candidate) : null,
        ...(candidate ? {} : { unavailableReason: this.localInjectionEntryError ?? "Captured Item Update is unavailable for Scenario authoring." })
      };
    });
    state.membershipPreview = previewScenarioMembership(state.scenario, candidates);
    state.membershipError = null;
    this.localInjectionEntryError = null;
    this.publish();
  }

  private confirmScenarioMembershipPreview(): void {
    const state = this.scenarioState;
    const preview = state?.membershipPreview;
    if (!state || state.phase !== "edit" || !preview) return;
    const candidates = new Map<string, LocalInjectionDraftState>();
    for (const member of preview.members) {
      if (!member.available) continue;
      const displayed = this.displayedEvidence();
      const index = displayed.events.findIndex(({ id }) => id === member.evidence.eventId);
      const identity = displayed.records[index]?.identity;
      if (!identity || identity.intervalId !== member.evidence.intervalId || identity.sequence !== member.evidence.sequence || identity.eventId !== member.evidence.eventId) {
        state.membershipError = `Evidence ${member.evidence.eventId} is no longer retained at ${member.evidence.intervalId} sequence ${member.evidence.sequence}. Preview membership again; no Steps were added.`;
        state.membershipPreview = null;
        this.publish();
        return;
      }
      const candidate = this.createLocalInjectionCandidate({ kind: "selected-event", eventId: member.evidenceId });
      if (!candidate) {
        state.membershipError = this.localInjectionEntryError ?? `Evidence ${member.evidenceId} is no longer available; no Steps were added.`;
        this.publish();
        return;
      }
      candidates.set(member.evidenceId, candidate);
    }
    const result = confirmScenarioMembershipPreview(state.scenario, preview, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) {
      state.membershipError = result.reason;
      this.publish();
      return;
    }
    const added = result.scenario.steps.slice(state.scenario.steps.length);
    state.scenario = result.scenario;
    for (const step of added) {
      const draft = candidates.get(step.draft.sourceEventId ?? "");
      if (draft) state.drafts.set(step.id, draft);
    }
    state.focusedStepId = added.at(-1)?.id ?? state.focusedStepId;
    state.focusedMemberId = state.focusedStepId;
    state.membershipPreview = null;
    state.membershipError = null;
    state.pickerOpen = false;
    this.localInjectionEntryError = null;
    this.publish();
  }

  private addAuthoredScenarioStep(): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const reference = state.drafts.get(state.scenario.steps[0]!.id);
    if (!reference) return;
    const authored = cloneLocalInjectionDraftState(reference);
    authored.id = `local-injection-draft-${++this.localInjectionSequence}`;
    authored.anchor = Object.freeze({ ...authored.anchor, sourceKind: "authored", sourceEventId: null });
    authored.sourceDocument = null;
    authored.sourceRawText = null;
    authored.compareOpen = false;
    authored.editorPresentation = emptyScenarioEditorState(false);
    authored.restorationOrigin = reference.restorationOrigin;
    const addition = addScenarioStep(state.scenario, this.scenarioDraftInput(authored), { retainedRunBytes: state.retainedRunBytes });
    if (!addition.ok) {
      state.membershipError = addition.reason;
      this.publish();
      return;
    }
    state.scenario = addition.scenario;
    state.focusedStepId = addition.scenario.steps.at(-1)!.id;
    state.focusedMemberId = state.focusedStepId;
    state.drafts.set(state.focusedStepId, authored);
    state.membershipError = null;
    this.publish();
  }

  private moveCurrentScenarioStep(stepId: string, direction: "earlier" | "later"): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const result = moveScenarioStep(state.scenario, stepId, direction, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    state.scenario = result.scenario;
    state.focusedStepId = stepId;
    state.focusedMemberId = stepId;
    state.membershipError = null;
    this.publish();
  }

  private duplicateCurrentScenarioStep(stepId: string): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const index = state.scenario.steps.findIndex(({ id }) => id === stepId);
    const source = state.drafts.get(stepId);
    if (!source) return;
    const result = duplicateScenarioStep(state.scenario, stepId, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    const duplicateStep = result.scenario.steps[index + 1]!;
    const duplicate = cloneLocalInjectionDraftState(source);
    duplicate.id = duplicateStep.draft.id;
    state.scenario = result.scenario;
    state.drafts.set(duplicateStep.id, duplicate);
    state.focusedStepId = duplicateStep.id;
    state.focusedMemberId = duplicateStep.id;
    state.membershipError = null;
    this.publish();
  }

  private removeCurrentScenarioStep(stepId: string): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const index = state.scenario.steps.findIndex(({ id }) => id === stepId);
    const draft = state.drafts.get(stepId);
    if (!draft) return;
    const result = removeScenarioStep(state.scenario, stepId, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    state.scenario = result.scenario;
    state.drafts.delete(stepId);
    state.removedDrafts.set(stepId, draft);
    state.focusedStepId = result.scenario.steps[Math.min(index, result.scenario.steps.length - 1)]!.id;
    state.focusedMemberId = state.focusedStepId;
    state.membershipError = null;
    this.publish();
  }

  private undoCurrentScenarioStepRemoval(): void {
    const state = this.scenarioState;
    const removedStep = state?.scenario.removedSteps.at(-1)?.step;
    const removed = removedStep ? state?.removedDrafts.get(removedStep.id) : null;
    if (!state || state.phase !== "edit" || !removedStep || !removed) return;
    const result = undoScenarioStepRemoval(state.scenario, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    state.scenario = result.scenario;
    state.drafts.set(removedStep.id, removed);
    state.removedDrafts.delete(removedStep.id);
    state.focusedStepId = removedStep.id;
    state.focusedMemberId = removedStep.id;
    state.membershipError = null;
    this.publish();
  }

  private setScenarioStepDelay(stepId: string, delayMs: number): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const draft = state.drafts.get(stepId);
    if (!draft) return;
    const nextDelay = Math.max(0, Math.floor(delayMs));
    const result = updateScenarioStepDraft(state.scenario, stepId, { ...this.scenarioDraftInput(draft), relativeDelayMs: nextDelay }, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    draft.relativeDelayMs = nextDelay;
    state.scenario = result.scenario;
    state.membershipError = null;
    this.publish();
  }

  private setScenarioSpeed(speed: ScenarioSpeed): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const result = updateScenarioSpeed(state.scenario, speed, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) {
      state.membershipError = result.reason;
      this.publish();
      return;
    }
    state.scenario = result.scenario;
    state.membershipError = null;
    this.publish();
  }

  private reviewCurrentScenario(): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const validated = this.scenarioWithOrderedValidation(state);
    if (!validated.ok) {
      state.membershipError = validated.reason;
      this.publish();
      return;
    }
    const scenario = validated.scenario;
    const reviewed = reviewScenario(scenario, {
      runId: `local-injection-run-${++this.localInjectionSequence}`,
      committedEvidenceSeed: this.committedEvidenceBoundary,
      targetFingerprint: this.scenarioTargetFingerprint(state.drafts.get(state.scenario.steps[0]!.id)!),
      listenerIds: this.scenarioCurrentListenerIds(state.drafts.get(state.scenario.steps[0]!.id)!),
      historyAccepting: this.historyStatus.phase === "RUNNING" && this.scenarioFollowerPhase === "LIVE" && this.projectionRecovery === null,
      clearInProgress: this.clearState !== "idle",
      activeCommandKeysByItem: state.scenario.steps.map(({ id }) => state.drafts.get(id)!).map((draft) => ({
        item: { name: draft.anchor.itemName, position: draft.anchor.itemPosition },
        keys: this.activeCommandKeys(draft.anchor)
      })),
      retainedRunBytes: state.retainedRunBytes
    });
    if (!reviewed.ok) {
      state.membershipError = `${reviewed.stepId ? `${reviewed.stepId}: ` : ""}${reviewed.reason}`;
      this.publish();
      return;
    }
    const reviews = new Map(state.scenario.steps.map((step, index) => {
      const draft = state.drafts.get(step.id)!;
      const executionDraft = applyLocalInjectionDocumentToDraft(
        draft.baseDraft,
        reviewed.run.steps[index]!.document,
        draft.explicitConcreteFields
      );
      return [step.id, this.localInjectionExecutionCoordinator.review({
        fingerprint: this.localInjectionFingerprint(draft),
        executionTarget: draft.anchor.executionTarget,
        document: reviewed.run.steps[index]!.document,
        draft: cloneReinjectionDraft(executionDraft),
        correlation: {
          scenarioId: reviewed.run.scenarioId,
          runId: reviewed.run.id,
          stepId: reviewed.run.steps[index]!.id,
          ordinal: index + 1,
          targetId: draft.anchor.subscriptionId
        }
      })] as const;
    }));
    const refused = [...reviews.values()].find((review) => review.kind === "refused");
    if (refused?.kind === "refused") {
      state.membershipError = refused.reason;
      this.publish();
      return;
    }
    state.scenario = scenario;
    state.serverInterleaves = [];
    state.run = reviewed.run;
    state.reviews = reviews;
    state.phase = "review";
    state.membershipError = null;
    state.runner = this.createScenarioRunner(state, reviewed.run);
    state.runnerSnapshot = state.runner.snapshot();
    this.publish();
  }

  private createScenarioRunner(state: ScenarioState, run: ScenarioRun): ScenarioRunner {
    return createLocalInjectionScenarioRunner(run, {
      clock: this.scenarioClock,
      allocateInjectionId: () => `local-injection-${++this.localInjectionSequence}`,
      beforeDispatch: ({ member }) => {
        const draft = member.kind === "step"
          ? state.drafts.get(member.id)
          : state.drafts.get(state.scenario.steps[0]!.id);
        if (!draft) return { allow: false as const, reason: "TARGET_RETIRED" as const, detail: "Scenario Step target is unavailable." };
        const targetProblem = this.validateLocalInjectionTarget(draft.anchor)[0];
        if (targetProblem) return { allow: false as const, reason: "TARGET_RETIRED" as const, detail: targetProblem.message };
        // A Checkpoint is a zero-Injection committed read boundary. It may
        // intentionally observe the Server Evidence that created drift; retain
        // that drift so the next Injection Step still requires re-review.
        if (member.kind === "checkpoint") return { allow: true as const };
        const authorization = state.run?.authorizations.at(-1);
        const currentListeners = this.scenarioCurrentListenerIds(draft);
        const authorizedListeners = authorization?.listenerIds ?? [];
        const addedListenerIds = currentListeners.filter((id) => !authorizedListeners.includes(id));
        const removedListenerIds = authorizedListeners.filter((id) => !currentListeners.includes(id));
        const serverEvidence = this.scenarioPendingServerInterleave(state, authorization?.committedEvidenceBoundary ?? null);
        if (addedListenerIds.length > 0 || removedListenerIds.length > 0 || serverEvidence) {
          return {
            allow: false as const,
            reason: "DRIFT" as const,
            detail: serverEvidence
              ? `Committed Server Item Update ${serverEvidence.eventId} interleaved on the exact Scenario target.`
              : `Item Update listener set changed: added ${addedListenerIds.join(", ") || "none"}; removed ${removedListenerIds.join(", ") || "none"}.`,
            drift: {
              kind: serverEvidence && (addedListenerIds.length > 0 || removedListenerIds.length > 0) ? "MIXED" as const : serverEvidence ? "SERVER_ITEM_UPDATE" as const : "LISTENER_SET" as const,
              addedListenerIds,
              removedListenerIds,
              evidence: serverEvidence ?? null
            }
          };
        }
        const review = state.reviews.get(member.id);
        if (!review || review.kind !== "reviewed") {
          return { allow: false as const, reason: "DRIFT" as const, detail: "Scenario Review is unavailable; return to Edit and Review again." };
        }
        const current = this.localInjectionExecutionCoordinator.revalidateReview(review);
        return current.kind === "current"
          ? { allow: true as const }
          : {
              allow: false as const,
              reason: "DRIFT" as const,
              detail: current.kind === "stale-target"
                ? `${current.reason} Return to Edit and Review again.`
                : "Scenario Review was invalidated; return to Edit and Review again."
            };
      },
      afterSettlement: async ({ run: settledRun }) => {
        const nextMember = settledRun.members[settledRun.nextMemberIndex];
        if (nextMember?.kind === "checkpoint") return { continue: true as const };
        const authorization = settledRun.authorizations.at(-1);
        const serverEvidence = this.scenarioPendingServerInterleave(state, authorization?.committedEvidenceBoundary ?? null);
        return serverEvidence
          ? { continue: false as const, reason: "DRIFT" as const, detail: `Committed Server Item Update ${serverEvidence.eventId} interleaved on the exact Scenario target.`, drift: { kind: "SERVER_ITEM_UPDATE" as const, addedListenerIds: [], removedListenerIds: [], evidence: serverEvidence } }
          : { continue: true as const };
      },
      execute: async (input) => {
        const review = state.reviews.get(input.stepId);
        if (!review || review.kind !== "reviewed") {
          return { kind: "not-run" as const, reason: "REVIEW INVALIDATED" as const, timestamp: this.scenarioClock.now(), detail: "Scenario Review is unavailable before dispatch." };
        }
        const correlatedReview = Object.freeze({
          ...review,
          correlation: Object.freeze({ ...review.correlation, injectionId: input.injectionId })
        });
        state.reviews.set(input.stepId, correlatedReview);
        const executionId = `local-injection-execution-${++this.localInjectionSequence}`;
        const execution = await this.localInjectionExecutionCoordinator.execute(correlatedReview, { executionId });
        return settleScenarioCoordinatorExecution(execution, Date.now());
      },
      checkpoint: {
        feed: this.scenarioBoundaryFeed(),
        observations: (currentRun) => this.scenarioAssertionObservations(currentRun)
      },
      onChange: (runnerSnapshot) => {
        if (this.disposed || this.scenarioState !== state) return;
        state.runnerSnapshot = runnerSnapshot;
        state.run = runnerSnapshot.run;
        state.phase = runnerSnapshot.phase === "complete"
          ? "complete"
          : runnerSnapshot.phase === "stopped"
            ? "stopped"
            : runnerSnapshot.phase === "paused"
              ? state.run.trace.length === 0 && state.run.controls.length === 0 ? "review" : "paused"
              : "running";
        if (!this.scenarioVisibilityTransition) this.publish();
      }
    });
  }

  private scenarioAssertionObservations(run: ScenarioRun): ScenarioAssertionObservation {
    const priorOutcomes = new Map<string, WorkbenchLocalInjectionOutcome>();
    const correlatedLocalEvidence = new Map<string, EvidenceRef>();
    const evidenceByEventId = new Map<string, EvidenceRef>();
    for (const entry of run.trace) {
      if (entry.kind !== "attempted") continue;
      priorOutcomes.set(entry.stepId, entry.outcome);
      if (entry.evidence) evidenceByEventId.set(entry.evidence.eventId, entry.evidence);
      if (entry.evidence && entry.evidenceAvailability === "RETAINED" && this.retainedLocalEvidenceIds.has(entry.evidence.eventId)) {
        correlatedLocalEvidence.set(entry.stepId, entry.evidence);
      }
    }
    if (this.committedEvidenceBoundary) evidenceByEventId.set(this.committedEvidenceBoundary.eventId, this.committedEvidenceBoundary);
    return Object.freeze({
      priorOutcomes,
      correlatedLocalEvidence,
      inspectCommand: ({ item, key, field }) => {
        const inspected = this.commandStateProjections.inspect("local-effective", {
          subscriptionId: run.target.subscriptionId,
          item,
          key,
          ...(field === undefined ? {} : { field })
        });
        const provenance = inspected.provenance;
        const evidence = provenance ? evidenceByEventId.get(provenance.eventId) ?? null : this.committedEvidenceBoundary;
        const correlated = provenance?.source === "synthetic" && provenance.eventId !== undefined && this.retainedLocalEvidenceIds.has(provenance.eventId);
        return Object.freeze({
          state: inspected.state,
          ...(Object.prototype.hasOwnProperty.call(inspected, "value") ? { value: inspected.value } : {}),
          certainty: inspected.state === "ambiguous-server-null"
            ? "ambiguous" as const
            : inspected.state === "redacted" || inspected.state === "unavailable" || inspected.state === "unresolved-wire"
              ? "unavailable" as const : "certain" as const,
          provenance: correlated ? "correlated-local" as const : provenance?.source === "server" ? "server" as const : "local-effective" as const,
          evidence
        });
      }
    });
  }

  private reReviewCurrentScenario(): void {
    const state = this.scenarioState;
    if (!state?.run || !state.runner || state.runnerSnapshot?.pauseReason !== "DRIFT_REVIEW_REQUIRED") return;
    if (this.historyStatus.phase !== "RUNNING" || this.clearState !== "idle") {
      state.runner.stop("Drift re-review failed because Event History is not RUNNING and accepting.");
      return;
    }
    const firstDraft = state.drafts.get(state.scenario.steps[0]!.id);
    if (!firstDraft) {
      state.runner.stop("Drift re-review failed because the exact Scenario target is unavailable.");
      return;
    }
    const targetProblem = this.validateLocalInjectionTarget(firstDraft.anchor)[0];
    if (targetProblem) {
      state.runner.stop(`Drift re-review failed: ${targetProblem.message}`);
      return;
    }
    const reviews = new Map(state.run.steps.slice(state.run.nextOrdinal - 1).map((step) => {
      const draft = state.drafts.get(step.id)!;
      const executionDraft = applyLocalInjectionDocumentToDraft(draft.baseDraft, step.document, draft.explicitConcreteFields);
      return [step.id, this.localInjectionExecutionCoordinator.review({
        fingerprint: this.localInjectionFingerprint(draft),
        executionTarget: draft.anchor.executionTarget,
        document: step.document,
        draft: cloneReinjectionDraft(executionDraft),
        correlation: { scenarioId: state.run!.scenarioId, runId: state.run!.id, stepId: step.id, ordinal: step.ordinal, targetId: draft.anchor.subscriptionId }
      })] as const;
    }));
    const refusal = [...reviews.values()].find((review) => review.kind === "refused");
    if (refusal?.kind === "refused") {
      state.runner.stop(`Drift re-review failed: ${refusal.reason}`);
      return;
    }
    for (const [stepId, review] of reviews) state.reviews.set(stepId, review);
    const accepted = state.runner.reReview({
      targetFingerprint: this.scenarioTargetFingerprint(firstDraft),
      listenerIds: this.scenarioCurrentListenerIds(firstDraft),
      committedEvidenceBoundary: this.committedEvidenceBoundary
    });
    if (!accepted.ok) state.runner.stop(`Drift re-review failed: ${accepted.reason}`);
    else state.serverInterleaves = [];
  }

  private scenarioPendingServerInterleave(state: ScenarioState, boundary: EvidenceRef | null): EvidenceRef | null {
    return state.serverInterleaves.find((reference) => boundary === null ||
      (reference.intervalId === boundary.intervalId && reference.sequence > boundary.sequence)) ?? null;
  }

  private archiveCurrentScenarioRun(state: ScenarioState): void {
    state.runner?.stop("Scenario returned to Edit before this Step was attempted.");
    const run = state.run ? terminalizeScenarioRun(state.run, this.scenarioClock.now()) : null;
    if (!run) return;
    state.priorRuns.push(run);
    state.retainedRunBytes += run.accountedBytes - state.scenario.accountedBytes;
  }

  private stepNextScenario(): void {
    const state = this.scenarioState;
    if (!state || (state.phase !== "review" && state.phase !== "paused")) return;
    state.runner?.stepNext();
  }

  private runScenarioAgain(): void {
    const state = this.scenarioState;
    if (!state || (state.phase !== "complete" && state.phase !== "stopped")) return;
    this.archiveCurrentScenarioRun(state);
    state.runner?.dispose();
    state.runner = null;
    state.runnerSnapshot = null;
    state.run = null;
    state.reviews.clear();
    state.phase = "edit";
    this.reviewCurrentScenario();
  }

  private finishScenario(): void {
    const state = this.scenarioState;
    if (!state || state.phase === "running") return;
    const origin = state.scenario.restorationOrigin;
    this.scenarioState = null;
    this.localInjectionDraft = null;
    this.scopeId = origin.scopeId;
    this.selectionEventId = origin.selectionEventId;
    this.focusedEventId = origin.focusedEventId;
    this.contextId = origin.contextId;
    this.publish();
  }

  private setScenarioStepJson(stepId: string, text: string): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const current = state.drafts.get(stepId);
    if (!current) return;
    const draft = cloneLocalInjectionDraftState(current);
    draft.rawText = text;
    draft.preflightFingerprint = null;
    draft.reviewedExecution = null;
    draft.reviewRefusal = null;
    draft.outcome = null;
    this.refreshLocalInjectionValidation(draft);
    const result = updateScenarioStepDraft(state.scenario, stepId, this.scenarioDraftInput(draft), { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) {
      state.membershipError = result.reason;
      this.publish();
      return;
    }
    state.drafts.set(stepId, draft);
    state.scenario = result.scenario;
    state.membershipError = null;
    this.publish();
  }

  private setScenarioStepCompare(stepId: string, open: boolean): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const draft = state.drafts.get(stepId);
    if (!draft || (open && draft.sourceRawText === null)) return;
    const presentation = Object.freeze({ ...draft.editorPresentation, compareOpen: open });
    const result = updateScenarioStepPresentation(state.scenario, stepId, presentation, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    draft.compareOpen = open;
    draft.editorPresentation = presentation;
    state.scenario = result.scenario;
    state.membershipError = null;
    this.publish();
  }

  private setScenarioStepEditorPresentation(stepId: string, presentation: ScenarioEditorState): void {
    const state = this.scenarioState;
    if (!state || state.phase !== "edit") return;
    const index = state.scenario.steps.findIndex(({ id }) => id === stepId);
    const draft = state.drafts.get(stepId);
    if (!draft) return;
    const next = Object.freeze({ ...presentation, compareOpen: draft.compareOpen });
    if (sameScenarioEditorState(draft.editorPresentation, next)) return;
    const result = updateScenarioStepPresentation(state.scenario, stepId, next, { retainedRunBytes: state.retainedRunBytes });
    if (!result.ok) { state.membershipError = result.reason; this.publish(); return; }
    draft.editorPresentation = next;
    state.scenario = result.scenario;
    state.membershipError = null;
    this.publish();
  }

  private scenarioMembershipAvailability(event: LightstreamerEventEnvelope): Readonly<{ eventId: string; available: boolean; reason: string | null }> {
    const state = this.scenarioState;
    if (!state) return Object.freeze({ eventId: event.id, available: false, reason: "No Scenario is being edited." });
    if (!isCompatibleLocalInjectionSource(event)) {
      return Object.freeze({ eventId: event.id, available: false, reason: "Not a captured Item Update with a live Local Injection delivery target." });
    }
    let draft = createDraftFromEvent(event);
    if (!draft) return Object.freeze({ eventId: event.id, available: false, reason: "Captured Item Update fields are unavailable for a Draft." });
    const fieldSchema = localInjectionFieldSchema(event.subscription?.fields, event.update?.fields);
    draft = { ...draft, sourceSubscription: { ...draft.sourceSubscription!, fields: [...fieldSchema] } };
    const anchor = anchorFromDraft(draft, "captured-event", event.topology?.pageEpoch ?? this.currentPageEpoch, fieldSchema);
    const reference = state.drafts.get(state.scenario.steps[0]!.id)!;
    const candidateTarget = this.scenarioDraftInput({ ...reference, anchor, baseDraft: draft }).target;
    const reason = scenarioTargetIncompatibility(state.scenario.target, candidateTarget)
      ?? this.validateLocalInjectionTarget(anchor)[0]?.message
      ?? null;
    return Object.freeze({ eventId: event.id, available: reason === null, reason });
  }

  private scenarioDraftInput(draft: LocalInjectionDraftState, ready = localInjectionReady(draft)): ScenarioDraftInput {
    return Object.freeze({
      id: draft.id,
      sourceEventId: draft.anchor.sourceEventId,
      sourceRawText: draft.sourceRawText,
      rawText: draft.rawText,
      document: draft.document ? freezeLocalInjectionDocument(draft.document) : null,
      ready,
      diagnostics: Object.freeze([...draft.documentDiagnostics, ...draft.targetDiagnostics]),
      target: Object.freeze({
        pageEpoch: draft.anchor.pageEpoch,
        clientId: draft.anchor.clientId,
        sessionId: draft.anchor.sessionId,
        subscriptionId: draft.anchor.subscriptionId,
        deliveryPath: draft.anchor.executionTarget === "captured-listener" ? "listener" as const : "wire" as const,
        listenerId: draft.anchor.listenerId,
        mode: draft.anchor.subscriptionMode,
        schemaFields: draft.anchor.fieldSchema
      }),
      item: Object.freeze({ name: draft.anchor.itemName, position: draft.anchor.itemPosition }),
      editor: draft.editorPresentation,
      restorationOrigin: draft.restorationOrigin,
      relativeDelayMs: draft.relativeDelayMs
    });
  }

  private scenarioWithOrderedValidation(state: ScenarioState): ReturnType<typeof admitScenarioValidation> {
    const steps = state.scenario.steps.map((step) => {
      const draft = state.drafts.get(step.id)!;
      this.refreshLocalInjectionValidation(draft);
      return Object.freeze({ kind: "step" as const, id: step.id, draft: this.scenarioDraftInput(draft) });
    });
    return admitScenarioValidation(state.scenario, Object.freeze(steps), { retainedRunBytes: state.retainedRunBytes });
  }

  private activeCommandKeys(anchor: WorkbenchLocalInjectionAnchor): readonly string[] {
    const subscription = this.commandStateProjections.snapshot("local-effective").subscriptions
      .find(({ subscriptionId }) => subscriptionId === anchor.subscriptionId);
    const item = subscription?.items.find((candidate) =>
      (anchor.itemName !== null && candidate.itemName === anchor.itemName) ||
      (anchor.itemPosition !== null && candidate.itemPosition === anchor.itemPosition));
    return Object.freeze(item?.activeRows.map(({ key }) => key) ?? []);
  }

  private scenarioTargetFingerprint(draft: LocalInjectionDraftState): string {
    return hashLocalInjectionValue({ anchor: draft.anchor, deliveryIdentity: this.localInjectionDeliveryIdentity(draft.anchor) });
  }

  private scenarioCurrentListenerIds(draft: LocalInjectionDraftState): readonly string[] {
    const identity = this.localInjectionDeliveryIdentity(draft.anchor) as { deliveryListenerIds?: readonly string[] };
    return Object.freeze([...(identity.deliveryListenerIds ?? [])].sort());
  }

  private refreshEvidence(
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility",
    offset = 0
  ): void {
    if (source === "passive" && this.evidenceQueryPending) {
      this.passiveRefreshPending = true;
      return;
    }
    this.reconcileScopeIdentity();
    const effectiveOffset = this.mode === "frozen" && source !== "passive" && source !== "visibility"
      ? (source === "navigation" ? offset : this.displayedEvidence().offset)
      : offset;
    if (source !== "navigation") {
      this.evidencePageCursors.clear();
    }
    const generation = ++this.queryGeneration;
    this.evidenceQueryAbortController?.abort();
    const queryController = new AbortController();
    this.evidenceQueryAbortController = queryController;
    const request = Object.freeze({ ...this.investigationRequest(effectiveOffset, source), signal: queryController.signal });
    this.evidenceQueryPending = true;
    this.evidenceLoading = true;
    this.investigationState = "loading";
    this.investigationProblem = null;
    this.lastEvidenceQueryError = null;
    if (source === "scope" || source === "filter" || source === "reveal-selection" || source === "navigation") {
      this.lastCoherentEvidence = this.liveEvidence;
      this.lastCoherentInvestigation = this.liveInvestigation;
      this.lastCoherentInvestigationContract = this.liveInvestigationContract;
      this.liveEvidence = emptyEvidence;
      this.liveInvestigation = null;
      this.liveInvestigationContract = null;
      this.clearFindResults();
    }
    if (source !== "initial" && source !== "passive" && source !== "visibility") {
      this.publish();
    }

    void Promise.resolve(this.queryInvestigation(request, effectiveOffset)).then(
      (result) => {
        if (this.disposed || generation !== this.queryGeneration) return;
        if (this.evidenceQueryAbortController === queryController) this.evidenceQueryAbortController = null;
        this.evidenceQueryPending = false;
        this.evidenceLoading = false;
        if (!result.ok) {
          this.investigationState = "error";
          this.investigationProblem = result.problem;
          this.lastEvidenceQueryError = result.problem.code;
          if (source === "initial") this.initialEvidenceSettled = true;
          if (!this.liveInvestigation && this.lastCoherentInvestigation) {
            this.liveEvidence = this.lastCoherentEvidence;
            this.liveInvestigation = this.lastCoherentInvestigation;
            this.liveInvestigationContract = this.lastCoherentInvestigationContract;
            this.applyFindResult(this.lastCoherentInvestigation.find);
          }
          if (!this.liveInvestigation) this.liveEvidence = emptyEvidence;
          if (this.visible) this.publish();
          else this.hiddenDirty = true;
          this.drainPassiveRefresh();
          return;
        }

        this.investigationState = "ready";
        this.investigationProblem = null;
        this.lastEvidenceQueryError = null;
        this.historyStatus = this.history.status();
        const committedContract = Object.freeze({
          scope: request.scope,
          filter: request.filter
        });
        this.liveInvestigationContract = committedContract;
        if (this.mode === "frozen" && source !== "passive" && source !== "visibility") {
          this.frozenInvestigationContract = committedContract;
        }
        const selectionNeedsLookup = this.selectionEventId !== null &&
          this.selectedPayloadLoadedForEventId !== this.selectionEventId &&
          request.lookup?.eventId !== this.selectionEventId;
        if (result.value.page.nextCursor !== null) {
          this.evidencePageCursors.set(
            effectiveOffset + result.value.page.evidence.length,
            result.value.page.nextCursor
          );
        } else {
          this.evidencePageCursors.delete(effectiveOffset + result.value.page.evidence.length);
        }
        this.applyInvestigationSnapshot(result.value, source, effectiveOffset);
        if (selectionNeedsLookup) {
          // Selection may arrive while the initial/passive request is in
          // flight. Reissue the same coherent investigation with the selected
          // identity attached instead of hydrating payload through a second
          // legacy read path.
          this.initialEvidenceSettled = true;
          this.refreshEvidence("command");
          return;
        }
        this.resumePendingLocalInjection();
        this.lastCoherentEvidence = this.liveEvidence;
        this.lastCoherentInvestigation = this.liveInvestigation;
        this.lastCoherentInvestigationContract = this.liveInvestigationContract;
        const displayed = this.displayedEvidence();
        if (displayed === this.liveEvidence || displayed === this.frozenEvidence) {
          this.renderedEvidenceBoundary = evidenceRefFromIdentity(result.value.readPoint.committedEvidenceBoundary);
        }
        if (source === "initial") {
          this.initialEvidenceSettled = true;
          this.refreshRuntimeDiagnosticObservations();
          this.snapshot = this.createSnapshot();
          if (this.passiveRefreshPending) {
            this.passiveRefreshPending = false;
            this.schedulePassivePublication();
          }
          return;
        }
        if (!this.visible) {
          this.hiddenDirty = true;
          this.drainPassiveRefresh();
          return;
        }
        this.publish();
        this.drainPassiveRefresh();
      },
      (error: unknown) => {
        if (this.disposed || generation !== this.queryGeneration) return;
        if (this.evidenceQueryAbortController === queryController) this.evidenceQueryAbortController = null;
        this.evidenceQueryPending = false;
        this.evidenceLoading = false;
        const problem: EvidenceFilterReadProblem = {
          code: "QUERY_FAILED",
          message: errorMessage(error)
        };
        this.investigationState = "error";
        this.investigationProblem = problem;
        this.lastEvidenceQueryError = problem.code;
        if (source === "initial") this.initialEvidenceSettled = true;
        if (!this.liveInvestigation && this.lastCoherentInvestigation) {
          this.liveEvidence = this.lastCoherentEvidence;
          this.liveInvestigation = this.lastCoherentInvestigation;
          this.liveInvestigationContract = this.lastCoherentInvestigationContract;
          this.applyFindResult(this.lastCoherentInvestigation.find);
        }
        if (!this.liveInvestigation) this.liveEvidence = emptyEvidence;
        if (this.visible) this.publish();
        else this.hiddenDirty = true;
        this.drainPassiveRefresh();
      }
    );
  }

  private investigationRequest(
    offset: number,
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility"
  ): EvidenceInvestigationQueryRequest {
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const frozenReadPoint = this.mode === "frozen" && source !== "passive" && source !== "visibility"
      ? this.restorationReadPoint ?? this.frozenInvestigation?.readPoint
      : null;
    const pageSize = Math.min(100, this.windowSize);
    const currentFind = this.findIdentity(this.findCurrentEventId);
    const selectedLookup = this.selectedEvidenceIdentity ?? this.identityForEventId(this.selectionEventId);
    const discoveryByFacet = new Map<string, FacetDiscoveryRequest>();
    for (const discovery of this.investigationDiscoveries) discoveryByFacet.set(discovery.facet, discovery);
    if (this.filterDiscovery) discoveryByFacet.set(this.filterDiscovery.facet, this.filterDiscovery);
    return Object.freeze({
      // Find is a retained-history operation even while the visible page is
      // Frozen. Read its canonical match window at the current boundary, then
      // keep the Frozen page/read point when publishing that window.
      at: this.mode === "frozen" && this.find.trim() !== ""
        ? "LATEST_COMMITTED"
        : frozenReadPoint ?? "LATEST_COMMITTED",
      scope: structuralEvidenceScope(target),
      filter: this.canonicalFilter,
      page: Object.freeze({
        order: "NEWEST_FIRST",
        size: pageSize,
        ...(offset > 0 && this.evidencePageCursors.has(offset)
          ? { cursor: this.evidencePageCursors.get(offset) }
          : {})
      }),
      discover: Object.freeze([...discoveryByFacet.values()]),
      ...(selectedLookup === null ? {} : { lookup: selectedLookup }),
      ...(this.find.trim() === "" ? {} : { find: { text: this.find, scopeToFilter: true, ...(currentFind ? { current: currentFind } : {}) } })
    });
  }

  private queryInvestigation(
    request: EvidenceInvestigationQueryRequest,
    targetOffset: number
  ): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {
    if (targetOffset === 0 || request.page.cursor !== undefined) {
      return this.evidenceQuery.query(request);
    }
    return this.queryPagedInvestigation(request, targetOffset);
  }

  private async queryPagedInvestigation(
    request: EvidenceInvestigationQueryRequest,
    targetOffset: number
  ): Promise<Readonly<{ ok: true; value: EvidenceSnapshot }> | Readonly<{ ok: false; problem: EvidenceFilterReadProblem }>> {

    const pageSize = request.page.size;
    // IndexedDB cursors are bound to the complete page request, including
    // size. Traversal uses one stable storage page size and slices only the
    // requested renderer window after the bounded fetches complete.
    const storagePageSize = MAX_EVIDENCE_PAGE_SIZE;
    let startOffset = 0;
    let cursor: string | undefined;
    let at = request.at;
    let currentOffset = startOffset;
    let first: EvidenceSnapshot | null = null;
    let last: EvidenceSnapshot | null = null;
    const selected: DeterministicEvidenceRecord[] = [];
    while (true) {
      const result = await this.evidenceQuery.query({
        ...request,
        at,
        page: Object.freeze({
          ...request.page,
          size: storagePageSize,
          ...(cursor === undefined ? {} : { cursor })
        })
      });
      if (!result.ok) return result;
      first ??= result.value;
      last = result.value;
      if (first && !sameEvidenceReadPoint(result.value.readPoint, first.readPoint)) {
        return {
          ok: false,
          problem: {
            code: "QUERY_FAILED",
            message: "The paged Evidence read crossed a committed boundary."
          }
        };
      }
      const resultStart = currentOffset;
      const resultEnd = resultStart + result.value.page.evidence.length;
      const selectionStart = Math.max(targetOffset, resultStart);
      const selectionEnd = Math.min(targetOffset + pageSize, resultEnd);
      if (selectionStart < selectionEnd) {
        selected.push(...result.value.page.evidence.slice(selectionStart - resultStart, selectionEnd - resultStart));
      }
      if (result.value.page.nextCursor !== null) {
        this.evidencePageCursors.set(resultEnd, result.value.page.nextCursor);
      }
      if (resultEnd >= targetOffset + pageSize || result.value.page.nextCursor === null) break;
      currentOffset += result.value.page.evidence.length;
      cursor = result.value.page.nextCursor;
      at = first.readPoint;
      if (result.value.page.evidence.length === 0) break;
    }
    const page = selected.slice(0, pageSize);
    const absoluteEnd = targetOffset + page.length;
    const lastPageEnd = currentOffset + (last?.page.evidence.length ?? 0);
    const nextCursor = absoluteEnd === lastPageEnd ? last?.page.nextCursor ?? null : null;
    return {
      ok: true,
      value: Object.freeze({
        ...first!,
        page: Object.freeze({ evidence: Object.freeze(page), nextCursor })
      })
    };
  }

  private applyInvestigationSnapshot(
    value: EvidenceSnapshot,
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility",
    offset: number
  ): void {
    const frozenFindBase = this.mode === "frozen" && this.find.trim() !== ""
      ? this.frozenInvestigation
      : null;
    const projectedValue = frozenFindBase
      ? Object.freeze({ ...value, readPoint: frozenFindBase.readPoint, totals: frozenFindBase.totals })
      : value;
    // Find is part of the same bounded canonical query. When it supplies its
    // bounded target window, publish that window as the visible page so
    // next/previous navigation can reveal a retained match without a
    // renderer-owned scan or a second full-history read.
    const findWindow = value.find?.window;
    const findTargetId = value.find?.current?.eventId ?? value.find?.first?.eventId ?? null;
    const targetIsOnCanonicalPage = findTargetId === null || value.page.evidence.some((record) => record.identity.eventId === findTargetId);
    const boundedFindWindow = !targetIsOnCanonicalPage && findWindow && findWindow.length > 0
      ? findWindow.slice(0, this.windowSize)
      : null;
    const displayedPage = boundedFindWindow && boundedFindWindow.length > 0
      ? Object.freeze({ ...projectedValue.page, evidence: Object.freeze([...boundedFindWindow].reverse()) })
      : projectedValue.page;
    const displayedValue = displayedPage === projectedValue.page
      ? projectedValue
      : Object.freeze({ ...projectedValue, page: displayedPage });
    const records = Object.freeze([...displayedPage.evidence].reverse());
    const events = Object.freeze(records.flatMap((record) => [this.eventForRecord(record)]));
    const nextEvidence = freezeEvidence(events, displayedValue.totals.inScope, offset, records);
    const liveRecords = Object.freeze([...value.page.evidence].reverse());
    const liveEvents = Object.freeze(liveRecords.flatMap((record) => [this.eventForRecord(record)]));
    this.liveEvidence = frozenFindBase
      ? freezeEvidence(liveEvents, value.totals.inScope, offset, liveRecords)
      : nextEvidence;
    this.liveInvestigation = frozenFindBase ? value : displayedValue;
    this.applyFindResult(value.find);

    const selectedRecord = this.liveEvidence.records.find(
      (record) => record.identity.eventId === this.selectionEventId
    );
    if (selectedRecord) {
      this.selectedEvidenceIdentity = selectedRecord.identity;
      this.selectedEventEnvelope = this.eventForRecord(selectedRecord);
      this.selectionHiddenByFilter = false;
    }

    if (displayedValue.lookup?.state === "RETAINED") {
      this.selectedEvidenceIdentity = displayedValue.lookup.evidence.identity;
      const candidate = candidateFromDeterministicRecord(displayedValue.lookup.evidence);
      if (isLightstreamerEvidenceCandidate(candidate)) {
        this.selectedEventEnvelope = candidate;
        if (candidate.id === this.selectionEventId) this.selectedPayloadLoadedForEventId = candidate.id;
      }
    }

    if (this.mode === "frozen" && source !== "passive" && source !== "visibility") {
      this.frozenEvidence = nextEvidence;
      this.frozenInvestigation = displayedValue;
    }
    if (this.clearedSelectionEventId !== this.selectionEventId && displayedValue.lookup) {
      this.reconcileSelectionFromLookup(displayedValue.lookup, nextEvidence, source);
    }
  }

  private applyFindResult(find: EvidenceFindResult | null): void {
    if (!find || find.text.trim() === "") {
      this.findCurrentEventId = null;
      return;
    }
    this.findCurrentEventId = find.current?.eventId ?? find.first?.eventId ?? null;
  }

  private reconcileSelectionFromLookup(
    lookup: EvidenceLookupResult,
    result: EvidenceData,
    source: "initial" | "scope" | "command" | "passive" | "filter" | "reveal-selection" | "navigation" | "visibility"
  ): void {
    if (!this.selectionEventId) {
      this.selectionHiddenByFilter = false;
      return;
    }
    if (lookup.state !== "RETAINED") {
      this.selectionHiddenByFilter = true;
      if (source === "filter" || source === "scope") this.filterRecoveryFocused = result.records.length === 0;
      return;
    }
    if (lookup.evidence.identity.eventId !== this.selectionEventId) return;
    this.selectionHiddenByFilter = !lookup.matchesFilter || !lookup.inScope;
    if (this.selectionHiddenByFilter && (source === "filter" || source === "scope")) {
      this.focusedEventId = nearestVisibleRecordId(result.records, lookup.evidence.identity);
      this.filterRecoveryFocused = result.records.length === 0;
    } else if (!this.selectionHiddenByFilter) {
      this.filterRecoveryFocused = false;
    }
    if (!this.selectionHiddenByFilter && this.focusedEventId === null) {
      this.focusedEventId = this.selectionEventId;
    }
  }

  private eventForRecord(record: DeterministicEvidenceRecord): LightstreamerEventEnvelope {
    const cached = this.evidenceEventCache.get(record.identity.eventId);
    if (cached) {
      this.cacheEvidenceEvent(cached);
      return cached;
    }
    const event = eventFromDeterministicRecord(record);
    this.cacheEvidenceEvent(event);
    return event;
  }

  private cacheEvidenceEvent(event: LightstreamerEventEnvelope): void {
    this.evidenceEventCache.delete(event.id);
    this.evidenceEventCache.set(event.id, event);
    while (this.evidenceEventCache.size > MAX_EVIDENCE_EVENT_CACHE) {
      const oldest = this.evidenceEventCache.keys().next().value;
      if (oldest === undefined) break;
      this.evidenceEventCache.delete(oldest);
    }
  }

  private identityForEventId(eventId: string | null): EvidenceIdentity | null {
    if (!eventId) return null;
    const investigation = this.liveInvestigation ?? this.frozenInvestigation;
    return investigation?.page.evidence.find((record) => record.identity.eventId === eventId)?.identity ??
      (investigation?.lookup?.state === "RETAINED" && investigation.lookup.evidence.identity.eventId === eventId
        ? investigation.lookup.evidence.identity
        : null);
  }

  private findIdentity(eventId: string | null): EvidenceIdentity | null {
    if (!eventId) return null;
    const investigations = [this.liveInvestigation, this.frozenInvestigation];
    for (const investigation of investigations) {
      const match = investigation?.find?.current?.eventId === eventId
        ? investigation.find.current
        : investigation?.find?.first?.eventId === eventId
          ? investigation.find.first
        : investigation?.find?.previous?.eventId === eventId
          ? investigation.find.previous
          : investigation?.find?.next?.eventId === eventId
            ? investigation.find.next
            : null;
      if (match) return match;
    }
    return this.identityForEventId(eventId);
  }

  private drainPassiveRefresh(): void {
    if (!this.passiveRefreshPending || this.disposed || !this.visible) return;
    this.passiveRefreshPending = false;
    // Keep the passive query behind the frame already requested by the
    // committed boundary. IndexedDB completions can otherwise resolve in a
    // same-turn microtask chain and repeatedly start another query before
    // the browser gets a chance to paint the committed snapshot.
    this.schedulePassivePublication();
  }

  private hydrateProjections(): void {
    // Evidence is hydrated by the single investigation query. Keeping this
    // hook makes the startup sequence explicit without issuing a second
    // legacy read that could produce a different boundary.
    this.historyStatus = this.history.status();
  }

  private reconcileScopeIdentity(): void {
    if (this.scopeId === "page") return;
    const state = this.topologyProjection.snapshot();
    if (this.currentScopeStructure(state).descriptorById.has(this.scopeId ?? "page")) return;
    this.scopeId = "page";
    this.scopeFocusedNodeId = "page";
    this.invalidatePreparedExport();
    this.invalidateEvidenceCopy();
  }

  private publish(allowHidden = false): void {
    if (this.disposed) {
      return;
    }
    this.refreshRuntimeDiagnosticObservations();
    if (!this.visible && !allowHidden) {
      this.hiddenDirty = true;
      return;
    }
    this.reconcileScopeIdentity();
    const localInjectionDraft = this.localInjectionDraft;
    if (localInjectionDraft?.phase === "edit") {
      this.refreshLocalInjectionValidation(localInjectionDraft);
    } else if (localInjectionDraft?.phase === "review") {
      this.refreshLocalInjectionValidation(localInjectionDraft);
      const reviewedFingerprint = localInjectionDraft.preflightFingerprint;
      if (
        !reviewedFingerprint ||
        !localInjectionReady(localInjectionDraft) ||
        this.localInjectionFingerprint(localInjectionDraft) !== reviewedFingerprint
      ) {
        localInjectionDraft.phase = "edit";
        localInjectionDraft.preflightFingerprint = null;
        localInjectionDraft.reviewedExecution = null;
        localInjectionDraft.reviewRefusal = null;
      }
    }
    this.version += 1;
    this.snapshot = this.createSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private createSnapshot(): WorkbenchSnapshot {
    const evidence = this.displayedEvidence();
    const baseEvidence = this.mode === "frozen"
      ? this.frozenEvidence ?? emptyEvidence
      : this.liveEvidence;
    const scope = this.scopeSnapshot();
    const visibleEnd = evidence.events.length > 0
      ? Math.max(0, evidence.total - evidence.offset)
      : 0;
    const visibleStart = evidence.events.length > 0
      ? Math.max(1, visibleEnd - evidence.events.length + 1)
      : 0;
    const baseVisibleEnd = baseEvidence.events.length > 0
      ? Math.max(0, baseEvidence.total - baseEvidence.offset)
      : 0;
    const newerCount = !this.evidenceLoading && this.mode === "frozen"
      ? Math.max(0, this.liveEvidence.total - baseVisibleEnd)
      : 0;
    const findResult = this.displayedInvestigation()?.find;
    const findMatches = findResult?.matches ?? [];
    const findIndex = findMatches.findIndex((identity) => identity.eventId === this.findCurrentEventId);
    const currentFindEventId = this.find.trim() === ""
      ? null
      : this.findCurrentEventId ?? findResult?.current?.eventId ?? null;
    const revealAvailability = this.revealSelectionAvailability();
    const activity = this.activitySnapshot(scope);
    return Object.freeze({
      version: this.version,
      renderedEvidenceBoundary: this.renderedEvidenceBoundary
        ? Object.freeze({ ...this.renderedEvidenceBoundary })
        : null,
      visible: this.visible,
      theme: this.theme,
      captureStatus: this.captureStatus,
      capture: this.captureSnapshot(),
      scopeId: this.scopeId,
      scope,
      selectionEventId: this.selectionEventId,
      selectedEvidence:
        this.selectedEventEnvelope?.id === this.selectionEventId
          ? this.presentEvidence(this.selectedEventEnvelope)
          : null,
      contextId: this.contextId,
      context: this.contextSnapshot(evidence.events, scope, activity.projection),
      commandProjections: this.commandProjectionSnapshot(),
      diagnostics: this.diagnosticSnapshot(scope, activity.projection),
      historyCondition: this.historyCondition,
      historyAnnouncement: this.historyAnnouncement,
      storage: Object.freeze({ ...this.storage }),
      retention: this.retentionSnapshot(),
      export: this.exportSnapshot(),
      evidenceCopy: this.evidenceCopy,
      activity,
      localInjection: this.localInjectionSnapshot(),
      scenario: this.scenarioState
        ? Object.freeze({
            phase: this.scenarioState.phase,
            scenario: this.scenarioState.scenario,
            run: this.scenarioState.run,
            membershipError: this.scenarioState.membershipError,
            pickerOpen: this.scenarioState.pickerOpen,
            membership: Object.freeze(this.displayedEvidence().events.map((event) => this.scenarioMembershipAvailability(event))),
            membershipPreview: this.scenarioState.membershipPreview
              ? Object.freeze({
                  scenarioRevision: this.scenarioState.membershipPreview.scenarioRevision,
                  members: Object.freeze(this.scenarioState.membershipPreview.members.map((member) => Object.freeze({
                    eventId: member.evidenceId,
                    intervalId: member.evidence.intervalId,
                    retainedSequence: member.retainedSequence,
                    available: member.available,
                    reason: member.reason
                  })))
                })
              : null,
            focusedMemberId: this.scenarioState.focusedMemberId,
            focusedStepId: this.scenarioState.focusedStepId,
            canUndoRemoval: this.scenarioState.scenario.removedSteps.length > 0,
            priorRuns: Object.freeze([...this.scenarioState.priorRuns]),
            retainedRunBytes: this.scenarioState.retainedRunBytes,
            runner: this.scenarioState.runnerSnapshot
          })
        : null,
      evidence: Object.freeze({
        events: Object.freeze(evidence.events.map((event) => this.presentEvidence(event))),
        loading: this.evidenceLoading,
        total: this.mode === "frozen" || this.evidenceLoading ? evidence.total : this.liveEvidence.total,
        windowSize: this.windowSize,
        mode: this.mode,
        newerCount,
        offset: this.mode === "frozen" ? evidence.offset : newerCount,
        scrollTop: this.evidenceScrollTop,
        visibleStart,
        visibleEnd,
        hasOlder: visibleStart > 1,
        hasNewer: newerCount > 0,
        find: this.find,
        findState: Object.freeze({
          query: this.find,
          matchCount: this.find.trim() === ""
            ? 0
            : findResult?.total ?? 0,
          currentIndex: findIndex,
          currentEventId: currentFindEventId
        }),
        filterMutation: this.filterMutation,
        restoration: Object.freeze({
          canBack: this.restorationIndex > this.restorationBarrier,
          canForward: this.restorationIndex >= 0 && this.restorationIndex < this.restorationCheckpoints.length - 1,
          barrier: this.restorationBarrier,
          current: this.restorationIndex
        }),
        filterRecoveryFocused: this.filterRecoveryFocused,
        focusedEventId: this.focusedEventId,
        selectedEventId: this.selectionEventId,
        hiddenSelection:
          this.selectionHiddenByFilter && this.selectionEventId
            ? Object.freeze({
                eventId: this.selectionEventId,
                message: "Selected event outside current results" as const,
                canReveal: revealAvailability.canReveal,
                ...(revealAvailability.reason === undefined ? {} : { revealUnavailableReason: revealAvailability.reason }),
                canClear: true as const
              })
            : null,
        investigation: this.investigationSnapshot()
      })
    });
  }

  private revealSelectionAvailability(): Readonly<{ canReveal: boolean; reason?: string }> {
    if (!this.selectionEventId) return { canReveal: false, reason: "Reveal is unavailable without a retained selection." };
    const investigation = this.displayedInvestigation() ?? this.liveInvestigation;
    const lookup = investigation?.lookup;
    if (!lookup || lookup.state !== "RETAINED" || lookup.evidence.identity.eventId !== this.selectionEventId) {
      return { canReveal: false, reason: "Reveal is unavailable because the selected Evidence is no longer retained." };
    }
    if (!lookup.inScope) return { canReveal: false, reason: "Reveal is unavailable because the selection is outside the current Scope." };
    if (this.scopeSnapshot().selection?.retired) {
      return { canReveal: false, reason: "Reveal is unavailable because the selected runtime identity is retired." };
    }
    if (lookup.blockingCriteria.length === 0) {
      return { canReveal: false, reason: "Reveal is unavailable because the current Filter reports no removable blocker." };
    }
    return { canReveal: true };
  }

  private presentEvidence(event: LightstreamerEventEnvelope): WorkbenchEvidence {
    const cached = this.evidencePresentationCache.get(event);
    if (cached) return cached;
    const presentation = toWorkbenchEvidence(event);
    this.evidencePresentationCache.set(event, presentation);
    return presentation;
  }

  private captureSnapshot(): WorkbenchCaptureSnapshot {
    const boundary = this.captureBoundary;
    const operation =
      this.captureStatus === "capturing"
        ? "RUNNING"
        : this.captureStatus === "bridge disconnected"
          ? "STOPPED"
          : "IDLE";
    return Object.freeze({
      operation: boundary?.operation ?? this.captureOverride.operation ?? operation,
      coverage: boundary?.coverage ?? this.captureOverride.coverage ?? this.topologyCoverage ?? "USEFUL",
      firstMissingEventId: boundary?.firstMissingEventId ?? null,
      committedEvidenceBoundary: boundary?.committedEvidenceBoundary ?? null,
      ...(boundary?.detail
        ? { detail: boundary.detail }
        : this.captureOverride.detail
          ? { detail: this.captureOverride.detail }
          : {}),
      ...(boundary?.recovery
        ? { recovery: boundary.recovery }
        : this.captureOverride.recovery
          ? { recovery: this.captureOverride.recovery }
          : {})
    });
  }

  private localInjectionSnapshot(): WorkbenchLocalInjectionSnapshot {
    const draft = this.localInjectionDraft;
    return Object.freeze({
      state: draft ? "active" as const : "idle" as const,
      availability: this.localInjectionAvailability(),
      entryError: this.localInjectionEntryError,
      blockedEntry: this.localInjectionBlockedEntry
        ? Object.freeze({
            kind: this.localInjectionBlockedEntry.kind,
            label: this.localInjectionBlockedEntry.kind === "selected-event"
              ? `Selected Evidence ${this.localInjectionBlockedEntry.eventId}`
              : `COMMAND Scope ${this.localInjectionBlockedEntry.scopeId}`
          })
        : null,
      discardConfirmation: this.localInjectionDiscardConfirmation,
      draft: draft
        ? Object.freeze({
            id: draft.id,
            phase: draft.phase,
            rawText: draft.rawText,
            document: draft.document ? freezeLocalInjectionDocument(draft.document) : null,
            diagnostics: Object.freeze([
              ...draft.documentDiagnostics,
              ...draft.targetDiagnostics
            ]),
            ready: localInjectionReady(draft),
            anchor: draft.anchor,
            source: Object.freeze({
              kind: draft.anchor.sourceKind,
              rawText: draft.sourceRawText
            }),
            compareStatus: draft.sourceDocument && draft.document
              ? localInjectionDocumentsEqual(draft.sourceDocument, draft.document)
                ? "unchanged" as const
                : "changed" as const
              : "no-source" as const,
            compareOpen: draft.compareOpen,
            editorPresentation: draft.editorPresentation,
            minimized: draft.minimized,
            parked: draft.parked,
            open: draft.open,
            restorationOrigin: draft.restorationOrigin,
            executionId: draft.executionId,
            preflightFingerprint: draft.preflightFingerprint,
            outcome: draft.outcome
          })
        : null
    });
  }

  private localInjectionAvailability(): WorkbenchLocalInjectionSnapshot["availability"] {
    const selectedEvent = this.selectionEventId
      ? this.selectedEventEnvelope?.id === this.selectionEventId
        ? this.selectedEventEnvelope
        : this.displayedEvidence().events.find(({ id }) => id === this.selectionEventId) ?? null
      : null;
    let selectedUpdate: { available: boolean; reason: string | null };
    if (!selectedEvent) {
      selectedUpdate = {
        available: false,
        reason: "Select one captured Item Update to create a Local Injection draft."
      };
    } else if (!isCompatibleLocalInjectionSource(selectedEvent)) {
      selectedUpdate = {
        available: false,
        reason: "Selected Evidence is not a compatible captured Item Update."
      };
    } else {
      const baseDraft = createDraftFromEvent(selectedEvent)!;
      const fieldSchema = localInjectionFieldSchema(
        selectedEvent.subscription?.fields,
        selectedEvent.update?.fields
      );
      const anchor = anchorFromDraft(
        baseDraft,
        "captured-event",
        selectedEvent.topology?.pageEpoch ?? this.currentPageEpoch,
        fieldSchema
      );
      const targetDiagnostic = this.validateLocalInjectionTarget(anchor)[0];
      selectedUpdate = targetDiagnostic
        ? { available: false, reason: targetDiagnostic.message }
        : { available: true, reason: null };
    }

    const scopeTarget = findTopologySelection(
      this.topologyProjection.snapshot(),
      this.scopeId ?? "page"
    );
    const authored = authoredDraftFromScope(scopeTarget, this.currentPageEpoch);
    let commandScope: { available: boolean; reason: string | null };
    if (!authored) {
      commandScope = {
        available: false,
        reason: "Select a live COMMAND Item Scope, Listener Scope, or a Subscription with exactly one current item and a captured listener context."
      };
    } else {
      const targetDiagnostic = this.validateLocalInjectionTarget(authored.anchor)[0];
      commandScope = targetDiagnostic
        ? { available: false, reason: targetDiagnostic.message }
        : { available: true, reason: null };
    }
    return Object.freeze({
      selectedUpdate: Object.freeze(selectedUpdate),
      commandScope: Object.freeze(commandScope)
    });
  }

  private scopeSnapshot(): WorkbenchSnapshot["scope"] {
    const state = this.topologyProjection.snapshot();
    const projectionStatus = this.topologyProjection.status();
    const structure = this.currentScopeStructure(state);
    const selectedDescriptor =
      structure.descriptorById.get(this.scopeId ?? "page") ?? structure.descriptors[0];
    const resolved = new Map<string, WorkbenchScopeNode>();
    const resolveNode = (scopeId: string): WorkbenchScopeNode | null => {
      const cached = resolved.get(scopeId);
      if (cached) return cached;
      const descriptor = structure.descriptorById.get(scopeId);
      if (!descriptor) return null;
      const node = resolveScopeNode(
        state,
        descriptor,
        this.scopeId,
        this.captureStatus
      );
      const stableNode = this.stableScopeNode(structure.revision, node);
      resolved.set(scopeId, stableNode);
      return stableNode;
    };
    const selected = selectedDescriptor ? resolveNode(selectedDescriptor.id) : null;
    const limited = projectionStatus.coverage?.status === "partial";
    let materializedNodes: readonly WorkbenchScopeNode[] | null = null;
    const snapshot: WorkbenchSnapshot["scope"] = {
      label: scopeBreadcrumb(structure.descriptorById, selectedDescriptor),
      status: [
        selected ? scopeLifecycleLabel(selected.lifecycle) : "Unknown",
        selected?.detail,
        selected?.retired ? "Historical · read-only" : null
      ]
        .filter(Boolean)
        .join(" · "),
      structureRevision: structure.revision,
      structure: structure.descriptors,
      resolveNode,
      get nodes() {
        materializedNodes ??= Object.freeze(
          structure.descriptors.map((descriptor) => resolveNode(descriptor.id)!)
        );
        return materializedNodes;
      },
      focusedNodeId: this.scopeFocusedNodeId,
      selection: selected
        ? Object.freeze({ id: selected.id, kind: selected.kind, retired: selected.retired })
        : null,
      coverage: Object.freeze({
        semantic: projectionStatus.semanticActive,
        status: limited ? "LIMITED" : "USEFUL",
        detail: projectionStatus.semanticActive
          ? limited
            ? "Partial semantic coverage; some runtime properties may be unavailable."
            : "Complete semantic coverage from the official Lightstreamer client API."
          : "Legacy capture coverage; unavailable runtime properties remain explicit."
      })
    };
    return Object.freeze(snapshot);
  }

  private currentScopeStructure(state: TopologyState): NonNullable<Runtime["scopeStructureCache"]> {
    const revision = this.topologyProjection.scopeStructureRevision();
    if (this.scopeStructureCache?.revision === revision) return this.scopeStructureCache;
    const descriptors = Object.freeze(createScopeNodeDescriptors(state));
    this.scopeStructureCache = {
      revision,
      descriptors,
      descriptorById: new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]))
    };
    return this.scopeStructureCache;
  }

  private stableScopeNode(
    revision: number,
    node: WorkbenchScopeNode
  ): WorkbenchScopeNode {
    if (this.scopeNodePresentationCache?.revision !== revision) {
      this.scopeNodePresentationCache = { revision, nodes: new Map() };
    }
    const cached = this.scopeNodePresentationCache.nodes.get(node.id);
    if (cached && sameScopeNodePresentation(cached, node)) return cached;
    this.scopeNodePresentationCache.nodes.set(node.id, node);
    return node;
  }

  private retentionSnapshot(): WorkbenchRetentionSnapshot {
    return Object.freeze({
      historyStatus: this.historyStatus,
      clearState: this.clearState,
      ...(this.clearError ? { clearError: this.clearError } : {})
    });
  }

  private activitySnapshot(scope: WorkbenchSnapshot["scope"]): WorkbenchActivitySnapshot {
    const target = findTopologySelection(this.topologyProjection.snapshot(), this.scopeId ?? "page");
    const activityScope = activityScopeFor(target);
    const entries = this.activityEvidence.filter((entry) => entry.intervalId === this.historyStatus.interval.id);
    const first = entries.reduce<ActivityEvidence | undefined>((current, entry) => !current || entry.sequence < current.sequence ? entry : current, undefined);
    const last = entries.reduce<ActivityEvidence | undefined>((current, entry) => !current || entry.sequence > current.sequence ? entry : current, undefined);
    const retained = first && last
      ? { first: { timestamp: first.event.timestamp, sequence: first.sequence }, last: { timestamp: last.event.timestamp, sequence: last.sequence } }
      : null;
    const boundary = this.historyStatus.committedEvidenceBoundary;
    const readPoint: ActivityReadPoint = {
      intervalId: this.historyStatus.interval.id,
      committedEvidenceBoundary: boundary ? { intervalId: boundary.intervalId, sequence: boundary.sequence, eventId: boundary.eventId } : null,
      retainedRange: retained,
      coverage: this.captureSnapshot().coverage,
      terminal: this.historyStatus.phase === "STOPPED" || Boolean(this.historyStatus.terminal)
    };
    const projectionInput: ActivityProjectionInput = {
      evidence: this.activityOpen || entries.length <= 1_000 ? entries : [],
      scope: activityScope,
      filter: this.canonicalFilter,
      readPoint
    };
    let projection: ActivityProjection;
    try {
      projection = this.activityProjectionFactory(projectionInput);
    } catch (error) {
      projection = failedActivityProjection(
        projectionInput,
        error instanceof Error ? error.message : "Activity aggregation failed."
      );
    }
    const coalesced = this.activityOpen && this.activityPublicationPending && this.activityPublishedProjection !== null;
    let presentedProjection = coalesced ? this.activityPublishedProjection! : projection;
    if (this.activityOpen && !coalesced) this.activityPublishedProjection = projection;
    if (this.activityOpen && !this.activityDocumentState) {
      this.activityDocumentState = openActivityDocument(presentedProjection, {
        scope: activityScope,
        filter: this.canonicalFilter,
        readPoint,
        evidenceSelectionId: this.selectionEventId,
        evidenceFocusId: this.focusedEventId,
        evidenceScrollTop: this.evidenceScrollTop,
        view: this.mode === "frozen" ? "FROZEN" : "FOLLOW LIVE",
        localDraftId: this.localInjectionDraft?.id ?? null
      });
    }
    if (this.activityDocumentState) {
      const document = this.activityDocumentState;
      const scopeChanged = JSON.stringify(document.scope) !== JSON.stringify(activityScope);
      const filterChanged = document.filter.revision !== this.canonicalFilter.revision;
      const intervalChanged = document.readPoint.intervalId !== readPoint.intervalId;
      if (scopeChanged || filterChanged || intervalChanged) {
        this.flushActivityPublication();
        presentedProjection = projection;
        this.activityPublishedProjection = projection;
        this.activityDocumentState = reduceActivityDocument(document, {
          type: "scope-or-filter-changed",
          scope: activityScope,
          filter: this.canonicalFilter,
          readPoint,
          projection: presentedProjection
        }).state;
      } else if (document.view === "FROZEN") {
        const frozenSequence = document.readPoint.committedEvidenceBoundary?.sequence ?? 0;
        const newer = entries.filter((entry) => entry.sequence > frozenSequence && matchesActivityEvidence(entry, document.filter, document.scope)).length;
        this.activityDocumentState = Object.freeze({ ...document, newerMatchingEvidence: newer });
      } else if (!coalesced) {
        this.activityDocumentState = reconcileActivityDocumentProjection(
          Object.freeze({ ...document, scope: activityScope, filter: this.canonicalFilter, newerMatchingEvidence: 0 }),
          readPoint,
          projection
        );
      }
    }
    const document = this.activityDocumentState;
    const presentedReadPoint = document?.view === "FROZEN" ? document.readPoint : presentedProjection.readPoint;
    return Object.freeze({
      open: this.activityOpen,
      transition: this.activityTransition,
      scope: activityScope,
      filter: this.canonicalFilter,
      readPoint: presentedReadPoint,
      projection: document?.view === "FROZEN" ? document.projection : presentedProjection,
      document
    });
  }

  private async hydrateActivityEvidence(): Promise<void> {
    // Activity is a projection of accepted Evidence, not a second query
    // surface. The paged investigation contract deliberately caps pages at
    // 100 records for renderer work, but using it for retained-history
    // hydration would rescan the complete journal once per page. Read the
    // already-latched authoritative candidates once, then merge any arrivals
    // accepted while that read was in flight below.
    const result = await this.evidencePipeline.read({
      intervalId: this.historyStatus.interval.id,
      order: "asc"
    });
    if (!result.ok) return;
    const hydrated: ActivityEvidence[] = result.value.evidence.flatMap((entry) =>
      isLightstreamerEvidenceCandidate(entry.candidate)
        ? [{ intervalId: entry.intervalId, sequence: entry.sequence, event: entry.candidate }]
        : []
    );
    if (this.disposed) return;
    const latchedIntervalId = hydrated[0]?.intervalId ?? this.historyStatus.interval.id;
    const latchedBoundary = hydrated.reduce((highest, entry) => Math.max(highest, entry.sequence), 0);
    const retainedAfterLatch = this.activityEvidence.filter((entry) =>
      entry.intervalId !== latchedIntervalId || entry.sequence > latchedBoundary
    );
    const byKey = new Map<string, ActivityEvidence>();
    for (const entry of hydrated) byKey.set(`${entry.intervalId}\u0000${entry.sequence}`, entry);
    for (const entry of retainedAfterLatch) byKey.set(`${entry.intervalId}\u0000${entry.sequence}`, entry);
    const rebuilt = [...byKey.values()].sort((left, right) => left.sequence - right.sequence);
    this.activityEvidence.splice(0, this.activityEvidence.length, ...rebuilt);
    this.activityEvidenceKeys.clear();
    for (const entry of rebuilt) this.activityEvidenceKeys.add(`${entry.intervalId}\u0000${entry.sequence}`);
    this.activityHydrated = true;
    if (this.activityOpen) this.publish();
  }

  private exportSnapshot(): WorkbenchExportSnapshot {
    const state = topologyStateForScope(this.topologyProjection.snapshot(), this.scopeId);
    const sensitiveRevision = this.topologyProjection.sensitiveStructureRevision();
    if (
      this.exportSensitiveCountsCache?.revision !== sensitiveRevision ||
      this.exportSensitiveCountsCache.scopeId !== this.scopeId
    ) {
      this.exportSensitiveCountsCache = {
        revision: sensitiveRevision,
        scopeId: this.scopeId,
        counts: Object.freeze(topologySensitiveCategoryCounts(state))
      };
    }
    const redactions = TOPOLOGY_SENSITIVE_CATEGORIES.filter((category) =>
      this.exportRedactions.has(category)
    );
    return Object.freeze({
      activeScopeId: this.scopeId,
      redactions: Object.freeze(redactions),
      sensitiveCounts: this.exportSensitiveCountsCache.counts,
      completeEvidence: this.exportCompleteEvidence,
      document: this.preparedExport?.document ?? null,
      json: this.preparedExport?.json ?? null,
      filename: this.preparedExport?.filename ?? null,
      ...(this.preparedExport ? { html: this.preparedExport.html } : {}),
      ...(this.exportOperation ? { operation: this.exportOperation } : {})
    });
  }

  private contextSnapshot(
    events: readonly LightstreamerEventEnvelope[],
    scope: WorkbenchSnapshot["scope"],
    activityProjection: ActivityProjection
  ): WorkbenchContextSnapshot {
    const diagnostics = this.contextDiagnosticSnapshot(scope);
    const diagnosticFilter = Object.freeze({
      criteria: this.diagnosticFilterCriteria,
      active: Object.values(this.diagnosticFilterCriteria).some((criterion) =>
        "include" in criterion
          ? criterion.include.length > 0 || criterion.exclude.length > 0
          : criterion.length > 0
      ),
      options: this.contextDiagnosticFilterOptions(scope)
    });
    const selected =
      (this.selectedEventEnvelope?.id === this.selectionEventId
        ? this.selectedEventEnvelope
        : events.find((event) => event.id === this.selectionEventId)) ?? null;
    if (!selected) {
      const topology = this.topologyProjection.snapshot();
      const dossier = runtimeObjectDossier(
        findTopologySelection(topology, this.scopeId ?? "page"),
        scope.label,
        scope.coverage,
        this.captureSnapshot(),
        events.length,
        this.liveEvidence.total,
        activityProjection
      );
      return Object.freeze({ ...dossier, diagnostics, diagnosticFilter });
    }
    return Object.freeze({
      kind: "evidence",
      title: `${selected.id} · ${humanizeKind(selected.kind)}`,
      selectedUpdate: selectedUpdateSnapshot(selected.update),
      fields: Object.freeze([
        ["Source", evidenceSource(selected)],
        ["Phase", evidencePhase(selected)],
        ["COMMAND operation", selected.update?.command ?? "—"],
        ["Evidence identity", selected.id],
        ["Client identity", selected.client?.id ?? "—"],
        ["Session identity", selected.client?.sessionId ?? "—"],
        ["Subscription identity", selected.subscription?.id ?? "—"],
        ["Runtime object", evidenceObject(selected)],
        ["COMMAND key", selected.update?.key ?? "—"],
        ["Observation path", evidenceObservationPath(selected)],
        ["Evidence limitations", evidenceLimitations(selected)]
      ] as const),
      filterActions: this.selectedContextFilterActions(selected),
      diagnostics,
      diagnosticFilter
    });
  }

  private selectedContextFilterActions(
    selected: LightstreamerEventEnvelope | null = this.selectedEventEnvelope
  ): readonly EvidenceFilterActionDescriptor[] {
    if (!selected || !this.selectionEventId || selected.id !== this.selectionEventId) return Object.freeze([]);
    const investigation = this.displayedInvestigation() ?? this.liveInvestigation;
    const lookup = investigation?.lookup;
    if (lookup && lookup.state !== "RETAINED" && lookup.identity.eventId === this.selectionEventId) return Object.freeze([]);
    const pageIdentity = investigation?.page.evidence.find((record) => record.identity.eventId === this.selectionEventId)?.identity;
    const identity = lookup?.state === "RETAINED"
      ? lookup.evidence.identity
      : this.selectedEvidenceIdentity ?? pageIdentity;
    const timestamp = lookup?.state === "RETAINED" ? lookup.evidence.timestamp : selected.timestamp;
    const retainedIntervalId = investigation?.readPoint.interval.id;
    const retained = identity !== null &&
      (retainedIntervalId === undefined || identity?.intervalId === retainedIntervalId);
    return createEvidenceFilterActionDescriptors(selected, {
      ...(identity === null || identity === undefined ? {} : { identity }),
      timestamp,
      retained,
      ...(retainedIntervalId === undefined ? {} : { retainedIntervalId })
    });
  }

  private commandProjectionSnapshot(): WorkbenchSnapshot["commandProjections"] {
    const topology = this.topologyProjection.snapshot();
    const target = findTopologySelection(topology, this.scopeId ?? "page");
    const observedState = this.commandStateProjections.snapshot("observed-server");
    const localEffectiveState = this.commandStateProjections.snapshot("local-effective");
    const supportingLocalEvidenceId = contributingLocalEvidenceId(
      observedState,
      localEffectiveState,
      target,
      this.retainedLocalEvidenceIds
    );
    const localEffective = commandProjection(
      "Local Effective COMMAND State",
      "Server Updates plus successfully delivered Local Injected Updates",
      localEffectiveState,
      target
    );
    return Object.freeze({
      observed: commandProjection(
        "Observed Server COMMAND State",
        "Captured Server Updates only",
        observedState,
        target
      ),
      localEffective: supportingLocalEvidenceId
        ? Object.freeze({ ...localEffective, supportingLocalEvidenceId })
        : localEffective,
      authoritativeLimit: "Neither projection is Authoritative COMMAND State."
    });
  }

  private diagnosticSnapshot(scope: WorkbenchSnapshot["scope"], activityProjection?: ActivityProjection): readonly WorkbenchDiagnostic[] {
    const capture = this.captureSnapshot();
    const diagnostics: WorkbenchDiagnostic[] = [];
    if (activityProjection?.state === "AGGREGATION_FAILED") {
      diagnostics.push({
        category: "activity",
        severity: "Error",
        title: "Activity aggregation unavailable",
        affected: "Activity",
        detail: activityProjection.reason ?? "Activity could not aggregate retained Evidence.",
        recovery: "Retry Activity aggregation; Capture, History, and Evidence remain available"
      });
    }
    if (this.historyCondition) {
      diagnostics.push({
        category: "history",
        severity: this.historyCondition.severity,
        title: this.historyCondition.title,
        affected: this.historyCondition.affected,
        detail: this.historyCondition.detail,
        recovery: this.historyCondition.recovery
      });
    }
    const storageDiagnostic = storageHeadroomDiagnostic(this.storageEstimate);
    if (storageDiagnostic) {
      diagnostics.push({
        category: "storage",
        severity: storageDiagnostic.severity,
        title: storageDiagnostic.title,
        affected: storageDiagnostic.affected,
        detail: storageDiagnostic.detail,
        recovery: storageDiagnostic.recovery
      });
    }
    if (this.captureStatus === "bridge disconnected") {
      diagnostics.push({
        category: "capture",
        severity: "Error",
        title: "Capture disconnected",
        affected: scope.label,
        detail: "Workbench cannot observe new inspected-page activity. Retained Evidence remains readable.",
        recovery: "Reconnect the inspected page and DevTools panel"
      });
    }
    const topology = this.topologyProjection.snapshot();
    const recoveringSessions = topology.clients.flatMap((client) =>
      client.sessions
        .filter((session) => session.normalizedStatus === "recovering")
        .map((session) => `Session ${session.id ?? session.key}`)
    );
    const recoveringClients = topology.clients
      .filter((client) => client.normalizedStatus === "recovering")
      .map((client) => `Client ${client.id}`);
    const recoveringObjects = recoveringSessions.length ? recoveringSessions : recoveringClients;
    if (recoveringObjects.length) {
      diagnostics.push({
        category: "session",
        severity: "Warning",
        title: "Session recovering",
        affected: [...new Set(recoveringObjects)].join(", "),
        detail: "The official client is attempting Session recovery. Evidence remains ordered, but current runtime availability may change.",
        recovery: "Inspect the affected Session and wait for recovery or reconnect the inspected page"
      });
    }
    if (capture.coverage !== "USEFUL" && !this.captureBoundary) {
      diagnostics.push({
        category: "capture",
        severity: capture.coverage === "UNAVAILABLE" ? "Error" : "Warning",
        title: `Coverage ${capture.coverage}`,
        affected: scope.label,
        detail:
          capture.detail ??
          "Some runtime properties are unavailable; Workbench will not infer values without evidence.",
        recovery:
          capture.recovery ??
          (capture.coverage === "UNAVAILABLE"
            ? "Reconnect the inspected page, then reload it with DevTools open"
            : "Reload the inspected page with DevTools open")
      });
    }
    const scopeSelection = scope.selection;
    if (scopeSelection?.retired) {
      diagnostics.push({
        severity: "Information",
        title: "Retired Scope",
        affected: scope.label,
        detail: "This historical runtime object is read-only. Matching retained Evidence remains available.",
        recovery: "Select a current runtime Scope before starting Local Injection"
      });
    }
    if (this.clearedSelectionEventId) {
      diagnostics.push({
        severity: "Information",
        title: "Selected Evidence cleared",
        affected: `Evidence ${this.clearedSelectionEventId}`,
        detail: `Evidence ${this.clearedSelectionEventId} was deliberately removed from history; its selection identity is retained until you choose another Scope or Evidence row.`,
        recovery: "Select another Scope or retained Evidence row"
      });
    }
    if (this.clearState === "error" && this.clearError) {
      diagnostics.push({
        category: "retention",
        severity: "Error",
        title: "History could not be cleared",
        affected: "Current panel session",
        detail: this.clearError,
        recovery: "Try clearing history again"
      });
    }
    diagnostics.push(...this.relevantCommittedDiagnosticPresentations(scope).filter((diagnostic) => !isContextOwnedDiagnostic(diagnostic)));
    return Object.freeze(diagnostics.map((diagnostic) => Object.freeze(diagnostic)));
  }

  private relevantCommittedDiagnosticPresentations(scope: WorkbenchSnapshot["scope"]): WorkbenchDiagnostic[] {
    const selected = scope.selection;
    return [...this.committedDiagnosticPresentations.values()].filter((diagnostic) => {
      if (!selected || selected.kind === "page") {
        return true;
      }
      const target = findTopologySelection(this.topologyProjection.snapshot(), selected.id);
      return diagnostic.affectedIdentity !== undefined && target !== null
        ? diagnosticAffectedIdentityAppliesToTarget(diagnostic.affectedIdentity, target)
        : false;
    });
  }

  private contextDiagnosticSnapshot(scope: WorkbenchSnapshot["scope"]): readonly WorkbenchDiagnostic[] {
    const relevant = this.relevantCommittedDiagnosticPresentations(scope).filter(isContextOwnedDiagnostic);
    if (relevant.length === 0) return Object.freeze([]);
    const relevantSet = new Set(relevant);
    const pairs = [...this.committedDiagnosticPresentations.entries()]
      .filter(([, diagnostic]) => relevantSet.has(diagnostic))
      .flatMap(([key, diagnostic]) => {
        const observation = this.committedDiagnosticObservations.get(key);
        return observation ? [{ diagnostic, observation }] : [];
      });
    const accepted = new Set(createDiagnosticObservationIndex(pairs.map(({ observation }) => observation))
      .query(this.diagnosticFilterCriteria)
      .map(({ observation }) => diagnosticObservationIdentity(observation)));
    return Object.freeze(pairs
      .filter(({ observation }) => accepted.has(diagnosticObservationIdentity(observation)))
      .map(({ diagnostic }) => diagnostic));
  }

  private contextDiagnosticFilterOptions(
    scope: WorkbenchSnapshot["scope"]
  ): Readonly<Record<DiagnosticFilterFacet, readonly Readonly<{ value: TypedFacetValue; count: number }> []>> {
    const relevant = new Set(this.relevantCommittedDiagnosticPresentations(scope).filter(isContextOwnedDiagnostic));
    const observations = [...this.committedDiagnosticPresentations.entries()].flatMap(([key, diagnostic]) => {
      const observation = relevant.has(diagnostic) ? this.committedDiagnosticObservations.get(key) : undefined;
      return observation ? [observation] : [];
    });
    const index = createDiagnosticObservationIndex(observations);
    return Object.freeze(Object.fromEntries(
      DIAGNOSTIC_FILTER_FACETS.map((facet) => [facet, index.discover(facet)])
    ) as Record<DiagnosticFilterFacet, readonly Readonly<{ value: TypedFacetValue; count: number }>[] >);
  }

  private applyDiagnosticFilter(
    facet: DiagnosticFilterFacet,
    value: TypedFacetValue,
    polarity: "include" | "exclude"
  ): void {
    if (value.facet !== facet) return;
    const prior = this.diagnosticFilterCriteria[facet];
    const include = [...(prior && "include" in prior ? prior.include : prior ?? [])]
      .filter((entry) => entry.identity !== value.identity);
    const exclude = [...(prior && "exclude" in prior ? prior.exclude : [])]
      .filter((entry) => entry.identity !== value.identity);
    (polarity === "include" ? include : exclude).push(value);
    this.diagnosticFilterCriteria = Object.freeze({
      ...this.diagnosticFilterCriteria,
      [facet]: Object.freeze({ include: Object.freeze(include), exclude: Object.freeze(exclude) })
    });
    this.publish();
  }

  private removeDiagnosticFilter(
    facet: DiagnosticFilterFacet,
    value: TypedFacetValue,
    polarity: "include" | "exclude"
  ): void {
    const prior = this.diagnosticFilterCriteria[facet];
    if (!prior) return;
    const include = [...("include" in prior ? prior.include : prior)];
    const exclude = [...("exclude" in prior ? prior.exclude : [])];
    const values = polarity === "include" ? include : exclude;
    const index = values.findIndex((entry) => entry.identity === value.identity);
    if (index < 0) return;
    values.splice(index, 1);
    const criteria = { ...this.diagnosticFilterCriteria };
    if (include.length === 0 && exclude.length === 0) delete criteria[facet];
    else criteria[facet] = Object.freeze({ include: Object.freeze(include), exclude: Object.freeze(exclude) });
    this.diagnosticFilterCriteria = Object.freeze(criteria);
    this.publish();
  }

  private inspectDiagnosticAffected(affected: DiagnosticAffectedIdentity): void {
    const state = this.topologyProjection.snapshot();
    const structure = this.currentScopeStructure(state);
    const descriptor = structure.descriptors.find((candidate) => {
      const target = locateScopeDescriptor(state, candidate.locator);
      return target !== null && diagnosticAffectedIdentityAppliesToTarget(affected, target) && target.kind === affected.kind;
    }) ?? structure.descriptors.find((candidate) => {
      const target = locateScopeDescriptor(state, candidate.locator);
      return target !== null && diagnosticAffectedIdentityAppliesToTarget(affected, target);
    });
    if (!descriptor) return;
    this.recordInvestigationCheckpoint();
    this.scopeId = descriptor.id;
    this.scopeFocusedNodeId = descriptor.id;
    this.selectionEventId = null;
    this.selectedEvidenceIdentity = null;
    this.selectedEventEnvelope = null;
    this.contextId = "context:scope";
    this.recordInvestigationCheckpoint();
    this.publish();
  }

  private recordCommittedServerDiagnosticFindings(
    entry: CommittedEvidence,
    event: LightstreamerEventEnvelope
  ): void {
    const evidenceBoundary = Object.freeze({ intervalId: entry.intervalId, sequence: entry.sequence, eventId: entry.eventId });
    const affected = diagnosticAffectedIdentity(event, evidenceBoundary);
    if (event.kind === "server-error") {
      const originalCode = event.serverError?.code;
      const nonPositive = typeof originalCode === "number" && originalCode <= 0;
      const sessionKnown = event.client?.sessionId !== undefined && event.client.sessionId !== null && event.client.sessionId !== "";
      const adapted = adaptCommittedEvidenceFinding({
        family: "server-error",
        severity: "warning",
        lifecycle: { kind: "occurrence", occurrenceId: event.id },
        affected,
        observedAt: event.timestamp,
        observed: typeof originalCode === "number"
          ? `ClientListener reported server error code ${originalCode}.`
          : "ClientListener reported a server error without a usable numeric code.",
        limitation: `${nonPositive ? "Non-positive codes can be application-specific. " : ""}${sessionKnown ? "The callback does not expose server-side application state." : "No current Session identity was available at callback time; Workbench attributes this only to the Client."}`,
        consequence: "The callback proves a server error notification, but not the complete server-side cause or resulting connection state.",
        route: { kind: "inspect-evidence", evidence: evidenceBoundary },
        evidenceBoundary,
        ...(typeof originalCode === "number" && Number.isSafeInteger(originalCode) ? { originalCode } : {}),
        ...(event.serverError?.messageState === "safe" && event.serverError.message ? { safeMessage: event.serverError.message } : {})
      });
      this.queueDiagnosticMutation(() => this.diagnosticObservations.observe(adapted.observation));
      const presentation = presentDiagnosticObservation(adapted.observation);
      this.rememberCommittedDiagnosticPresentation(diagnosticObservationIdentity(adapted.observation), {
        id: presentation.id,
        code: presentation.code,
        category: "session",
        severity: presentation.severity,
        title: presentation.title,
        affected: presentation.affected,
        affectedIdentity: adapted.observation.affected,
        detail: presentation.observed,
        limitation: presentation.limitation,
        consequence: presentation.consequence,
        route: presentation.route
      }, adapted.observation);
    }
    if (event.kind === "server-keepalive") {
      const count = event.keepalive?.count ?? 1;
      const sessionKnown = event.client?.sessionId !== undefined && event.client.sessionId !== null && event.client.sessionId !== "";
      const adapted = adaptCommittedEvidenceFinding({
        family: "server-keepalive",
        severity: "information",
        lifecycle: { kind: "occurrence", occurrenceId: event.id },
        affected,
        observedAt: event.timestamp,
        observed: `ClientListener reported ${count} keepalive callback${count === 1 ? "" : "s"} in bounded window ${event.keepalive?.windowId ?? "unavailable"}.`,
        limitation: sessionKnown
          ? "Keepalive presence says only that the callback occurred for the captured Session window."
          : "No current Session identity was available; the callback is attributed only to the Client.",
        consequence: "A keepalive callback does not prove that the connection, application, or end-to-end data flow is healthy.",
        route: { kind: "inspect-evidence", evidence: evidenceBoundary },
        evidenceBoundary
      });
      this.queueDiagnosticMutation(() => this.diagnosticObservations.observe(adapted.observation));
      const presentation = presentDiagnosticObservation(adapted.observation);
      this.rememberCommittedDiagnosticPresentation(diagnosticObservationIdentity(adapted.observation), {
        id: presentation.id,
        code: presentation.code,
        category: "session",
        severity: presentation.severity,
        title: presentation.title,
        affected: presentation.affected,
        affectedIdentity: adapted.observation.affected,
        detail: presentation.observed,
        limitation: presentation.limitation,
        consequence: presentation.consequence,
        route: presentation.route
      }, adapted.observation);
    }
  }

  private recordSubscriptionDiagnosticProposals(
    proposals: readonly SubscriptionDiagnosticProposal[]
  ): void {
    if (proposals.length === 0) return;
    for (const proposal of proposals) {
      if (proposal.kind === "observe") {
        const presentation = presentDiagnosticObservation(proposal.observation);
        if (proposal.observation.code !== "workbench.history.lower-capacity" && proposal.observation.code !== "workbench.history.terminal") {
          this.rememberCommittedDiagnosticPresentation(
            diagnosticProposalPresentationKey(proposal),
            {
              id: presentation.id,
              code: presentation.code,
              category: "session",
              severity: presentation.severity,
              title: presentation.title,
              affected: presentation.affected,
              affectedIdentity: proposal.observation.affected,
              detail: presentation.observed,
              limitation: presentation.limitation,
              consequence: presentation.consequence,
              route: presentation.route
            },
            proposal.observation
          );
        }
      } else {
        const key = diagnosticProposalPresentationKey(proposal);
        this.committedDiagnosticPresentations.delete(key);
        this.committedDiagnosticObservations.delete(key);
      }
    }
    this.queueDiagnosticMutation(() =>
      commitSubscriptionDiagnosticProposalsAdvisory(
        this.diagnosticObservations,
        proposals
      )
    );
  }

  private rememberCommittedDiagnosticPresentation(
    key: string,
    diagnostic: WorkbenchDiagnostic,
    observation: DiagnosticObservationInput
  ): void {
    const facets = createDiagnosticObservationIndex([observation]).records[0]?.facets;
    this.committedDiagnosticPresentations.set(key, Object.freeze({ ...diagnostic, ...(facets ? { filterFacets: facets } : {}) }));
    this.committedDiagnosticObservations.set(key, observation);
    while (this.committedDiagnosticPresentations.size > 100) {
      const oldest = this.committedDiagnosticPresentations.keys().next().value as string | undefined;
      if (!oldest) break;
      this.committedDiagnosticPresentations.delete(oldest);
      this.committedDiagnosticObservations.delete(oldest);
    }
  }

  private acceptDiagnosticEvidenceTransition(entry: CommittedEvidence): boolean {
    const prior = this.diagnosticEvidenceSequences.get(entry.intervalId) ?? 0;
    if (entry.sequence <= prior) return false;
    this.diagnosticEvidenceSequences.set(entry.intervalId, entry.sequence);
    return true;
  }

  private refreshRuntimeDiagnosticObservations(
    topology: TopologyState = (this.projectionRecovery?.topology ?? this.topologyProjection).snapshot(),
    sourceTransition = this.projectionRecovery === null
  ): void {
    if (!sourceTransition) return;
    const pageId = this.currentPageEpoch;
    const desired = new Map<string, Readonly<{ code: string; conditionId: string; affected: DiagnosticAffectedIdentity }>>();
    const record = (input: Readonly<{
      family: "history" | "storage" | "capture" | "session";
      localCode: string;
      conditionId: string;
      severity: "information" | "warning" | "error";
      affected: DiagnosticAffectedIdentity;
      observed: string;
      limitation: string;
      consequence: string;
      route: string;
    }>): void => {
      const adapted = adaptWorkbenchConditionFinding({
        family: input.family,
        localCode: input.localCode,
        severity: input.severity,
        lifecycle: { kind: "condition", conditionId: input.conditionId },
        affected: input.affected,
        observedAt: Date.now(),
        observed: boundedDiagnosticText(input.observed),
        limitation: boundedDiagnosticText(input.limitation),
        consequence: boundedDiagnosticText(input.consequence),
        route: { kind: "recover", action: input.route }
      });
      desired.set(diagnosticObservationIdentity(adapted.observation), { code: adapted.observation.code, conditionId: input.conditionId, affected: input.affected });
      this.queueDiagnosticMutation(() => this.diagnosticObservations.observe(adapted.observation));
    };
    const page: DiagnosticAffectedIdentity = pageId
      ? Object.freeze({ kind: "page" as const, pageId })
      : Object.freeze({ kind: "unavailable" as const, reason: "page-identity-unavailable" as const });
    if (this.historyCondition) {
      record({
        family: "history",
        localCode: this.historyCondition.kind,
        conditionId: this.historyCondition.kind,
        severity: this.historyCondition.severity === "Error" ? "error" : "warning",
        affected: page,
        observed: `Event History reported ${this.historyCondition.kind}.`,
        limitation: "The condition describes the current History Interval and its committed boundary only.",
        consequence: this.historyCondition.detail,
        route: "inspect-retained-evidence"
      });
    }
    const storage = storageHeadroomDiagnostic(this.storageEstimate);
    if (storage) {
      record({ family: "storage", localCode: "headroom-limited", conditionId: "storage-headroom", severity: "warning", affected: page, observed: "Browser storage telemetry reported limited headroom.", limitation: "Browser storage estimates are advisory and do not reserve capacity.", consequence: storage.detail, route: "inspect-storage-headroom" });
    }
    const capture = this.captureSnapshot();
    if (this.captureStatus === "bridge disconnected") {
      record({ family: "capture", localCode: "disconnected", conditionId: "bridge", severity: "error", affected: page, observed: "The inspected-page Capture bridge is disconnected.", limitation: "Workbench cannot observe later inspected-page activity while the bridge is disconnected.", consequence: "Retained Evidence remains readable, but new inspected-page activity cannot become Evidence.", route: "inspect-capture-status" });
    } else if (capture.coverage !== "USEFUL" && !this.captureBoundary) {
      record({ family: "capture", localCode: "coverage-limited", conditionId: "coverage", severity: capture.coverage === "UNAVAILABLE" ? "error" : "warning", affected: page, observed: `Observation Coverage is ${capture.coverage}.`, limitation: capture.detail ?? "Some runtime properties are unavailable; Workbench does not infer values without Evidence.", consequence: "Current Workbench conclusions are limited to the activity Capture observed.", route: "inspect-capture-status" });
    }
    for (const client of topology.clients) {
      const sessions = client.sessions.filter((session) => !session.historical && session.normalizedStatus === "recovering");
      if (sessions.length) {
        for (const session of sessions) {
          const affected: DiagnosticAffectedIdentity = !pageId
            ? page
            : session.id
            ? Object.freeze({ kind: "session" as const, pageId, clientId: client.id, sessionId: session.id })
            : Object.freeze({ kind: "client" as const, pageId, clientId: client.id });
          record({ family: "session", localCode: "recovering", conditionId: session.id ?? session.key, severity: "warning", affected, observed: "The official client is attempting Session recovery.", limitation: "Recovery status does not prove whether the prior Session will resume.", consequence: "Current runtime availability may change while Evidence remains ordered.", route: "inspect-session" });
        }
      } else if (client.normalizedStatus === "recovering") {
        const affected: DiagnosticAffectedIdentity = pageId
          ? Object.freeze({ kind: "client" as const, pageId, clientId: client.id })
          : page;
        record({ family: "session", localCode: "recovering", conditionId: client.id, severity: "warning", affected, observed: "The official client is attempting Session recovery.", limitation: "The current Session identity is unavailable.", consequence: "Current runtime availability may change while Evidence remains ordered.", route: "inspect-session" });
      }
    }
    for (const [id, prior] of this.activeRuntimeDiagnosticConditions) {
      if (desired.has(id)) continue;
      this.queueDiagnosticMutation(() => this.diagnosticObservations.resolveCondition({ ...prior, observedAt: Date.now() }));
    }
    this.activeRuntimeDiagnosticConditions.clear();
    for (const [id, condition] of desired) this.activeRuntimeDiagnosticConditions.set(id, condition);
  }

  private queueDiagnosticMutation(operation: () => Promise<unknown>): void {
    this.diagnosticObservationSettlement = this.diagnosticObservationSettlement
      .then(async () => {
        try {
          await operation();
        } catch (error) {
          await this.diagnosticObservations.close().catch(() => undefined);
          throw error;
        }
      });
    void this.diagnosticObservationSettlement.catch(() => undefined);
  }
}

function boundedDiagnosticText(value: string): string {
  return [...value].slice(0, DIAGNOSTIC_TEXT_MAX_LENGTH).join("");
}

function diagnosticAffectedIdentity(
  event: LightstreamerEventEnvelope,
  evidence: Readonly<{ intervalId: string; sequence: number; eventId: string }>
): DiagnosticAffectedIdentity {
  const pageId = event.topology?.pageEpoch;
  if (!pageId) return Object.freeze({ kind: "evidence", ...evidence });
  if (event.client?.id && event.subscription?.id) {
    if (event.item?.name !== undefined || event.item?.position !== undefined) {
      return Object.freeze({
        kind: "item",
        pageId,
        clientId: event.client.id,
        subscriptionId: event.subscription.id,
        item: event.item.name ?? `#${event.item.position}`
      });
    }
    return Object.freeze({
      kind: "subscription",
      pageId,
      clientId: event.client.id,
      ...(event.client.sessionId ? { sessionId: event.client.sessionId } : {}),
      subscriptionId: event.subscription.id
    });
  }
  if (event.client?.id && event.client.sessionId) {
    return Object.freeze({ kind: "session", pageId, clientId: event.client.id, sessionId: event.client.sessionId });
  }
  if (event.client?.id) return Object.freeze({ kind: "client", pageId, clientId: event.client.id });
  return Object.freeze({ kind: "evidence", ...evidence });
}

function diagnosticProposalPresentationKey(
  proposal: SubscriptionDiagnosticProposal
): string {
  const source = proposal.kind === "observe" ? proposal.observation : proposal.resolution;
  const lifecycle = proposal.kind === "observe"
    ? proposal.observation.lifecycle.kind === "occurrence"
      ? `occurrence:${proposal.observation.lifecycle.occurrenceId}`
      : `condition:${proposal.observation.lifecycle.conditionId}`
    : `condition:${proposal.resolution.conditionId}`;
  return `${source.code}:v${source.ruleVersion ?? 1}:${lifecycle}:${diagnosticAffectedPresentationKey(source.affected)}`;
}

function diagnosticAffectedPresentationKey(affected: DiagnosticAffectedIdentity): string {
  switch (affected.kind) {
    case "unavailable": return `unavailable:${affected.reason}`;
    case "page": return `page:${affected.pageId}`;
    case "client": return `client:${affected.pageId}:${affected.clientId}`;
    case "session": return `session:${affected.pageId}:${affected.clientId}:${affected.sessionId}`;
    case "subscription": return `subscription:${affected.pageId}:${affected.clientId}:${affected.sessionId ?? "-"}:${affected.subscriptionId}`;
    case "item": return `item:${affected.pageId}:${affected.clientId}:${affected.subscriptionId}:${affected.item}`;
    case "evidence": return `evidence:${affected.intervalId}:${affected.sequence}:${affected.eventId}`;
  }
}

function diagnosticAffectedIdentityAppliesToTarget(
  affected: DiagnosticAffectedIdentity,
  target: TopologySelectionTarget
): boolean {
  if (target.kind === "page") return true;
  if (affected.kind === "evidence" || affected.kind === "unavailable" || affected.kind === "page") return false;
  const targetClientId = "client" in target && target.client ? target.client.id : null;
  if (target.kind === "client") return affected.clientId === target.client.id;
  if (affected.clientId !== targetClientId) return false;
  if (target.kind === "session") {
    return affected.kind === "session" && affected.sessionId === target.session.id;
  }
  if (target.kind === "subscription") {
    return (affected.kind === "subscription" || affected.kind === "item") &&
      affected.subscriptionId === target.subscription.id;
  }
  if (target.kind === "item") {
    if (affected.kind !== "item" || affected.subscriptionId !== target.subscription.id) return false;
    return affected.item === (target.item.name ?? `#${target.item.position}`);
  }
  return false;
}

function isContextOwnedDiagnostic(diagnostic: WorkbenchDiagnostic): boolean {
  const affected = diagnostic.affectedIdentity;
  if (affected?.kind === "subscription" || affected?.kind === "item") return true;
  const code = diagnostic.code ?? "";
  return code.startsWith("ls.sub.") ||
    code.startsWith("ls.subscription.") ||
    code.startsWith("ls.command.") ||
    code.startsWith("ls.listener.");
}

export function settleScenarioCoordinatorExecution(execution: LocalInjectionCoordinatorExecution, now: number) {
  if (execution.kind === "review-invalidated") {
    return { kind: "not-run" as const, reason: "REVIEW INVALIDATED" as const, timestamp: now, detail: "Review invalidated before dispatch; no Injection was attempted." };
  }
  if (execution.record.executionResult === null && execution.record.outcome.requestId === null) {
    return { kind: "not-run" as const, reason: "TARGET NOT RUN" as const, timestamp: execution.record.outcome.timestamp, detail: execution.record.outcome.detail };
  }
  const evidence = execution.record.evidence.state === "committed"
    ? execution.record.evidence.reference
    : null;
  return { kind: "attempted" as const, outcome: execution.record.outcome, evidence };
}

function runtimeObjectDossier(
  target: TopologySelectionTarget | null,
  title: string,
  topologyCoverage: WorkbenchSnapshot["scope"]["coverage"],
  capture: WorkbenchCaptureSnapshot,
  visibleEvidenceCount: number,
  matchingEvidenceCount: number,
  activityProjection: ActivityProjection
): WorkbenchContextSnapshot {
  const fields: Array<readonly [string, string]> = [];
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };

  if (!target) {
    add("Scope type", "Unknown");
    add("Identity", "Unknown");
  } else {
    switch (target.kind) {
      case "page":
        add("Scope type", "Page");
        add("Clients", target.state.clientCount);
        add("Active sessions", target.state.activeSessionCount);
        add("Historical sessions", target.state.historicalSessionCount);
        add("Subscriptions", target.state.subscriptionCount);
        add("Items", target.state.itemCount);
        add("Listeners", target.state.listenerCount);
        add("Observing since", dossierTimestamp(target.state.observingSince));
        break;
      case "client":
        add("Scope type", "Client");
        add("Client ID", target.client.id);
        add("Status", target.client.status);
        add("Normalized status", target.client.normalizedStatus);
        add("Current Session ID", target.client.sessionId);
        add("Server address", target.client.serverAddress);
        add("Adapter set", target.client.adapterSet);
        add("Library version", target.client.libraryVersion);
        add("Transport", target.client.transport);
        add("Active sessions", target.client.sessions.filter(({ active, historical }) => active && !historical).length);
        add("Historical sessions", target.client.sessions.filter(({ historical }) => historical).length);
        add("Waiting Subscriptions", target.client.waitingSubscriptions.length);
        break;
      case "session":
        add("Scope type", "Session");
        add("Session ID", target.session.id);
        add("Client ID", target.client.id);
        add("Status", target.session.normalizedStatus);
        add("Client status", target.session.status);
        add("Active", yesNo(target.session.active));
        add("Historical", yesNo(target.session.historical));
        add("Transport", target.session.transport);
        add("Subscriptions", target.session.subscriptions.length);
        add("Connection epochs", target.session.connectionEpochCount);
        add("Recoveries", target.session.recoveryCount);
        break;
      case "subscription":
        addSubscriptionDossier(fields, target);
        break;
      case "item":
        add("Scope type", "Item");
        add("Item name", target.item.name);
        add("Position", target.item.position);
        add("Resolution", target.item.resolution);
        add("Subscription ID", target.subscription.id);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Historical", yesNo(target.subscription.historical));
        add("Snapshot phase", target.item.snapshotPhase);
        add("Updates", target.item.updateCount);
        add("Synthetic updates", target.item.syntheticUpdateCount);
        add("Deliveries", target.item.deliveryCount);
        add("Lost updates", target.item.lostUpdateCount);
        add("Listeners", target.item.listenerIds.length);
        add("Last COMMAND operation", target.item.lastCommand);
        add("Active COMMAND keys", target.item.activeCommandKeyCount);
        add("Deleted COMMAND keys", target.item.deletedCommandKeyCount);
        break;
      case "listener":
        add("Scope type", "Listener");
        add("Listener ID", target.listener.id);
        add("Subscription ID", target.subscription.id);
        add("Item", target.item?.name);
        add("Client ID", target.client?.id);
        add("Session ID", target.session?.id);
        add("Active", yesNo(target.listener.active));
        add("Callbacks", dossierList(target.listener.callbacks));
        add("Registration count", target.listener.registrationCount);
        add("Metric owner", yesNo(target.listener.metricOwner));
        add("Deliveries", target.listener.deliveryCount);
        add("First delivery", dossierTimestamp(target.listener.firstDeliveryAt));
        add("Last delivery", dossierTimestamp(target.listener.lastDeliveryAt));
        break;
      case "generation":
      case "inferred-child":
        // COMMAND generations are Evidence attached to structural Scope, never Scope peers.
        add("Scope type", "Unknown");
        add("Identity", "Unknown");
        break;
    }
  }

  add("Capture coverage", capture.coverage);
  add(
    "Topology coverage",
    `${topologyCoverage.semantic ? "Semantic" : "Legacy"} · ${topologyCoverage.status}`
  );
  add("Visible Evidence", visibleEvidenceCount);
  add("Matching retained Evidence", matchingEvidenceCount);
  add(
    "Activity",
    `${activityProjection.logicalUpdateTotal.toLocaleString()} Logical Updates · ${activityProjection.updateDeliveryTotal.toLocaleString()} Update Deliveries · ${activityProjection.state}`
  );

  return Object.freeze({
    kind: "runtime",
    title,
    fields: Object.freeze(fields),
    selectedUpdate: null,
    filterActions: Object.freeze([]),
    diagnostics: Object.freeze([]),
    diagnosticFilter: Object.freeze({
      criteria: Object.freeze({}),
      active: false,
      options: Object.freeze({ diagnosticCode: Object.freeze([]), diagnosticSeverity: Object.freeze([]), diagnosticAffected: Object.freeze([]) })
    })
  });
}

function addSubscriptionDossier(
  fields: Array<readonly [string, string]>,
  target: Extract<TopologySelectionTarget, { kind: "subscription" }>
): void {
  const add = (name: string, value: unknown): void => {
    fields.push(Object.freeze([name, dossierValue(value)] as const));
  };
  const subscription = target.subscription;
  add("Scope type", "Subscription");
  add("Subscription ID", subscription.id);
  add("Client ID", target.client?.id);
  add("Session ID", target.session?.id);
  add("Mode", subscription.mode);
  add("Status", subscription.statusLabel);
  add("Active", yesNo(subscription.active));
  add("Server established", yesNo(subscription.serverEstablished));
  add("Historical", yesNo(subscription.historical));
  add("Configured items", dossierList(subscription.configuredItems));
  add("Fields", dossierList(subscription.fields));
  add("Requested snapshot", subscription.requestedSnapshot);
  add("Requested buffer size", subscription.requestedBufferSize);
  add("Requested max frequency", subscription.requestedMaxFrequency);
  add("Real max frequency", subscription.realMaxFrequency);
  add("Data Adapter", subscription.dataAdapter);
  add("Selector", subscription.selector);
  add("Snapshot phase", dossierSnapshotPhases(subscription.items));
  add("Items", subscription.items.length);
  add("Listeners", subscription.listenerCount);
  add("Updates", subscription.updateCount);
  add("Synthetic updates", subscription.syntheticUpdateCount);
  add("Deliveries", subscription.deliveryCount);
  add("Lost updates", subscription.lostUpdateCount);
  add("COMMAND generations", subscription.commandGenerations.length);
}

function dossierValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Unknown";
  return String(value);
}

function dossierList(values: readonly unknown[] | undefined): string {
  return values && values.length > 0 ? values.map(String).join(", ") : "Unknown";
}

function dossierSnapshotPhases(items: readonly { snapshotPhase: string }[]): string {
  const phases = [...new Set(items.map(({ snapshotPhase }) => snapshotPhase))];
  return phases.length > 0 ? phases.join(", ") : "Unknown";
}

function dossierTimestamp(value: number | null): string {
  return value === null ? "Unknown" : new Date(value).toISOString();
}

function yesNo(value: boolean): "Yes" | "No" {
  return value ? "Yes" : "No";
}

function freezeEvidence(
  events: readonly LightstreamerEventEnvelope[],
  total: number,
  offset: number,
  records: readonly DeterministicEvidenceRecord[] = []
): EvidenceData {
  return Object.freeze({
    events: Object.freeze([...events]),
    total,
    offset,
    records: Object.freeze([...records])
  });
}

function isLightstreamerEvidenceCandidate(
  candidate: CommittedEvidence["candidate"] | undefined
): candidate is LightstreamerEventEnvelope {
  return Boolean(candidate && candidate.kind !== "topology-checkpoint");
}

function topologyCheckpointSyncId(
  candidate: CommittedEvidence["candidate"]
): string | null {
  if (candidate.kind !== "topology-checkpoint") return null;
  const syncId = candidate.checkpoint.syncId;
  return typeof syncId === "string" && syncId.length > 0 ? syncId : null;
}

function toWorkbenchEvidence(event: LightstreamerEventEnvelope): WorkbenchEvidence {
  return Object.freeze({
    id: event.id,
    time: new Date(event.timestamp).toISOString().slice(11, 23),
    source: evidenceSource(event),
    phase: evidencePhase(event),
    command: event.update?.command ?? null,
    commandKey: event.update?.key ?? null,
    kind: humanizeKind(event.kind),
    object: evidenceObject(event),
    summary: evidenceSummary(event),
    raw: event
  });
}

function evidenceSource(event: LightstreamerEventEnvelope): WorkbenchEvidence["source"] {
  if (event.synthetic || event.source === "synthetic") {
    return "LOCAL";
  }
  return event.kind === "item-update" ? "SERVER" : "RUNTIME";
}

function evidencePhase(event: LightstreamerEventEnvelope): WorkbenchEvidence["phase"] {
  if (event.kind === "end-of-snapshot") return "END OF SNAPSHOT";
  if (event.update?.isSnapshot) return "SNAPSHOT";
  return event.update ? "LIVE" : "—";
}

function evidenceObject(event: LightstreamerEventEnvelope): string {
  return event.item?.name ?? event.subscription?.id ?? event.client?.id ?? "Inspected page";
}

function evidenceSummary(event: LightstreamerEventEnvelope): string {
  const changed = Object.keys(event.update?.changedFields ?? {});
  if (changed.length > 0) return changed.join(", ");
  const fields = Object.keys(event.update?.fields ?? {});
  return fields.length > 0 ? `${fields.length} fields` : "No field detail";
}

function evidenceObservationPath(event: LightstreamerEventEnvelope): string {
  if (event.synthetic || event.source === "synthetic") {
    return "Local Injection › synthetic delivery";
  }
  return `Server › ${event.captureSource ? `${event.captureSource} Capture` : "Capture source Unknown"}`;
}

function evidenceLimitations(event: LightstreamerEventEnvelope): string {
  if (event.synthetic || event.source === "synthetic") {
    return "Local Effective observation only; it is not Server Evidence or Authoritative COMMAND State.";
  }
  if (event.topology?.coverage.status === "partial") {
    return `Partial semantic observation${event.topology.coverage.reason ? ` (${event.topology.coverage.reason})` : ""}; unavailable properties remain Unknown and this is not Authoritative COMMAND State.`;
  }
  return "Captured observation; unavailable properties remain Unknown and this is not Authoritative COMMAND State.";
}

function humanizeKind(kind: string): string {
  return kind
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isCompatibleLocalInjectionSource(event: LightstreamerEventEnvelope): boolean {
  const fields = localInjectionFieldSchema(event.subscription?.fields, event.update?.fields);
  const listenerTarget = Boolean(event.listener?.id);
  const wireTarget = event.captureSource === "wire" && Boolean(event.item?.position);
  const mode = event.subscription?.mode;
  const commandContextReady =
    mode !== "COMMAND" || (fields.includes("command") && fields.includes("key"));
  return (
    event.kind === "item-update" &&
    !event.synthetic &&
    event.source === "server" &&
    (mode === "COMMAND" || mode === "MERGE" || mode === "DISTINCT") &&
    Boolean(event.client?.id) &&
    Boolean(event.client?.sessionId) &&
    Boolean(event.subscription?.id) &&
    Boolean(event.item?.name || event.item?.position) &&
    fields.length > 0 &&
    commandContextReady &&
    (listenerTarget || wireTarget)
  );
}

function localInjectionFieldSchema(
  captured: readonly string[] | null | undefined,
  observed: Readonly<Record<string, unknown>> | undefined
): string[] {
  const fields: string[] = [];
  for (const field of captured ?? Object.keys(observed ?? {})) {
    if (field.trim() && !fields.includes(field)) fields.push(field);
  }
  return fields;
}

function anchorFromDraft(
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

function authoredDraftFromScope(
  target: TopologySelectionTarget | null,
  pageEpoch: string | null
): { draft: ReinjectionDraft; anchor: WorkbenchLocalInjectionAnchor } | null {
  if (!target || (target.kind !== "subscription" && target.kind !== "item" && target.kind !== "listener")) return null;
  if (!target.client || !target.session || target.session.historical || !target.session.active) return null;
  const subscription = target.subscription;
  const item = target.kind === "subscription"
    ? subscription.items.length === 1 ? subscription.items[0] ?? null : null
    : target.item;
  if (!item || subscription.mode !== "COMMAND" || subscription.historical || !subscription.active) return null;
  const listener = target.kind === "listener"
    ? target.listener
    : subscription.listeners.find(
        (candidate) => candidate.active && item.listenerIds.includes(candidate.id)
      ) ?? null;
  if (!listener?.active) return null;
  const fieldSchema = localInjectionFieldSchema(subscription.fields, undefined);
  if (!fieldSchema.includes("command") || !fieldSchema.includes("key")) return null;
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
  const draft = createNewCommandDraftFromContext({
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

function localInjectionReady(draft: LocalInjectionDraftState): boolean {
  return Boolean(draft.document) &&
    draft.documentDiagnostics.every(({ severity }) => severity !== "error") &&
    draft.targetDiagnostics.every(({ severity }) => severity !== "error");
}

function rememberExplicitConcreteFields(
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

function isActiveLocalInjectionDeliveryListener(
  listener: Readonly<{ active: boolean; callbacks: readonly string[] }>
): boolean {
  return listener.active && listener.callbacks.includes("onItemUpdate");
}

function freezeLocalInjectionDocument(
  document: LocalInjectionDocument
): Readonly<LocalInjectionDocument> {
  return Object.freeze({
    command: document.command,
    key: document.key,
    isSnapshot: document.isSnapshot,
    fields: deepFreezeLocalInjectionFields(document.fields)
  });
}

function deepFreezeLocalInjectionFields(
  fields: LocalInjectionDocument["fields"]
): LocalInjectionDocument["fields"] {
  return Object.freeze(Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [name, cloneAndFreezeJsonValue(value)])
  ));
}

function cloneReinjectionDraft(draft: ReinjectionDraft): ReinjectionDraft {
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

function cloneLocalInjectionDraftState(draft: LocalInjectionDraftState): LocalInjectionDraftState {
  return {
    ...draft,
    baseDraft: cloneReinjectionDraft(draft.baseDraft),
    anchor: Object.freeze({ ...draft.anchor, fieldSchema: Object.freeze([...draft.anchor.fieldSchema]) }),
    document: draft.document ? freezeLocalInjectionDocument(draft.document) : null,
    documentDiagnostics: Object.freeze(draft.documentDiagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
    targetDiagnostics: Object.freeze(draft.targetDiagnostics.map((diagnostic) => Object.freeze({ ...diagnostic }))),
    sourceDocument: draft.sourceDocument ? freezeLocalInjectionDocument(draft.sourceDocument) : null,
    explicitConcreteFields: new Set(draft.explicitConcreteFields),
    editorPresentation: Object.freeze({
      ...draft.editorPresentation,
      serializedState: draft.editorPresentation.serializedState
        ? Object.freeze({ ...draft.editorPresentation.serializedState })
        : null
    }),
    restorationOrigin: Object.freeze({ ...draft.restorationOrigin })
  };
}

function hashLocalInjectionValue(value: unknown): string {
  const text = stableJson(value);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `li-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function createScopeNodeDescriptors(state: TopologyState): ScopeNodeDescriptor[] {
  const descriptors: ScopeNodeDescriptor[] = [];
  const add = (
    presentation: ReturnType<typeof topologyPageNodePresentation>,
    parentId: string | null,
    depth: number,
    locator: ScopeNodeDescriptor["locator"]
  ): string => {
    const id = presentation.selection.key;
    const kind = presentation.selection.kind;
    if (!isStructuralScopeKind(kind)) {
      throw new Error(`Non-structural ${kind} cannot enter Workbench Scope.`);
    }
    descriptors.push(Object.freeze({
      id,
      kind,
      label: presentation.label,
      parentId,
      depth,
      locator
    }));
    return id;
  };

  const pageId = add(topologyPageNodePresentation(state), null, 0, { kind: "page" });
  const addSubscription = (
    client: TopologyState["clients"][number] | null,
    session: TopologyState["clients"][number]["sessions"][number] | null,
    subscription: TopologyState["clients"][number]["sessions"][number]["subscriptions"][number],
    locator: ScopeSubscriptionLocator,
    parentId: string,
    depth: number
  ) => {
    const subscriptionId = add(
      topologySubscriptionNodePresentation(client, session, subscription),
      parentId,
      depth,
      { kind: "subscription", ...locator }
    );
    for (const [itemIndex, item] of subscription.items.entries()) {
      const itemId = add(
        topologyItemNodePresentation(client, session, subscription, item),
        subscriptionId,
        depth + 1,
        { kind: "item", ...locator, itemIndex }
      );
      for (const listenerId of item.listenerIds) {
        add(
          topologyListenerNodePresentation(client, session, subscription, item, listenerId),
          itemId,
          depth + 2,
          { kind: "listener", ...locator, itemIndex, listenerId }
        );
      }
    }
    if (subscription.items.length === 0) {
      for (const listenerId of subscription.listenerIds) {
        add(
          topologyListenerNodePresentation(client, session, subscription, null, listenerId),
          subscriptionId,
          depth + 1,
          { kind: "listener", ...locator, itemIndex: null, listenerId }
        );
      }
    }
  };

  for (const [clientIndex, client] of state.clients.entries()) {
    const clientId = add(
      topologyClientNodePresentation(client),
      pageId,
      1,
      { kind: "client", clientIndex }
    );
    for (const [subscriptionIndex, subscription] of client.waitingSubscriptions.entries()) {
      addSubscription(
        client,
        null,
        subscription,
        { clientIndex, sessionIndex: null, collection: "waiting", subscriptionIndex },
        clientId,
        2
      );
    }
    for (const [sessionIndex, session] of client.sessions.entries()) {
      const sessionId = add(
        topologySessionNodePresentation(client, session),
        clientId,
        2,
        { kind: "session", clientIndex, sessionIndex }
      );
      for (const [subscriptionIndex, subscription] of session.subscriptions.entries()) {
        addSubscription(
          client,
          session,
          subscription,
          { clientIndex, sessionIndex, collection: "session", subscriptionIndex },
          sessionId,
          3
        );
      }
    }
  }
  for (const [subscriptionIndex, subscription] of state.unassignedSubscriptions.entries()) {
    addSubscription(
      null,
      null,
      subscription,
      { clientIndex: null, sessionIndex: null, collection: "unassigned", subscriptionIndex },
      pageId,
      1
    );
  }
  return descriptors;
}

function resolveScopeNode(
  state: TopologyState,
  descriptor: ScopeNodeDescriptor,
  selectedId: string | null,
  captureStatus: CaptureStatus
): WorkbenchScopeNode {
  const located = locateScopeDescriptor(state, descriptor.locator);
  if (!located) {
    return Object.freeze({
      ...descriptor,
      detail: "Unavailable in current topology snapshot",
      tone: "neutral",
      lifecycle: "unknown",
      retired: false,
      selected: descriptor.id === (selectedId ?? "page")
    });
  }
  let presentation: ReturnType<typeof topologyPageNodePresentation>;
  let lifecycle: WorkbenchScopeLifecycle;
  switch (located.kind) {
    case "page":
      presentation = topologyPageNodePresentation(state);
      lifecycle = pageScopeLifecycle(state, captureStatus);
      break;
    case "client":
      presentation = topologyClientNodePresentation(located.client);
      lifecycle = connectionScopeLifecycle(located.client.normalizedStatus);
      break;
    case "session":
      presentation = topologySessionNodePresentation(located.client, located.session);
      lifecycle = located.session.historical
        ? "retired"
        : connectionScopeLifecycle(located.session.normalizedStatus);
      break;
    case "subscription": {
      const inherited = located.session
        ? located.session.historical
          ? "retired"
          : connectionScopeLifecycle(located.session.normalizedStatus)
        : located.client
          ? connectionScopeLifecycle(located.client.normalizedStatus)
          : "unknown";
      presentation = topologySubscriptionNodePresentation(
        located.client,
        located.session,
        located.subscription
      );
      lifecycle = subscriptionScopeLifecycle(located.subscription, inherited);
      break;
    }
    case "item": {
      const inherited = located.session
        ? located.session.historical
          ? "retired"
          : connectionScopeLifecycle(located.session.normalizedStatus)
        : located.client
          ? connectionScopeLifecycle(located.client.normalizedStatus)
          : "unknown";
      presentation = topologyItemNodePresentation(
        located.client,
        located.session,
        located.subscription,
        located.item
      );
      lifecycle = subscriptionScopeLifecycle(located.subscription, inherited);
      break;
    }
    case "listener": {
      const inherited = located.session
        ? located.session.historical
          ? "retired"
          : connectionScopeLifecycle(located.session.normalizedStatus)
        : located.client
          ? connectionScopeLifecycle(located.client.normalizedStatus)
          : "unknown";
      const subscriptionLifecycle = subscriptionScopeLifecycle(located.subscription, inherited);
      presentation = topologyListenerNodePresentation(
        located.client,
        located.session,
        located.subscription,
        located.item,
        located.listener.id
      );
      lifecycle = listenerScopeLifecycle(
        located.subscription,
        located.listener.id,
        subscriptionLifecycle
      );
      break;
    }
  }
  return Object.freeze({
    id: descriptor.id,
    kind: descriptor.kind,
    label: presentation.label,
    detail: presentation.meta,
    parentId: descriptor.parentId,
    depth: descriptor.depth,
    tone: presentation.tone,
    lifecycle,
    retired: lifecycle === "retired",
    selected: descriptor.id === (selectedId ?? "page")
  });
}

function locateScopeDescriptor(
  state: TopologyState,
  locator: ScopeNodeDescriptor["locator"]
): Exclude<TopologySelectionTarget, { kind: "generation" | "inferred-child" }> | null {
  if (locator.kind === "page") return { kind: "page", state };
  const client = state.clients[locator.clientIndex ?? -1];
  if (locator.kind === "client") {
    return client ? { kind: "client", client } : null;
  }
  const session = client?.sessions[locator.sessionIndex ?? -1];
  if (locator.kind === "session") {
    return client && session ? { kind: "session", client, session } : null;
  }
  const locatedSubscription = locateScopeSubscription(state, locator);
  if (!locatedSubscription) return null;
  const { subscription } = locatedSubscription;
  if (locator.kind === "subscription") {
    return { kind: "subscription", ...locatedSubscription };
  }
  const item = locator.itemIndex === null
    ? null
    : subscription.items[locator.itemIndex];
  if (locator.kind === "item") {
    return item ? { kind: "item", ...locatedSubscription, item } : null;
  }
  const listener = subscription.listeners.find(({ id }) => id === locator.listenerId);
  return listener
    ? { kind: "listener", ...locatedSubscription, item, listener }
    : null;
}

function locateScopeSubscription(
  state: TopologyState,
  locator: ScopeSubscriptionLocator
): {
  client: TopologyState["clients"][number] | null;
  session: TopologyState["clients"][number]["sessions"][number] | null;
  subscription: TopologySubscription;
} | null {
  if (locator.collection === "unassigned") {
    const subscription = state.unassignedSubscriptions[locator.subscriptionIndex];
    return subscription ? { client: null, session: null, subscription } : null;
  }
  const client = state.clients[locator.clientIndex ?? -1];
  if (!client) return null;
  if (locator.collection === "waiting") {
    const subscription = client.waitingSubscriptions[locator.subscriptionIndex];
    return subscription ? { client, session: null, subscription } : null;
  }
  const session = client.sessions[locator.sessionIndex ?? -1];
  const subscription = session?.subscriptions[locator.subscriptionIndex];
  return session && subscription ? { client, session, subscription } : null;
}

function connectionScopeLifecycle(
  state: TopologyConnectionState
): WorkbenchScopeLifecycle {
  switch (state) {
    case "connected":
      return "active";
    case "recovering":
      return "recovering";
    case "stalled":
      return "stalled";
    case "disconnected":
      return "disconnected";
    case "connecting":
    case "unknown":
      return "unknown";
  }
}

function pageScopeLifecycle(
  state: TopologyState,
  captureStatus: CaptureStatus
): WorkbenchScopeLifecycle {
  if (captureStatus === "bridge disconnected") return "disconnected";
  const clientLifecycles = state.clients.map(({ normalizedStatus }) =>
    connectionScopeLifecycle(normalizedStatus)
  );
  for (const lifecycle of ["recovering", "stalled", "active"] as const) {
    if (clientLifecycles.includes(lifecycle)) return lifecycle;
  }
  if (
    clientLifecycles.length > 0 &&
    clientLifecycles.every((lifecycle) => lifecycle === "disconnected")
  ) {
    return "disconnected";
  }
  return captureStatus === "capturing" ? "active" : "unknown";
}

function subscriptionScopeLifecycle(
  subscription: TopologySubscription,
  inheritedLifecycle: WorkbenchScopeLifecycle
): WorkbenchScopeLifecycle {
  if (subscription.historical || inheritedLifecycle === "retired") return "retired";
  if (subscription.active || subscription.serverEstablished) return "active";
  if (
    subscription.statusLabel === "Inactive" ||
    subscription.statusLabel === "Failed" ||
    subscription.waitingForSession ||
    subscription.pendingSince !== null ||
    subscription.endedAt !== null
  ) {
    return "inactive";
  }
  return "unknown";
}

function listenerScopeLifecycle(
  subscription: TopologySubscription,
  listenerId: string,
  inheritedLifecycle: WorkbenchScopeLifecycle
): WorkbenchScopeLifecycle {
  if (inheritedLifecycle === "retired") return "retired";
  const listener = subscription.listeners.find(({ id }) => id === listenerId);
  if (!listener) return "unknown";
  return listener.active ? "active" : "inactive";
}

function scopeLifecycleLabel(lifecycle: WorkbenchScopeLifecycle): string {
  return `${lifecycle.slice(0, 1).toUpperCase()}${lifecycle.slice(1)}`;
}

function isStructuralScopeKind(
  kind: TopologySelection["kind"]
): kind is WorkbenchStructuralScopeKind {
  return (
    kind === "page" ||
    kind === "client" ||
    kind === "session" ||
    kind === "subscription" ||
    kind === "item" ||
    kind === "listener"
  );
}

function scopeBreadcrumb(
  nodesById: ReadonlyMap<string, WorkbenchScopeStructureNode>,
  selected: WorkbenchScopeStructureNode | undefined
): string {
  if (!selected) return "Inspected page";
  const labels: string[] = [];
  let current: WorkbenchScopeStructureNode | undefined = selected;
  while (current) {
    labels.unshift(current.label);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return labels.join(" › ");
}

function sameScopeNodePresentation(
  left: WorkbenchScopeNode,
  right: WorkbenchScopeNode
): boolean {
  return (
    left.id === right.id &&
    left.kind === right.kind &&
    left.label === right.label &&
    left.detail === right.detail &&
    left.parentId === right.parentId &&
    left.depth === right.depth &&
    left.tone === right.tone &&
    left.lifecycle === right.lifecycle &&
    left.retired === right.retired &&
    left.selected === right.selected
  );
}

function topologyStateForScope(
  state: TopologyState,
  scopeId: string | null
): TopologyState {
  const target = findTopologySelection(state, scopeId ?? "page");
  if (!target || target.kind === "page") return state;
  if (target.kind === "client") {
    return topologyStateFromBranches(state, [target.client], []);
  }
  if (target.kind === "session") {
    return topologyStateFromBranches(
      state,
      [{ ...target.client, waitingSubscriptions: [], sessions: [target.session] }],
      []
    );
  }

  let subscription = target.subscription;
  if (target.kind === "item") {
    const listenerIds = new Set(target.item.listenerIds);
    subscription = {
      ...subscription,
      items: [target.item],
      listenerIds: [...listenerIds],
      listeners: subscription.listeners.filter(({ id }) => listenerIds.has(id)),
      commandGenerations: subscription.commandGenerations.filter(
        ({ itemId }) => itemId === target.item.id
      )
    };
  } else if (target.kind === "listener") {
    subscription = {
      ...subscription,
      listenerIds: [target.listener.id],
      listeners: [target.listener],
      items: target.item
        ? [{ ...target.item, listenerIds: [target.listener.id] }]
        : []
    };
  } else if (target.kind === "generation" || target.kind === "inferred-child") {
    const generation =
      target.kind === "inferred-child"
        ? { ...target.generation, inferredChildren: [target.child] }
        : target.generation;
    subscription = {
      ...subscription,
      commandGenerations: [generation],
      items: subscription.items.filter(({ id }) => id === generation.itemId)
    };
  }

  if (!target.client) {
    return topologyStateFromBranches(state, [], [subscription]);
  }
  if (!target.session) {
    return topologyStateFromBranches(
      state,
      [{ ...target.client, waitingSubscriptions: [subscription], sessions: [] }],
      []
    );
  }
  return topologyStateFromBranches(
    state,
    [
      {
        ...target.client,
        waitingSubscriptions: [],
        sessions: [{ ...target.session, subscriptions: [subscription] }]
      }
    ],
    []
  );
}

function topologyStateFromBranches(
  source: TopologyState,
  clients: TopologyState["clients"],
  unassignedSubscriptions: TopologyState["unassignedSubscriptions"]
): TopologyState {
  const subscriptions = [
    ...clients.flatMap((client) => [
      ...client.waitingSubscriptions,
      ...client.sessions.flatMap((session) => session.subscriptions)
    ]),
    ...unassignedSubscriptions
  ];
  const sessions = clients.flatMap((client) => client.sessions);
  return {
    observingSince: source.observingSince,
    clients,
    unassignedSubscriptions,
    clientCount: clients.length,
    activeSessionCount: sessions.filter(({ active, historical }) => active && !historical).length,
    historicalSessionCount: sessions.filter(({ historical }) => historical).length,
    subscriptionCount: subscriptions.length,
    activeSubscriptionCount: subscriptions.filter(({ active, historical }) => active && !historical).length,
    serverEstablishedSubscriptionCount: subscriptions.filter(
      ({ serverEstablished, historical }) => serverEstablished && !historical
    ).length,
    itemCount: subscriptions.reduce((total, subscription) => total + subscription.items.length, 0),
    listenerCount: subscriptions.reduce(
      (total, subscription) => total + subscription.listeners.length,
      0
    )
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function evidenceRefFromIdentity(identity: EvidenceIdentity | null): EvidenceRef | null {
  return identity === null
    ? null
    : Object.freeze({
        intervalId: identity.intervalId,
        sequence: identity.sequence,
        eventId: identity.eventId
      });
}

function structuralEvidenceScope(target: TopologySelectionTarget | null): StructuralEvidenceScope {
  if (!target || target.kind === "page") return Object.freeze({ kind: "PAGE" });
  switch (target.kind) {
    case "client":
      return Object.freeze({ kind: "CLIENT", clientId: target.client.id });
    case "session":
      return Object.freeze({
        kind: "SESSION",
        clientId: target.client.id,
        sessionId: target.session.id
      });
    case "subscription":
      return Object.freeze({
        kind: "SUBSCRIPTION",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id
      });
    case "item":
      return Object.freeze({
        kind: "ITEM",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id,
        ...(target.item.name === null ? {} : { item: target.item.name }),
        itemPosition: target.item.position ?? undefined
      });
    case "listener":
      return Object.freeze({
        kind: "LISTENER",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id,
        ...(target.item?.name == null ? {} : { item: target.item.name }),
        itemPosition: target.item?.position ?? undefined,
        listenerId: target.listener.id
      });
    case "generation":
    case "inferred-child":
      // Generation rows remain a Subscription structural scope in the
      // storage-neutral contract. Their generation-specific semantics stay in
      // the existing topology projection until a later domain seam owns them.
      return Object.freeze({
        kind: "SUBSCRIPTION",
        clientId: target.client?.id ?? null,
        sessionId: target.session?.id ?? null,
        subscriptionId: target.subscription.id
      });
  }
}

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

function eventFromDeterministicRecord(record: DeterministicEvidenceRecord): LightstreamerEventEnvelope {
  const payload = lightstreamerPayload(record.payload);
  if (payload) return payload;

  const facet = (name: string): Readonly<{ value: string; label: string }> | undefined => {
    const value = record.facets[name];
    if (!value || typeof value !== "object") return undefined;
    const candidate = value as { value?: unknown; label?: unknown };
    return typeof candidate.value === "string" && typeof candidate.label === "string"
      ? { value: candidate.value, label: candidate.label }
      : undefined;
  };
  const client = facet("client");
  const session = facet("session");
  const subscription = facet("subscription");
  const item = facet("item");
  const listener = facet("listener");
  const mode = facet("mode");
  const key = facet("key");
  const operation = facet("operation");
  const provenance = facet("provenance");
  const observationPath = facet("observationPath");
  const kind = record.summary === "Topology checkpoint" ? "client-status" : record.summary;
  return Object.freeze({
    id: record.identity.eventId,
    timestamp: record.timestamp,
    direction: "inbound",
    source: provenance?.value === "LOCAL" ? "synthetic" : "server",
    ...(observationPath?.value === "LISTENER" || observationPath?.value === "WIRE"
      ? { captureSource: observationPath.value.toLowerCase() as "listener" | "wire" }
      : {}),
    synthetic: provenance?.value === "LOCAL",
    kind: kind as LightstreamerEventEnvelope["kind"],
    ...(client ? { client: { id: client.label, ...(session ? { sessionId: session.label } : {}) } } : {}),
    ...(subscription
      ? { subscription: { id: subscription.label, ...(mode ? { mode: mode.label } : {}) } }
      : {}),
    ...(item ? { item: { name: item.label } } : {}),
    ...(listener ? { listener: { id: listener.label } } : {}),
    ...(key || operation
      ? { update: { ...(key ? { key: key.label } : {}), ...(operation ? { command: operation.label } : {}) } }
      : {}),
    raw: { summary: record.summary, searchText: record.searchText }
  });
}

function candidateFromDeterministicRecord(record: DeterministicEvidenceRecord): LightstreamerEventEnvelope {
  return eventFromDeterministicRecord(record);
}

function lightstreamerPayload(value: unknown): LightstreamerEventEnvelope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<LightstreamerEventEnvelope>;
  return typeof candidate.id === "string" &&
      typeof candidate.timestamp === "number" &&
      (candidate.direction === "inbound" || candidate.direction === "outbound") &&
      (candidate.source === "server" || candidate.source === "synthetic") &&
      typeof candidate.synthetic === "boolean" &&
      typeof candidate.kind === "string"
    ? candidate as LightstreamerEventEnvelope
    : null;
}

function nearestVisibleRecordId(
  records: readonly DeterministicEvidenceRecord[],
  selected: EvidenceIdentity
): string | null {
  if (records.length === 0) return null;
  return records.find((record) => record.identity.sequence >= selected.sequence)?.identity.eventId ??
    records.at(-1)?.identity.eventId ??
    null;
}

function blockersToMutations(blockers: readonly RevealBlocker[]): readonly FilterMutation[] {
  const operations: FilterMutation[] = [];
  for (const blocker of blockers) {
    if (blocker.criterion === "free-text") operations.push({ type: "set-text", text: "" });
    else if (blocker.criterion === "around-evidence") operations.push({ type: "clear-around" });
    else if (typeof blocker.criterion === "object" && "polarity" in blocker.criterion && "facet" in blocker.criterion) {
      const criterion = blocker.criterion;
      const raw = criterion.value.value;
      const value = createTypedFilterValue(criterion.facet, criterion.value.type, criterion.value.type === "number" ? Number(raw) : raw, criterion.value.label);
      operations.push({ type: "remove-criterion", facet: criterion.facet, value });
    } else if (typeof blocker.criterion === "object" && "id" in blocker.criterion) {
      operations.push({ type: "clear-unsupported", id: blocker.criterion.id });
    }
  }
  return Object.freeze(operations);
}

function commandProjection(
  name: string,
  basis: string,
  state: CommandState,
  target: TopologySelectionTarget | null
): WorkbenchCommandProjection {
  const subscriptions = commandSubscriptionsForScope(state, target);
  const rows = subscriptions.flatMap((subscription) =>
    subscription.items.flatMap((item) =>
      item.activeRows.map((row) =>
        Object.freeze([
          `${subscription.subscriptionId} / ${item.itemName ?? item.itemId} / ${row.key}`,
          Object.entries(row.fields)
            .map(([field, value]) => `${field}=${String(value)}`)
            .join(", ")
        ] as const)
      )
    )
  );
  return Object.freeze({ name, basis, rows: Object.freeze(rows) });
}

type ScopedCommandRow = CommandState["subscriptions"][number]["items"][number]["activeRows"][number];
type ScopedDeletedCommandKey = CommandState["subscriptions"][number]["items"][number]["deletedKeys"][number];

function contributingLocalEvidenceId(
  observedState: CommandState,
  localEffectiveState: CommandState,
  target: TopologySelectionTarget | null,
  retainedLocalEvidenceIds: ReadonlySet<string>
): string | null {
  const observedRows = new Map<string, ScopedCommandRow>();
  const localRows = new Map<string, ScopedCommandRow>();
  const localDeletedKeys = new Map<string, ScopedDeletedCommandKey>();
  const collect = (
    state: CommandState,
    rows: Map<string, ScopedCommandRow>,
    deletedKeys?: Map<string, ScopedDeletedCommandKey>
  ) => {
    for (const subscription of commandSubscriptionsForScope(state, target)) {
      for (const item of subscription.items) {
        for (const row of item.activeRows) {
          rows.set(commandRowIdentity(subscription.subscriptionId, item.itemId, row.key), row);
        }
        if (deletedKeys) {
          for (const deleted of item.deletedKeys) {
            deletedKeys.set(
              commandRowIdentity(subscription.subscriptionId, item.itemId, deleted.key),
              deleted
            );
          }
        }
      }
    }
  };
  collect(observedState, observedRows);
  collect(localEffectiveState, localRows, localDeletedKeys);

  let supporting: { eventId: string; timestamp: number } | null = null;
  for (const identity of new Set([...observedRows.keys(), ...localRows.keys()])) {
    const observed = observedRows.get(identity);
    const local = localRows.get(identity);
    if (observed && local && commandFieldsEqual(observed.fields, local.fields)) continue;
    const provenance = local?.latest ?? localDeletedKeys.get(identity)?.deletedAt;
    if (
      !provenance?.synthetic ||
      !retainedLocalEvidenceIds.has(provenance.eventId) ||
      (supporting && provenance.timestamp < supporting.timestamp)
    ) continue;
    supporting = { eventId: provenance.eventId, timestamp: provenance.timestamp };
  }
  return supporting?.eventId ?? null;
}

function commandRowIdentity(subscriptionId: string, itemId: string, key: string): string {
  return `${subscriptionId}\u0000${itemId}\u0000${key}`;
}

function commandFieldsEqual(
  left: ScopedCommandRow["fields"],
  right: ScopedCommandRow["fields"]
): boolean {
  const leftEntries = Object.entries(left);
  return leftEntries.length === Object.keys(right).length && leftEntries.every(
    ([field, value]) => Object.is(value, right[field])
  );
}

function commandSubscriptionsForScope(
  state: CommandState,
  target: TopologySelectionTarget | null
): CommandState["subscriptions"] {
  if (!target) return [];
  if (target.kind === "page") return state.subscriptions;

  let subscriptionIds: Set<string>;
  let itemTarget: Extract<TopologySelectionTarget, { kind: "item" }>['item'] | null = null;
  switch (target.kind) {
    case "client":
      subscriptionIds = new Set([
        ...target.client.waitingSubscriptions.map(({ id }) => id),
        ...target.client.sessions.flatMap((session) =>
          session.subscriptions.map(({ id }) => id)
        )
      ]);
      break;
    case "session":
      subscriptionIds = new Set(target.session.subscriptions.map(({ id }) => id));
      break;
    case "subscription":
      subscriptionIds = new Set([target.subscription.id]);
      break;
    case "item":
      subscriptionIds = new Set([target.subscription.id]);
      itemTarget = target.item;
      break;
    case "listener":
      subscriptionIds = new Set([target.subscription.id]);
      itemTarget = target.item;
      break;
    case "generation":
    case "inferred-child":
      return [];
  }

  return state.subscriptions
    .filter(({ subscriptionId }) => subscriptionIds.has(subscriptionId))
    .map((subscription) =>
      itemTarget
        ? {
            ...subscription,
            items: subscription.items.filter((item) =>
              commandItemMatchesTopologyItem(item, itemTarget)
            )
          }
        : subscription
    );
}

function commandItemMatchesTopologyItem(
  commandItem: CommandState["subscriptions"][number]["items"][number],
  topologyItem: Extract<TopologySelectionTarget, { kind: "item" }>['item']
): boolean {
  if (topologyItem.name !== null && commandItem.itemName !== topologyItem.name) return false;
  if (
    topologyItem.position !== null &&
    commandItem.itemPosition !== topologyItem.position
  ) return false;
  return topologyItem.name !== null || topologyItem.position !== null
    ? true
    : commandItem.itemId === topologyItem.id;
}

function normalizeWindowSize(value: number | undefined): number {
  return Math.max(1, Math.floor(value ?? DEFAULT_EVIDENCE_WINDOW_SIZE));
}

function normalizeOutputByteLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_EVIDENCE_OUTPUT_BYTE_LIMIT;
  if (!Number.isSafeInteger(value) || value < 2) {
    throw new RangeError("The Evidence output-byte limit must be at least two bytes.");
  }
  return value;
}

function operationProgress(
  phase: WorkbenchEvidenceOperationProgress["phase"],
  completed: number,
  total: number | null,
  outputBytes: number,
  readPoint: EvidenceSnapshot["readPoint"] | null,
  outputByteLimit: number,
  excludedAfterLatch: number
): WorkbenchEvidenceOperationProgress {
  return Object.freeze({
    phase,
    completed: Math.max(0, completed),
    total: total === null ? null : Math.max(0, total),
    outputBytes: Math.max(0, outputBytes),
    outputByteLimit,
    interval: readPoint?.interval ? Object.freeze({ ...readPoint.interval }) : null,
    committedEvidenceBoundary: readPoint?.committedEvidenceBoundary
      ? Object.freeze({ ...readPoint.committedEvidenceBoundary })
      : null,
    excludedAfterLatch: Math.max(0, excludedAfterLatch)
  });
}

function readPointFromProgress(
  progress: WorkbenchEvidenceOperationProgress | undefined
): EvidenceSnapshot["readPoint"] | null {
  if (!progress?.interval) return null;
  return {
    interval: progress.interval,
    committedEvidenceBoundary: progress.committedEvidenceBoundary,
    retainedRange: null
  };
}

function ensureOutputByteLimit(bytes: number, maxBytes: number): void {
  if (bytes <= maxBytes) return;
  throw codedOperationError(
    "OUTPUT_LIMIT",
    `The serialized Evidence output would exceed the ${maxBytes.toLocaleString()}-byte safety limit.`
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function serializationFailure(failure: unknown): Error & { code: "SERIALIZATION_FAILED" } {
  return Object.assign(
    new Error(failure instanceof Error ? failure.message : "Evidence serialization failed."),
    { code: "SERIALIZATION_FAILED" as const }
  );
}

function codedOperationError(
  code: "OUTPUT_LIMIT",
  message: string
): Error & { code: "OUTPUT_LIMIT" } {
  return Object.assign(new Error(message), { code: "OUTPUT_LIMIT" as const });
}

function operationFailure(
  failure: unknown,
  signal: AbortSignal
): Readonly<{
  outcome: WorkbenchEvidenceOperationOutcome;
  message: string;
  recovery: string;
}> {
  const code = failure && typeof failure === "object" && "code" in failure
    ? String(failure.code)
    : "";
  const message = failure && typeof failure === "object" && "message" in failure
    ? String(failure.message)
    : errorMessage(failure);
  if (signal.aborted || code === "QUERY_CANCELLED") {
    return {
      outcome: "CANCELLED",
      message: "The Complete History operation was cancelled before its artifact was published.",
      recovery: "Run the operation again when you are ready."
    };
  }
  if (code === "OUTPUT_LIMIT") {
    return {
      outcome: "OUTPUT_REFUSED",
      message,
      recovery: "Use a smaller Scope or Filter, or copy/export in smaller bounded selections."
    };
  }
  if (code === "SERIALIZATION_FAILED") {
    return {
      outcome: "SERIALIZATION_FAILED",
      message: message || "Evidence serialization failed.",
      recovery: "No partial artifact was published. Try again after narrowing the Scope or Filter."
    };
  }
  if (code === "HISTORY_INTERVAL_UNAVAILABLE" || code === "READ_POINT_UNAVAILABLE") {
    return {
      outcome: "HISTORY_UNAVAILABLE",
      message,
      recovery: "Clear retained Evidence or reload the inspected page with DevTools open, then try again."
    };
  }
  if (code === "HISTORY_TERMINAL") {
    return {
      outcome: "HISTORY_TERMINAL",
      message,
      recovery: "Capture is stopped at its committed Evidence boundary. Reload the inspected page with DevTools open to start a new Panel Session."
    };
  }
  return {
    outcome: "QUERY_FAILED",
    message,
    recovery: "No partial artifact was published. Try the operation again after checking the retained Evidence status."
  };
}

function sameEvidenceReadPoint(
  left: EvidenceSnapshot["readPoint"],
  right: EvidenceSnapshot["readPoint"]
): boolean {
  const sameIdentity = (first: EvidenceIdentity | null, second: EvidenceIdentity | null): boolean =>
    first?.intervalId === second?.intervalId &&
    first?.pageId === second?.pageId &&
    first?.ownerId === second?.ownerId &&
    first?.sequence === second?.sequence &&
    first?.eventId === second?.eventId;
  return left.interval.id === right.interval.id &&
    left.interval.ordinal === right.interval.ordinal &&
    sameIdentity(left.committedEvidenceBoundary, right.committedEvidenceBoundary) &&
    sameIdentity(left.retainedRange?.first ?? null, right.retainedRange?.first ?? null) &&
    sameIdentity(left.retainedRange?.last ?? null, right.retainedRange?.last ?? null);
}

function emptyScenarioEditorState(compareOpen: boolean): ScenarioEditorState {
  return Object.freeze({ cursor: 0, selectionFrom: 0, selectionTo: 0, scrollTop: 0, scrollLeft: 0, compareOpen, serializedState: null });
}

function sameScenarioEditorState(left: ScenarioEditorState, right: ScenarioEditorState): boolean {
  return left.cursor === right.cursor &&
    left.selectionFrom === right.selectionFrom &&
    left.selectionTo === right.selectionTo &&
    left.scrollTop === right.scrollTop &&
    left.scrollLeft === right.scrollLeft &&
    left.compareOpen === right.compareOpen && JSON.stringify(left.serializedState) === JSON.stringify(right.serializedState);
}

function browserScheduler(): WorkbenchRuntimeScheduler {
  return {
    requestFrame(callback) {
      return globalThis.requestAnimationFrame(callback);
    },
    cancelFrame(handle) {
      globalThis.cancelAnimationFrame(handle as number);
    },
    setTimeout(callback, delayMs) {
      return globalThis.setTimeout(callback, delayMs);
    },
    clearTimeout(handle) {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  };
}
