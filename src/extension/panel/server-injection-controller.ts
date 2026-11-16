import type { CaptureStatus } from "../../bridge/messages";
import type { LightstreamerEventEnvelope } from "../../core/event-envelope";
import type { TopologyState } from "../../core/topology-state";
import {
  cloneServerInjectionDraft,
  createAuthoredServerInjectionDraft,
  createServerInjectionDraftFromEvent,
  serverInjectionApprovalFingerprint,
  validateServerInjectionDraft,
  type ServerInjectionDiagnostic,
  type ServerInjectionDraft,
  type ServerInjectionExecutionResult,
  type ServerInjectionExecutor
} from "../../core/server-injection";
import {
  createClientMessageRecipeContext,
  errorClientMessageRecipes,
  loadingClientMessageRecipes,
  unavailableClientMessageRecipes,
  type ClientMessageRecipeProvider,
  type ClientMessageRecipeResolution
} from "../../core/client-message-recipe";
import type { AgentServerInjectionInput } from "./agent-runtime";

export type WorkbenchServerInjectionSnapshot = Readonly<{
  state: "idle" | "active";
  availability: Readonly<{
    cloneSelected: Readonly<{ available: boolean; reason: string | null }>;
    authorSelectedClient: Readonly<{ available: boolean; reason: string | null }>;
  }>;
  entryError: string | null;
  draft: Readonly<{
    id: string;
    phase: "edit" | "review" | "pending" | "outcome";
    value: Readonly<ServerInjectionDraft>;
    delayTimeoutText: string;
    diagnostics: readonly ServerInjectionDiagnostic[];
    ready: boolean;
    source: Readonly<{ kind: "captured-message" | "authored"; eventId: string | null }>;
    reviewedFingerprint: string | null;
    agentRequestId: string | null;
    agentApproved: boolean;
    outcome: ServerInjectionExecutionResult | null;
    repeatWarning: boolean;
    discardConfirmation: boolean;
    recipes: ClientMessageRecipeResolution;
  }> | null;
}>;

export type ServerInjectionCommand =
  | { type: "begin-server-injection-from-selection" }
  | { type: "begin-server-injection-from-selected-client" }
  | { type: "set-server-injection-message"; message: string }
  | { type: "set-server-injection-sequence"; sequence: string }
  | { type: "set-server-injection-delay-timeout"; value: string }
  | { type: "set-server-injection-enqueue"; enabled: boolean }
  | { type: "apply-server-injection-recipe"; recipeId: string }
  | { type: "review-server-injection" }
  | { type: "edit-server-injection" }
  | { type: "execute-server-injection" }
  | { type: "approve-server-injection-for-agent" }
  | { type: "request-discard-server-injection" }
  | { type: "cancel-discard-server-injection" }
  | { type: "confirm-discard-server-injection" }
  | { type: "finish-server-injection" }
  | { type: "prepare-server-injection-repeat" };

const SERVER_INJECTION_COMMAND_TYPES: ReadonlySet<string> = new Set<ServerInjectionCommand["type"]>([
  "begin-server-injection-from-selection",
  "begin-server-injection-from-selected-client",
  "set-server-injection-message",
  "set-server-injection-sequence",
  "set-server-injection-delay-timeout",
  "set-server-injection-enqueue",
  "apply-server-injection-recipe",
  "review-server-injection",
  "edit-server-injection",
  "execute-server-injection",
  "approve-server-injection-for-agent",
  "request-discard-server-injection",
  "cancel-discard-server-injection",
  "confirm-discard-server-injection",
  "finish-server-injection",
  "prepare-server-injection-repeat"
]);

export function isServerInjectionCommand(command: Readonly<{ type: string }>): command is ServerInjectionCommand {
  return SERVER_INJECTION_COMMAND_TYPES.has(command.type);
}

/** The runtime facts one Server Injection Draft is validated and fingerprinted against. */
export type ServerInjectionControllerHost = Readonly<{
  topology(): TopologyState;
  pageEpoch(): string | null;
  captureStatus(): CaptureStatus;
  disposed(): boolean;
  visible(): boolean;
  /** The selected Evidence that may seed a cloned or authored Draft. */
  selectedEvent(): LightstreamerEventEnvelope | null;
  /** The other protected document that currently blocks Server Injection. */
  blockingDocument(): "local-injection" | "scenario" | null;
  /** Completes the runtime state transition after this controller changed state. */
  commitTransition(): void;
}>;

