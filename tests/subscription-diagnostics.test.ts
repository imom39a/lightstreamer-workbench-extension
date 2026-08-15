import { describe, expect, it } from "vitest";

import {
  SUBSCRIPTION_DIAGNOSTIC_RULE_CODES,
  SUBSCRIPTION_DIAGNOSTIC_RULE_CLASSIFICATION,
  available,
  lintSubscription,
  reconcileSubscriptionDiagnostics,
  type SubscriptionDiagnosticInput
} from "../src/core/subscription-diagnostics";

const provenance = Object.freeze({ source: "getter" as const, capturedAt: 100 });

function baseInput(): SubscriptionDiagnosticInput {
  return Object.freeze({
    boundary: Object.freeze({ id: "latch-418", observedAt: 100, sequence: 418 }),
    affected: Object.freeze({
      kind: "subscription",
      pageId: "page",
      clientId: "client",
      sessionId: "session",
      subscriptionId: "sub"
    }),
    configuration: Object.freeze({
      mode: available("MERGE", provenance),
      items: Object.freeze({ kind: "list", values: Object.freeze(["item-1"]), provenance }),
      fields: Object.freeze({ kind: "list", values: Object.freeze(["price"]), provenance }),
      dataAdapter: available("QUOTE_ADAPTER", provenance),
      requestedSnapshot: available("yes", provenance),
      requestedBufferSize: available(null, provenance),
      requestedMaxFrequency: available(null, provenance),
      secondLevelFields: Object.freeze({ kind: "unset", provenance }),
      secondLevelDataAdapter: available(null, provenance),
      sessionId: available("session", provenance),
      adapterSet: available("adapter-set", provenance)
    }),
    runtimeState: Object.freeze({
      establishmentEpoch: "epoch-1",
      active: available(false, provenance),
      subscribed: available(false, provenance),
      realMaxFrequency: null,
      errors: Object.freeze([]),
      configurationAttempts: Object.freeze([])
    }),
    coverage: Object.freeze({ kind: "useful" }),
    historical: false,
    relatedSubscriptions: Object.freeze([])
  });
}

