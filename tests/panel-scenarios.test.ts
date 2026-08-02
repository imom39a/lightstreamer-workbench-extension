import { describe, expect, it } from "vitest";

import {
  FIXED_SCENARIO_TIMESTAMP,
  createTopologyPerformanceLogicalUpdate,
  createTopologyPerformanceScenario,
  getExtensionPanelSmokeScenario,
  getPanelScenario
} from "./support/panel-scenarios";

describe("deterministic panel scenarios", () => {
  it("creates repeatable store-listing state with fixed Capture identifiers and timestamps", () => {
    const first = getPanelScenario("command-state");
    const second = getPanelScenario("command-state");

    expect(first).toEqual(second);
    expect(first.initialView).toBe("COMMAND State");
    expect(first.capturedEvents).toHaveLength(6);
    expect(first.capturedEvents.map((event) => event.id)).toEqual([
      "scenario-event-1",
      "scenario-event-2",
      "scenario-event-3",
      "scenario-event-4",
      "scenario-event-5",
      "scenario-event-6"
    ]);
    expect(first.capturedEvents.map((event) => event.timestamp)).toEqual([
      FIXED_SCENARIO_TIMESTAMP + 1,
      FIXED_SCENARIO_TIMESTAMP + 2,
      FIXED_SCENARIO_TIMESTAMP + 3,
      FIXED_SCENARIO_TIMESTAMP + 4,
      FIXED_SCENARIO_TIMESTAMP + 5,
      FIXED_SCENARIO_TIMESTAMP + 6
    ]);
    expect(first.capturedEvents[0]?.client?.id).toBe("scenario-client-1");
    expect(first.capturedEvents[0]?.subscription?.id).toBe("scenario-subscription-1");
  });

  it("describes optional setup actions without binding them to a browser runner", () => {
    const scenario = getPanelScenario("new-command");

    expect(scenario.initialView).toBe("COMMAND State");
    expect(scenario.setupActions).toEqual([
      { type: "select-row", selector: ".command-current-row", text: "alpha" },
      { type: "click", selector: ".new-command-button" },
      {
        type: "set-value",
        selector: ".command-draft-command",
        value: "UPDATE"
      },
      { type: "set-value", selector: ".command-draft-key", value: "alpha" },
      {
        type: "set-value",
        selector: '.command-draft-field-input[data-field-name="qty"]',
        value: "42"
      },
      {
        type: "set-value",
        selector: '.command-draft-field-input[data-field-name="status"]',
        value: "review"
      },
      {
        type: "scroll-into-view",
        containerSelector: ".command-detail-pane",
        targetSelector: ".new-command-editor",
        offset: 72
      }
    ]);
  });

  it("provides an empty shipped-extension smoke scenario for CDP browser verification", () => {
    expect(getExtensionPanelSmokeScenario()).toEqual({
      id: "extension-panel-smoke",
      status: "idle",
      initialView: "Timeline",
      capturedEvents: [],
      setupActions: []
    });
  });

  it("builds the existing high-volume Topology workload from deterministic shared inputs", () => {
    const config = {
      subscriptionCount: 2,
      itemsPerSubscription: 3,
      listenersPerSubscription: 2
    };

    const scenario = createTopologyPerformanceScenario(config);
    const update = createTopologyPerformanceLogicalUpdate(config, 5);

    expect(scenario.initialView).toBe("Topology");
    expect(scenario.capturedEvents).toHaveLength(8);
    expect(scenario.capturedEvents.map((event) => event.id)).toEqual([
      "performance-client-created",
      "performance-client-status",
      "performance-subscription-1-started",
      "performance-subscription-1-listener-1",
      "performance-subscription-1-listener-2",
      "performance-subscription-2-started",
      "performance-subscription-2-listener-1",
      "performance-subscription-2-listener-2"
    ]);
    expect(update).toHaveLength(2);
    expect(update.map((event) => event.logicalEventId)).toEqual([
      "performance-logical-update-5",
      "performance-logical-update-5"
    ]);
    expect(update.map((event) => event.id)).toEqual([
      "performance-logical-update-5-listener-1",
      "performance-logical-update-5-listener-2"
    ]);
  });
});