export type ServerInjectionControllerOptions = Readonly<{
  executor: ServerInjectionExecutor | null;
  recipeProvider: ClientMessageRecipeProvider | null;
}>;

type ServerInjectionDraftState = {
  id: string;
  phase: "edit" | "review" | "pending" | "outcome";
  draft: ServerInjectionDraft;
  delayTimeoutText: string;
  diagnostics: readonly ServerInjectionDiagnostic[];
  sourceKind: "captured-message" | "authored";
  reviewedDraft: ServerInjectionDraft | null;
  reviewedFingerprint: string | null;
  agentRequestId: string | null;
  agentPreparedFingerprint: string | null;
  approvalFingerprint: string | null;
  outcome: ServerInjectionExecutionResult | null;
  repeatWarning: boolean;
  discardConfirmation: boolean;
  recipes: ClientMessageRecipeResolution;
};

/**
 * Owns the one protected Server Injection Source/Draft/review/execution/outcome
 * lifecycle. A reviewed Client Message is sent at most once through the
 * inspected client's normal sendMessage path; an agent-prepared Draft executes
 * only after the visible human approval latch matches its exact fingerprint.
 */
export class ServerInjectionController {
  private draft: ServerInjectionDraftState | null = null;
  private entryError: string | null = null;
  private sequence = 0;

  constructor(
    private readonly host: ServerInjectionControllerHost,
    private readonly options: ServerInjectionControllerOptions
  ) {}

  /** Whether a protected Server Injection Draft currently exists. */
  get active(): boolean {
    return this.draft !== null;
  }

  dispatch(command: ServerInjectionCommand): void {
    switch (command.type) {
      case "begin-server-injection-from-selection":
        this.begin(false);
        return;
      case "begin-server-injection-from-selected-client":
        this.begin(true);
        return;
      case "set-server-injection-message":
        this.updateDraft((draft) => ({ ...draft, message: command.message }));
        return;
      case "set-server-injection-sequence":
        this.updateDraft((draft) => ({ ...draft, sequence: command.sequence }));
        return;
      case "set-server-injection-delay-timeout":
        this.setDelayTimeout(command.value);
        return;
      case "set-server-injection-enqueue":
        this.updateDraft((draft) => ({ ...draft, enqueueWhileDisconnected: command.enabled }));
        return;
      case "apply-server-injection-recipe":
        this.applyRecipe(command.recipeId);
        return;
      case "review-server-injection":
        this.review();
        return;
      case "edit-server-injection":
        this.edit();
        return;
      case "execute-server-injection":
        void this.execute();
        return;
      case "approve-server-injection-for-agent":
        this.approveForAgent();
        return;
      case "request-discard-server-injection":
        this.requestDiscard();
        return;
      case "cancel-discard-server-injection":
        this.cancelDiscard();
        return;
      case "confirm-discard-server-injection":
        this.confirmDiscard();
        return;
      case "finish-server-injection":
        this.finish();
        return;
      case "prepare-server-injection-repeat":
        this.prepareRepeat();
        return;
    }
  }

  snapshot(): WorkbenchServerInjectionSnapshot {
    const draft = this.draft;
    return Object.freeze({
      state: draft ? "active" as const : "idle" as const,
      availability: this.availability(),
      entryError: this.entryError,
      draft: draft
        ? Object.freeze({
            id: draft.id,
            phase: draft.phase,
            value: Object.freeze(cloneServerInjectionDraft(draft.draft)),
            delayTimeoutText: draft.delayTimeoutText,
            diagnostics: draft.diagnostics,
            ready: this.ready(draft),
            source: Object.freeze({
              kind: draft.sourceKind,
              eventId: draft.draft.sourceEventId
            }),
            reviewedFingerprint: draft.reviewedFingerprint,
            agentRequestId: draft.agentRequestId,
            agentApproved: Boolean(draft.agentRequestId && draft.approvalFingerprint && draft.approvalFingerprint === draft.reviewedFingerprint && draft.approvalFingerprint === this.currentFingerprint(draft)),
            outcome: draft.outcome,
            repeatWarning: draft.repeatWarning,
            discardConfirmation: draft.discardConfirmation,
            recipes: draft.recipes
          })
        : null
    });
  }

  /**
   * Revalidates the Draft against the current target. A reviewed Draft whose
   * exact-call fingerprint no longer matches returns to Edit and loses any
   * approval latch. Does not commit a transition.
   */
  reconcile(): void {
    const state = this.draft;
    if (state?.phase === "edit") {
      this.refreshValidation(state);
    } else if (state?.phase === "review") {
      this.refreshValidation(state);
      if (
        !state.reviewedFingerprint ||
        !this.ready(state) ||
        this.currentFingerprint(state) !== state.reviewedFingerprint
      ) {
        this.returnToEdit(state);
      }
    }
  }

