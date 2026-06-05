import { describe, expect, it } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { normalizeCaptureMessage } from "../src/core/event-normalizer";

describe("event normalizer", () => {
  it("preserves COMMAND command and key values", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        client: { id: "client-1" },
        subscription: { id: "subscription-1", mode: "COMMAND" },
        listener: { id: "listener-1" },
        item: { name: "scenario.add-update-delete", position: 1 },
        update: {
          isSnapshot: false,
          fields: {
            command: "ADD",
            key: "gamma",
            name: "Gamma",
            qty: "3"
          },
          changedFields: {
            command: "ADD",
            key: "gamma"
          }
        }
      }),
      "event-42"
    );

    expect(event.id).toBe("event-42");
    expect(event.direction).toBe("inbound");
    expect(event.source).toBe("server");
    expect(event.synthetic).toBe(false);
    expect(event.update?.command).toBe("ADD");
    expect(event.update?.key).toBe("gamma");
  });

  it("keeps current fields and changed fields separate", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        update: {
          fields: {
            command: "UPDATE",
            key: "alpha",
            name: "Alpha",
            qty: "12",
            status: "open"
          },
          changedFields: {
            qty: "12",
            status: "open"
          }
        }
      })
    );

    expect(event.update?.fields).toEqual({
      command: "UPDATE",
      key: "alpha",
      name: "Alpha",
      qty: "12",
      status: "open"
    });
    expect(event.update?.changedFields).toEqual({
      qty: "12",
      status: "open"
    });
  });

  it("preserves snapshot status at update time", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          isSnapshot: true,
          fields: {
            command: "ADD",
            key: "alpha"
          }
        }
      })
    );

    expect(event.item?.name).toBe("scenario.snapshot-basic");
    expect(event.update?.isSnapshot).toBe(true);
  });

  it("maps WebSocket TLCP diagnostics to wire capture source", () => {
    const event = normalizeCaptureMessage(
      createCaptureMessage("item-update", {
        subscription: { id: "subscription-1", mode: "COMMAND" },
        item: { name: "scenario.snapshot-basic", position: 1 },
        update: {
          fields: { command: "ADD", key: "alpha" },
          changedFields: { command: "ADD", key: "alpha" }
        },
        raw: { captureSource: "websocket-tlcp" }
      })
    );

    expect(event.source).toBe("server");
    expect(event.captureSource).toBe("wire");
  });
});
