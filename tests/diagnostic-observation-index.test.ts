import { describe, expect, it } from "vitest";

import { createMemoryDiagnosticObservationJournal } from "../src/core/diagnostic-observation";
import {
  createDiagnosticObservationIndex,
  diagnosticAffectedFacetValue,
  diagnosticCodeFacetValue,
  diagnosticSeverityFacetValue
} from "../src/core/diagnostic-observation-index";

describe("Diagnostic Observation Filter index", () => {
  it("indexes stable code, severity, and every affected identity component as multi-valued facets", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "diagnostic-index" });
    const observation = await journal.observe({
      code: "ls.client.server-error",
      severity: "warning",
      lifecycle: { kind: "occurrence", occurrenceId: "server-error-1" },
      affected: { kind: "session", pageId: "page-1", clientId: "client-1", sessionId: "S-1" },
      observedAt: 10,
      observed: "ClientListener reported server error code 41.",
      limitation: "The callback does not expose server state.",
      consequence: "The Session may require inspection.",
      route: { kind: "inspect-affected" }
    });
    const index = createDiagnosticObservationIndex([observation]);
    const record = index.records[0]!;

    expect(record.facets.diagnosticCode).toEqual([diagnosticCodeFacetValue("ls.client.server-error")]);
    expect(record.facets.diagnosticSeverity).toEqual([diagnosticSeverityFacetValue("warning")]);
    expect(record.facets.diagnosticAffected).toEqual([
      diagnosticAffectedFacetValue("page", "page-1", "Page page-1"),
      diagnosticAffectedFacetValue("client", "page-1/client-1", "Client client-1"),
      diagnosticAffectedFacetValue("session", "page-1/client-1/S-1", "Session S-1")
    ]);
    expect(index.query({
      diagnosticCode: [diagnosticCodeFacetValue("ls.client.server-error")],
      diagnosticSeverity: [diagnosticSeverityFacetValue("warning")],
      diagnosticAffected: [diagnosticAffectedFacetValue("client", "page-1/client-1", "copy does not identify")]
    })).toEqual([record]);
  });

  it("deduplicates multi-valued postings and discovers stable values independent of display copy", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "diagnostic-discovery" });
    const observations = await Promise.all(["first copy", "localized copy"].map((observed, index) => journal.observe({
      code: "ls.client.server-keepalive",
      severity: "information",
      lifecycle: { kind: "occurrence", occurrenceId: `keepalive-${index + 1}` },
      affected: { kind: "client", pageId: "page-1", clientId: "client-1" },
      observedAt: index + 1,
      observed,
      limitation: "Keepalive is not health.",
      consequence: "No global conclusion follows.",
      route: { kind: "inspect-affected" }
    })));
    const index = createDiagnosticObservationIndex(observations);

    expect(index.discover("diagnosticCode")).toEqual([
      expect.objectContaining({ value: diagnosticCodeFacetValue("ls.client.server-keepalive"), count: 2 })
    ]);
    expect(index.query({ diagnosticCode: [diagnosticCodeFacetValue("ls.client.server-error")] })).toEqual([]);
    expect(index.query({ diagnosticAffected: [diagnosticAffectedFacetValue("page", "page-1", "Page page-1")] })).toHaveLength(2);
  });

  it("applies include/exclude with OR within a facet and AND across facets", async () => {
    const journal = createMemoryDiagnosticObservationJournal({ panelSessionId: "diagnostic-filter-semantics" });
    const observations = await Promise.all([
      ["ls.client.server-error", "warning", "client-1", "error"],
      ["ls.client.server-keepalive", "information", "client-1", "keepalive"],
      ["ls.subscription.lost-updates", "warning", "client-2", "loss"]
    ].map(([code, severity, clientId, occurrenceId], index) => journal.observe({
      code: code!,
      severity: severity as "warning" | "information",
      lifecycle: { kind: "occurrence", occurrenceId: occurrenceId! },
      affected: { kind: "client", pageId: "page-1", clientId: clientId! },
      observedAt: index + 1,
      observed: "Observed fact.",
      limitation: "Bounded limitation.",
      consequence: "Bounded consequence.",
      route: { kind: "inspect-affected" }
    })));
    const index = createDiagnosticObservationIndex(observations);

    expect(index.query({
      diagnosticCode: {
        include: [diagnosticCodeFacetValue("ls.client.server-error"), diagnosticCodeFacetValue("ls.client.server-keepalive")],
        exclude: []
      },
      diagnosticSeverity: {
        include: [diagnosticSeverityFacetValue("warning")],
        exclude: []
      },
      diagnosticAffected: {
        include: [diagnosticAffectedFacetValue("page", "page-1", "Page page-1")],
        exclude: [diagnosticAffectedFacetValue("client", "page-1/client-2", "Client client-2")]
      }
    }).map(({ observation }) => observation.code)).toEqual(["ls.client.server-error"]);
  });
});