  /** Clears an agent approval latch when the panel hides or closes. Does not commit a transition. */
  clearAgentApprovalLatch(): void {
    if (this.draft?.agentRequestId && this.draft.approvalFingerprint) this.draft.approvalFingerprint = null;
  }

  prepareForAgent(input: AgentServerInjectionInput, requestId: string): void {
    if (this.host.disposed() || !this.host.visible()) throw new Error("TARGET_CHANGED: Show Workbench before preparing a Server Injection review.");
    if (!requestId || requestId.length > 2048) throw new Error("INVALID_ARGUMENT: requestId must be a non-empty bounded value.");
    if (this.host.blockingDocument() || this.draft) throw new Error("REQUEST_CAPACITY: Finish the active protected document before preparing Server Injection.");
    if (input.target.pageEpoch !== this.host.pageEpoch()) throw new Error("TARGET_CHANGED: The selected page epoch changed before preparation.");
    const state: ServerInjectionDraftState = {
      id: `agent-server-injection-${requestId}`,
      phase: "edit",
      draft: cloneServerInjectionDraft(input),
      delayTimeoutText: input.delayTimeout === null ? "" : String(input.delayTimeout),
      diagnostics: Object.freeze([]),
      sourceKind: "authored",
      reviewedDraft: null,
      reviewedFingerprint: null,
      agentRequestId: requestId,
      agentPreparedFingerprint: null,
      approvalFingerprint: null,
      outcome: null,
      repeatWarning: false,
      discardConfirmation: false,
      recipes: unavailableClientMessageRecipes("This Client Message was prepared by an agent. Review its exact body and arguments before approving it.")
    };
    this.draft = state;
    this.refreshValidation(state);
    state.agentPreparedFingerprint = this.currentFingerprint(state);
    this.host.commitTransition();
  }

  executeApprovedForAgent(requestId: string): Promise<ServerInjectionExecutionResult> {
    if (this.host.disposed() || !this.host.visible()) {
      throw new Error("TARGET_CHANGED: Agent-approved Server Injection cannot execute while the panel is hidden or closed.");
    }
    const state = this.draft;
    if (!state || state.agentRequestId !== requestId || !state.approvalFingerprint ||
      state.approvalFingerprint !== state.reviewedFingerprint ||
      state.approvalFingerprint !== this.currentFingerprint(state)) {
      if (state?.agentRequestId === requestId && state.approvalFingerprint) {
        state.approvalFingerprint = null;
        state.reviewedFingerprint = null;
        state.reviewedDraft = null;
        if (state.phase === "review") state.phase = "edit";
        this.host.commitTransition();
      }
      throw new Error("HUMAN_APPROVAL_REQUIRED: Review and approve this exact Client/Session/message call in the Workbench document.");
    }
    return this.execute(requestId).then(result => {
      if (!result) throw new Error("TARGET_CHANGED: Approved Server Injection could not be started.");
      return result;
    });
  }

  abortForAgent(requestId: string): void {
    const state = this.draft;
    if (!state || state.agentRequestId !== requestId || state.phase === "pending" || state.phase === "outcome" ||
      !state.agentPreparedFingerprint || state.agentPreparedFingerprint !== this.currentFingerprint(state)) throw new Error("TARGET_CHANGED: Only the unchanged unexecuted agent Server Injection can be aborted.");
    this.draft = null;
    this.entryError = null;
    this.host.commitTransition();
  }

  revokeAgentApproval(): void {
    const state = this.draft;
    if (state?.agentRequestId && state.approvalFingerprint) {
      state.approvalFingerprint = null;
      this.host.commitTransition();
    }
  }

