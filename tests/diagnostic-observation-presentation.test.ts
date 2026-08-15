import { describe, expect, it } from "vitest";

import { presentDiagnosticObservation } from "../src/core/diagnostic-observation-presentation";

describe("Diagnostic Observation presentation adapter", () => {
  it("keeps stable semantics and routing independent of React and footer placement", () => {
    expect(presentDiagnosticObservation({
      code: "ls.client.server-error",
      severity: "warning",
      lifecycle: { kind: "occurrence", occurrenceId: "error-1" },
      affected: { kind: "session", pageId: "page-1", clientId: "client-1", sessionId: "S-1" },
      observedAt: 1,
      observed: "ClientListener reported server error code -7.",
      limitation: "Non-positive codes can be application-specific.",
      consequence: "The callback does not prove the complete server-side cause.",
      route: { kind: "inspect-evidence", evidence: { intervalId: "interval-1", sequence: 4, eventId: "error-1" } },
      originalCode: -7,
      safeMessage: "Application denied the operation"
    })).toEqual({
      id: "error-1",
      code: "ls.client.server-error",
      severity: "Warning",
      title: "Server error -7",
      affected: "Session S-1",
      observed: "ClientListener reported server error code -7. Message: Application denied the operation",
      limitation: "Non-positive codes can be application-specific.",
      consequence: "The callback does not prove the complete server-side cause.",
      route: { kind: "inspect-evidence", eventId: "error-1", label: "Inspect supporting Evidence" }
    });
  });
});
