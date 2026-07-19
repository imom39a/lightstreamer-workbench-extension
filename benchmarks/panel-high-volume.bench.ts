import { afterAll, beforeAll, bench } from "vitest";

import { createEventStore, type InMemoryEventStore } from "../src/core/event-store";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { type PanelController, renderPanel } from "../src/extension/panel/main";

const benchmarkOptions = {
  iterations: 10,
  time: 0,
  warmupIterations: 2,
  warmupTime: 0
};

let panel: PanelController;
let store: InMemoryEventStore;
let mutationIndex = 3_001;

beforeAll(() => {
  document.body.innerHTML = '<main id="app"></main>';
  const root = document.querySelector<HTMLElement>("#app");
  if (!root) {
    throw new Error("missing benchmark root");
  }

  store = createEventStore();
  for (let index = 1; index <= 3_001; index += 1) {
    store.append(commandEvent(index));
  }
  panel = renderPanel(root, undefined, { store });
});

afterAll(() => {
  panel.dispose();
});

bench(
  "render a 3,001-event Timeline window",
  () => {
    clickView("Timeline");
  },
  benchmarkOptions
);

bench(
  "render a 3,001-event COMMAND State window",
  () => {
    clickView("COMMAND State");
  },
  benchmarkOptions
);

bench(
  "repeat an unchanged filtered 3,001-event COMMAND render",
  () => {
    clickView("COMMAND State");
    const search = document.querySelector<HTMLInputElement>(".command-search");
    if (!search) {
      throw new Error("missing COMMAND search input");
    }
    search.value = "hot-key";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  },
  benchmarkOptions
);

bench(
  "append to and filter a 3,001-event COMMAND lifecycle",
  () => {
    mutationIndex += 1;
    store.append(commandEvent(mutationIndex));
    clickView("COMMAND State");
    const search = document.querySelector<HTMLInputElement>(".command-search");
    if (!search) {
      throw new Error("missing COMMAND search input");
    }
    search.value = "hot-key";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  },
  benchmarkOptions
);

function clickView(label: string): void {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".view-selector button")
  ).find((candidate) => candidate.textContent === label);
  if (!button) {
    throw new Error(`missing ${label} view button`);
  }
  button.click();
}

function commandEvent(index: number): LightstreamerEventEnvelope {
  const command = index === 1 ? "ADD" : "UPDATE";
  return {
    id: `benchmark-${index}`,
    timestamp: 1_700_000_000_000 + index,
    direction: "inbound",
    source: "server",
    synthetic: false,
    kind: "item-update",
    client: { id: "benchmark-client" },
    subscription: { id: "benchmark-command", mode: "COMMAND" },
    listener: { id: "benchmark-listener" },
    item: { name: "benchmark-item", position: 1 },
    update: {
      isSnapshot: index === 1,
      command,
      key: "hot-key",
      fields: { command, key: "hot-key", value: index },
      changedFields: { value: index }
    },
    raw: { benchmark: true }
  };
}
