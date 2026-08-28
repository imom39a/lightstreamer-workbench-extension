import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
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
let mountedHistory: EventHistory | undefined;
async function settle(): Promise<void> {
  await act(async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); });
}
async function mount(events = [update("first", 0, false, true), update("snapshot", 100, false, true), update("local", 450, true), update("last", 999)]): Promise<WorkbenchRuntime> {
  document.body.innerHTML = '<main id="app"></main>';
  const history = createInMemoryEventHistory();
  mountedHistory = history;
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
  mountedHistory = undefined;
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
    const summary = document.querySelector('[aria-label="Activity summary"]')!;
    expect(summary.querySelector('[aria-label="Activity counts"]')).toBeNull();
    expect(summary.textContent).toContain("synchronizing");
    await act(async () => {
      await vi.waitFor(() => expect(runtime!.getSnapshot().activity?.projection.state).toBe("AVAILABLE"));
    });
    expect(timeline.getAttribute("aria-busy")).toBe("false");
    expect(track.getAttribute("aria-disabled")).toBe("false");
    expect(summary.querySelector('[aria-label="Activity counts"]')).not.toBeNull();
  });

  it("does not imply elapsed duration across a clock regression even when the last timestamp catches up", async () => {
    const panel = await mount([update("first", 0), update("forward", 500), update("regressed", 400), update("last", 999)]);
    const timeline = document.querySelector('[aria-label="Activity timeline"]')!;
    const track = timeline.querySelector<HTMLElement>('[aria-label="Select Activity time range"]')!;
    expect(track.getAttribute("aria-disabled")).toBe("true");
    expect(timeline.textContent).toContain("Timeline unavailable across a clock change");
    expect(timeline.querySelector('[aria-label="Captured Activity events"]')).toBeNull();
    expect(timeline.querySelector('[aria-label="Elapsed time since first retained timestamped event"]')!.textContent).toBe("");
    expect(panel.getSnapshot().evidence.events).toHaveLength(4);
  });

  it("shows SERVER and LOCAL on one compact elapsed timeline above existing Ordered Evidence", async () => {
    const panel = await mount();
    const evidence = document.querySelector('[aria-label="Ordered Evidence"]')!;
    const timeline = evidence.querySelector('[aria-label="Activity timeline"]');
    expect(timeline).not.toBeNull();
    expect(timeline!.textContent).toContain("SERVER");
    expect(timeline!.textContent).toContain("LOCAL");
    expect(timeline!.textContent).toContain("since first retained timestamped event");
    expect(timeline!.textContent).not.toContain(String(origin));
    expect(evidence.querySelector('[aria-label="Ordered Lightstreamer Evidence"]')).not.toBeNull();
    expect(panel.getSnapshot().activity?.open).toBe(false);
    expect(Array.from(document.querySelectorAll("button")).some(button => button.textContent === "Open Activity")).toBe(false);
  });

  it("keeps a collapsed scope Activity summary beside selected Evidence with exact source counts", async () => {
    const panel = await mount();
    const context = document.querySelector('[aria-label="Context"]')!;
    const disclosure = context.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]');
    expect(disclosure).not.toBeNull();
    expect(disclosure!.open).toBe(false);
    expect(disclosure!.querySelector('summary')!.textContent).toBe("Activity summary — Inspected page");
    expect(Array.from(context.querySelectorAll('[aria-label="Evidence metadata"] dt')).map(term => term.textContent)).not.toContain("Activity");
    expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent === "Open Scope Context")).toBe(true);
    await act(async () => disclosure!.querySelector('summary')!.click());
    await settle();
    expect(disclosure!.open).toBe(true);
    const counts = disclosure!.querySelector('[aria-label="Activity counts"]')!;
    expect(counts.textContent).toContain("SERVER33");
    expect(counts.textContent).toContain("LOCAL11");
    expect(disclosure!.textContent).toContain("SERVER Snapshot 2 · Live 1");
    await act(async () => panel.dispatch({ type: "select-evidence", eventId: "local" }));
    await settle();
    expect(context.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!.open).toBe(true);
    expect(context.textContent).toContain("local");
    await act(async () => { await mountedHistory!.offer(update("later", 1500)).settled; });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity?.projection.logicalUpdateTotal).toBe(4)); });
    expect(context.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!.open).toBe(true);
    expect(counts.textContent).toContain("SERVER44");
  });

  it("pages every SERVER ranking and narrows Evidence without changing Scope, range, selection, Find or Frozen", async () => {
    const events = Array.from({ length: 6 }, (_, index) => ({ ...update(`server-${index}`, index * 100), subscription: { id: `subscription-${index + 1}`, mode: "COMMAND" as const } }));
    const panel = await mount([...events, { ...update("local-only", 600, true), subscription: { id: "local-only-subscription", mode: "COMMAND" } }]);
    await act(async () => {
      panel.dispatch({ type: "select-evidence", eventId: "local-only" });
      panel.dispatch({ type: "freeze-evidence" });
      panel.dispatch({ type: "set-find", value: "orders" });
      panel.dispatch({ type: "apply-filter-mutations", expectedRevision: panel.getSnapshot().evidence.investigation.filter.revision, operations: [{ type: "set-around", around: { intervalId: panel.getSnapshot().activity!.projection.intervalId, start: origin, end: origin + 601 } }] });
    });
    await settle();
    const before = panel.getSnapshot();
    const disclosure = document.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!;
    await act(async () => disclosure.querySelector('summary')!.click());
    expect(disclosure.textContent).toContain("Filter: Range +0.0s–+0.601s");
    const ranking = disclosure.querySelector('[aria-label="Busiest SERVER Subscriptions"]');
    expect(ranking).not.toBeNull();
    expect(ranking!.querySelectorAll('button[aria-label^="Filter Evidence to"]')).toHaveLength(5);
    expect(ranking!.textContent).not.toContain("local-only-subscription");
    const next = ranking!.querySelector<HTMLButtonElement>('button[aria-label="Next Activity ranking page"]')!;
    await act(async () => next.click());
    expect(ranking!.textContent).toContain("Rows 6–6 of 6");
    const target = ranking!.querySelector<HTMLButtonElement>('button[aria-label="Filter Evidence to subscription-6"]')!;
    await act(async () => target.click());
    await settle();
    const after = panel.getSnapshot();
    expect(after.evidence.events.map(event => event.id)).toEqual(["server-5"]);
    expect(after.activity!.scope).toEqual(before.activity!.scope);
    expect(after.evidence.investigation.filter.around).toEqual(before.evidence.investigation.filter.around);
    expect(after.evidence.selectedEventId).toBe("local-only");
    expect(after.evidence.findState.query).toBe("orders");
    expect(after.evidence.mode).toBe("frozen");
    expect(disclosure.open).toBe(true);
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back investigation"]')!;
    await act(async () => back.click());
    await settle();
    expect(panel.getSnapshot().evidence.events).toHaveLength(7);
    const reset = Array.from(disclosure.querySelectorAll('button')).find(button => button.textContent === "Reset Filter")!;
    await act(async () => reset.click());
    await settle();
    expect(panel.getSnapshot().evidence.investigation.filter.around).toBeNull();
  });

  it("labels bandwidth and frequency as captured distinct values, not the latest or current settings", async () => {
    const events = [10, 5, 10].map((value, index) => {
      const base = update(`bandwidth-${index}`, index * 100);
      return { ...base, client: { ...base.client!, requestedMaxBandwidth: value }, subscription: { ...base.subscription!, realMaxFrequency: "unlimited" } };
    });
    await mount(events);
    const disclosure = document.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!;
    await act(async () => disclosure.querySelector('summary')!.click());
    const facts = disclosure.querySelector('[aria-label="Captured bandwidth and frequency"]');
    expect(facts).not.toBeNull();
    expect(facts!.textContent).toContain("Captured distinct values across matching owners; not current settings.");
    expect(facts!.textContent).toContain("Requested max bandwidth10 · 5");
    expect(facts!.textContent).toContain("Real max frequencyunlimited");
    expect(facts!.textContent).not.toContain(String(origin));
  });

  it("retains a focused ranking identity while passive Capture updates its exact counts", async () => {
    const rankedUpdate = (id: string, subscription: number, offset: number) => ({ ...update(id, offset), subscription: { id: `subscription-${subscription}`, mode: "COMMAND" as const } });
    const panel = await mount(Array.from({ length: 6 }, (_, index) => rankedUpdate(`rank-${index}`, index + 1, index * 100)));
    const summary = document.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!;
    await act(async () => summary.querySelector('summary')!.click());
    const rank = summary.querySelector<HTMLButtonElement>('button[aria-label="Filter Evidence to subscription-5"]')!;
    await act(async () => rank.focus());
    await act(async () => {
      await mountedHistory!.offer(rankedUpdate("rank-6-next", 6, 600)).settled;
      await mountedHistory!.offer(rankedUpdate("rank-5-next", 5, 700)).settled;
    });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity!.projection.logicalUpdateTotal).toBe(8)); });
    expect(document.activeElement).toBe(rank);
    expect(rank.closest('tr')!.textContent).toBe("subscription-522");
  });

  it("does not turn delivery-only Evidence into zero logical updates and qualifies mixed identity counts", async () => {
    const unknown = Array.from({ length: 5 }, (_, index) => ({ ...update(`delivery-${index}`, index * 100, false, index < 2), logicalEventId: undefined }));
    const panel = await mount([...unknown, { ...update("local-delivery", 500, true), logicalEventId: undefined }]);
    const summary = document.querySelector<HTMLDetailsElement>('details[aria-label="Activity summary"]')!;
    await act(async () => summary.querySelector('summary')!.click());
    const counts = summary.querySelector('[aria-label="Activity counts"]')!;
    expect(counts.textContent).toContain("SERVERUnknown5");
    expect(counts.textContent).toContain("LOCALUnknown1");
    expect(summary.textContent).toContain("SERVER Snapshot Unknown · Live Unknown");
    expect(summary.textContent).toContain("5 SERVER Update Deliveries lack logical update identity.");
    expect(summary.textContent).toContain("Ranking unavailable: SERVER logical update identities were not captured.");
    const timeline = document.querySelector('[aria-label="Activity timeline"]')!;
    expect(timeline.textContent).toContain("Captured deliveries; logical update count unknown");
    expect(timeline.textContent).not.toContain("No matching captured updates");
    await act(async () => {
      await mountedHistory!.offer(update("identified-server", 600, false, true)).settled;
      await mountedHistory!.offer(update("identified-local", 700, true)).settled;
    });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity!.projection.updateDeliveryTotal).toBe(6)); });
    expect(counts.textContent).toContain("SERVER1 identified6");
    expect(counts.textContent).toContain("LOCAL1 identified2");
    expect(summary.textContent).toContain("SERVER Snapshot 1 identified · Live Unknown");
    expect(summary.textContent).toContain("Ranked by identified SERVER Logical Updates only.");
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
    expect(document.querySelectorAll('button[aria-label="Show snapshot burst +0.0s–+0.101s in Evidence"]')).toHaveLength(1);
    expect(burst!.textContent).toContain("2 snapshot updates");
    await act(async () => burst!.click());
    await settle();
    const after = panel.getSnapshot();
    expect(after.evidence.investigation.filter.text).toBe("orders");
    expect(after.evidence.investigation.filter.criteria.phase!.include.map(value => value.value)).toEqual(["SNAPSHOT"]);
    expect(after.evidence.investigation.filter.criteria.provenance!.include.map(value => value.value)).toEqual(["SERVER"]);
    expect(after.evidence.investigation.filter.around).toEqual({ intervalId: before.activity!.projection.intervalId, start: origin, end: origin + 101 });
    expect(after.evidence.events.map(event => event.id)).toEqual(["first", "snapshot"]);
    expect(document.querySelector('[aria-label="Elapsed time since first retained timestamped event"]')!.textContent).toContain("+1.0s");
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

  it("cancels an owned pointer range with Escape so a later pointerup cannot apply its Filter", async () => {
    const panel = await mount();
    const before = panel.getSnapshot().evidence.investigation.filter;
    const track = document.querySelector<HTMLElement>('[aria-label="Select Activity time range"]')!;
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 24, width: 100, height: 24, toJSON: () => ({}) });
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
      Object.defineProperty(event, "pointerId", { value: 1 });
      track.dispatchEvent(event);
    };
    await act(async () => pointer("pointerdown", 20));
    await act(async () => pointer("pointermove", 70));
    expect(document.querySelector('[aria-label="Activity timeline"]')!.textContent).toContain("Preview");
    const cancel = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => track.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(document.querySelector('[aria-label="Activity timeline"]')!.textContent).not.toContain("Preview");
    await act(async () => pointer("pointerup", 70));
    await settle();
    expect(panel.getSnapshot().evidence.investigation.filter).toEqual(before);
    const unowned = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    await act(async () => track.dispatchEvent(unowned));
    expect(unowned.defaultPrevented).toBe(false);
  });

  it("retains the focused snapshot caption as passive Capture extends its exact burst", async () => {
    const panel = await mount([update("first", 0, false, true)]);
    const caption = document.querySelector<HTMLButtonElement>('button[aria-label^="Show snapshot burst"]')!;
    await act(async () => caption.focus());
    await act(async () => { await mountedHistory!.offer(update("snapshot-next", 100, false, true)).settled; });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity?.projection.timeline.snapshotBursts[0]?.end).toBe(origin + 101)); });
    expect(document.activeElement).toBe(caption);
    expect(caption.textContent).toContain("2 snapshot updates");
    await act(async () => caption.click());
    await settle();
    expect(panel.getSnapshot().evidence.investigation.filter.around?.end).toBe(origin + 101);
  });

  it("retains a focused band as a later snapshot burst extends during passive Capture", async () => {
    const panel = await mount([update("first", 0, false, true), update("live", 100), update("second", 200, false, true)]);
    const band = document.querySelector<HTMLButtonElement>('button[aria-label="Show snapshot burst +0.2s–+0.201s in Evidence"]')!;
    await act(async () => band.focus());
    await act(async () => { await mountedHistory!.offer(update("snapshot-next", 300, false, true)).settled; });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity?.projection.timeline.snapshotBursts[1]?.end).toBe(origin + 301)); });
    expect(document.activeElement).toBe(band);
    await act(async () => band.click());
    await settle();
    expect(panel.getSnapshot().evidence.investigation.filter.around).toMatchObject({ start: origin + 200, end: origin + 301 });
  });

  it("selects an exact LOCAL update in existing Evidence without opening Context or changing the investigation", async () => {
    const panel = await mount();
    await act(async () => {
      panel.dispatch({ type: "freeze-evidence" });
      panel.dispatch({ type: "set-find", value: "orders" });
    });
    await settle();
    const before = panel.getSnapshot();
    const point = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => /^Select LOCAL Item Update at .*; Evidence local$/.test(button.getAttribute("aria-label") ?? ""));
    expect(point).toBeDefined();
    await act(async () => point!.click());
    await settle();
    const after = panel.getSnapshot();
    expect(after.evidence.selectedEventId).toBe("local");
    expect(after.evidence.events.some(event => event.id === "local")).toBe(true);
    expect(after.contextId).toBe(before.contextId);
    expect(after.evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    expect(after.evidence.findState.query).toBe(before.evidence.findState.query);
    expect(after.evidence.mode).toBe("frozen");
  });

  it("keeps a captured status marker unobscured when no Item Updates match", async () => {
    const base = update("status", 0);
    await mount([{ ...base, kind: "client-status", logicalEventId: undefined, update: undefined, client: { ...base.client!, status: "CONNECTED:WS-STREAMING" } }]);
    const timeline = document.querySelector('[aria-label="Activity timeline"]')!;
    const track = timeline.querySelector('[aria-label="Select Activity time range"]')!;
    expect(track.querySelector('button[aria-label^="Inspect SERVER Client status"]')).not.toBeNull();
    expect(track.querySelector('[role="status"]')).toBeNull();
    expect(timeline.textContent).toContain("No matching captured updates");
  });

  it("offers coincident captured loss and error records individually and inspects the chosen immutable Evidence", async () => {
    const problemBase = update("problem", 500);
    const panel = await mount([
      update("first", 0),
      { ...problemBase, id: "loss", kind: "lost-updates", logicalEventId: undefined, update: { lostUpdates: 7 } },
      { ...problemBase, id: "error", kind: "subscription-error", logicalEventId: undefined, update: undefined, raw: { code: 24, message: "Subscription refused" } },
      update("last", 999)
    ]);
    const before = panel.getSnapshot();
    const group = document.querySelector<HTMLButtonElement>('button[aria-label="2 captured Activity events; choose Evidence"]');
    expect(group).not.toBeNull();
    await act(async () => group!.click());
    const choices = document.querySelector('[role="dialog"][aria-label="Choose captured Activity event"]')!;
    expect(choices).not.toBeNull();
    expect(choices.textContent).toContain("Lost updates");
    expect(choices.textContent).toContain("Subscription error");
    const error = Array.from(choices.querySelectorAll<HTMLButtonElement>("button")).find(button => /^Inspect SERVER Subscription error at .*; Evidence error$/.test(button.getAttribute("aria-label") ?? ""))!;
    await act(async () => error.click());
    await settle();
    expect(panel.getSnapshot().evidence.selectedEventId).toBe("error");
    expect(panel.getSnapshot().contextId).toBe("context:error");
    expect(panel.getSnapshot().evidence.investigation.filter).toEqual(before.evidence.investigation.filter);
    expect(document.querySelector('[aria-label="Context"]')!.textContent).toContain("error");
    expect(document.querySelector('[role="dialog"][aria-label="Choose captured Activity event"]')).toBeNull();
  });

  it("keeps open choices and focus stable through passive Capture, then Escape restores the exact group", async () => {
    const base = update("problem", 500);
    const panel = await mount([update("first", 0), { ...base, id: "loss", kind: "lost-updates", logicalEventId: undefined, update: { lostUpdates: 7 } }, { ...base, id: "error", kind: "subscription-error", logicalEventId: undefined, update: undefined, raw: { code: 24 } }, update("last", 999)]);
    const group = document.querySelector<HTMLButtonElement>('button[aria-label="2 captured Activity events; choose Evidence"]')!;
    await act(async () => { group.focus(); group.click(); });
    const focusedChoice = document.activeElement;
    expect(focusedChoice?.getAttribute("aria-label")).toMatch(/^Inspect SERVER Lost updates/);
    await act(async () => { await mountedHistory!.offer(update("far-later", 100_000, true)).settled; });
    await act(async () => { await vi.waitFor(() => expect(panel.getSnapshot().activity?.projection.timeline.domain?.end).toBe(origin + 100_001)); });
    expect(document.activeElement).toBe(focusedChoice);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("2 captured events");
    await act(async () => focusedChoice!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"][aria-label="Choose captured Activity event"]')).toBeNull();
    expect(document.activeElement).toBe(group);
    expect(panel.getSnapshot().evidence.selectedEventId).toBeNull();
    await act(async () => group.click());
    expect(document.querySelector('[role="dialog"][aria-label="Choose captured Activity event"]')).not.toBeNull();
    await act(async () => panel.dispatch({ type: "freeze-evidence" }));
    await settle();
    expect(document.querySelector('[role="dialog"][aria-label="Choose captured Activity event"]')).toBeNull();
  });
});
