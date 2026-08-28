import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory } from "../src/core/event-history-authoritative";
import { WorkbenchPanel } from "../src/extension/panel/react/workbench-panel";
import { createWorkbenchRuntime, type WorkbenchRuntime } from "../src/extension/panel/workbench-runtime";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const origin = 1_800_000_000_000;
function update(id: string, offset: number, local = false, snapshot = false): LightstreamerEventEnvelope {
  return {
    id, timestamp: origin + offset, direction: "inbound", source: local ? "synthetic" : "server", synthetic: local,
    captureSource: "listener", kind: "item-update", logicalEventId: `logical-${id}`,
    client: { id: "client-1", sessionId: "session-1" }, subscription: { id: "subscription-1", mode: "COMMAND" },
    item: { name: "orders", position: 1 }, listener: { id: "listener-1" },
    update: { key: "order-1", command: snapshot ? "ADD" : "UPDATE", isSnapshot: snapshot, fields: { value: id } }
  };
}

let root: Root | undefined;
let runtime: WorkbenchRuntime | undefined;
async function settle(): Promise<void> {
  await act(async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); });
}
async function mount(events = [update("first", 0, false, true), update("snapshot", 100, false, true), update("local", 450, true), update("last", 999)]): Promise<WorkbenchRuntime> {
  document.body.innerHTML = '<main id="app"></main>';
  const history = createInMemoryEventHistory();
  for (const event of events) await history.offer(event).settled;
  runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
  await settle();
  root = createRoot(document.querySelector("#app")!);
  await act(async () => root!.render(createElement(WorkbenchPanel, { runtime: runtime! })));
  await settle();
  return runtime;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  runtime?.dispose();
  root = undefined;
  runtime = undefined;
});

