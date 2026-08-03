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
): PanelScenarioRuntime {
  panel.setStatus(scenario.status);
  if (scenario.captureMessages) {
    for (const message of scenario.captureMessages) {
      panel.appendCaptureMessage(message);
    }
  } else {
    for (const event of scenario.capturedEvents) {
      store.append(event);
    }
  }
  for (const frame of scenario.topologySyncFrames ?? []) {
    panel.applyTopologySyncFrame(frame);
  }
  selectView(root, scenario.initialView);
  for (const action of scenario.setupActions) {
    applySetupAction(root, action);
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let postRenderTimer: ReturnType<typeof setTimeout> | null = null;
  let nextIndex = 0;
  let resolveComplete: () => void = () => undefined;
  const streamComplete = new Promise<void>((resolve) => {
    resolveComplete = resolve;
  });
  const stream = scenario.stream;
  if (scenario.postRenderSetupActions && scenario.postRenderSetupActions.length > 0) {
    postRenderTimer = setTimeout(() => {
      postRenderTimer = null;
      if (stopped) {
        return;
      }
      for (const action of scenario.postRenderSetupActions ?? []) {
        applySetupAction(root, action);
      }
    }, 0);
  }
  if (!stream || stream.messages.length === 0) {
    resolveComplete();
  } else {
    const appendNext = (): void => {
      if (stopped) {
        resolveComplete();
        return;
      }
      const message = stream.messages[nextIndex++];
      if (!message) {
        resolveComplete();
        return;
      }
      panel.appendCaptureMessage(message);
      root.ownerDocument.documentElement.dataset.streamSequence = String(nextIndex);
      timer = setTimeout(appendNext, stream.intervalMs);
    };
    timer = setTimeout(appendNext, stream.initialDelayMs ?? stream.intervalMs);
  }

  return {
    streamComplete,
    stop(): void {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (postRenderTimer) {
        clearTimeout(postRenderTimer);
        postRenderTimer = null;
      }
      resolveComplete();
    }
  };
}

export type PanelScenarioRuntime = {
  streamComplete: Promise<void>;
  stop(): void;
};

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
