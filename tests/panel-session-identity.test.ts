import { describe, expect, it, vi } from "vitest";

import {
  PANEL_REGISTER_MESSAGE,
  PANEL_REINJECT_REQUEST,
  PANEL_REINJECT_RESULT,
  createPanelSessionId,
  isInjectionCorrelation,
  isPanelRegisterMessage,
  isPanelReinjectRequestMessage,
  isPanelReinjectResultMessage,
  isPanelSessionId
} from "../src/bridge/messages";

describe("Panel Session identity bridge boundary", () => {
  it("generates a non-empty cryptographic identity synchronously", () => {
    const first = createPanelSessionId();
    const second = createPanelSessionId();

    expect(first).toMatch(/^panel-[0-9a-f-]{36}$/);
    expect(second).toMatch(/^panel-[0-9a-f-]{36}$/);
    expect(second).not.toBe(first);
  });

  it("fails closed when the platform cryptographic source is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createPanelSessionId()).toThrow(/cryptographically secure random source/i);
    vi.unstubAllGlobals();
  });

  it("accepts only canonical version-four Panel Session identities", () => {
    const valid = "panel-00000000-0000-4000-8000-000000000001";

    expect(isPanelSessionId(valid)).toBe(true);
    for (const candidate of [
      "panel-x",
      "panel-00000000-0000-1000-8000-000000000001",
      "panel-00000000-0000-4000-7000-000000000001",
      "panel-00000000-0000-4000-c000-000000000001",
      "panel-00000000-0000-4000-8000-00000000000G",
      "panel-00000000-0000-4000-8000-000000000001-extra"
    ]) {
      expect(isPanelSessionId(candidate)).toBe(false);
    }
  });

  it("requires the Panel Session identity on registration and injection correlation", () => {
    const panelSessionId = "panel-00000000-0000-4000-8000-000000000001";
    const draft = {
      sourceEventId: "event-1",
      executionTarget: "captured-wire" as const,
      target: { subscriptionId: "subscription-1", listenerId: null },
      item: { name: "item-1", position: 1 },
      command: "UPDATE",
      key: "key-1",
      fields: { value: 1 },
      changedFields: { value: 1 },
      isSnapshot: false,
      provenance: { source: "test" }
    };

    expect(isPanelRegisterMessage({ type: PANEL_REGISTER_MESSAGE, tabId: 1 })).toBe(false);
    expect(
      isPanelRegisterMessage({ type: PANEL_REGISTER_MESSAGE, tabId: 1, panelSessionId })
    ).toBe(true);
    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-1",
        panelSessionId,
        draft
      })
    ).toBe(true);
    expect(
      isPanelReinjectRequestMessage({
        type: PANEL_REINJECT_REQUEST,
        requestId: "request-1",
        draft
      })
    ).toBe(false);
    expect(
      isPanelReinjectResultMessage({
        type: PANEL_REINJECT_RESULT,
        panelSessionId,
        result: {
          requestId: "request-1",
          panelSessionId,
          ok: true,
          status: "success",
          timestamp: 1
        }
      })
    ).toBe(true);
    expect(
      isPanelReinjectResultMessage({
        type: PANEL_REINJECT_RESULT,
        result: {
          requestId: "request-1",
          ok: true,
          status: "success",
          timestamp: 1
        }
      })
    ).toBe(false);
  });

  it("validates one shared Local Injection correlation contract", () => {
    const panelSessionId = "panel-00000000-0000-4000-8000-000000000001";

    expect(isInjectionCorrelation({ panelSessionId, requestId: "request-1" })).toBe(true);
    expect(isInjectionCorrelation({ panelSessionId })).toBe(false);
    expect(isInjectionCorrelation({ panelSessionId: "panel-x", requestId: "request-1" })).toBe(false);
    expect(isInjectionCorrelation({ panelSessionId, requestId: "" })).toBe(false);
    expect(isInjectionCorrelation({ panelSessionId, requestId: 1 })).toBe(false);

    expect(
      isPanelReinjectResultMessage({
        type: PANEL_REINJECT_RESULT,
        panelSessionId,
        result: {
          requestId: "request-1",
          panelSessionId: "panel-00000000-0000-4000-8000-000000000002",
          ok: true,
          status: "success",
          timestamp: 1
        }
      })
    ).toBe(false);
  });
});
