import { describe, expect, it } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { createEventNormalizer } from "../src/core/event-normalizer";
import { matchesEventFilters } from "../src/core/event-filter";
import { toPersistableEventEnvelope } from "../src/core/event-envelope";
import {
  describeLightstreamerError
} from "../src/core/lightstreamer-diagnostics";
import { type EventErrorScope } from "../src/core/event-envelope";

describe("Lightstreamer diagnostics", () => {
  it("explains a known client routing error while preserving the server message", () => {
    expect(describeLightstreamerError("client", 21, "wrong server instance")).toMatchObject({
      code: "LS-CLIENT-21",
      severity: "warning",
      title: "Session routing mismatch",
      serverMessage: "wrong server instance"
    });
  });

  it("explains known subscription configuration errors", () => {
    expect(describeLightstreamerError("subscription", 15, null)).toMatchObject({
      code: "LS-SUBSCRIPTION-15",
      title: "COMMAND key field is missing",
      explanation: expect.stringContaining("key"),
      suggestion: expect.stringContaining("COMMAND")
    });
  });

  it("keeps Metadata Adapter and unknown codes conservative", () => {
    expect(describeLightstreamerError("second-level", -7, null)).toMatchObject({
      code: "LS-SECOND-LEVEL--7",
      title: "Metadata Adapter refused the request",
      severity: "warning"
    });
    expect(describeLightstreamerError("client", 999, null)).toMatchObject({
      code: "LS-CLIENT-999",
      title: "Unknown Lightstreamer client error",
      explanation: expect.stringContaining("999")
    });
    expect(describeLightstreamerError("subscription", 14, null).title).toBe(
      "Unknown Lightstreamer subscription error"
    );
    expect(describeLightstreamerError("second-level", 15, null).title).toBe(
      "Unknown Lightstreamer second-level subscription error"
    );
  });

  it("normalizes structured errors and makes diagnostics searchable", () => {
    const event = createEventNormalizer().normalize(
      createCaptureMessage(
        "client-error",
        {
          client: { id: "client-1" },
          diagnostic: { scope: "client", code: 61, message: "parse failed" }
        },
        100
      )
    );

    expect(event.error).toEqual({
      scope: "client",
      code: 61,
      message: "parse failed",
      key: undefined
    });
    expect(event.diagnostics).toEqual([
      expect.objectContaining({
        code: "LS-CLIENT-61",
        title: "Server response could not be parsed",
        serverMessage: "parse failed"
      })
    ]);
    expect(matchesEventFilters(event, { query: "LS-CLIENT-61" })).toBe(true);
    expect(matchesEventFilters(event, { query: "parse failed" })).toBe(true);

    const persisted = toPersistableEventEnvelope(event);
    expect(persisted.error).toEqual(event.error);
    expect(persisted.diagnostics).toEqual(event.diagnostics);
    expect("topology" in persisted).toBe(false);
  });

  it.each<EventErrorScope>(["client", "subscription", "second-level"])(
    "uses a stable scope for %s diagnostics",
    (scope) => {
      expect(describeLightstreamerError(scope, 68, null).code).toContain("68");
    }
  );
});
