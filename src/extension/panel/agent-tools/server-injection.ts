import { AGENT_RESPONSE_CONTRACT } from "../../../agent/protocol";
import { agentToolResultBytes } from "../../../agent/tool-result";
import { awaitAgentCall, type AgentServiceContext, type AgentToolHandlers } from "./context";
import { cloneCredentialSafe } from "./redaction";

/** Reviewed Server Injection: the agent prepares; only a separate human approval lets it send once. */
export function createServerInjectionHandlers({ runtime, permission, state }: AgentServiceContext): AgentToolHandlers {
  const { requests, documentRequests, serverRequests } = state;
  return {
    prepare_server_injection(args) {
      if (permission() !== "local") throw new Error("ACCESS_REVOKED: Server Injection preparation requires the Panel Session's Local access grant; sending still requires a separate human approval.");
      if (!runtime.prepareServerInjection || !runtime.serverInjection) throw new Error("UNSUPPORTED_CAPABILITY: Reviewed agent Server Injection is unavailable in this panel build.");
      const id = args.requestId;
      const draft = { sourceEventId: null, target: { pageEpoch: args.pageEpoch, clientId: args.clientId, sessionId: args.sessionId }, message: args.message, sequence: args.sequence, delayTimeout: args.delayTimeout, enqueueWhileDisconnected: args.enqueueWhileDisconnected === true };
      const signature = JSON.stringify(draft);
      const previous = serverRequests.get(id);
      if (previous) {
        if (previous.signature !== signature) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies a different Server Injection request.");
        return { requestId: id, token: previous.token, approvalRequired: true, ...(previous.outcome ? { outcome: previous.outcome } : {}), ...(previous.state === "aborted" ? { aborted: true } : {}) };
      }
      if (requests.has(id) || documentRequests.has(id)) throw new Error("REQUEST_ID_CONFLICT: requestId already identifies another operation.");
      if (serverRequests.size >= 128) throw new Error("DOCUMENT_BUDGET_EXCEEDED: The Server Injection receipt ledger is full.");
      runtime.prepareServerInjection(draft, id);
      const token = crypto.randomUUID();
      state.serverPrepared = { requestId: id, token, signature, consumed: false };
      serverRequests.set(id, { signature, token, state: "prepared" });
      const snapshot = runtime.serverInjection();
      const result = { requestId: id, token, approvalRequired: true, draft: snapshot.draft };
      return agentToolResultBytes(result) <= (args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes)
        ? result
        : { requestId: id, token, approvalRequired: true, previewOmitted: "The Client Message preview exceeded maxBytes. Inspect and approve the exact message in Workbench." };
    },
    async execute_server_injection(args, signal) {
      const id = args.requestId;
      const entry = serverRequests.get(id);
      if (!entry || entry.token !== args.token) throw new Error("TARGET_CHANGED: Server Injection token is unavailable or superseded.");
      if (entry.promise) {
        if (entry.state === "complete") return { requestId: id, state: "complete", outcome: entry.outcome };
        return { requestId: id, state: "complete", outcome: await awaitAgentCall(entry.promise, signal) };
      }
      const prepared = state.serverPrepared;
      if (!prepared || prepared.requestId !== id || prepared.token !== args.token) throw new Error("TARGET_CHANGED: Server Injection token is unavailable or superseded.");
      if (prepared.consumed) throw new Error("REQUEST_ID_CONFLICT: This Server Injection request was already consumed.");
      if (!runtime.executeApprovedServerInjection) throw new Error("UNSUPPORTED_CAPABILITY: Server Injection execution is unavailable.");
      const reviewed = runtime.serverInjection?.();
      if (reviewed?.draft?.agentRequestId !== id || reviewed.draft.agentApproved !== true) throw new Error("HUMAN_APPROVAL_REQUIRED: Review and approve this exact Client/Session/message call in Workbench.");
      // The runtime enforces the panel-owned per-message approval fingerprint.
      // Reserve and consume the idempotency receipt before entering runtime code:
      // synchronous throws and lost replies must never make a second send possible.
      prepared.consumed = true;
      entry.state = "pending";
      entry.promise = Promise.resolve().then(() => runtime.executeApprovedServerInjection!(id)).then(
        outcome => { entry.state = "complete"; entry.outcome = cloneCredentialSafe(outcome); return entry.outcome; },
        error => {
          const message = error instanceof Error ? error.message : "The Server Injection result was lost.";
          const provenNotSent = /^(TARGET_CHANGED|HUMAN_APPROVAL_REQUIRED):/.test(message);
          entry.state = "complete";
          entry.outcome = {
            requestId: id,
            ok: false,
            status: provenNotSent ? "stale-target" : "unknown",
            timestamp: Date.now(),
            ...(provenNotSent ? { sentOnNetwork: false } : {}),
            error: provenNotSent ? message : `${message} Do not repeat automatically; recover this receipt before taking action.`
          };
          return entry.outcome;
        }
      );
      return { requestId: id, state: "complete", outcome: await awaitAgentCall(entry.promise, signal) };
    },
    recover_server_injection(args) {
      if (permission() !== "local") throw new Error("ACCESS_REVOKED: Server Injection document recovery requires this Panel Session's Local access grant.");
      const id = args.requestId === undefined ? state.serverPrepared?.requestId : args.requestId;
      if (!id) throw new Error("DOCUMENT_UNKNOWN: No current agent Server Injection document is available.");
      const entry = serverRequests.get(id);
      if (!entry) throw new Error("DOCUMENT_UNKNOWN: This Server Injection request is unknown in the current Panel Session.");
      const current = runtime.serverInjection?.();
      const status = entry.state === "prepared" && current?.draft?.agentRequestId === id && current.draft.agentApproved ? "approved" : entry.state;
      const currentBelongsToRequest = current?.draft?.agentRequestId === id;
      const response = { ...(args.requestId === undefined ? {} : { requestId: id }), token: entry.token, state: status, approvalRequired: true,
        outcome: entry.outcome ?? (currentBelongsToRequest ? current?.draft?.outcome : null) ?? null,
        ...(currentBelongsToRequest ? { document: current!.draft } : { previewOmitted: "This request is no longer the current document; only its bounded receipt remains." }) };
      return agentToolResultBytes(response) <= (args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes)
        ? response
        : { ...(args.requestId === undefined ? {} : { requestId: id }), token: entry.token, state: status, approvalRequired: true, outcome: entry.outcome ?? null,
            previewOmitted: "The current Client Message preview exceeded maxBytes. Inspect the document in Workbench." };
    },
    abort_server_injection(args) {
      const prepared = state.serverPrepared;
      if (!prepared || prepared.token !== args.token || prepared.consumed) throw new Error("TARGET_CHANGED: Only the unchanged unexecuted agent Server Injection can be aborted.");
      if (!runtime.abortServerInjection) throw new Error("UNSUPPORTED_CAPABILITY: This panel cannot abort the Server Injection document.");
      runtime.abortServerInjection(prepared.requestId);
      const entry = serverRequests.get(prepared.requestId);
      if (entry) entry.state = "aborted";
      state.serverPrepared = null;
      return { aborted: true };
    }
  };
}
