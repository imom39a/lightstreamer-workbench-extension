import {
  CLIENT_MESSAGE_DEFAULT_SEQUENCE,
  type ServerInjectionDraftPayload
} from "../bridge/messages";
import { type LightstreamerEventEnvelope } from "./event-envelope";

export type ServerInjectionDraft = ServerInjectionDraftPayload;

export type ServerInjectionDiagnostic = Readonly<{
  code: string;
  severity: "error" | "warning";
  message: string;
}>;

export type ServerInjectionExecutionResult = Readonly<{
  requestId: string;
  ok: boolean;
  status:
    | "processed"
    | "denied"
    | "discarded"
    | "aborted"
    | "unknown"
    | "stale-target"
    | "bridge-error";
  timestamp: number;
  error?: string;
  code?: number | null;
  response?: string | null;
  sentOnNetwork?: boolean | null;
}>;

export type ServerInjectionExecutor = Readonly<{
  execute(draft: ServerInjectionDraft): Promise<ServerInjectionExecutionResult>;
}>;

export function createServerInjectionDraftFromEvent(
  event: LightstreamerEventEnvelope
): ServerInjectionDraft | null {
  const message = event.clientMessage;
  const target = targetFromEvent(event);
  if (!message || message.messageState !== "available" || message.message === null || !target) {
    return null;
  }
  return {
    sourceEventId: event.id,
    target,
    message: message.message,
    sequence: message.sequence,
    delayTimeout: message.delayTimeout,
    enqueueWhileDisconnected: message.enqueueWhileDisconnected
  };
}

export function createAuthoredServerInjectionDraft(
  event: LightstreamerEventEnvelope,
  resolvedTarget: ServerInjectionDraft["target"] | null = null
): ServerInjectionDraft | null {
  const target = resolvedTarget ?? targetFromEvent(event);
  if (!target) return null;
  return {
    sourceEventId: null,
    target,
    message: "",
    sequence: CLIENT_MESSAGE_DEFAULT_SEQUENCE,
    delayTimeout: null,
    enqueueWhileDisconnected: false
  };
}

export function validateServerInjectionDraft(
  draft: ServerInjectionDraft
): readonly ServerInjectionDiagnostic[] {
  const diagnostics: ServerInjectionDiagnostic[] = [];
  const error = (code: string, message: string) => diagnostics.push(
    Object.freeze({ code, severity: "error" as const, message })
  );
  if (!draft.target.pageEpoch.trim() || !draft.target.clientId.trim() || !draft.target.sessionId.trim()) {
    error("missing-target", "A captured client and active Session are required.");
  }
  if (draft.message.length === 0) {
    error("empty-message", "Client Message body cannot be empty.");
  }
  if (!draft.sequence.trim()) {
    error("empty-sequence", "Message sequence cannot be empty.");
  }
  if (
    draft.delayTimeout !== null &&
    (!Number.isSafeInteger(draft.delayTimeout) || draft.delayTimeout < 0)
  ) {
    error("invalid-timeout", "Delay timeout must be a non-negative whole number or Server default.");
  }
  if (draft.enqueueWhileDisconnected) {
    diagnostics.push(Object.freeze({
      code: "enqueue-session-risk",
      severity: "warning" as const,
      message: "Enqueue while disconnected can outlive the reviewed connection state; Workbench still refuses a stale Session at submission time."
    }));
  }
  return Object.freeze(diagnostics);
}

export function cloneServerInjectionDraft(
  draft: ServerInjectionDraft
): ServerInjectionDraft {
  return {
    ...draft,
    target: { ...draft.target }
  };
}

export function serverInjectionFingerprint(draft: ServerInjectionDraft): string {
  return JSON.stringify([
    draft.sourceEventId,
    draft.target.pageEpoch,
    draft.target.clientId,
    draft.target.sessionId,
    draft.message,
    draft.sequence,
    draft.delayTimeout,
    draft.enqueueWhileDisconnected
  ]);
}

function targetFromEvent(
  event: LightstreamerEventEnvelope
): ServerInjectionDraft["target"] | null {
  const pageEpoch = event.clientMessage?.pageEpoch ?? event.topology?.pageEpoch;
  const clientId = event.client?.id;
  const sessionId = event.client?.sessionId;
  if (!pageEpoch || !clientId || !sessionId) return null;
  return { pageEpoch, clientId, sessionId };
}
