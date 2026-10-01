import { describe, expect, it, vi } from "vitest";
import type { LightstreamerEventEnvelope } from "../src/core/event-envelope";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createInMemoryEventHistory, type EventHistory } from "../src/core/event-history-authoritative";
import { createIndexedDbEventHistory } from "../src/core/event-history-indexeddb";
import { createWorkbenchRuntime } from "../src/extension/panel/workbench-runtime";
import { createAuthoritativeHistory } from "./support/authoritative-history";

function event(id: string, kind: LightstreamerEventEnvelope["kind"] = "item-update"): LightstreamerEventEnvelope {
  return { id, timestamp: 1, direction: "inbound", source: "server", synthetic: false, captureSource: "listener", kind,
    client: { id: "c", sessionId: "s", status: "CONNECTED:WS-STREAMING" },
    subscription: { id: "sub", mode: "COMMAND", items: ["items"], fields: ["command", "key", "value"], active: true, subscribed: true },
    listener: { id: "l", callbacks: ["onItemUpdate"] }, item: { name: "items", position: 1 },
    ...(kind === "item-update" ? { update: { isSnapshot: false, command: "ADD", key: id, fields: { command: "ADD", key: id, value: id }, changedFields: { command: "ADD", key: id, value: id } } } : {}) };
}
function captures(count: number) {
  return [event("client", "client-created"), event("status", "client-status"), event("subscription", "subscription-created"), event("started", "subscription-started"), event("listener", "listener-added"), ...Array.from({length: count}, (_, i) => event(`capture-${i}`))];
}
async function setup(count = 1200, providedHistory?: EventHistory, pageEpoch?: string) {
  const initial = captures(count).map(capture => pageEpoch ? {...capture, topology:{version:1 as const,kind:"item-observed" as const,pageEpoch,captureSequence:1,provenance:{instrumentationSource:"official-public-api" as const},coverage:{status:"complete" as const,getters:{}}}} : capture);
  const history = providedHistory ?? createAuthoritativeHistory({ precommitted: initial });
  if (providedHistory) await Promise.all(initial.map(capture => history.offer(capture).settled));
  const executor = vi.fn();
  const runtime = createWorkbenchRuntime({ history, captureStatus: "capturing", localInjectionExecutor: { execute: executor } });
  runtime.dispatch({type: "select-evidence", eventId: `capture-${count-1}`});
  await vi.waitFor(() => expect(runtime.getSnapshot().selectedEvidence?.id).toBe(`capture-${count-1}`));
  runtime.dispatch({type: "begin-local-injection-from-selection"});
  await vi.waitFor(() => expect(runtime.getSnapshot().localInjection.state).toBe("active"));
  runtime.dispatch({type: "convert-local-injection-to-scenario"});
  return {history, runtime, executor};
}
describe("Scenario retained Capture workspace", () => {
  it("searches all retained target captures independent of Evidence controls and adds exact selections in retained order", async () => {
    const {runtime, executor} = await setup();
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario?.captureWorkspace?.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace!.total).toBe(1200);
      expect(runtime.getSnapshot().scenario!.captureWorkspace!.rows).toHaveLength(40);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.rows.every(row => row.event.update?.fields === undefined && row.preview.length <= 240)).toBe(true);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.rows[0]!.preview).toContain("value");
      runtime.dispatch({type: "set-scenario-capture-search", text: "capture-2"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace!.queryState).toBe("ready"));
      const newer = runtime.getSnapshot().scenario!.captureWorkspace!.rows[0]!.identity;
      runtime.dispatch({type: "toggle-scenario-capture", identity: newer});
      runtime.dispatch({type: "set-scenario-capture-search", text: "capture-0"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace!.queryState).toBe("ready"));
      const older = runtime.getSnapshot().scenario!.captureWorkspace!.rows[0]!.identity;
      runtime.dispatch({type: "toggle-scenario-capture", identity: older});
      expect(runtime.getSnapshot().scenario!.captureWorkspace!.selected).toHaveLength(2);
      runtime.dispatch({type: "add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(3));
      expect(runtime.getSnapshot().scenario!.scenario.steps.slice(1).map(step => step.draft.sourceEventId)).toEqual([older.eventId, newer.eventId]);
      expect(runtime.getSnapshot().scenario!.captureWorkspace!.feedback).toContain("2");
      expect(executor).not.toHaveBeenCalled();
    } finally {runtime.dispose();}
  });
  it("keeps page, exact selections and read boundary stable through passive Capture, focus, Park and Resume", async () => {
    const {runtime, history} = await setup(100);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      runtime.dispatch({type: "show-older-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const selected = runtime.getSnapshot().scenario!.captureWorkspace.rows[0]!.identity;
      runtime.dispatch({type: "toggle-scenario-capture", identity: selected});
      runtime.dispatch({type: "set-scenario-capture-scroll", scrollTop: 154});
      runtime.dispatch({type: "park-scenario"});
      const before = runtime.getSnapshot().scenario!.captureWorkspace;
      await history.offer(event("new-passive")).settled;
      runtime.dispatch({type: "resume-scenario"});
      expect(runtime.getSnapshot().scenario!.captureWorkspace).toEqual({...before, newerAcceptedEvidenceCount: 1});
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      runtime.dispatch({type: "refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.total).toBe(101);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toEqual([selected]);
    } finally {runtime.dispose();}
  });

  it.each(["memory", "indexeddb"])("hydrates selected off-page payloads from %s storage without changing human Evidence selection", async storage => {
    if (storage === "indexeddb") Object.assign(globalThis, {indexedDB: new IDBFactory(), IDBKeyRange});
    const history = storage === "memory" ? createInMemoryEventHistory({panelSessionId: "scenario-capture-memory"}) : await createIndexedDbEventHistory({panelSessionId: "scenario-capture-idb"});
    const {runtime, executor} = await setup(85, history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      runtime.dispatch({type: "show-older-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const chosen = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity;
      runtime.dispatch({type: "toggle-scenario-capture", identity: chosen});
      runtime.dispatch({type: "set-scenario-capture-search", text: "absent"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.rows).toHaveLength(0);
      runtime.dispatch({type: "add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(2));
      expect(runtime.getSnapshot().scenario!.scenario.steps[1]!.draft.sourceEventId).toBe(chosen.eventId);
      expect(runtime.getSnapshot().evidence.selectedEventId).toBe("capture-84");
      expect(executor).not.toHaveBeenCalled();
    } finally {runtime.dispose(); await history.close();}
  });

  it("refuses a full batch atomically at the 100-Step capacity boundary", async () => {
    const {runtime} = await setup(5);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const selected = runtime.getSnapshot().scenario!.captureWorkspace.rows.filter(row => !row.alreadyUsed).slice(0,2);
      for (const row of selected) runtime.dispatch({type:"toggle-scenario-capture", identity:row.identity});
      for (let i = 0; i < 98; i++) runtime.dispatch({type:"add-authored-scenario-step"});
      const before = runtime.getSnapshot().scenario!.scenario;
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("100"));
      expect(runtime.getSnapshot().scenario!.scenario).toBe(before);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(2);
    } finally {runtime.dispose();}
  });

  it("rejects a selected Source after Clear without changing Scenario membership", async () => {
    const {runtime, history} = await setup(5);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const row = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!;
      runtime.dispatch({type:"toggle-scenario-capture", identity:row.identity});
      await history.clear();
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("no longer retained"));
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.rows).toHaveLength(0);
      runtime.dispatch({type:"toggle-scenario-capture", identity:row.identity});
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(0);
    } finally {runtime.dispose();}
  });

  it("undoes an unchanged successful Capture addition and refuses stale undo after a later edit", async () => {
    const {runtime} = await setup(5);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const identity = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity;
      runtime.dispatch({type:"toggle-scenario-capture", identity});
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.canUndoCaptureAddition).toBe(true));
      runtime.dispatch({type:"undo-scenario-capture-addition"});
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      runtime.dispatch({type:"toggle-scenario-capture", identity});
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.canUndoCaptureAddition).toBe(true));
      runtime.dispatch({type:"add-authored-scenario-step"});
      expect(runtime.getSnapshot().scenario!.canUndoCaptureAddition).toBe(false);
      runtime.dispatch({type:"undo-scenario-capture-addition"});
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(3);
    } finally {runtime.dispose();}
  });

  it.each(["memory", "indexeddb"])("ignores double add and refuses target drift during an async %s selected Source read", async storage => {
    if (storage === "indexeddb") Object.assign(globalThis, {indexedDB: new IDBFactory(), IDBKeyRange});
    const base = storage === "memory" ? createInMemoryEventHistory({panelSessionId:"scenario-drift-memory"}) : await createIndexedDbEventHistory({panelSessionId:"scenario-drift-idb"});
    let armed = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    let chosenReads = 0;
    const history: EventHistory = {...base, query: async request => {
      if (armed && request.lookup?.eventId === "capture-3") {chosenReads++; await gate;}
      return base.query!(request);
    }};
    const {runtime, executor} = await setup(5, history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      runtime.dispatch({type:"toggle-scenario-capture", identity:runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity});
      armed = true;
      runtime.dispatch({type:"add-scenario-captures"});
      runtime.dispatch({type:"add-scenario-captures"});
      expect(runtime.getSnapshot().scenario!.captureWorkspace.adding).toBe(true);
      await base.offer({...event("retired", "client-status"), client: {id:"c", sessionId:"s", status:"DISCONNECTED"}}).settled;
      release();
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("Target changed"));
      expect(chosenReads).toBe(1);
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      expect(executor).not.toHaveBeenCalled();
    } finally {release();runtime.dispose();await base.close();}
  });

  it.each(["memory", "indexeddb"])("refuses all selected Sources when Clear occurs during a delayed %s lookup", async storage => {
    if (storage === "indexeddb") Object.assign(globalThis, {indexedDB: new IDBFactory(), IDBKeyRange});
    const base = storage === "memory" ? createInMemoryEventHistory({panelSessionId:"scenario-clear-memory"}) : await createIndexedDbEventHistory({panelSessionId:"scenario-clear-idb"});
    let armed = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const history: EventHistory = {...base, query: async request => {if (armed && request.lookup) await gate;return base.query!(request);}};
    const {runtime} = await setup(5, history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      for (const row of runtime.getSnapshot().scenario!.captureWorkspace.rows.slice(1,3)) runtime.dispatch({type:"toggle-scenario-capture",identity:row.identity});
      armed = true;
      runtime.dispatch({type:"add-scenario-captures"});
      await base.clear();
      release();
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("no longer retained"));
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(2);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.expired).toBe(true);
      runtime.dispatch({type:"clear-scenario-capture-selection"});
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(0);
    } finally {release();runtime.dispose();await base.close();}
  });

  it("refuses stale async batch membership after a Scenario revision changes", async () => {
    const base = createInMemoryEventHistory({panelSessionId:"scenario-revision-memory"});
    let armed = false;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const history: EventHistory = {...base, query: async request => {if (armed && request.lookup?.eventId === "capture-3") await gate;return base.query!(request);}};
    const {runtime} = await setup(5, history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      runtime.dispatch({type:"toggle-scenario-capture",identity:runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity});
      armed = true;
      runtime.dispatch({type:"add-scenario-captures"});
      runtime.dispatch({type:"review-scenario"});
      expect(runtime.getSnapshot().scenario!.phase).toBe("edit");
      runtime.dispatch({type:"add-authored-scenario-step"});
      const edited = runtime.getSnapshot().scenario!.scenario;
      release();
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("Scenario changed"));
      expect(runtime.getSnapshot().scenario!.scenario).toBe(edited);
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(2);
    } finally {release();runtime.dispose();await base.close();}
  });

  it.each(["epoch", "schema"])("treats metadata eligibility as provisional and atomically rejects a chosen Source with incompatible %s", async mismatch => {
    const {runtime, history, executor} = await setup(5, undefined, "current-page");
    try {
      const bad = event("incompatible-source");
      if (mismatch === "epoch") bad.topology = {version:1,kind:"item-observed",pageEpoch:"different-page",captureSequence:10,provenance:{instrumentationSource:"official-public-api"},coverage:{status:"complete",getters:{}}};
      else bad.subscription = {...bad.subscription!, fields:["command","key","value","extra"]};
      await history.offer(bad).settled;
      if (mismatch === "epoch") await history.offer({...event("restore-current-page"),topology:{version:1,kind:"item-observed",pageEpoch:"current-page",captureSequence:11,provenance:{instrumentationSource:"official-public-api"},coverage:{status:"complete",getters:{}}}}).settled;
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const rows = runtime.getSnapshot().scenario!.captureWorkspace.rows;
      const badRow = rows.find(row => row.identity.eventId === bad.id)!;
      expect(badRow.available).toBe(true);
      runtime.dispatch({type:"toggle-scenario-capture",identity:rows.find(row => row.identity.eventId === "capture-3")!.identity});
      runtime.dispatch({type:"toggle-scenario-capture",identity:badRow.identity});
      const before = runtime.getSnapshot().scenario!.scenario;
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("incompatible-source"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain(mismatch === "epoch" ? "Different page" : "Different field schema");
      expect(runtime.getSnapshot().scenario!.scenario).toBe(before);
      expect(executor).not.toHaveBeenCalled();
    } finally {runtime.dispose();}
  });

  it("refuses the entire ordered addition when a later chosen payload exceeds accounted Scenario bytes", async () => {
    const {runtime, history, executor} = await setup(5);
    try {
      const huge = event("oversized-source");
      huge.update!.fields!.value = "x".repeat(3 * 1024 * 1024);
      huge.update!.changedFields!.value = huge.update!.fields!.value;
      await history.offer(huge).settled;
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const rows = runtime.getSnapshot().scenario!.captureWorkspace.rows;
      for (const id of ["capture-3", huge.id]) runtime.dispatch({type:"toggle-scenario-capture",identity:rows.find(row => row.identity.eventId === id)!.identity});
      const before = runtime.getSnapshot().scenario!.scenario;
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("8 MiB"), {timeout:5000});
      expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain(huge.id);
      expect(runtime.getSnapshot().scenario!.scenario).toBe(before);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(2);
      expect(executor).not.toHaveBeenCalled();
    } finally {runtime.dispose();}
  });

  it("preserves surviving Compare, cursor and scroll presentation when undoing a Capture addition", async () => {
    const {runtime} = await setup(5);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const row = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!;
      runtime.dispatch({type:"toggle-scenario-capture",identity:row.identity});
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(2));
      const survivor = runtime.getSnapshot().scenario!.scenario.steps[0]!;
      const presentation = {...survivor.draft.editor, cursor:12, selectionFrom:12, selectionTo:15, scrollTop:44, scrollLeft:29};
      runtime.dispatch({type:"set-scenario-step-editor-presentation",stepId:survivor.id,presentation});
      runtime.dispatch({type:"set-scenario-step-compare",stepId:survivor.id,open:false});
      expect(runtime.getSnapshot().scenario!.canUndoCaptureAddition).toBe(true);
      runtime.dispatch({type:"undo-scenario-capture-addition"});
      expect(runtime.getSnapshot().scenario!.scenario.steps[0]!.draft.editor).toEqual({...presentation,compareOpen:false});
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
    } finally {runtime.dispose();}
  });

  it.each([false, true])("keeps Scenario member allocation monotonic after Capture Undo (Review and Edit: %s)", async archiveReview => {
    const {runtime} = await setup(5);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      runtime.dispatch({type:"toggle-scenario-capture",identity:runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity});
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(2));
      const addedId = runtime.getSnapshot().scenario!.scenario.steps[1]!.id;
      const nextSequence = runtime.getSnapshot().scenario!.scenario.nextStepSequence;
      if (archiveReview) {
        runtime.dispatch({type:"review-scenario"});
        expect(runtime.getSnapshot().scenario!.phase).toBe("review");
        runtime.dispatch({type:"edit-scenario"});
        expect(runtime.getSnapshot().scenario!.priorRuns[0]!.steps.some(step => step.id === addedId)).toBe(true);
      }
      expect(runtime.getSnapshot().scenario!.canUndoCaptureAddition).toBe(true);
      runtime.dispatch({type:"undo-scenario-capture-addition"});
      expect.soft(runtime.getSnapshot().scenario!.scenario.nextStepSequence).toBe(nextSequence);
      runtime.dispatch({type:"add-authored-scenario-step"});
      expect(runtime.getSnapshot().scenario!.scenario.steps[1]!.id).not.toBe(addedId);
      if (archiveReview) expect(runtime.getSnapshot().scenario!.retainedRunBytes).toBeGreaterThan(0);
    } finally {runtime.dispose();}
  });

  it.each(["memory", "indexeddb"])("hydrates an exact off-window selection once with 5000 retained Captures in %s", async storage => {
    if (storage === "indexeddb") Object.assign(globalThis, {indexedDB:new IDBFactory(),IDBKeyRange});
    const base = storage === "memory" ? createInMemoryEventHistory({panelSessionId:"scenario-off-window-memory"}) : await createIndexedDbEventHistory({panelSessionId:"scenario-off-window-idb"});
    let armed = false;
    let selectedQueries = 0;
    const history: EventHistory = {...base,query:async request => {
      // Bound a broken immediate-query loop so the test can report its failure
      // instead of starving the timer that asserts Source hydration.
      if (armed && ++selectedQueries > 6) throw new Error("Off-window selection repeated without attaching its exact retained identity.");
      return base.query!(request);
    }};
    const {runtime} = await setup(5000,history);
    try {
      // Bootstrap performs real indexed scans through fake-indexeddb's queued
      // callbacks. This wait is not a latency assertion; the exact query-count
      // guard below detects the loop, and native browser tests cover 5,000 rows.
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"), {timeout:45_000});
      armed = true;
      runtime.dispatch({type:"select-evidence",eventId:"capture-0"});
      await vi.waitFor(() => expect(runtime.getSnapshot().selectedEvidence?.id).toBe("capture-0"));
      expect(selectedQueries).toBeLessThanOrEqual(2);
      expect(runtime.getSnapshot().evidence.investigation.queryState).toBe("ready");
      expect(runtime.getSnapshot().scenario!.captureWorkspace.total).toBe(5000);
    } finally {runtime.dispose();await base.close();}
  }, 60_000);

  it.each(["memory", "indexeddb"])("shows a bounded field-search excerpt without repeated runtime identities from %s metadata", async storage => {
    if (storage === "indexeddb") Object.assign(globalThis,{indexedDB:new IDBFactory(),IDBKeyRange});
    const history = storage === "memory" ? createInMemoryEventHistory({panelSessionId:"preview-memory"}) : await createIndexedDbEventHistory({panelSessionId:"preview-idb"});
    const {runtime} = await setup(5,history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const source = event("preview-source");
      source.update = {isSnapshot:false,command:"ADD",key:"order-A",fields:{command:"ADD",key:"order-A",value:"payload-37"},changedFields:{command:"ADD",key:"order-A",value:"payload-37"}};
      await history.offer(source).settled;
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const row = runtime.getSnapshot().scenario!.captureWorkspace.rows.find(row => row.identity.eventId === source.id)!;
      expect(row.preview).toBe("value payload-37");
      expect(row.preview).not.toContain("preview-source");
      expect(row.preview).not.toContain("connected");
      expect(row.preview.length).toBeLessThanOrEqual(240);
      expect(row.event.update?.fields).toBeUndefined();
      expect(row.available, row.reason ?? undefined).toBe(true);
      runtime.dispatch({type:"toggle-scenario-capture",identity:row.identity});
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toHaveLength(1);
      runtime.dispatch({type:"add-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.adding).toBe(false));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toBeNull();
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(2));
      const copiedSource = JSON.parse(runtime.getSnapshot().scenario!.scenario.steps[1]!.draft.sourceRawText!);
      expect(copiedSource.fields).toEqual({command:"ADD",key:"order-A",value:"payload-37"});
    } finally {runtime.dispose();await history.close();}
  });

  it("keeps complete retained matching totals across IndexedDB residual-filter cursor pages", async () => {
    Object.assign(globalThis,{indexedDB:new IDBFactory(),IDBKeyRange});
    const history = await createIndexedDbEventHistory({panelSessionId:"residual-total-idb"});
    try {
      await Promise.all(captures(9).map(capture => history.offer(capture).settled));
      const first = await history.query!({at:"LATEST_COMMITTED",filter:{revision:1,text:"add key",criteria:{},around:null,unsupported:[]},page:{order:"NEWEST_FIRST",size:3}});
      if (!first.ok) throw new Error(first.problem.message);
      expect(first.value.totals.matching).toBe(9);
      expect(first.value.page.nextCursor).toBeTruthy();
      const next = await history.query!({at:first.value.readPoint,filter:{revision:1,text:"add key",criteria:{},around:null,unsupported:[]},page:{order:"NEWEST_FIRST",size:3,cursor:first.value.page.nextCursor!}});
      if (!next.ok) throw new Error(next.problem.message);
      expect(next.value.page.evidence).toHaveLength(3);
      expect(next.value.totals).toEqual(first.value.totals);
    } finally {await history.close();}
  });

  it("does not label an unstructured runtime metadata prefix as a captured field excerpt", async () => {
    const base = createInMemoryEventHistory({panelSessionId:"preview-no-field-boundary"});
    const history: EventHistory = {...base,query:async request => {
      const result = await base.query!(request);
      return result.ok ? {...result,value:{...result.value,page:{...result.value.page,evidence:result.value.page.evidence.map(record => ({...record,searchText:"runtime metadata client c session s source server https://example.test"}))}}} : result;
    }};
    const {runtime} = await setup(5,history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.rows.every(row => row.preview === "")).toBe(true);
    } finally {runtime.dispose();await base.close();}
  });

  it("preserves selected identities through a real workspace query failure and explicit refresh recovery", async () => {
    const base = createInMemoryEventHistory({panelSessionId:"capture-query-recovery"});
    let failNext = false;
    const history: EventHistory = {...base,query:async request => {
      if (failNext && request.filter.criteria.kind?.include[0]?.value === "ITEM-UPDATE") {failNext = false;throw new Error("Deterministic Capture read failure");}
      return base.query!(request);
    }};
    const {runtime} = await setup(5,history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const selected = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity;
      runtime.dispatch({type:"toggle-scenario-capture",identity:selected});
      failNext = true;
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("error"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toContain("Deterministic Capture read failure");
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toEqual([selected]);
      expect(runtime.getSnapshot().scenario!.scenario.steps).toHaveLength(1);
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      expect(runtime.getSnapshot().scenario!.captureWorkspace.selected).toEqual([selected]);
      expect(runtime.getSnapshot().scenario!.captureWorkspace.error).toBeNull();
    } finally {runtime.dispose();await base.close();}
  });

  it("ignores a stale delayed Capture query after a newer search and refresh have committed", async () => {
    const base = createInMemoryEventHistory({panelSessionId:"capture-stale-query"});
    let release!: () => void;
    let delayed = false;
    let completed = false;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const history: EventHistory = {...base,query:async request => {
      const result = await base.query!(request);
      if (request.filter.text === "capture-1") {delayed = true;await gate;completed = true;}
      return result;
    }};
    const {runtime} = await setup(5,history);
    try {
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const identity = runtime.getSnapshot().scenario!.captureWorkspace.rows[1]!.identity;
      runtime.dispatch({type:"toggle-scenario-capture",identity});
      runtime.dispatch({type:"set-scenario-capture-search",text:"capture-1"});
      await vi.waitFor(() => expect(delayed).toBe(true));
      runtime.dispatch({type:"set-scenario-capture-search",text:"capture-2"});
      runtime.dispatch({type:"refresh-scenario-captures"});
      await vi.waitFor(() => expect(runtime.getSnapshot().scenario!.captureWorkspace.queryState).toBe("ready"));
      const current = runtime.getSnapshot().scenario!.captureWorkspace;
      release();
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(runtime.getSnapshot().scenario!.captureWorkspace).toBe(current);
      expect(current.rows.map(row => row.identity.eventId)).toEqual(["capture-2"]);
      expect(current.selected).toEqual([identity]);
    } finally {release();runtime.dispose();await base.close();}
  });

});
