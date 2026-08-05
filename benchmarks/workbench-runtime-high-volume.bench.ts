import { afterAll, beforeAll, bench } from "vitest";

import { createCaptureMessage } from "../src/bridge/messages";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history";
import { type LightstreamerEventEnvelope } from "../src/core/event-envelope";
import {
  createWorkbenchRuntime,
  type WorkbenchRuntime
} from "../src/extension/panel/workbench-runtime";

const benchmarkOptions = {
  iterations: 10,
  time: 0,
  warmupIterations: 2,
  warmupTime: 0
};

let history: EventHistory;
let runtime: WorkbenchRuntime;
let mutationIndex = 3_001;

beforeAll(() => {
  history = createInMemoryEventHistory();
  for (let index = 1; index <= 3_001; index += 1) history.append(commandEvent(index));
  runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
});

afterAll(() => {
  runtime.dispose();
  void history.close();
});

bench(
  "filter a 3,001-event Evidence history",
  () => {
    runtime.dispatch({ type: "set-filters", filters: { query: "hot-key" } });
    runtime.getSnapshot();
    runtime.dispatch({ type: "clear-filters" });
  },
  benchmarkOptions
);

bench(
  "find within a 3,001-event Evidence window",
  () => {
    runtime.dispatch({ type: "set-find", value: "hot-key" });
    runtime.getSnapshot();
    runtime.dispatch({ type: "set-find", value: "" });
  },
  benchmarkOptions
);

bench(
  "append and project one COMMAND update",
  () => {
    mutationIndex += 1;
    runtime.dispatch({
      type: "ingest-capture-message",
      message: createCaptureMessage("item-update", commandPayload(mutationIndex))
    });
    runtime.getSnapshot().commandProjections.localEffective.rows.length;
  },
  benchmarkOptions
);

function commandEvent(index: number): LightstreamerEventEnvelope {
  const command = index === 1 ? "ADD" : "UPDATE";
  return {
    id: `benchmark-${index}`,
    timestamp: 1_700_000_000_000 + index,
    direction: "inbound",
    source: "server",
    captureSource: "listener",
    synthetic: false,
    kind: "item-update",
    ...commandPayload(index),
    raw: { benchmark: true }
  };
}
function commandPayload(index: number) {
  const command = index === 1 ? "ADD" : "UPDATE";
  return {
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
    }
  };
}
