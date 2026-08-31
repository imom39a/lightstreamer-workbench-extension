import { describe, expect, it } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { normalizeCaptureMessage } from "../src/core/event-normalizer";
import {
  createAuthoredServerInjectionDraft,
  createServerInjectionDraftFromEvent,
  serverInjectionFingerprint,
  validateServerInjectionDraft
} from "../src/core/server-injection";

describe("Server Injection Draft", () => {
  const source = normalizeCaptureMessage(createCaptureMessage("client-message-sent", {
    client: { id: "client-1", sessionId: "session-1" },
    clientMessage: {
      id: "message-1",
      pageEpoch: "page-1",
      message: "original",
      messageState: "available",
      sequence: "orders",
      delayTimeout: 500,
      enqueueWhileDisconnected: false,
      listenerProvided: true,
      origin: "application",
      outcome: "submitted",
      outcomeAvailability: "pending"
    }
  }), "event-1");

  it("clones an immutable Captured Client Message into an independent Draft", () => {
    const draft = createServerInjectionDraftFromEvent(source)!;
    draft.message = "changed";

    expect(source.clientMessage?.message).toBe("original");
    expect(draft).toMatchObject({
      sourceEventId: "event-1",
      target: { pageEpoch: "page-1", clientId: "client-1", sessionId: "session-1" },
      message: "changed",
      sequence: "orders",
      delayTimeout: 500
    });
  });

  it("authors against captured client/Session context with safe defaults", () => {
    const draft = createAuthoredServerInjectionDraft(source)!;
    expect(draft).toMatchObject({
      sourceEventId: null,
      message: "",
      sequence: "UNORDERED_MESSAGES",
      delayTimeout: null,
      enqueueWhileDisconnected: false
    });
    expect(validateServerInjectionDraft(draft).map(({ code }) => code)).toContain("empty-message");
  });

  it("protects all reviewed sendMessage arguments in the fingerprint", () => {
    const draft = createServerInjectionDraftFromEvent(source)!;
    const fingerprint = serverInjectionFingerprint(draft);
    expect(serverInjectionFingerprint({ ...draft, delayTimeout: 501 })).not.toBe(fingerprint);
    expect(serverInjectionFingerprint({ ...draft, enqueueWhileDisconnected: true })).not.toBe(fingerprint);
    expect(serverInjectionFingerprint({ ...draft, target: { ...draft.target, sessionId: "session-2" } })).not.toBe(fingerprint);
  });
});
