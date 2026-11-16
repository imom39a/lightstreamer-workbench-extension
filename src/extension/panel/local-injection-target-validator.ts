import type { CaptureStatus } from "../../bridge/messages";
import type { CommandStateProjections } from "../../core/command-state";
import type { HistoryStatus } from "../../core/event-history-authoritative";
import { expandJsonStringFields } from "../../core/json-string-fields";
import {
  nativeBaselineFromDraft,
  type NativeChangeContext,
  type NativeReviewedChangeFacts
} from "../../core/local-injection-change-semantics";
import {
  analyzeLocalInjectionDocument,
  applyLocalInjectionDocumentToDraft,
  type LocalInjectionDiagnostic,
  type LocalInjectionDocument
} from "../../core/local-injection-document";
import type { createNativeItemBaselineIndex } from "../../core/local-injection-item-baseline";
import type { TopologyState } from "../../core/topology-state";
import {
  hashLocalInjectionValue,
  isActiveLocalInjectionDeliveryListener,
  rememberExplicitConcreteFields,
  scenarioStepDraft,
  type LocalInjectionDraftState,
  type ScenarioNativeChangeStep,
  type WorkbenchLocalInjectionAnchor
} from "./local-injection-draft-state";

/** The current runtime facts a Local Injection target is validated against. Read on every call. */
export type LocalInjectionTargetFacts = Readonly<{
  topology(): TopologyState;
  pageEpoch(): string | null;
  captureStatus(): CaptureStatus;
  commandState(): CommandStateProjections;
  historyStatus(): HistoryStatus;
  nativeItemBaselines: Pick<ReturnType<typeof createNativeItemBaselineIndex>, "read">;
  /** False while committed projections are rebuilding or the committed follower is not LIVE. */
  committedProjectionsLive(): boolean;
}>;

/**
 * Validates and fingerprints Local Injection Drafts against their protected
 * target: document analysis, stale page/client/Session/Subscription/item/
 * listener detection, native-mode change baselines, and the delivery
 * identity a reviewed fingerprint binds. Shared by standalone Drafts,
 * Scenario Steps, and agent preparation so all three revalidate identically.
 */
export class LocalInjectionTargetValidator {
  constructor(private readonly facts: LocalInjectionTargetFacts) {}