  private availability(): WorkbenchServerInjectionSnapshot["availability"] {
    const event = this.host.selectedEvent();
    const blocking = this.host.blockingDocument();
    const blocked = blocking === "local-injection"
      ? "Finish or discard the active Local Injection Draft first."
      : blocking === "scenario"
        ? "Finish the active Local Injection Scenario first."
        : null;
    const source = event ? createServerInjectionDraftFromEvent(event) : null;
    const authored = event ? this.authoredDraftForEvent(event) : null;
    const cloneReason = blocked ?? (
      !event
        ? "Select a captured Client Message."
        : !source
          ? "Selected Evidence is not a Captured Client Message with an available body and Session."
          : this.validateTarget(source)[0]?.message ?? null
    );
    const authorReason = blocked ?? (
      !event
        ? "Select Evidence from a live official Lightstreamer client Session."
        : !authored
          ? "Selected Evidence does not identify a live official client sendMessage target."
          : this.validateTarget(authored)[0]?.message ?? null
    );
    return Object.freeze({
      cloneSelected: Object.freeze({ available: cloneReason === null, reason: cloneReason }),
      authorSelectedClient: Object.freeze({ available: authorReason === null, reason: authorReason })
    });
  }

  private begin(authored: boolean): void {
    this.entryError = null;
    const blocking = this.host.blockingDocument();
    if (blocking) {
      this.entryError = blocking === "local-injection"
        ? "Finish or discard the active Local Injection Draft before starting Server Injection."
        : "Finish the active Local Injection Scenario before starting Server Injection.";
      this.host.commitTransition();
      return;
    }
    if (this.draft) {
      this.entryError = "One Server Injection Draft is already active.";
      this.host.commitTransition();
      return;
    }
    const event = this.host.selectedEvent();
    const candidate = event
      ? authored
        ? this.authoredDraftForEvent(event)
        : createServerInjectionDraftFromEvent(event)
      : null;
    if (!candidate) {
      this.entryError = authored
        ? "Select Evidence from a live official Lightstreamer client Session."
        : "Select a Captured Client Message with an available body and Session.";
      this.host.commitTransition();
      return;
    }
    const state: ServerInjectionDraftState = {
      id: `server-injection-draft-${++this.sequence}`,
      phase: "edit",
      draft: cloneServerInjectionDraft(candidate),
      delayTimeoutText: candidate.delayTimeout === null ? "" : String(candidate.delayTimeout),
      diagnostics: Object.freeze([]),
      sourceKind: authored ? "authored" : "captured-message",
      reviewedDraft: null,
      reviewedFingerprint: null,
      agentRequestId: null,
      agentPreparedFingerprint: null,
      approvalFingerprint: null,
      outcome: null,
      repeatWarning: false,
      discardConfirmation: false,
      recipes: authored
        ? loadingClientMessageRecipes()
        : unavailableClientMessageRecipes(
            "Captured Client Messages already provide the exact body accepted by the application."
          )
    };
    this.draft = state;
    this.refreshValidation(state);
    this.host.commitTransition();
    if (authored && event) {
      this.resolveRecipes(state.id, createClientMessageRecipeContext(event, candidate.target));
    }
  }

  private resolveRecipes(
    draftId: string,
    context: ReturnType<typeof createClientMessageRecipeContext>
  ): void {
    const resolution = this.options.recipeProvider
      ? this.options.recipeProvider.resolve(context)
      : Promise.resolve(unavailableClientMessageRecipes(
          "This application does not expose a Workbench Message Recipe adapter."
        ));
    void resolution.then(
      (recipes) => this.setRecipes(draftId, recipes),
      (error) => this.setRecipes(draftId, errorClientMessageRecipes(
        error instanceof Error
          ? error.message
          : "Workbench could not resolve application Message Recipes."
      ))
    );
  }

  private setRecipes(draftId: string, recipes: ClientMessageRecipeResolution): void {
    const state = this.draft;
    if (this.host.disposed() || !state || state.id !== draftId || state.phase !== "edit") return;
    state.recipes = recipes;
    this.host.commitTransition();
  }

  private applyRecipe(recipeId: string): void {
    const state = this.draft;
    if (!state || state.phase !== "edit" || state.recipes.status !== "available") return;
    const recipe = state.recipes.items.find(({ id }) => id === recipeId);
    if (!recipe) return;
    state.draft = {
      ...state.draft,
      message: recipe.message,
      sequence: recipe.sequence,
      delayTimeout: recipe.delayTimeout,
      enqueueWhileDisconnected: recipe.enqueueWhileDisconnected
    };
    state.delayTimeoutText = recipe.delayTimeout === null ? "" : String(recipe.delayTimeout);
    this.invalidateEditedDraft(state);
    this.refreshValidation(state);
    this.host.commitTransition();
  }

