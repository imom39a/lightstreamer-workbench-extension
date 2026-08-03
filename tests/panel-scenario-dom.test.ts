import { beforeEach, describe, expect, it } from "vitest";

import { createEventStore } from "../src/core/event-store";
import { renderPanel } from "../src/extension/panel/main";
import { applyPanelScenario } from "./support/panel-scenario-dom";
import { getPanelScenario } from "./support/panel-scenarios";

describe("panel scenario DOM adapter", () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
  });

  it("applies shared scenario inputs and setup actions through the public panel seam", () => {
    const root = document.querySelector<HTMLElement>("#app");
    if (!root) {
      throw new Error("missing test root");
    }
    const store = createEventStore();
    const panel = renderPanel(root, undefined, {
      store,
      bridge: {
        reinjectDraft: () =>
          Promise.resolve({
            requestId: "scenario-test",
            ok: true,
            status: "success" as const,
            timestamp: 1
          })
      }
    });

    const runtime = applyPanelScenario(root, panel, store, getPanelScenario("new-command"));

    expect(document.querySelector(".command-draft-controls")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>(".command-draft-command")?.value).toBe(
      "UPDATE"
    );
    expect(document.querySelector<HTMLInputElement>(".command-draft-key")?.value).toBe("alpha");
    expect(
      document.querySelector<HTMLInputElement>(
        '.command-draft-field-input[data-field-name="qty"]'
      )?.value
    ).toBe("42");
    runtime.stop();
  });
});