describe("integrated Activity timeline in the production Workbench panel", () => {
  it("keeps range actions unavailable until the accepted Evidence timeline is coherent", async () => {
    document.body.innerHTML = '<main id="app"></main>';
    const history = createInMemoryEventHistory();
    await history.offer(update("first", 0, false, true)).settled;
    runtime = createWorkbenchRuntime({ history, captureStatus: "capturing" });
    root = createRoot(document.querySelector("#app")!);
    act(() => root!.render(createElement(WorkbenchPanel, { runtime: runtime! })));
    const timeline = document.querySelector('[aria-label="Activity timeline"]')!;
    const track = timeline.querySelector<HTMLElement>('[aria-label="Select Activity time range"]')!;
    expect(timeline.getAttribute("aria-busy")).toBe("true");
    expect(track.getAttribute("aria-disabled")).toBe("true");
    expect(timeline.textContent).toContain("synchronizing");
    expect(timeline.querySelector('[aria-label="Snapshot bursts"]')).toBeNull();
    await act(async () => {
      await vi.waitFor(() => expect(runtime!.getSnapshot().activity?.projection.state).toBe("AVAILABLE"));
    });
    expect(timeline.getAttribute("aria-busy")).toBe("false");
    expect(track.getAttribute("aria-disabled")).toBe("false");
  });

  it("shows SERVER and LOCAL on one compact elapsed timeline above existing Ordered Evidence", async () => {
    const panel = await mount();
    const evidence = document.querySelector('[aria-label="Ordered Evidence"]')!;
    const timeline = evidence.querySelector('[aria-label="Activity timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline!.textContent).toContain("SERVER");
    expect(timeline!.textContent).toContain("LOCAL");
    expect(timeline!.textContent).toContain("since first retained event");
    expect(timeline!.textContent).not.toContain(String(origin));
    expect(evidence.querySelector('[aria-label="Ordered Lightstreamer Evidence"]')).not.toBeNull();
    expect(panel.getSnapshot().activity?.open).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Open Activity")).toBe(true);
  });

  it("applies a keyboard range to existing Evidence without changing selection, Find, or Frozen position", async () => {
    const panel = await mount();
    await act(async () => {
      panel.dispatch({ type: "select-evidence", eventId: "last" });
      panel.dispatch({ type: "freeze-evidence" });
      panel.dispatch({ type: "set-find", value: "order-1" });
    });
    await settle();
    const before = panel.getSnapshot();
    const track = document.querySelector<HTMLElement>('[aria-label="Select Activity time range"]');
    expect(track).not.toBeNull();
    await act(async () => {
      track!.focus();
      track!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    expect(panel.getSnapshot().evidence.investigation.filter.around).toBeNull();
    await act(async () => { track!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    const after = panel.getSnapshot();
    expect(after.evidence.investigation.queryState).toBe("ready");
    expect(after.evidence.investigation.filter.around).toEqual({ intervalId: before.activity!.projection.intervalId, start: origin, end: origin + 990 });
    expect(after.evidence.events.map(event => event.id)).toEqual(["first", "snapshot", "local"]);
    expect(after.evidence.selectedEventId).toBe("last");
    expect(after.evidence.findState.query).toBe(before.evidence.findState.query);
    expect(after.evidence.mode).toBe(before.evidence.mode);
    expect(document.activeElement).toBe(track);
    const heading = document.querySelector('[aria-label="Ordered Evidence"] > .workbench-react__pane-header')!;
    expect(heading.textContent).toContain("Before range 4");
    expect(heading.textContent).toContain("In range 3");
    expect(heading.textContent).not.toContain(String(origin));
  });

  it("filters an exact snapshot burst and restores the prior Filter through existing Back", async () => {
    const panel = await mount([update("first", 0, false, true), update("snapshot", 100, false, true), update("local-snapshot", 100, true, true), update("local", 450, true), update("last", 999)]);
    await act(async () => panel.dispatch({ type: "apply-filter-mutations", expectedRevision: panel.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-text", text: "orders" }] }));
    await settle();
    const before = panel.getSnapshot();
    const burst = document.querySelector<HTMLButtonElement>('button[aria-label="Show snapshot burst +0.0s–+0.101s in Evidence"]');
    expect(Array.from(document.querySelectorAll('[aria-label="Snapshot bursts"] button')).map(button => button.getAttribute("aria-label"))).toContain("Show snapshot burst +0.0s–+0.101s in Evidence");
    await act(async () => burst!.click());
    await settle();
    const after = panel.getSnapshot();
    expect(after.evidence.investigation.filter.text).toBe("orders");
    expect(after.evidence.investigation.filter.criteria.phase!.include.map(value => value.value)).toEqual(["SNAPSHOT"]);
    expect(after.evidence.investigation.filter.criteria.provenance!.include.map(value => value.value)).toEqual(["SERVER"]);
    expect(after.evidence.investigation.filter.around).toEqual({ intervalId: before.activity!.projection.intervalId, start: origin, end: origin + 101 });
    expect(after.evidence.events.map(event => event.id)).toEqual(["first", "snapshot"]);
    expect(document.querySelector('[aria-label="Elapsed time since first retained event"]')!.textContent).toContain("+1.0s");
    const back = Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "Back investigation");
    expect(back).toBeDefined();
    await act(async () => back!.click());
    await settle();
    expect(panel.getSnapshot().evidence.investigation.filter.around).toBeNull();
    expect(panel.getSnapshot().evidence.investigation.filter.text).toBe("orders");
    expect(panel.getSnapshot().evidence.events).toHaveLength(5);
  });

  it("cancels the pending range when the timeline is collapsed, without applying a Filter", async () => {
    const panel = await mount();
    const track = document.querySelector<HTMLElement>('[aria-label="Select Activity time range"]')!;
    await act(async () => { track.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(document.querySelector('[aria-label="Activity timeline"]')!.textContent).toContain("Preview");
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-controls="workbench-activity-timeline-content"]')!;
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[aria-label="Activity timeline"]')!.textContent).not.toContain("Range");
    await act(async () => toggle.click());
    expect(document.querySelector('[aria-label="Activity timeline"]')!.textContent).toContain("All retained time");
    expect(panel.getSnapshot().evidence.investigation.filter.around).toBeNull();
  });
});