describe("Lightstreamer Subscription diagnostic rules", () => {
  it("publishes the complete 18-rule research catalog as normalized journal codes", () => {
    expect(Object.values(SUBSCRIPTION_DIAGNOSTIC_RULE_CODES)).toHaveLength(18);
    expect(new Set(Object.values(SUBSCRIPTION_DIAGNOSTIC_RULE_CODES)).size).toBe(18);
    expect(Object.values(SUBSCRIPTION_DIAGNOSTIC_RULE_CODES).every((code) => /^ls\.sub\.[a-z0-9-]+$/.test(code))).toBe(true);
    expect(Object.values(SUBSCRIPTION_DIAGNOSTIC_RULE_CLASSIFICATION).filter((classification) => classification === "heuristic")).toHaveLength(3);
  });

  it.each([
    {
      name: "explains that RAW has no snapshot Evidence even when the preference getter is unavailable",
      patch: {
        mode: available("RAW", provenance),
        requestedSnapshot: { kind: "unavailable" as const, reason: "late-attachment", provenance }
      },
      code: "ls.sub.raw-snapshot-unavailable"
    },
    {
      name: "marks a retained RAW buffer request as not applicable",
      patch: { mode: available("RAW", provenance), requestedBufferSize: available(10, provenance) },
      code: "ls.sub.buffer-not-applicable-mode"
    },
    {
      name: "marks a retained COMMAND buffer request as not applicable",
      patch: { mode: available("COMMAND", provenance), requestedBufferSize: available("unlimited", provenance) },
      code: "ls.sub.buffer-not-applicable-mode"
    },
    {
      name: "marks a buffer request as not applicable to unfiltered MERGE",
      patch: { requestedBufferSize: available(5, provenance), requestedMaxFrequency: available("unfiltered", provenance) },
      code: "ls.sub.buffer-not-applicable-unfiltered"
    }
  ])("$name", ({ patch, code }) => {
    const input = baseInput();
    const observations = lintSubscription({
      ...input,
      configuration: Object.freeze({ ...input.configuration, ...patch })
    });

    expect(observations.map((observation) => observation.code)).toContain(code);
    expect(observations.every((observation) => Object.isFrozen(observation))).toBe(true);
    expect(JSON.stringify(observations)).not.toContain("liveSubscription");
  });

  it("does not replace unavailable or null buffer/frequency getters with defaults", () => {
    const input = baseInput();
    const unavailable = { kind: "unavailable" as const, reason: "getter-threw", provenance };
    expect(lintSubscription({
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        requestedBufferSize: unavailable,
        requestedMaxFrequency: unavailable
      })
    })).toEqual([]);
  });

  it.each([
    ["MERGE", "unlimited", "warning", "ls.sub.merge-unlimited-buffer-risk"],
    ["DISTINCT", 12, "information", "ls.sub.distinct-bounded-buffer-risk"]
  ] as const)("emits the clearly limited %s buffer heuristic", (mode, buffer, severity, code) => {
    const input = baseInput();
    const [observation] = lintSubscription({
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        mode: available(mode, provenance),
        requestedBufferSize: available(buffer, provenance),
        requestedMaxFrequency: available(2, provenance)
      })
    });
    expect(observation).toMatchObject({ code, severity });
    expect(`${observation.observed} ${observation.limitation}`).toMatch(/can|may|did not observe/);
  });

  it("emits COMMAND-field findings only from exact rejection evidence", () => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 8, eventId: "error-8" };
    const command = {
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        mode: available("COMMAND" as const, provenance),
        fields: Object.freeze({ kind: "schema" as const, name: "COMMAND_SCHEMA", provenance })
      })
    };
    expect(lintSubscription(command).map(({ code }) => code)).not.toContain("ls.sub.command-key-missing");
    expect(lintSubscription({
      ...command,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        errors: Object.freeze([
          { level: "first" as const, code: 15, safeMessage: "key missing", epoch: "epoch-1", evidence },
          { level: "first" as const, code: 16, safeMessage: "command missing", epoch: "epoch-1", evidence: { ...evidence, sequence: 9, eventId: "error-9" } }
        ])
      })
    }).map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ls.sub.command-key-missing",
      "ls.sub.command-command-missing"
    ]));
  });

  it("retains locally rejected RAW snapshot and COMMAND field attempts as occurrence Evidence", () => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 4, eventId: "attempt-4" };
    const observations = lintSubscription({
      ...input,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        configurationAttempts: Object.freeze([
          { kind: "raw-snapshot" as const, occurrenceId: "attempt-raw", evidence },
          { kind: "command-key-missing" as const, occurrenceId: "attempt-key" },
          { kind: "command-command-missing" as const, occurrenceId: "attempt-command" }
        ])
      })
    });
    expect(observations.filter(({ lifecycle }) => lifecycle.kind === "occurrence").map(({ code }) => code)).toEqual([
      "ls.sub.raw-snapshot-unavailable",
      "ls.sub.command-key-missing",
      "ls.sub.command-command-missing"
    ]);
    expect(observations[0]?.route).toEqual({ kind: "inspect-evidence", evidence });
  });

  it("detects exact two-level list conflicts but refuses to interpret schemas or unavailable getters", () => {
    const input = baseInput();
    const explicit = lintSubscription({
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        mode: available("COMMAND", provenance),
        fields: Object.freeze({ kind: "list", values: Object.freeze(["key", "command", "price"]), provenance }),
        secondLevelFields: Object.freeze({ kind: "list", values: Object.freeze(["price", "size"]), provenance })
      })
    });
    expect(explicit).toContainEqual(expect.objectContaining({ code: "ls.sub.2l-field-name-conflict", severity: "warning" }));
    expect(lintSubscription({
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        mode: available("COMMAND", provenance),
        fields: Object.freeze({ kind: "schema", name: "FIRST", provenance }),
        secondLevelFields: Object.freeze({ kind: "schema", name: "SECOND", provenance })
      })
    }).map(({ code }) => code)).not.toContain("ls.sub.2l-field-name-conflict");
  });

  it.each([
    [14, "ls.sub.2l-invalid-item"],
    [17, "ls.sub.2l-data-adapter-refused"],
    [21, "ls.sub.2l-group-schema-refused"],
    [22, "ls.sub.2l-group-schema-refused"],
    [23, "ls.sub.2l-group-schema-refused"],
    [24, "ls.sub.2l-mode-refused"],
    [26, "ls.sub.2l-unfiltered-refused"],
    [27, "ls.sub.2l-unfiltered-refused"],
    [28, "ls.sub.2l-unfiltered-refused"],
    [0, "ls.sub.application-refused"],
    [-7, "ls.sub.application-refused"]
  ])("maps exact second-level callback code %i", (originalCode, ruleCode) => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 12, eventId: `error-${originalCode}` };
    const observations = lintSubscription({
      ...input,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        errors: Object.freeze([{ level: "second" as const, code: originalCode, safeMessage: "server refusal", key: "key-1", epoch: "epoch-1", evidence }])
      })
    });
    expect(observations).toContainEqual(expect.objectContaining({
      code: ruleCode,
      originalCode,
      safeMessage: "server refusal",
      lifecycle: { kind: "occurrence", occurrenceId: `epoch-1:${evidence.eventId}` },
      affected: { kind: "item", pageId: "page", clientId: "client", subscriptionId: "sub", item: "key-1" },
      route: { kind: "inspect-evidence", evidence }
    }));
  });

  it.each([26, 27, 28])("maps exact first-level unfiltered refusal %i without predicting it from configuration", (code) => {
    const input = baseInput();
    const configured = {
      ...input,
      configuration: Object.freeze({ ...input.configuration, requestedMaxFrequency: available("unfiltered" as const, provenance) })
    };
    expect(lintSubscription(configured).map((entry) => entry.code)).not.toContain("ls.sub.unfiltered-refused");
    const evidence = { intervalId: "history", sequence: code, eventId: `error-${code}` };
    expect(lintSubscription({
      ...configured,
      runtimeState: Object.freeze({ ...input.runtimeState, errors: Object.freeze([{ level: "first" as const, code, safeMessage: "refused", epoch: "epoch-1", evidence }]) })
    })).toContainEqual(expect.objectContaining({ code: "ls.sub.unfiltered-refused", originalCode: code }));
  });

  it("keeps state and negotiated frequency within the same establishment epoch", () => {
    const input = baseInput();
    const active = {
      ...input,
      configuration: Object.freeze({ ...input.configuration, requestedMaxFrequency: available("unfiltered" as const, provenance) }),
      runtimeState: Object.freeze({
        ...input.runtimeState,
        active: available(true, provenance),
        subscribed: available(false, provenance),
        realMaxFrequency: Object.freeze({ value: 3, epoch: "epoch-1" })
      })
    };
    expect(lintSubscription(active).map(({ code }) => code)).toEqual(expect.arrayContaining([
      "ls.sub.active-not-established",
      "ls.sub.unfiltered-actually-limited"
    ]));
    expect(lintSubscription({
      ...active,
      runtimeState: Object.freeze({ ...active.runtimeState, realMaxFrequency: Object.freeze({ value: 3, epoch: "epoch-old" }) })
    }).map(({ code }) => code)).not.toContain("ls.sub.unfiltered-actually-limited");
  });

  it("fails closed for unavailable lifecycle getters and stale callback epochs", () => {
    const input = baseInput();
    const unavailable = { kind: "unavailable" as const, reason: "late-attachment", provenance };
    const evidence = { intervalId: "history", sequence: 31, eventId: "old-error" };
    expect(lintSubscription({
      ...input,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        active: unavailable,
        subscribed: unavailable,
        errors: Object.freeze([{ level: "first" as const, code: 26, safeMessage: "old", epoch: "epoch-old", evidence }])
      })
    })).toEqual([]);
  });

  it("preserves unavailable second-level adapter context without inventing DEFAULT", () => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 17, eventId: "adapter-error" };
    const [observation] = lintSubscription({
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        secondLevelDataAdapter: Object.freeze({ kind: "unavailable" as const, reason: "getter-threw", provenance })
      }),
      runtimeState: Object.freeze({
        ...input.runtimeState,
        errors: Object.freeze([{ level: "second" as const, code: 17, safeMessage: "refused", key: "key", epoch: "epoch-1", evidence }])
      })
    });
    expect(observation.limitation).toContain("unavailable: getter-threw");
    expect(observation.limitation).toContain("did not substitute DEFAULT");
  });

  it("bounds safe callback messages and composite lifecycle identities for journal compatibility", () => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 26, eventId: "e".repeat(120) };
    const [observation] = lintSubscription({
      ...input,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        establishmentEpoch: "x".repeat(120),
        errors: Object.freeze([{ level: "first" as const, code: 26, safeMessage: "m".repeat(400), epoch: "x".repeat(120), evidence }])
      })
    });
    expect(observation.lifecycle).toMatchObject({ kind: "occurrence" });
    if (observation.lifecycle.kind === "occurrence") expect([...observation.lifecycle.occurrenceId]).toHaveLength(128);
    expect([...(observation.safeMessage ?? "")]).toHaveLength(256);
  });

  it("emits overlap only for two current active non-RAW literal-item latches with resolved matching identities", () => {
    const input = baseInput();
    const current = {
      ...input,
      configuration: Object.freeze({
        ...input.configuration,
        sessionId: available("session", provenance),
        adapterSet: available("adapter-set", provenance),
        dataAdapter: available("QUOTE_ADAPTER", provenance)
      }),
      runtimeState: Object.freeze({ ...input.runtimeState, active: available(true, provenance) }),
      relatedSubscriptions: Object.freeze([{
        affected: Object.freeze({ kind: "subscription" as const, pageId: "page", clientId: "client", sessionId: "session", subscriptionId: "peer" }),
        current: true,
        sessionId: available("session", provenance),
        adapterSet: available("adapter-set", provenance),
        dataAdapter: available("QUOTE_ADAPTER", provenance),
        mode: available("DISTINCT" as const, provenance),
        items: Object.freeze({ kind: "list" as const, values: Object.freeze(["item-1"]), provenance }),
        active: available(true, provenance),
        establishmentEpoch: "peer-epoch"
      }])
    };
    expect(lintSubscription(current)).toContainEqual(expect.objectContaining({ code: "ls.sub.nonraw-mode-overlap", severity: "information" }));
    expect(lintSubscription({ ...current, historical: true }).map(({ code }) => code)).not.toContain("ls.sub.nonraw-mode-overlap");
  });

  it("deduplicates identical callback Evidence and proposes resolution only for disappeared conditions", () => {
    const input = baseInput();
    const evidence = { intervalId: "history", sequence: 26, eventId: "same-callback" };
    const withError = {
      ...input,
      runtimeState: Object.freeze({
        ...input.runtimeState,
        active: available(true, provenance),
        subscribed: available(false, provenance),
        errors: Object.freeze([
          { level: "first" as const, code: 26, safeMessage: "refused", epoch: "epoch-1", evidence },
          { level: "first" as const, code: 26, safeMessage: "refused", epoch: "epoch-1", evidence }
        ])
      })
    };
    const previous = lintSubscription(withError);
    expect(previous.filter(({ code }) => code === "ls.sub.unfiltered-refused")).toHaveLength(1);
    const reconciliation = reconcileSubscriptionDiagnostics(input, previous);
    expect(reconciliation.observations).toEqual([]);
    expect(reconciliation.resolutions).toEqual([
      expect.objectContaining({ code: "ls.sub.active-not-established", conditionId: "sub:epoch-1" })
    ]);
  });
});
