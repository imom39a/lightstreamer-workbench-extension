import { type EventSubscription } from "./event-envelope";

export type SubscriptionSemanticDiagnosticCode =
  | "command-key-field-missing"
  | "command-command-field-missing"
  | "raw-snapshot-requested"
  | "buffer-mode-unsupported"
  | "second-level-requires-command";

export type SubscriptionSemanticDiagnostic = {
  code: SubscriptionSemanticDiagnosticCode;
  severity: "error" | "warning";
  title: string;
  explanation: string;
  suggestion: string;
};

export function lintSubscriptionSemantics(
  subscription: EventSubscription
): SubscriptionSemanticDiagnostic[] {
  const mode = subscription.mode?.trim().toUpperCase();
  const knownMode = mode && ["COMMAND", "MERGE", "DISTINCT", "RAW"].includes(mode)
    ? mode
    : null;
  const diagnostics: SubscriptionSemanticDiagnostic[] = [];

  if (mode === "COMMAND" && subscription.fields) {
    if (!subscription.fields.includes("key")) {
      diagnostics.push({
        code: "command-key-field-missing",
        severity: "warning",
        title: "COMMAND key field is not visible",
        explanation: "The captured field list does not contain the key field required by COMMAND mode.",
        suggestion: "Verify that the COMMAND schema includes a field named key."
      });
    }
    if (!subscription.fields.includes("command")) {
      diagnostics.push({
        code: "command-command-field-missing",
        severity: "warning",
        title: "COMMAND command field is not visible",
        explanation: "The captured field list does not contain the command field required by COMMAND mode.",
        suggestion: "Verify that the COMMAND schema includes a field named command."
      });
    }
  }

  if (mode === "RAW" && isSnapshotRequested(subscription.requestedSnapshot)) {
    diagnostics.push({
      code: "raw-snapshot-requested",
      severity: "warning",
      title: "RAW subscriptions do not provide snapshots",
      explanation: "This subscription requests a snapshot even though RAW mode does not support snapshots.",
      suggestion: "Set the requested snapshot to false or choose a snapshot-capable mode."
    });
  }

  if (
    hasValue(subscription.requestedBufferSize) &&
    knownMode !== null &&
    ((knownMode !== "MERGE" && knownMode !== "DISTINCT") ||
      isUnfiltered(subscription.requestedMaxFrequency))
  ) {
    diagnostics.push({
      code: "buffer-mode-unsupported",
      severity: "warning",
      title: "Buffer request is not valid for this mode",
      explanation: "The captured subscription requests a buffer outside filtered MERGE or DISTINCT semantics.",
      suggestion: "Use a filtered MERGE or DISTINCT subscription when a buffer is required."
    });
  }

  if (
    knownMode !== null &&
    knownMode !== "COMMAND" &&
    (hasValue(subscription.commandSecondLevelDataAdapter) ||
      (subscription.commandSecondLevelFields?.length ?? 0) > 0 ||
      hasValue(subscription.commandSecondLevelFieldSchema))
  ) {
    diagnostics.push({
      code: "second-level-requires-command",
      severity: "error",
      title: "Second-level configuration requires COMMAND mode",
      explanation: "The subscription exposes second-level COMMAND configuration while using a different mode.",
      suggestion: "Remove the second-level settings or change the subscription mode to COMMAND."
    });
  }

  return diagnostics;
}

function hasValue(value: string | number | null | undefined): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function isSnapshotRequested(value: string | boolean | null | undefined): boolean {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && !["false", "no", "none", "null"].includes(normalized);
}

function isUnfiltered(value: string | number | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "unlimited";
}
