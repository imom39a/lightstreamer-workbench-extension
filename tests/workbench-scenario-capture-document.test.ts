import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LocalInjectionScenarioDocument } from "../src/extension/panel/react/local-injection-scenario-document";
import { createWorkbenchRuntime, type WorkbenchSnapshot, type WorkbenchScenarioCaptureWorkspace } from "../src/extension/panel/workbench-runtime";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { createAuthoritativeHistory } from "./support/authoritative-history";

vi.mock("../src/extension/panel/react/local-injection-code-editor", () => ({ LocalInjectionCodeEditor: (props: { ariaLabel: string; compareOpen: boolean }) => createElement("textarea", { "aria-label": props.ariaLabel, "data-compare": props.compareOpen }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(async () => { await act(async () => roots.splice(0).forEach(root => root.unmount())); document.body.replaceChildren(); });

async function setup(mode = "COMMAND", command = "ADD") {
  const base = { timestamp: 1, direction: "inbound", source: "server", captureSource: "listener", synthetic: false, client: { id: "client", sessionId: "session", status: "CONNECTED:WS-STREAMING", transport: "WS-STREAMING" }, subscription: { id: "subscription", mode, items: ["orders"], fields: mode === "COMMAND" ? ["command", "key", "qty"] : ["qty"], active: true, subscribed: true } };
  const events: LightstreamerEventEnvelope[] = ["client-created", "client-status", "subscription-created", "subscription-started", "listener-added", "item-update"].map((kind, index) => ({ ...base as Omit<LightstreamerEventEnvelope, "id" | "kind">, id: `event-${index}`, kind: kind as LightstreamerEventEnvelope["kind"], ...(kind === "listener-added" || kind === "item-update" ? { listener: { id: "listener", callbacks: ["onItemUpdate"] } } : {}), ...(kind === "item-update" ? { item: { name: "orders", position: 1 }, update: mode === "COMMAND" ? { command, key: "order-1", isSnapshot: false, fields: { command, key: "order-1", qty: 1 }, changedFields: { command, key: "order-1", qty: 1 } } : { isSnapshot: false, fields: { qty: 1 }, changedFields: { qty: 1 } } } : {}) }));
  const actual = createWorkbenchRuntime({ history: createAuthoritativeHistory({ precommitted: events }), captureStatus: "capturing" });
  await new Promise(resolve => setTimeout(resolve, 0));
  actual.dispatch({ type: "select-evidence", eventId: "event-5" });
  actual.dispatch({ type: "begin-local-injection-from-selection" });
  actual.dispatch({ type: "convert-local-injection-to-scenario" });
  actual.dispatch({ type: "duplicate-scenario-step", stepId: actual.getSnapshot().scenario!.scenario.steps[0]!.id });
  const snapshot = actual.getSnapshot(); actual.dispose();
  const event: LightstreamerEventEnvelope = { ...events[5]!, id: "candidate", update: mode === "COMMAND" ? { ...events[5]!.update!, key: "second", fields: { command, key: "second", qty: 2 } } : { isSnapshot: false, fields: { qty: 2 }, changedFields: { qty: 2 } } };
  const identity = { intervalId: "history", pageId: "page", ownerId: "owner", sequence: 7, eventId: event.id };
  const capture: WorkbenchScenarioCaptureWorkspace = { search: "", commandFilter: "ALL", queryState: "ready", expired: false, newerAcceptedEvidenceCount: 0, remainingStepCapacity: 98, readPoint: null, rows: [{ identity, event, preview: "qty: 2", available: true, reason: null, alreadyUsed: false, selected: true }], selected: [identity], total: 81, pageOffset: 0, pageSize: 40, canShowOlder: true, canShowNewer: false, error: null, feedback: null, adding: false, scrollTop: 0 };
  const dispatch = vi.fn();
  const runtime = { ...actual, dispatch };
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  const render = async (workspace = capture, patch = {}) => { await act(async () => root.render(createElement(LocalInjectionScenarioDocument, { runtime, snapshot: { ...snapshot, scenario: { ...snapshot.scenario!, ...patch, captureWorkspace: workspace } } as WorkbenchSnapshot }))); };
  await render();
  return { host, render, capture, dispatch, identity, snapshot };
}

describe("persistent Scenario capture document", () => {
  it.each(["MERGE", "DISTINCT"])("preserves %s Item Update meaning without invented COMMAND controls", async mode => {
    const { host, snapshot, dispatch, identity } = await setup(mode);
    expect(snapshot.scenario!.scenario.target.mode).toBe(mode);
    expect(snapshot.scenario!.scenario.steps.map(step => step.draft.document!.command)).toEqual([null, null]);
    const queue = host.querySelector('[aria-label="Ordered Scenario Steps"]')!;
    const captions = Array.from(queue.querySelectorAll("li button > span"), caption => caption.textContent);
    expect(captions).toEqual(["Item update orders · event-5 · 0 ms", "Item update orders · event-5 · 0 ms"]);
    expect(queue.textContent).not.toMatch(/\b(?:ADD|UPDATE|DELETE)\b/);
    const pane = host.querySelector('[aria-label="Scenario captured updates"]')!;
    expect(pane.querySelector("li strong")?.textContent).toBe("Item update");
    expect(pane.querySelector('[aria-label="Captured operation"]')).toBeNull();
    await act(async () => pane.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "toggle-scenario-capture", identity });
  });
  it.each(["ADD", "UPDATE", "DELETE"])("keeps the actual COMMAND %s operation in queued captured Steps", async command => {
    const { host, snapshot } = await setup("COMMAND", command);
    expect(snapshot.scenario!.scenario.steps.map(step => step.draft.document!.command)).toEqual([command, command]);
    const queue = host.querySelector('[aria-label="Ordered Scenario Steps"]')!;
    expect(Array.from(queue.querySelectorAll("li button > span"), caption => caption.textContent)).toEqual([
      `${command} order-1 · event-5 · 0 ms`, `${command} order-1 · event-5 · 0 ms`
    ]);
  });

  it("keeps explicit capture selection beside a small queue and one editor", async () => {
    const { host, dispatch, identity } = await setup();
    expect(host.querySelector('[aria-label="Scenario captured updates"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Ordered Scenario Steps"]')?.querySelectorAll("li")).toHaveLength(2);
    expect(host.querySelectorAll('textarea[aria-label$="Local Injection JSON"]')).toHaveLength(1);
    expect(host.textContent).toContain("81 matching");
    const add = host.querySelector<HTMLButtonElement>('[aria-label="Add selected updates"]')!;
    expect(add.textContent).toBe("Add 1 update");
    await act(async () => add.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "add-scenario-captures" });
    await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "toggle-scenario-capture", identity });
  });

  it("retains the Evidence pane and scroll node while focus changes and reports refusal in place", async () => {
    const { host, render, capture, snapshot } = await setup();
    const pane = host.querySelector('[aria-label="Scenario captured updates"]');
    const scroll = host.querySelector(".workbench-react__scenario-capture-scroll");
    await render({ ...capture, error: "Selected source expired. Refresh captures." } as typeof capture, { focusedMemberId: snapshot.scenario!.scenario.steps[0]!.id });
    expect(host.querySelector('[aria-label="Scenario captured updates"]')).toBe(pane);
    expect(host.querySelector(".workbench-react__scenario-capture-scroll")).toBe(scroll);
    expect(pane?.textContent).toContain("Selected source expired");
    expect(host.querySelectorAll('textarea[aria-label$="Local Injection JSON"]')).toHaveLength(1);
  });

  it("explains used captures and loading, with explicit recovery and full-result pagination", async () => {
    const { host, render, capture, dispatch } = await setup();
    await render({ ...capture, rows: [{ ...capture.rows[0]!, alreadyUsed: true, available: false, selected: false }] });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
    expect(host.textContent).toContain("Already used · Duplicate Step to reuse");
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Show older captured updates"]')!.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "show-older-scenario-captures" });
    await render({ ...capture, queryState: "loading", rows: [] });
    expect(host.textContent).toContain("Loading captured updates");
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Add selected updates"]')!.disabled).toBe(true);
  });
  it("keeps batch success and reset recovery visible, without an overlay", async () => {
    const { host, render, capture, dispatch } = await setup();
    await render({ ...capture, search: "second", commandFilter: "ADD", feedback: "Added 1 captured update as Step 3.", selected: [], rows: [{ ...capture.rows[0]!, selected: false, alreadyUsed: true }] });
    const pane = host.querySelector('[aria-label="Scenario captured updates"]')!;
    expect(pane.querySelector('[role="status"]')?.textContent).toContain("Added 1 captured update");
    expect(host.querySelector('[aria-label="Scenario Evidence picker"]')).toBeNull();
    const reset = Array.from(pane.querySelectorAll("button")).find(button => button.textContent === "Reset")!;
    await act(async () => reset.click());
    expect(dispatch.mock.calls.slice(-2).map(([command]) => command)).toEqual([{ type: "set-scenario-capture-search", text: "" }, { type: "set-scenario-capture-filter", command: "ALL" }]);
    const refresh = Array.from(pane.querySelectorAll("button")).find(button => button.textContent === "Refresh captures")!;
    await act(async () => refresh.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "refresh-scenario-captures" });
  });

  it("switches working surfaces deliberately, preserves input arrows and leaves unowned Escape alone", async () => {
    const { host, dispatch, snapshot } = await setup();
    const queueButton = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Scenario queue")!;
    await act(async () => queueButton.click());
    expect(host.querySelector(".workbench-react__scenario-workspace")?.getAttribute("data-surface")).toBe("queue");
    const member = host.querySelector<HTMLButtonElement>('[aria-label="Ordered Scenario Steps"] li button')!;
    await act(async () => member.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "focus-scenario-member", memberId: snapshot.scenario!.scenario.members[0]!.id });
    expect(host.querySelector(".workbench-react__scenario-workspace")?.getAttribute("data-surface")).toBe("editor");
    expect(document.activeElement).toBe(host.querySelector("h2"));
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search captured updates"]')!;
    for (const key of ["ArrowLeft", "ArrowRight", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      search.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(dispatch.mock.calls.some(([command]) => command.type === "play-scenario")).toBe(false);
  });

  it("stores capture scroll independently of the focused member document", async () => {
    const { host, dispatch } = await setup();
    const scroll = host.querySelector<HTMLDivElement>(".workbench-react__scenario-capture-scroll")!;
    scroll.scrollTop = 173;
    await act(async () => scroll.dispatchEvent(new Event("scroll", { bubbles: true })));
    expect(dispatch).toHaveBeenLastCalledWith({ type: "set-scenario-capture-scroll", scrollTop: 173 });
  });

  it("explains capacity while allowing checked captures to be cleared, including expired off-page identities", async () => {
    const { host, render, capture, dispatch } = await setup();
    await render({ ...capture, remainingStepCapacity: 0, expired: true, newerAcceptedEvidenceCount: 9 });
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Add selected updates"]')!.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(false);
    expect(host.textContent).toContain("100-Step capacity reached");
    expect(host.textContent).toContain("Retained results expired");
    expect(host.textContent).toContain("9 newer accepted Evidence records");
    await render({ ...capture, rows: [], remainingStepCapacity: 0, expired: true });
    const clear = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Clear selection")!;
    await act(async () => clear.click());
    expect(dispatch).toHaveBeenLastCalledWith({ type: "clear-scenario-capture-selection" });
  });

  it("shows bounded metadata previews and server provenance without loading a Source payload", async () => {
    const { host, render, capture } = await setup();
    const event = { ...capture.rows[0]!.event, update: { ...capture.rows[0]!.event.update!, fields: {} } };
    await render({ ...capture, rows: [{ ...capture.rows[0]!, event, preview: "qty: 2 · status: pending" }] });
    const pane = host.querySelector('[aria-label="Scenario captured updates"]')!;
    expect(pane.textContent).toContain("qty: 2 · status: pending");
    expect(pane.textContent).toContain("Server · Live");
    await render({ ...capture, feedback: "Added 1 captured update as Step 3." }, { canUndoCaptureAddition: true });
    expect(Array.from(pane.querySelectorAll("button")).some(button => button.textContent === "Undo added updates")).toBe(true);
  });

  it("restores the exact focused authoring control after Park without rebuilding the capture pane", async () => {
    const { host, render, capture } = await setup();
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search captured updates"]')!;
    const pane = host.querySelector('[aria-label="Scenario captured updates"]');
    await act(async () => search.focus());
    await render(capture, { parked: true });
    await render(capture, { parked: false });
    expect(document.activeElement).toBe(search);
    expect(host.querySelector('[aria-label="Scenario captured updates"]')).toBe(pane);
  });

  it("keeps retained results keyboard reachable when Review disables capture selection", async () => {
    const { host, render, capture } = await setup();
    await render(capture, { phase: "review" });
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
    const results = host.querySelector<HTMLElement>('[aria-label="Captured update results"]')!;
    expect(results.tabIndex).toBe(0);
    await act(async () => results.focus());
    expect(document.activeElement).toBe(results);
    expect(results.textContent).toContain("candidate");
  });

  it.each(["ready", "error"] as const)("keeps a named keyboard results region when %s has no captured rows", async (queryState) => {
    const { host, render, capture } = await setup();
    await render({ ...capture, queryState, rows: [], selected: [], total: 0, error: queryState === "error" ? "Captured Evidence read failed." : null });
    const results = host.querySelector<HTMLElement>('[aria-label="Captured update results"]')!;
    expect(results.getAttribute("role")).toBe("region");
    await act(async () => results.focus());
    expect(document.activeElement).toBe(results);
    const report = await axe.run(host, { runOnly: { type: "rule", values: ["aria-prohibited-attr"] } });
    expect(report.violations).toEqual([]);
  });

});