  refresh(draft: LocalInjectionDraftState): void {
    const previousDocument = draft.document;
    const analysis = analyzeLocalInjectionDocument(draft.rawText, {
      mode: draft.anchor.subscriptionMode,
      commandSemantics:
        draft.anchor.subscriptionMode === "COMMAND"
          ? "required"
          : "not-applicable",
      schemaFields: draft.anchor.fieldSchema,
      jsonStringFields: expandJsonStringFields(draft.baseDraft.fields).encodedFieldNames,
      commandState: this.facts.commandState().snapshot("local-effective"),
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
    if (analysis.document) {
      const context = this.nativeChangeContext(draft);
      const effective = applyLocalInjectionDocumentToDraft(draft.baseDraft, analysis.document, draft.explicitConcreteFields, context);
      draft.nativeChanges = Object.freeze({ context, fields: Object.freeze({ ...effective.fields }), fieldValueStates: Object.freeze({ ...effective.fieldValueStates }), changedFields: Object.freeze({ ...effective.changedFields }), semantics: Object.freeze({ ...effective.changeSemantics!, limitations: Object.freeze([...effective.changeSemantics!.limitations]) }) });
    } else draft.nativeChanges = undefined;
    draft.documentDiagnostics = analysis.diagnostics;
    draft.targetDiagnostics = Object.freeze(this.validateTarget(draft.anchor));
  }

  validateTarget(
    anchor: WorkbenchLocalInjectionAnchor
  ): LocalInjectionDiagnostic[] {
    const diagnostics: LocalInjectionDiagnostic[] = [];
    const stale = (code: string, message: string) => diagnostics.push(Object.freeze({
      category: "target" as const,
      severity: "error" as const,
      code,
      message
    }));
    if (this.facts.captureStatus() === "bridge disconnected") {
      stale("stale-page-delivery", "The inspected-page Local Injection delivery target is disconnected.");
    }
    if (anchor.pageEpoch && this.facts.pageEpoch() && anchor.pageEpoch !== this.facts.pageEpoch()) {
      stale("stale-page-delivery", "The inspected page changed after this draft was created.");
    }
    const state = this.facts.topology();
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

  nativeChangeContext(draft: LocalInjectionDraftState): NativeChangeContext {
    const topology = this.facts.topology();
    const subscription = topology.clients.find(client => client.id === draft.anchor.clientId)?.sessions.find(session => session.id === draft.anchor.sessionId)?.subscriptions.find(subscription => subscription.id === draft.anchor.subscriptionId);
    const secondLevelFields = subscription?.commandSecondLevelFields ?? (subscription?.commandSecondLevelFieldSchema ? ["second-level schema"] : []);
    if (secondLevelFields.length) return { secondLevelFields };
    if (!this.facts.committedProjectionsLive()) return {};
    if (draft.anchor.subscriptionMode === "MERGE" || draft.anchor.subscriptionMode === "DISTINCT") {
      const history = this.facts.historyStatus();
      const gap = history.continuity?.state === "GAPPED" ? history.continuity.latestGap : null;
      if (!draft.anchor.pageEpoch || !draft.anchor.clientId || !draft.anchor.sessionId) return {};
      const baseline = this.facts.nativeItemBaselines.read({ pageEpoch: draft.anchor.pageEpoch, clientId: draft.anchor.clientId, sessionId: draft.anchor.sessionId, subscriptionId: draft.anchor.subscriptionId, item: { name: draft.anchor.itemName, position: draft.anchor.itemPosition } }, history.interval.id, gap ? gap.afterEvidence?.sequence ?? 0 : undefined);
      return baseline ? { baseline } : {};
    }
    if (draft.anchor.subscriptionMode !== "COMMAND" || !draft.document?.key) return {};
    const state = this.facts.commandState().readKey("local-effective", {
      subscriptionId: draft.anchor.subscriptionId,
      item: { name: draft.anchor.itemName, position: draft.anchor.itemPosition },
      key: draft.document.key
    });
    const row = state.row;
    const history = this.facts.historyStatus();
    const gap = history.continuity?.state === "GAPPED" ? history.continuity.latestGap : null;
    if (row && gap && Object.values(row.fieldProvenance).some(provenance => !provenance.evidence || provenance.evidence.intervalId !== history.interval.id || provenance.evidence.sequence <= (gap.afterEvidence?.sequence ?? 0))) return {};
    return row ? { baseline: { fields: { ...row.fields }, fieldValueStates: { ...row.fieldValueStates }, basis: `Local Effective COMMAND State ${row.latest.eventId}` } } : {};
  }

  scenarioNativeChanges(steps: readonly ScenarioNativeChangeStep[], drafts: ReadonlyMap<string, LocalInjectionDraftState>): ReadonlyMap<string, NativeReviewedChangeFacts> {
    const baselines = new Map<string, NativeChangeContext>();
    const changes = new Map<string, NativeReviewedChangeFacts>();
    for (const step of steps) {
      const draft = scenarioStepDraft(drafts, step.id);
      const document = step.document ?? step.draft?.document ?? draft.document;
      if (!document) continue;
      const identity = JSON.stringify([draft.anchor.subscriptionId, draft.anchor.itemName, draft.anchor.itemPosition, draft.anchor.subscriptionMode === "COMMAND" ? document.key : null]);
      const context = baselines.get(identity) ?? this.nativeChangeContext({ ...draft, document: document as LocalInjectionDocument });
      const execution = applyLocalInjectionDocumentToDraft(draft.baseDraft, document as LocalInjectionDocument, draft.explicitConcreteFields, context);
      const facts: NativeReviewedChangeFacts = Object.freeze({
        context: Object.freeze({ ...context, ...(context.baseline ? { baseline: Object.freeze({ ...context.baseline, fields: Object.freeze({ ...context.baseline.fields }), fieldValueStates: Object.freeze({ ...context.baseline.fieldValueStates }) }) } : {}) }),
        fields: Object.freeze({ ...execution.fields }), fieldValueStates: Object.freeze({ ...execution.fieldValueStates }), changedFields: Object.freeze({ ...execution.changedFields }),
        semantics: Object.freeze({ ...execution.changeSemantics!, limitations: Object.freeze([...execution.changeSemantics!.limitations]) })
      });
      changes.set(step.id, facts);
      if (!execution.changeSemantics?.refusal) baselines.set(identity, document.command === "DELETE" ? {} : { baseline: nativeBaselineFromDraft(execution, `preceding Scenario Step ${step.id}`) });
    }
    return changes;
  }

  fingerprint(draft: LocalInjectionDraftState, changeContext?: NativeChangeContext): string {
    const target = this.validateTarget(draft.anchor).map(({ code }) => code);
    const context = changeContext ?? this.nativeChangeContext(draft);
    const effective = draft.document ? applyLocalInjectionDocumentToDraft(draft.baseDraft, draft.document, draft.explicitConcreteFields, context) : null;
    const needsBaseline = effective?.changeSemantics?.policy === "native-mode" && !(draft.anchor.subscriptionMode === "COMMAND" && ["ADD", "DELETE"].includes(draft.document?.command ?? ""));
    return hashLocalInjectionValue({
      anchor: draft.anchor,
      document: draft.document,
      target,
      changeRefusal: effective?.changeSemantics?.refusal ?? null,
      ...(needsBaseline ? { baseline: context.baseline ? { fields: context.baseline.fields, fieldValueStates: context.baseline.fieldValueStates } : null } : {}),
      deliveryIdentity: this.deliveryIdentity(draft.anchor)
    });
  }

  /** The delivery identity a reviewed fingerprint binds; Scenario review compares it too. */
  deliveryIdentity(
    anchor: WorkbenchLocalInjectionAnchor
  ): unknown {
    const state = this.facts.topology();
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
      pageEpoch: this.facts.pageEpoch(),
      captureStatus: this.facts.captureStatus(),
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
}
