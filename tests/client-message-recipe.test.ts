import { describe, expect, it } from "vitest";

import {
  CLIENT_MESSAGE_RECIPE_LIMITS,
  createClientMessageRecipeContext,
  normalizeClientMessageRecipes
} from "../src/core/client-message-recipe";

describe("Client Message Recipes", () => {
  it("shares only bounded Lightstreamer context with the application adapter", () => {
    const context = createClientMessageRecipeContext({
      id: "event-6",
      timestamp: 1788165706536,
      direction: "inbound",
      source: "server",
      synthetic: false,
      kind: "item-update",
      client: {
        id: "client-1",
        sessionId: "session-1",
        adapterSet: "LSEW_FIXTURE",
        serverAddress: "http://private.example/"
      },
      subscription: {
        id: "subscription-1",
        mode: "COMMAND",
        dataAdapter: null
      },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: {
        command: "ADD",
        key: "beta",
        isSnapshot: true,
        fields: { command: "ADD", key: "beta", qty: "20", version: "1" },
        changedFields: { qty: "20" }
      }
    }, {
      pageEpoch: "page-1",
      clientId: "client-1",
      sessionId: "session-1"
    });

    expect(context).toMatchObject({
      source: { eventId: "event-6", kind: "item-update", direction: "inbound" },
      client: { adapterSet: "LSEW_FIXTURE" },
      item: { name: "scenario.snapshot-basic", position: 1 },
      update: { key: "beta", fields: { qty: "20", version: "1" } }
    });
    expect(context.client).not.toHaveProperty("serverAddress");
  });

  it("normalizes an exact recipe and rejects malformed or oversized adapter output", () => {
    const valid = {
      id: "fixture.update-fields.v1",
      label: "Update fields for beta",
      description: "Uses the selected COMMAND key.",
      message: '{"type":"update-fields"}',
      sequence: "LSEW_FIXTURE_FIELD_UPDATES",
      delayTimeout: null,
      enqueueWhileDisconnected: false
    };

    expect(normalizeClientMessageRecipes([valid])).toMatchObject({
      status: "available",
      items: [valid]
    });
    expect(normalizeClientMessageRecipes([{ ...valid, delayTimeout: -1 }]).status).toBe("error");
    expect(normalizeClientMessageRecipes([valid, valid]).detail).toContain("duplicate");
    expect(normalizeClientMessageRecipes(Array.from(
      { length: CLIENT_MESSAGE_RECIPE_LIMITS.count + 1 },
      (_, index) => ({ ...valid, id: `recipe-${index}` })
    )).status).toBe("error");
  });
});
