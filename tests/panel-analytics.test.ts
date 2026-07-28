import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCaptureMessage, type ReinjectionResult } from "../src/bridge/messages";
import {
  type AnalyticsConsent,
  type WorkbenchAnalytics,
  type WorkbenchAnalyticsEvent
} from "../src/extension/analytics";
import { renderPanel, type PanelController } from "../src/extension/panel/main";

type MockAnalytics = WorkbenchAnalytics & {
  events: WorkbenchAnalyticsEvent[];
  setConsent: ReturnType<typeof vi.fn>;
  track: ReturnType<typeof vi.fn>;
};

function createMockAnalytics(initialConsent: AnalyticsConsent): MockAnalytics {
  let consent = initialConsent;
  const events: WorkbenchAnalyticsEvent[] = [];
  const setConsent = vi.fn(async (nextConsent: "granted" | "denied") => {
    consent = nextConsent;
    return true;
  });
  const track = vi.fn(async (event: WorkbenchAnalyticsEvent) => {
    events.push(event);
  });

  return {
    available: true,
    events,
    getConsent: () => consent,
    setConsent,
    track
  };
}

async function flushPanel(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 40));
}

function appendSensitiveCommandUpdate(panel: PanelController): void {
  panel.appendCaptureMessage(
    createCaptureMessage("item-update", {
      client: {
        id: "private-client",
        serverAddress: "https://private.lightstreamer.example"
      },
      subscription: {
        id: "private-subscription",
        mode: "COMMAND"
      },
      listener: { id: "private-listener" },
      item: { name: "private-item", position: 1 },
      update: {
        isSnapshot: true,
        fields: {
          command: "ADD",
          key: "private-key",
          account: "customer-secret"
        },
        changedFields: {
          command: "ADD",
          key: "private-key"
        }
      },
      raw: {
        callback: "onItemUpdate",
        error: "private stack detail"
      }
    })
  );
}

function successResult(requestId: string): ReinjectionResult {
  return {
    requestId,
    ok: true,
    status: "success",
    timestamp: 123
  };
}

describe("panel usage analytics controls", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it("shows a prominent disclosure and sends nothing until the user allows it", async () => {
    const analytics = createMockAnalytics("unknown");
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    const panel = renderPanel(root, undefined, { analytics });

    expect(document.querySelector<HTMLElement>(".analytics-disclosure")?.hidden).toBe(false);
    expect(document.querySelector(".analytics-disclosure")?.textContent).toContain(
      "never sends inspected URLs"
    );
    expect(document.querySelector(".analytics-disclosure")?.textContent).toContain(
      "search text"
    );
    expect(analytics.track).not.toHaveBeenCalled();

    document.querySelector<HTMLButtonElement>(".analytics-allow-button")?.click();
    await flushPanel();

    expect(analytics.setConsent).toHaveBeenCalledWith("granted");
    expect(document.querySelector<HTMLElement>(".analytics-disclosure")?.hidden).toBe(true);
    expect(document.querySelector(".analytics-control")?.textContent).toBe(
      "Usage analytics: On"
    );
    expect(analytics.events.map((event) => event.name)).toEqual([
      "analytics_enabled",
      "panel_view"
    ]);

    panel.dispose();
  });

  it("keeps analytics off after decline and reopens the disclosure before opt-in", async () => {
    const analytics = createMockAnalytics("unknown");
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    const panel = renderPanel(root, undefined, { analytics });

    document.querySelector<HTMLButtonElement>(".analytics-decline-button")?.click();
    await flushPanel();

    expect(analytics.setConsent).toHaveBeenCalledWith("denied");
    expect(document.querySelector<HTMLElement>(".analytics-disclosure")?.hidden).toBe(true);
    expect(analytics.events).toEqual([]);

    document.querySelector<HTMLButtonElement>(".analytics-control")?.click();

    expect(document.querySelector<HTMLElement>(".analytics-disclosure")?.hidden).toBe(false);
    expect(analytics.setConsent).toHaveBeenCalledTimes(1);
    panel.dispose();
  });

  it("records only coarse allowlisted actions, never capture payloads or search text", async () => {
    const analytics = createMockAnalytics("granted");
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    const panel = renderPanel(root, undefined, {
      analytics,
      bridge: {
        reinjectDraft: vi.fn(async () => successResult("analytics-replay"))
      }
    });

    appendSensitiveCommandUpdate(panel);
    await flushPanel();

    const search = document.querySelector<HTMLInputElement>(".search-input");
    if (!search) {
      throw new Error("missing timeline search");
    }
    search.value = "customer-secret";
    search.dispatchEvent(new Event("input", { bubbles: true }));

    const commandButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".view-selector button")
    ).find((button) => button.textContent === "COMMAND State");
    const timelineButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".view-selector button")
    ).find((button) => button.textContent === "Timeline");
    commandButton?.click();
    timelineButton?.click();
    await flushPanel();

    document.querySelector<HTMLButtonElement>(".event-row")?.click();
    document.querySelector<HTMLButtonElement>(".reinject-button")?.click();
    await flushPanel();
    panel.dispose();

    expect(analytics.events.map((event) => event.name)).toEqual([
      "panel_view",
      "lightstreamer_detected",
      "search_used",
      "view_changed",
      "view_changed",
      "replay_attempt",
      "replay_result",
      "session_summary"
    ]);
    expect(analytics.events).toContainEqual({
      name: "replay_attempt",
      surface: "timeline",
      target: "listener",
      edited: false
    });
    expect(analytics.events).toContainEqual({
      name: "replay_result",
      surface: "timeline",
      target: "listener",
      edited: false,
      outcome: "success"
    });
    expect(analytics.events.at(-1)).toEqual({
      name: "session_summary",
      eventCountBucket: "1_10",
      commandViewUsed: true,
      searchUsed: true,
      replayUsed: true
    });
    expect(JSON.stringify(analytics.events)).not.toMatch(
      /private|customer-secret|lightstreamer\.example|stack detail/
    );
  });
});