  private authoredDraftForEvent(event: LightstreamerEventEnvelope): ServerInjectionDraft | null {
    const clientId = event.client?.id;
    const sessionId = event.client?.sessionId;
    const pageEpoch = event.clientMessage?.pageEpoch ?? event.topology?.pageEpoch ?? this.host.pageEpoch();
    const resolvedTarget = clientId && sessionId && pageEpoch
      ? { clientId, sessionId, pageEpoch }
      : null;
    return createAuthoredServerInjectionDraft(event, resolvedTarget);
  }

  private updateDraft(update: (draft: ServerInjectionDraft) => ServerInjectionDraft): void {
    const state = this.draft;
    if (!state || state.phase !== "edit") return;
    state.draft = update(cloneServerInjectionDraft(state.draft));
    this.invalidateEditedDraft(state);
    this.refreshValidation(state);
    this.host.commitTransition();
  }

  private invalidateEditedDraft(state: ServerInjectionDraftState): void {
    state.reviewedDraft = null;
    state.reviewedFingerprint = null;
    state.approvalFingerprint = null;
    state.outcome = null;
    state.discardConfirmation = false;
  }

  private setDelayTimeout(value: string): void {
    const state = this.draft;
    if (!state || state.phase !== "edit") return;
    state.delayTimeoutText = value;
    const trimmed = value.trim();
    if (trimmed === "") {
      state.draft = { ...state.draft, delayTimeout: null };
    } else if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed)) state.draft = { ...state.draft, delayTimeout: parsed };
    }
    state.reviewedDraft = null;
    state.reviewedFingerprint = null;
    state.approvalFingerprint = null;
    this.refreshValidation(state);
    this.host.commitTransition();
  }

  private refreshValidation(state: ServerInjectionDraftState): void {
    const diagnostics = [
      ...validateServerInjectionDraft(state.draft),
      ...this.validateTarget(state.draft)
    ];
    const timeout = state.delayTimeoutText.trim();
    if (
      timeout !== "" &&
      (!/^\d+$/.test(timeout) || !Number.isSafeInteger(Number(timeout)))
    ) {
      diagnostics.unshift(Object.freeze({
        code: "invalid-timeout",
        severity: "error" as const,
        message: "Delay timeout must be a non-negative whole number or left blank for Server default."
      }));
    }
    state.diagnostics = Object.freeze(diagnostics);
  }

  private validateTarget(draft: ServerInjectionDraft): readonly ServerInjectionDiagnostic[] {
    const errors: ServerInjectionDiagnostic[] = [];
    const add = (code: string, message: string) => errors.push(Object.freeze({
      code,
      severity: "error" as const,
      message
    }));
    if (this.host.captureStatus() === "bridge disconnected") {
      add("bridge-disconnected", "The inspected-page bridge is disconnected.");
    }
    const pageEpoch = this.host.pageEpoch();
    if (pageEpoch && draft.target.pageEpoch !== pageEpoch) {
      add("stale-page", "The inspected page changed after this Draft was created.");
      return errors;
    }
    const client = this.host.topology().clients.find(
      ({ id }) => id === draft.target.clientId
    );
    if (!client) {
      add("stale-client", "The protected Lightstreamer client is no longer available.");
      return errors;
    }
    if (client.instrumentationSource !== "public-api") {
      add("unsupported-client", "Server Injection requires an official Lightstreamer client API target.");
    }
    const session = client.sessions.find(
      ({ id, active, historical }) => id === draft.target.sessionId && active && !historical
    );
    if (!session) {
      add("stale-session", "The protected Lightstreamer Session is no longer active.");
    }
    return errors;
  }

  private ready(state: ServerInjectionDraftState): boolean {
    return state.diagnostics.every(({ severity }) => severity !== "error");
  }

  private currentFingerprint(state: ServerInjectionDraftState): string {
    const topology = this.host.topology();
    const client = topology.clients.find(({ id }) => id === state.draft.target.clientId);
    const session = client?.sessions.find(({ id }) => id === state.draft.target.sessionId);
    return JSON.stringify([
      serverInjectionApprovalFingerprint(state.draft),
      this.host.pageEpoch(),
      this.host.captureStatus(),
      client?.id ?? null,
      client?.instrumentationSource ?? null,
      session?.id ?? null,
      session?.active ?? false,
      session?.historical ?? true
    ]);
  }

  private returnToEdit(state: ServerInjectionDraftState): void {
    state.phase = "edit";
    state.reviewedDraft = null;
    state.reviewedFingerprint = null;
    state.approvalFingerprint = null;
  }

  private review(): void {
    const state = this.draft;
    if (!state || state.phase !== "edit") return;
    this.refreshValidation(state);
    if (!this.ready(state)) {
      this.host.commitTransition();
      return;
    }
    state.reviewedDraft = Object.freeze(cloneServerInjectionDraft(state.draft));
    state.reviewedFingerprint = this.currentFingerprint(state);
    state.approvalFingerprint = null;
    state.phase = "review";
    this.host.commitTransition();
  }

  private edit(): void {
    const state = this.draft;
    if (!state || state.phase !== "review") return;
    this.returnToEdit(state);
    state.discardConfirmation = false;
    this.host.commitTransition();
  }

  private approveForAgent(): void {
    const state = this.draft;
    if (!state?.agentRequestId || state.phase !== "review" || !state.reviewedFingerprint) return;
    this.refreshValidation(state);
    if (!this.ready(state) || this.currentFingerprint(state) !== state.reviewedFingerprint) {
      this.returnToEdit(state);
      this.host.commitTransition();
      return;
    }
    // This latch can only be created by the visible, focused human action in
    // this document. Agent calls cannot invoke this command.
    state.approvalFingerprint = state.reviewedFingerprint;
    this.host.commitTransition();
  }

  private execute(requestId?: string): Promise<ServerInjectionExecutionResult | null> {
    const state = this.draft;
    if (!state || state.phase !== "review" || !state.reviewedDraft || !state.reviewedFingerprint) return Promise.resolve(null);
    if (state.agentRequestId && (!requestId || !state.approvalFingerprint)) return Promise.resolve(null);
    this.refreshValidation(state);
    if (
      !this.ready(state) ||
      this.currentFingerprint(state) !== state.reviewedFingerprint
    ) {
      this.returnToEdit(state);
      this.host.commitTransition();
      return Promise.resolve(null);
    }
    const draftId = state.id;
    const reviewed = cloneServerInjectionDraft(state.reviewedDraft);
    state.phase = "pending";
    this.host.commitTransition();
    const execution = this.options.executor
      ? this.options.executor.execute(reviewed, requestId)
      : Promise.resolve<ServerInjectionExecutionResult>({
          requestId: requestId ?? `server-injection-unavailable-${Date.now()}`,
          ok: false,
          status: "bridge-error",
          timestamp: Date.now(),
          error: "Server Injection executor is unavailable."
        });
    return execution.then(
      (outcome) => { this.setOutcome(draftId, outcome); return outcome; },
      (error) => {
        const outcome: ServerInjectionExecutionResult = {
          requestId: requestId ?? `server-injection-unknown-${Date.now()}`,
          ok: false,
          status: "unknown",
          timestamp: Date.now(),
          error: `${error instanceof Error ? error.message : "Server Injection outcome was lost."} Do not repeat automatically.`
        };
        this.setOutcome(draftId, outcome);
        return outcome;
      }
    );
  }

  private setOutcome(draftId: string, outcome: ServerInjectionExecutionResult): void {
    const state = this.draft;
    if (this.host.disposed() || !state || state.id !== draftId || state.phase !== "pending") return;
    state.outcome = Object.freeze({ ...outcome });
    state.phase = "outcome";
    this.host.commitTransition();
  }

  private requestDiscard(): void {
    const state = this.draft;
    if (!state || state.phase === "pending") return;
    state.discardConfirmation = true;
    this.host.commitTransition();
  }

  private cancelDiscard(): void {
    const state = this.draft;
    if (!state || !state.discardConfirmation) return;
    state.discardConfirmation = false;
    this.host.commitTransition();
  }

  private confirmDiscard(): void {
    const state = this.draft;
    if (!state || state.phase === "pending" || !state.discardConfirmation) return;
    this.draft = null;
    this.entryError = null;
    this.host.commitTransition();
  }

  private finish(): void {
    if (this.draft?.phase !== "outcome") return;
    this.draft = null;
    this.entryError = null;
    this.host.commitTransition();
  }

  private prepareRepeat(): void {
    const state = this.draft;
    if (!state || state.phase !== "outcome") return;
    state.id = `server-injection-draft-${++this.sequence}`;
    // A deliberate Repeat is a new human-owned message, never a continuation
    // of an agent's consumed request ID or approval.
    state.agentRequestId = null;
    state.agentPreparedFingerprint = null;
    state.approvalFingerprint = null;
    state.phase = "edit";
    state.reviewedDraft = null;
    state.reviewedFingerprint = null;
    state.outcome = null;
    state.repeatWarning = true;
    state.discardConfirmation = false;
    this.refreshValidation(state);
    this.host.commitTransition();
  }
}
