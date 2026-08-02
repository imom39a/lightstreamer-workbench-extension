import { type EventStore } from "../../src/core/event-store";
import { type PanelController } from "../../src/extension/panel/main";
import { type PanelScenario, type PanelScenarioSetupAction } from "./panel-scenarios";

/**
 * Browser-facing adapter for the runner-independent scenario contract.
 * Runners that do not use the DOM can consume PanelScenario directly.
 */
export function applyPanelScenario(
  root: HTMLElement,
  panel: PanelController,
  store: EventStore,
  scenario: PanelScenario
): void {
  panel.setStatus(scenario.status);
  for (const event of scenario.capturedEvents) {
    store.append(event);
  }
  selectView(root, scenario.initialView);
  for (const action of scenario.setupActions) {
    applySetupAction(root, action);
  }
}

function selectView(root: HTMLElement, label: PanelScenario["initialView"]): void {
  const button = Array.from(root.querySelectorAll<HTMLButtonElement>(".view-selector button")).find(
    (candidate) => candidate.textContent === label
  );
  if (!button) {
    throw new Error(`Panel scenario could not select the ${label} view.`);
  }
  button.click();
}

function applySetupAction(root: HTMLElement, action: PanelScenarioSetupAction): void {
  switch (action.type) {
    case "select-row": {
      const row = Array.from(root.querySelectorAll<HTMLElement>(action.selector)).find((candidate) =>
        (candidate.textContent ?? "").includes(action.text)
      );
      if (!(row instanceof HTMLElement)) {
        throw new Error(`Panel scenario could not find ${action.text} in ${action.selector}.`);
      }
      row.click();
      return;
    }
    case "click": {
      const element = root.querySelector<HTMLElement>(action.selector);
      if (!element) {
        throw new Error(`Panel scenario could not find ${action.selector}.`);
      }
      element.click();
      return;
    }
    case "set-value": {
      const element = root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        action.selector
      );
      if (!element) {
        throw new Error(`Panel scenario could not find ${action.selector}.`);
      }
      element.value = action.value;
      element.dispatchEvent(
        new Event(element instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true
        })
      );
      return;
    }
    case "scroll-into-view": {
      const container = root.querySelector<HTMLElement>(action.containerSelector);
      const target = root.querySelector<HTMLElement>(action.targetSelector);
      if (!container || !target) {
        throw new Error(
          `Panel scenario could not align ${action.targetSelector} in ${action.containerSelector}.`
        );
      }
      container.scrollTop = Math.max(0, target.offsetTop - action.offset);
      return;
    }
  }
}
