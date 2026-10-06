import { SCENARIO_MAX_ACCOUNTED_BYTES, SCENARIO_MAX_STEPS } from "../../core/local-injection-scenario";
import { SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT, SCENARIO_MAX_ASSERTION_ACTIVE_MS } from "../../core/local-injection-scenario-checkpoint";
import type { ReinjectionDraft } from "../../core/reinjection-draft";
import type { NativeReviewedChangeFacts } from "../../core/local-injection-change-semantics";
import { expandJsonStringFields } from "../../core/json-string-fields";
import type { WorkbenchLocalInjectionAnchor } from "./workbench-runtime";

export type AgentNativeChangePreview = Readonly<{
  changedFields: readonly string[];
  fieldValueStates: NativeReviewedChangeFacts["fieldValueStates"];
  version: NativeReviewedChangeFacts["semantics"]["version"];
  policy: NativeReviewedChangeFacts["semantics"]["policy"];
  basis: string;
  limitations: NativeReviewedChangeFacts["semantics"]["limitations"];
  refusal?: string;
  /** A safe identity for the baseline; its field values are never exposed. */
  baseline: string | null;
}>;

export function agentNativeChangePreview(facts?: NativeReviewedChangeFacts): AgentNativeChangePreview | null {
  return facts ? Object.freeze({ changedFields: Object.freeze(Object.keys(facts.changedFields)),
    fieldValueStates: facts.fieldValueStates, ...facts.semantics, baseline: facts.context.baseline?.basis ?? null }) : null;
}

export function describeAgentDocument(fields: readonly string[], jsonStringFields: readonly string[] | null, mode: string | null) {
  return { format: "expanded-json", requiredProperties: ["command", "key", "isSnapshot", "fields"],
    requiredFields: [...fields], jsonStringFields, mirroredFields: mode === "COMMAND" ? fields.filter(name => name === "command" || name === "key") : [],
    editing: "Preserve every required field. Mirror only declared COMMAND command/key fields; in other modes those names are ordinary fields. Edit encoded JSON fields as objects or arrays; delivery serializes them back to strings." };
}

/** Describe the same exact target and value certainty used by ordinary Draft
 * validation. This is an inspection contract, not a second capability registry. */
export function describeAgentInjectionTarget(anchor: WorkbenchLocalInjectionAnchor, draft: ReinjectionDraft) {
  const mode = anchor.subscriptionMode;
  const supported = ["COMMAND", "MERGE", "DISTINCT"].includes(mode ?? "");
  return {
    version: 1,
    target: { pageEpoch: anchor.pageEpoch, clientId: anchor.clientId, sessionId: anchor.sessionId,
      subscriptionId: anchor.subscriptionId, item: { name: anchor.itemName, position: anchor.itemPosition },
      listenerId: anchor.listenerId, deliveryPath: anchor.captureSource, mode },
    supportedModes: supported ? [mode] : [], sourceFree: anchor.sourceKind === "authored" && supported,
    schema: { basis: "declared-field-list", fields: anchor.fieldSchema, jsonStringFields: expandJsonStringFields(draft.fields).encodedFieldNames },
    documentContract: describeAgentDocument(anchor.fieldSchema, expandJsonStringFields(draft.fields).encodedFieldNames, mode),
    fields: anchor.fieldSchema.map(name => ({ name, valueState: draft.fieldValueStates[name] ?? "unavailable" })),
    changePolicy: { replay: "Preserve an unchanged captured bitmap.", generated: "Derive native mode changes from the exact item/key baseline or preceding reviewed Step.",
      unavailableBaseline: "Refuse generated deltas when concrete baseline values are unavailable.",
      delete: "COMMAND DELETE preserves command/key and clears non-key values." },
    limits: { maxScenarioSteps: SCENARIO_MAX_STEPS, maxScenarioBytes: SCENARIO_MAX_ACCOUNTED_BYTES,
      maxCheckpointAssertions: SCENARIO_MAX_ASSERTIONS_PER_CHECKPOINT, maxFieldAssignments: 32, maxDelayMs: 3600000, maxAssertionActiveMs: SCENARIO_MAX_ASSERTION_ACTIVE_MS },
    assertions: ["prior-injection-outcome", ...(anchor.captureSource === "listener" ? ["listener-count"] : []), "correlated-local-evidence-exists", "local-evidence-field-equals",
      "server-item-update-absent", ...(mode === "COMMAND" ? ["command-key-exists", "command-field-equals"] : []), "diagnostic-observation-exists"],
    delivery: { contactsServer: false, localEvidence: true, appOutcome: "not-observed", rawSupported: false,
      limitations: ["One exact Subscription target; serial fail-stop execution.", "Local delivery does not establish application state.",
        "JSON Patch callbacks and generated second-level COMMAND fidelity are unavailable.",
        ...(anchor.captureSource === "wire" ? ["The official client derives change flags from complete submitted values.", "Wire delivery does not expose listener counts."] : ["Only current instrumented listeners receive this Local Update."])] }
  };
}
