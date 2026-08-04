const variants = {
  A: { short: "A", label: "A — Anchored Composer", render: renderAnchoredComposer },
  B: { short: "B", label: "B — Injection Bench", render: renderInjectionBench },
  C: { short: "C", label: "C — Sealed Preflight", render: renderExecutionReview }
};

const entries = {
  reuse: "Captured update · unchanged",
  mutate: "Captured update · mutate",
  author: "New COMMAND update"
};

const scenarios = {
  ready: "Ready to execute",
  invalid: "Invalid command / key",
  unavailable: "No delivery boundary",
  stale: "Target retired",
  mismatch: "Target mismatch",
  success: "Delivered locally",
  "listener-error": "Partial listener failure",
  "wire-error": "Wire delivery failure",
  "bridge-error": "Acknowledgement lost"
};

const sourceEvidence = [
  ["14:08:39.902", "COMMAND snapshot", "ADD", "order-1042", "6 fields", "Server"],
  ["14:08:40.116", "Update Delivery", "ADD", "order-1042", "listener-view", "Server"],
  ["14:08:41.238", "Item Update", "UPDATE", "order-1042", "qty, status", "Server"],
  ["14:08:41.239", "Update Delivery", "UPDATE", "order-1042", "listener-view", "Server"],
  ["14:08:41.239", "Update Delivery", "UPDATE", "order-1042", "listener-metrics", "Server"]
];

const query = new URLSearchParams(window.location.search);
document.documentElement.dataset.presentation = query.get("presentation") === "1" ? "true" : "false";
const requestedDraftCount = Math.max(1, Math.min(6, Number(query.get("drafts")) || 1));
const futureMultiEnabled = query.get("multi") === "1" || requestedDraftCount > 1;
const state = {
  variant: variants[query.get("variant")] ? query.get("variant") : "A",
  entry: entries[query.get("entry")] ? query.get("entry") : "mutate",
  scenario: scenarios[query.get("scenario")] ? query.get("scenario") : "ready",
  phase: "edit",
  draftOpen: true,
  minimized: false,
  traceOpen: false,
  compactEvidence: false,
  sourceOpen: false,
  executions: 0,
  qty: "42",
  status: "review",
  key: "order-1042",
  command: "UPDATE",
  snapshot: false,
  changedMode: "Auto",
  focusReturn: "evt-1842",
  fieldCount: [84, 240, 500].includes(Number(query.get("fields"))) ? Number(query.get("fields")) : 84,
  draftCount: futureMultiEnabled ? requestedDraftCount : 1,
  multiEnabled: futureMultiEnabled,
  activeEvent: Number.isInteger(Number(query.get("event"))) ? Math.max(0, Number(query.get("event"))) : 0,
  finalCompare: query.get("compare") === "1",
  collapsedEvents: new Set((query.get("collapsed") ?? "").split(",").filter(Boolean)),
  authoredEvents: new Set((query.get("authored") ?? "").split(",").filter(Boolean).map(Number)),
  addEventOpen: false
};

if (state.entry === "reuse") {
  state.qty = "18";
  state.status = "open";
} else if (state.entry === "author") {
  state.command = "ADD";
  state.key = "order-2099";
  state.qty = "1";
  state.status = "draft";
}

let finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
state.activeEvent = Math.min(state.activeEvent, finalBuffers.length - 1);
if (state.activeEvent > 0) focusFinalEvent(state.activeEvent);

const root = document.querySelector("#prototype");
const lab = document.querySelector("#prototype-lab");
const variantLabel = document.querySelector("#variant-label");

render();

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button, [data-action]") : null;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.switch) return cycleVariant(target.dataset.switch === "next" ? 1 : -1);
  const action = target.dataset.action;
  if (!action) return;
  if (action === "open-draft" || action === "resume") {
    state.draftOpen = true;
    state.minimized = false;
    state.traceOpen = false;
    state.compactEvidence = false;
  }
  if (action === "minimize") {
    state.draftOpen = false;
    state.minimized = true;
  }
  if (action === "back-evidence") {
    state.draftOpen = false;
    state.minimized = true;
    state.traceOpen = false;
    state.compactEvidence = true;
  }
  if (action === "show-ledger") state.compactEvidence = true;
  if (action === "review") state.phase = "review";
  if (action === "edit") state.phase = "edit";
  if (action === "inject") executeInjection();
  if (action === "trace") {
    state.traceOpen = true;
    state.draftOpen = false;
  }
  if (action === "return-outcome") {
    state.traceOpen = false;
    state.draftOpen = true;
  }
  if (action === "repeat") {
    state.scenario = "ready";
    state.phase = "edit";
    state.draftOpen = true;
    updateUrl();
  }
  if (action === "return-draft") {
    state.scenario = "ready";
    state.phase = "edit";
    state.draftOpen = true;
    updateUrl();
  }
  if (action === "inspect-source") state.sourceOpen = !state.sourceOpen;
  if (action === "final-view") state.finalCompare = target.dataset.view === "compare";
  if (action === "toggle-add-event") state.addEventOpen = !state.addEventOpen;
  if (action === "add-captured-event" && state.multiEnabled && state.draftCount < 6) {
    state.draftCount += 1;
    finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
    focusFinalEvent(state.draftCount - 1);
    state.addEventOpen = false;
  }
  if (action === "add-authored-event" && state.multiEnabled && state.draftCount < 6) {
    state.authoredEvents.add(state.draftCount);
    state.draftCount += 1;
    finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
    focusFinalEvent(state.draftCount - 1);
    state.addEventOpen = false;
  }
  if (action === "focus-event") focusFinalEvent(Number(target.dataset.event ?? 0));
  if (action === "toggle-event") {
    const eventIndex = Number(target.dataset.event ?? 0);
    focusFinalEvent(eventIndex);
    const eventId = finalBuffers[eventIndex]?.id;
    if (eventId) {
      if (state.collapsedEvents.has(eventId)) state.collapsedEvents.delete(eventId);
      else state.collapsedEvents.add(eventId);
    }
  }
  updateUrl();
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
  if (target.name === "entry") setEntry(target.value);
  if (target.name === "scenario") {
    state.scenario = target.value;
    state.phase = "edit";
  }
  if (target.name === "command") state.command = target.value;
  if (target.name === "snapshot") state.snapshot = target.checked;
  if (target.name === "changed-mode") state.changedMode = target.value;
  if (target.name === "final-field-count") {
    state.fieldCount = Number(target.value);
    finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
    state.activeEvent = Math.min(state.activeEvent, finalBuffers.length - 1);
  }
  if (target.name === "final-draft-count") {
    state.draftCount = Number(target.value);
    finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
    state.activeEvent = 0;
    state.collapsedEvents.clear();
  }
  if (target.name === "final-capability") {
    state.multiEnabled = target.value === "future-multi";
    state.draftCount = 1;
    state.activeEvent = 0;
    state.authoredEvents.clear();
    state.collapsedEvents.clear();
    state.addEventOpen = false;
    finalBuffers = buildFinalBuffers(1, state.fieldCount);
  }
  updateUrl();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name === "qty") state.qty = target.value;
  if (target.name === "status") state.status = target.value;
  if (target.name === "key") state.key = target.value;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.draftOpen) {
    state.draftOpen = false;
    state.minimized = true;
    render();
    return;
  }
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement) return;
  cycleVariant(event.key === "ArrowRight" ? 1 : -1);
});

function setEntry(entry) {
  state.entry = entry;
  state.phase = "edit";
  state.scenario = "ready";
  state.executions = 0;
  if (entry === "reuse") {
    state.command = "UPDATE";
    state.key = "order-1042";
    state.qty = "18";
    state.status = "open";
  } else if (entry === "mutate") {
    state.command = "UPDATE";
    state.key = "order-1042";
    state.qty = "42";
    state.status = "review";
  } else {
    state.command = "ADD";
    state.key = "order-2099";
    state.qty = "1";
    state.status = "draft";
  }
  finalBuffers = buildFinalBuffers(state.draftCount, state.fieldCount);
  state.activeEvent = 0;
  state.collapsedEvents.clear();
}

function executeInjection() {
  if (state.scenario !== "ready") return;
  state.executions += 1;
  state.scenario = "success";
  state.phase = "outcome";
  updateUrl();
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  state.phase = "edit";
  state.draftOpen = true;
  state.minimized = false;
  state.traceOpen = false;
  state.compactEvidence = false;
  updateUrl();
  render();
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("entry", state.entry);
  url.searchParams.set("scenario", state.scenario);
  url.searchParams.set("fields", String(state.fieldCount));
  url.searchParams.set("drafts", String(state.draftCount));
  url.searchParams.set("event", String(state.activeEvent));
  if (state.finalCompare) url.searchParams.set("compare", "1");
  else url.searchParams.delete("compare");
  if (state.collapsedEvents.size) url.searchParams.set("collapsed", [...state.collapsedEvents].join(","));
  else url.searchParams.delete("collapsed");
  if (state.multiEnabled) url.searchParams.set("multi", "1");
  else url.searchParams.delete("multi");
  if (state.authoredEvents.size) url.searchParams.set("authored", [...state.authoredEvents].join(","));
  else url.searchParams.delete("authored");
  window.history.replaceState({}, "", url);
}

function render() {
  document.documentElement.dataset.variant = state.variant;
  variantLabel.textContent = variants[state.variant].label;
  lab.innerHTML = prototypeLab();
  root.innerHTML = variants[state.variant].render();
}

function prototypeLab() {
  return `<div class="lab-title"><span>Prototype state</span><button type="button" class="lab-close" aria-label="Collapse prototype controls">×</button></div>
    <label>Entry route<select name="entry">${options(entries, state.entry)}</select></label>
    <label>Runtime / outcome<select name="scenario">${options(scenarios, state.scenario)}</select></label>
    <label>Payload size<select name="final-field-count"><option value="84" ${state.fieldCount === 84 ? "selected" : ""}>84 fields</option><option value="240" ${state.fieldCount === 240 ? "selected" : ""}>240 fields</option><option value="500" ${state.fieldCount === 500 ? "selected" : ""}>500 fields</option></select></label>
    <label>Capability<select name="final-capability"><option value="single" ${state.multiEnabled ? "" : "selected"}>Single event · today</option><option value="future-multi" ${state.multiEnabled ? "selected" : ""}>Future multi-edit</option></select></label>
    <label>Draft documents<select name="final-draft-count" ${state.multiEnabled ? "" : "disabled"}>${Array.from({ length: 6 }, (_, index) => index + 1).map((count) => `<option value="${count}" ${state.draftCount === count ? "selected" : ""}>${count} · ${count === 1 ? "seed event" : "explicit members"}</option>`).join("")}</select></label>
    <small>These controls simulate runtime conditions. They are not part of the proposed product UI.</small>`;
}

function options(values, selected) {
  return Object.entries(values).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function shell(body, className) {
  return `<section class="prototype-canvas injection-prototype ${className}">
    <header class="instrument-bar">
      <div class="instrument-state"><span class="signal success"></span><strong>Capture active</strong><span>Complete coverage</span><span>Session S-9</span></div>
      <div class="bar-actions"><button type="button">Frozen · 37 newer</button><button type="button">Find</button><button type="button">Filter</button><button type="button" aria-label="More actions">⋮</button></div>
    </header>
    <div class="scope-bar"><button type="button">Scope</button><span>Page</span><i>›</i><span>client-main</span><i>›</i><span>Session S-9</span><i>›</i><strong>orders.command</strong><i>›</i><span>portfolio</span><i>›</i><span>order-1042</span><em>live</em></div>
    ${body}
    <footer class="status-bar"><span>186 shown / 12,482 retained</span><span>Frozen · 37 newer matches</span><span class="push">${state.variant === "A" ? `${finalBuffers.length === 1 ? "Draft" : "Draft Set"} · ${finalBuffers.length} explicitly seeded ${finalBuffers.length === 1 ? "document" : "documents"} preserved` : "Draft D-7 preserved"} · Capture continues</span></footer>
  </section>`;
}

function renderAnchoredComposer() {
  if (state.traceOpen || !state.draftOpen) {
    const inspector = state.traceOpen ? traceInspector() : evidenceInspector();
    return shell(`<div class="anchored-workspace">
        <aside class="runtime-tree pane">${runtimeTree()}</aside>
        <section class="evidence-pane pane">${evidenceLedger()}</section>
        <aside class="context-pane pane">${inspector}</aside>
      </div>${draftResumeStrip()}`, `model-a ${state.compactEvidence ? "compact-evidence" : ""}`);
  }
  const phase = isOutcome() ? "outcome" : state.phase;
  const content = phase === "edit" ? finalDraftSet() : phase === "review" ? finalDraftReview() : finalDraftOutcome();
  return shell(`${finalWorkspaceHeader(phase)}${content}`, "model-a model-a-final");
}

function buildFinalBuffers(count, fieldCount) {
  const ids = ["evt-1842", "evt-1828", "evt-1814", "new-01", "evt-1780", "evt-1761"];
  const names = ["order-1042-update.json", "order-1044-update.json", "order-1046-delete.json", "authored-add.json", "order-1050-update.json", "order-1052-update.json"];
  return Array.from({ length: count }, (_, index) => {
    const authored = (index === 0 && state.entry === "author") || state.authoredEvents.has(index) || (count === 6 && index === 3);
    const command = authored ? "ADD" : index === 2 ? "DELETE" : "UPDATE";
    const key = index === 0 ? state.key : authored ? `order-${2099 + index}` : `order-${1042 + index * 2}`;
    const source = authored ? null : buildFinalPayload(fieldCount, index, false, command, key);
    const edited = index === 0 ? state.entry !== "reuse" : true;
    const draft = buildFinalPayload(fieldCount, index, edited, command, key);
    if (index === 0) {
      draft.command = state.command;
      draft.key = state.key;
      draft.isSnapshot = state.snapshot;
      draft.fields.command = state.command;
      draft.fields.key = state.key;
      draft.fields.qty = Number(state.qty);
      draft.fields.status = state.status;
    }
    if (index === 2) draft.fields.key = "";
    const draftText = JSON.stringify(draft, null, 2);
    return {
      id: authored ? (index === 0 ? "new-focused" : `new-${String(index + 1).padStart(2, "0")}`) : ids[index],
      name: authored ? (index === 0 ? "authored-focused.json" : `authored-command-${index + 1}.json`) : names[index],
      source,
      draft,
      sourceText: source ? JSON.stringify(source, null, 2) : "",
      draftText: index === 2 ? draftText.replace(/,\n(\s+)"status"/, "\n$1\"status\"") : draftText,
      target: index % 2 ? "inventory.command / warehouse" : "orders.command / portfolio",
      subscription: index % 2 ? "sub-11" : "sub-7",
      command: draft.command,
      key: draft.key,
      listeners: index === 1 ? 1 : 2,
      stale: !authored && index === 4,
      invalid: !authored && index === 2,
      authored
    };
  });
}

function buildFinalPayload(fieldCount, eventIndex, edited, command, key) {
  const fields = {
    command,
    key,
    account_id: `ACC-${319 + eventIndex}`,
    symbol: eventIndex % 2 ? "LS-NORTH" : "LS-CORP",
    side: eventIndex % 2 ? "SELL" : "BUY",
    qty: edited ? 42 + eventIndex : 18 + eventIndex,
    status: edited ? "review" : "open",
    limit_price: edited ? 42.18 : 42.15,
    average_price: 41.88,
    route: "SMART",
    risk_score: edited ? 84 : 71,
    audit_context: edited ? "workbench-local / attempt-4" : "matching-engine / attempt-3",
    update_reason: edited ? "local scenario" : "market movement"
  };
  const groups = ["pricing", "execution", "settlement", "diagnostics", "adapter", "custom"];
  let index = 1;
  while (Object.keys(fields).length < fieldCount) {
    const prefix = groups[(index - 1) % groups.length];
    const name = `${prefix}_${String(index).padStart(3, "0")}`;
    let value = index % 11 === 0 ? index * 10 : `value-${eventIndex + 1}-${index}`;
    if (edited && index % 47 === 0) value = `scenario-${eventIndex + 1}-${index}`;
    fields[name] = value;
    index += 1;
  }
  return { command, key, isSnapshot: false, fields };
}

function finalWorkspaceHeader(phase) {
  const buffer = currentFinalBuffer();
  const index = finalBuffers.indexOf(buffer);
  const title = phase === "edit" ? `Edit Local Injection ${finalBuffers.length === 1 ? "draft" : "drafts"}` : phase === "review" ? "Review focused Local Injection" : "Local delivery outcome";
  const draftLabel = finalBuffers.length === 1 ? "Local Injection Draft" : "Local Injection Draft Set";
  return `<header class="final-workspace-header"><button type="button" data-action="back-evidence">← Evidence</button><div><span class="eyebrow">${draftLabel} · ${buffer.authored ? "new COMMAND event" : "anchored to selected evidence"}</span><strong>${title}</strong></div><div class="final-header-focus"><span>Focused</span><strong>${buffer.id} · ${buffer.command} / ${buffer.key}</strong><small>${buffer.subscription} · ${buffer.target}</small></div><span class="status-pill ${finalStatusTone(buffer, index)}">${finalStatusLabel(buffer, index)}</span><button type="button" data-action="minimize">Minimize ${finalBuffers.length === 1 ? "draft" : "set"}</button></header>`;
}

function finalDraftSet() {
  const readyCount = finalBuffers.filter((buffer, index) => !finalBufferBlocked(buffer, index)).length;
  const workspaceLabel = state.multiEnabled ? "Future multi-edit workspace" : "Draft workspace";
  const membershipCopy = finalBuffers.length === 1
    ? (finalBuffers[0].authored ? "1 newly authored COMMAND document · no Injection Source" : `1 document seeded from selected evidence ${finalBuffers[0].id}`)
    : `${finalBuffers.length} explicitly added independent JSON documents · timeline visibility does not add drafts`;
  return `<main class="final-set-workspace">
    <div class="final-set-toolbar"><div><strong>${workspaceLabel}</strong><span>${membershipCopy}</span></div><div><span>${readyCount} reviewable${finalBuffers.length - readyCount ? ` · ${finalBuffers.length - readyCount} need attention` : ""}</span><button type="button" data-action="final-view" data-view="edit" class="${state.finalCompare ? "" : "active"}">Edit payload${finalBuffers.length === 1 ? "" : "s"}</button><button type="button" data-action="final-view" data-view="compare" class="${state.finalCompare ? "active" : ""}">Compare source${finalBuffers.length === 1 ? "" : "s"}</button>${state.multiEnabled ? renderAddEventControl() : ""}</div></div>
    <section class="final-event-scroll" aria-label="Independent Local Injection drafts">${finalBuffers.map(renderFinalEvent).join("")}</section>
    ${finalSetFooter()}
  </main>`;
}

function renderAddEventControl() {
  const limitReached = state.draftCount >= 6;
  return `<div class="final-add-event"><button type="button" data-action="toggle-add-event" aria-expanded="${state.addEventOpen ? "true" : "false"}" ${limitReached ? "disabled" : ""}>${limitReached ? "Draft set full" : "Add event…"}</button>${state.addEventOpen && !limitReached ? `<div class="final-add-menu" role="dialog" aria-label="Add event to future Draft Set"><span class="eyebrow">Future multi-edit</span><button type="button" data-action="add-captured-event"><strong>Add captured event…</strong><small>Choose evidence explicitly; visible timeline rows are not added.</small></button><button type="button" data-action="add-authored-event"><strong>Create new COMMAND event</strong><small>Add one source-free raw JSON document.</small></button></div>` : ""}</div>`;
}

function renderFinalEvent(buffer, index) {
  const collapsed = state.collapsedEvents.has(buffer.id);
  const focused = index === state.activeEvent;
  const statusTone = finalStatusTone(buffer, index);
  const statusLabel = finalStatusLabel(buffer, index);
  const sourceLabel = buffer.authored ? "No captured source" : `Source ${buffer.id}`;
  return `<article class="final-event ${focused ? "focused" : ""} ${statusTone}" data-event-id="${buffer.id}">
    <header class="final-event-header">
      <button type="button" class="final-event-toggle" data-action="toggle-event" data-event="${index}" aria-expanded="${collapsed ? "false" : "true"}" aria-label="${collapsed ? "Expand" : "Collapse"} ${buffer.id}">${collapsed ? "▸" : "▾"}</button>
      <button type="button" class="final-event-focus" data-action="focus-event" data-event="${index}" aria-label="Focus ${buffer.id}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${buffer.id}</strong><code>${buffer.command} / ${buffer.key}</code></button>
      <div class="final-event-context"><span>${buffer.subscription} · ${buffer.target}</span><span>${sourceLabel} · ${finalDifferenceCount(buffer)} differences</span></div>
      <span class="final-event-status"><i></i>${statusLabel}</span>
    </header>
    ${collapsed ? "" : state.finalCompare ? renderFinalCompare(buffer, index) : renderFinalEditor(buffer, index)}
  </article>`;
}

function renderFinalEditor(buffer, index) {
  return `<div class="final-editor-body">${renderFinalTextEditor(finalDraftText(buffer, index), `Editable JSON for ${buffer.id}`, finalBufferInvalid(buffer, index))}</div>`;
}

function renderFinalCompare(buffer, index) {
  const draftText = finalDraftText(buffer, index);
  if (buffer.authored) {
    return `<div class="final-no-source"><div><span class="eyebrow">No captured source</span><strong>Full JSON authoring remains editable</strong><p>Workbench will not fabricate a Server Update for comparison.</p></div><div class="final-editor-body">${renderFinalTextEditor(draftText, `Editable JSON for ${buffer.id}`, finalBufferInvalid(buffer, index))}</div></div>`;
  }
  const entries = finalDiffEntries(buffer.sourceText, draftText);
  return `<div class="final-compare-body">
    <div class="final-diff-head"><div><strong>Captured source</strong><span>immutable · ${buffer.id}</span></div><div><strong>Injection draft</strong><span>${finalBufferInvalid(buffer, index) ? "invalid · preserved" : "editable"}</span></div></div>
    <div class="final-diff-shared-scroll" data-shared-scroll="${buffer.id}" aria-label="Synchronized source and draft comparison for ${buffer.id}"><div class="final-diff-grid"><div class="final-diff-column">${renderFinalDiffColumn(entries, buffer.sourceText, draftText, "source")}</div><div class="final-diff-column draft" contenteditable="true" spellcheck="false">${renderFinalDiffColumn(entries, buffer.sourceText, draftText, "draft")}</div></div></div>
    <div class="final-inline-diff"><header><strong>${buffer.id} source → draft</strong><span>${finalDifferenceCount(buffer)} differences</span></header>${renderFinalInlineDiff(entries, buffer.sourceText, draftText)}</div>
  </div>`;
}

function renderFinalTextEditor(text, label, invalid = false) {
  return `<div class="final-code-editor ${invalid ? "invalid" : ""}"><pre aria-hidden="true">${Array.from({ length: text.split("\n").length }, (_, index) => index + 1).join("\n")}</pre><textarea aria-label="${label}" wrap="off" spellcheck="false">${escapeFinalHtml(text)}</textarea></div>`;
}

function finalDiffEntries(sourceText, draftText) {
  const source = sourceText.split("\n");
  const draft = draftText.split("\n");
  const max = Math.max(source.length, draft.length);
  const changed = Array.from({ length: max }, (_, index) => index).filter((index) => source[index] !== draft[index]);
  const keep = new Set([0, 1, 2, 3, 4, max - 2, max - 1]);
  for (const index of changed) for (let offset = -1; offset <= 1; offset += 1) if (index + offset >= 0 && index + offset < max) keep.add(index + offset);
  const visible = [...keep].sort((a, b) => a - b);
  const entries = [];
  let previous = -1;
  for (const index of visible) {
    if (previous >= 0 && index - previous > 1) entries.push({ kind: "fold", count: index - previous - 1 });
    entries.push({ kind: "line", index, changed: source[index] !== draft[index] });
    previous = index;
  }
  return entries;
}

function renderFinalDiffColumn(entries, sourceText, draftText, side) {
  const source = sourceText.split("\n");
  const draft = draftText.split("\n");
  return entries.map((entry) => {
    if (entry.kind === "fold") return `<div class="final-fold-row"><span></span><em>··· ${entry.count} unchanged lines ···</em></div>`;
    const text = side === "source" ? source[entry.index] : draft[entry.index];
    return `<div class="final-diff-line ${entry.changed ? `changed ${side}` : ""}"><span>${entry.index + 1}</span><code>${escapeFinalHtml(text ?? "")}</code></div>`;
  }).join("");
}

function renderFinalInlineDiff(entries, sourceText, draftText) {
  const source = sourceText.split("\n");
  const draft = draftText.split("\n");
  return `<div class="final-unified-lines">${entries.map((entry) => {
    if (entry.kind === "fold") return `<div class="final-unified-fold">··· ${entry.count} unchanged lines ···</div>`;
    if (!entry.changed) return `<div class="final-unified-line"><span> </span><code>${escapeFinalHtml(draft[entry.index] ?? source[entry.index] ?? "")}</code></div>`;
    return `<div class="final-unified-line removed"><span>−</span><code>${escapeFinalHtml(source[entry.index] ?? "")}</code></div><div class="final-unified-line added" contenteditable="true"><span>+</span><code>${escapeFinalHtml(draft[entry.index] ?? "")}</code></div>`;
  }).join("")}</div>`;
}

function finalSetFooter() {
  const buffer = currentFinalBuffer();
  const index = finalBuffers.indexOf(buffer);
  const blocked = finalBufferBlocked(buffer, index);
  return `<footer class="final-set-footer"><div><span>${finalBuffers.length === 1 ? "Single draft" : `Focused ${index + 1} of ${finalBuffers.length}`}</span><strong>${buffer.id} · ${buffer.command} / ${buffer.key}</strong><span class="${finalStatusTone(buffer, index)}">${finalStatusLabel(buffer, index)}</span><span>${finalBuffers.length === 1 ? "Only the selected or newly authored event is in this draft" : "Independent draft · no collection execution semantics"}</span></div><button type="button" class="primary" data-action="review" ${blocked ? "disabled" : ""}>Review ${finalBuffers.length === 1 ? "draft" : "focused draft"}…</button></footer>`;
}

function finalDraftReview() {
  const buffer = currentFinalBuffer();
  const source = buffer.authored ? "None · newly authored" : `${buffer.id} · immutable Server Update`;
  const independence = finalBuffers.length === 1
    ? "This is the only event in the Local Injection draft."
    : `The other ${finalBuffers.length - 1} explicitly added drafts remain independent and will not execute.`;
  return `<main class="final-review"><section class="final-review-summary"><div><span class="eyebrow">One draft only</span><h1>Review exactly one Local Injection</h1><p>${independence}</p></div><dl><dt>Source</dt><dd>${source}</dd><dt>Target</dt><dd>${buffer.subscription} · ${buffer.target} · Session S-9</dd><dt>Delivery</dt><dd>One Logical Update → ${buffer.listeners} current ${buffer.listeners === 1 ? "listener" : "listeners"}</dd><dt>COMMAND</dt><dd>${buffer.command} / ${buffer.key}</dd><dt>Payload</dt><dd>${state.fieldCount} fields · ${finalDifferenceCount(buffer)} semantic differences</dd></dl><div class="final-review-json">${renderFinalReadonly(finalDraftText(buffer, finalBuffers.indexOf(buffer)))}</div><div class="final-review-boundary"><div><strong>LOCAL inspected-page runtime only</strong><p>Lightstreamer Server is not contacted.${finalBuffers.length > 1 ? " Draft-set order has no execution meaning." : ""}</p></div><div><button type="button" data-action="edit">← Edit focused draft</button><button class="primary" type="button" data-action="inject">Confirm and inject ${buffer.id}</button></div></div></section></main>`;
}

function renderFinalReadonly(text) {
  const lines = text.split("\n");
  const shown = lines.length > 48 ? [...lines.slice(0, 40), `  ··· ${lines.length - 46} lines folded ···`, ...lines.slice(-6)] : lines;
  return shown.map((line, index) => `<div><span>${index < 40 ? index + 1 : index === 40 ? "" : lines.length - (shown.length - index) + 1}</span><code>${escapeFinalHtml(line)}</code></div>`).join("");
}

function finalDraftOutcome() {
  return `<main class="final-outcome">${outcomePanel(true)}</main>`;
}

function currentFinalBuffer() {
  return finalBuffers[state.activeEvent] ?? finalBuffers[0];
}

function focusFinalEvent(index) {
  state.activeEvent = Math.max(0, Math.min(index, finalBuffers.length - 1));
  const buffer = currentFinalBuffer();
  state.command = buffer.command;
  state.key = buffer.key;
  state.qty = String(buffer.draft.fields.qty ?? "");
  state.status = String(buffer.draft.fields.status ?? "");
  state.phase = "edit";
}

function finalDifferenceCount(buffer) {
  if (!buffer.source) return Object.keys(buffer.draft.fields).length;
  const source = buffer.source.fields;
  const draft = buffer.draft.fields;
  return [...new Set([...Object.keys(source), ...Object.keys(draft)])].filter((key) => source[key] !== draft[key]).length;
}

function finalBufferInvalid(buffer, index) {
  return buffer.invalid || (state.scenario === "invalid" && index === state.activeEvent);
}

function finalBufferStale(buffer, index) {
  return buffer.stale || (state.scenario === "stale" && index === state.activeEvent);
}

function finalBufferBlocked(buffer, index) {
  return finalBufferInvalid(buffer, index) || finalBufferStale(buffer, index) || (index === state.activeEvent && ["unavailable", "mismatch"].includes(state.scenario));
}

function finalStatusTone(buffer, index) {
  if (finalBufferInvalid(buffer, index) || finalBufferStale(buffer, index) || (index === state.activeEvent && state.scenario === "mismatch")) return "danger";
  if (index === state.activeEvent && state.scenario === "unavailable") return "warning";
  return "success";
}

function finalStatusLabel(buffer, index) {
  if (finalBufferInvalid(buffer, index)) return "Invalid JSON";
  if (finalBufferStale(buffer, index)) return "Target stale";
  if (index === state.activeEvent && state.scenario === "unavailable") return "No listeners";
  if (index === state.activeEvent && state.scenario === "mismatch") return "Target mismatch";
  return "Ready";
}

function finalDraftText(buffer, index) {
  if (state.scenario === "invalid" && index === state.activeEvent) return "{\n  \"command\": \"UPDATE\",\n  \"fields\": {\n";
  return buffer.draftText;
}

function escapeFinalHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function renderInjectionBench() {
  if (!state.draftOpen && !state.traceOpen) {
    return shell(`<div class="evidence-return">${evidenceLedger(true)}${draftResumeStrip()}</div>`, "model-b");
  }
  if (state.traceOpen) return shell(`<div class="evidence-return">${evidenceLedger(true)}${traceReturnBar()}</div>`, "model-b");
  return shell(`<div class="bench-header"><button type="button" data-action="back-evidence">← Evidence</button><div><span class="eyebrow">Temporary primary workspace</span><strong>Local Injection · Draft D-7</strong></div><span class="status-pill ${statusTone()}">${statusLabel()}</span><button type="button">Discard…</button></div>
    <div class="bench-workspace">
      <aside class="bench-source pane">${sourceAndRuns()}</aside>
      <main class="bench-editor pane"><div class="compact-bench-context">${targetBoundary()}${sourceBlock()}</div>${draftEditor("bench")}</main>
      <aside class="bench-execute pane">${targetBoundary()}${validationBlock()}${executionBlock()}</aside>
    </div>`, "model-b");
}

function renderExecutionReview() {
  if (!state.draftOpen && !state.traceOpen) return shell(`<div class="evidence-return">${evidenceLedger(true)}${draftResumeStrip()}</div>`, "model-c");
  if (state.traceOpen) return shell(`<div class="evidence-return">${evidenceLedger(true)}${traceReturnBar()}</div>`, "model-c");
  const phase = isOutcome() ? "outcome" : state.phase;
  return shell(`<div class="review-header"><button type="button" data-action="back-evidence">← Evidence</button><div><span class="eyebrow">Local Injection · Draft D-7</span><strong>${phase === "edit" ? "Edit draft" : phase === "review" ? "Execution review" : "Local delivery outcome"}</strong></div><div class="phase-track"><span class="${phase === "edit" ? "active" : "done"}">1 Edit</span><i>›</i><span class="${phase === "review" ? "active" : phase === "outcome" ? "done" : ""}">2 Review</span><i>›</i><span class="${phase === "outcome" ? "active" : ""}">3 Outcome</span></div></div>
    <main class="review-stage pane">${phase === "edit" ? reviewEdit() : phase === "review" ? immutableReview() : outcomePanel(true)}</main>`, "model-c");
}

function runtimeTree() {
  return `<div class="pane-heading"><div><span class="eyebrow">Runtime topology</span><strong>Inspected page</strong></div><button type="button">«</button></div>
    <div class="tree">
      <div><span>▾</span><strong>Page</strong><em>active</em></div>
      <div class="level-1"><span>▾</span><strong>client-main</strong><em>active</em></div>
      <div class="level-2"><span>▾</span><strong>Session S-9</strong><em>active</em></div>
      <div class="level-3 selected"><span>▾</span><strong>orders.command</strong><em>COMMAND</em></div>
      <div class="level-4 selected-child"><span>•</span><strong>portfolio</strong><em>1 item</em></div>
      <div class="level-4"><span>•</span><span>listener-view</span><em>live</em></div>
      <div class="level-4"><span>•</span><span>listener-metrics</span><em>live</em></div>
    </div>`;
}

function evidenceLedger(full = false) {
  const injectedRows = shouldShowInjectedEvidence() ? `
    <button class="evidence-row injected ${state.traceOpen ? "selected" : ""}" type="button"><span class="mono">14:08:52.004</span><span><b>Injected Update</b><small>inj-${18 + Math.max(0, state.executions - 1)} · Local Injection</small></span><span><b class="command">${state.command}</b> ${state.key}</span><span>qty, status</span><span class="local-mark">Local</span></button>
    <button class="evidence-row delivery" type="button"><span class="mono">14:08:52.005</span><span>Update Delivery</span><span>listener-view</span><span>delivered</span><span class="local-mark">Local</span></button>
    <button class="evidence-row delivery" type="button"><span class="mono">14:08:52.005</span><span>Update Delivery</span><span>listener-metrics</span><span>delivered</span><span class="local-mark">Local</span></button>` : "";
  return `<div class="pane-heading ledger-heading"><div><span class="eyebrow">Ordered evidence</span><strong>orders.command / portfolio</strong></div><span>186 shown</span></div>
    <div class="filter-input">⌕ <span>key:order-1042</span><span>source:any ×</span></div>
    <div class="evidence-grid ${full ? "full" : ""}">
      <div class="evidence-row evidence-head"><span>Time</span><span>Evidence</span><span>Command / key</span><span>Change</span><span>Provenance</span></div>
      ${sourceEvidence.map((row, index) => `<button class="evidence-row ${index === 2 && !state.traceOpen ? "selected anchor" : ""}" type="button"><span class="mono">${row[0]}</span><span>${row[1]}${index === 2 ? "<small>evt-1842 · draft anchor</small>" : ""}</span><span><b class="command">${row[2]}</b> ${row[3]}</span><span>${row[4]}</span><span class="server-mark">${row[5]}</span></button>`).join("")}
      ${injectedRows}
    </div>
    ${!state.draftOpen && !state.traceOpen ? `<div class="selection-bar"><span>Selected <strong>evt-1842 · UPDATE order-1042</strong></span><button class="primary" type="button" data-action="open-draft">Create Local Injection Draft</button></div>` : ""}`;
}

function evidenceInspector() {
  return `<div class="pane-heading"><div><span class="eyebrow">Selected evidence</span><strong>evt-1842 · Item Update</strong></div></div>
    <div class="lens-tabs"><button class="active">Summary</button><button>Fields</button><button>Deliveries</button><button>State</button><button>Raw</button></div>
    <div class="inspector-body"><button class="compact-only" type="button" data-action="show-ledger">← Ordered evidence</button><span class="server-mark">Server Update</span><dl><dt>Subscription</dt><dd>orders.command</dd><dt>Item / key</dt><dd>portfolio / order-1042</dd><dt>Command</dt><dd>UPDATE</dd><dt>Changed</dt><dd>qty, status</dd><dt>Deliveries</dt><dd>2 of 2 listeners</dd></dl><button class="primary" type="button" data-action="open-draft">Create Local Injection Draft</button><p>The selected Server Update remains immutable.</p></div>`;
}

function anchoredDraft() {
  return `<div class="pane-heading draft-title"><div><span class="eyebrow">Deliberate local action</span><strong>Local Injection · Draft D-7</strong><small>${sourceLabel()}</small></div><button type="button" data-action="minimize">Minimize</button></div>
    <div class="composer-scroll">${targetBoundary()}${sourceBlock()}${draftEditor("composer")}${validationBlock()}${executionBlock()}</div>`;
}

function sourceAndRuns() {
  return `<div class="pane-heading"><div><span class="eyebrow">Source / executions</span><strong>${sourceLabel()}</strong></div></div>${sourceBlock(true)}
    <section class="run-list"><span class="eyebrow">Executions (${state.executions || (isOutcome() ? 1 : 0)})</span>${isOutcome() ? `<button type="button"><strong>inj-${18 + Math.max(0, state.executions - 1)} · ${outcomeShort()}</strong><small>14:08:52 · Draft revision ${state.executions + 1}</small></button>` : `<p>No execution yet.</p>`}</section>`;
}

function sourceBlock(expanded = false) {
  if (state.entry === "author") return `<section class="source-card no-source"><span class="eyebrow">Newly authored</span><strong>No Injection Source</strong><p>Started from the live COMMAND item scope. No captured update is presented as authoritative.</p></section>`;
  return `<section class="source-card"><span class="eyebrow">Injection Source · immutable</span><strong>evt-1842 · Server Update</strong><p>UPDATE order-1042 · qty 18 · status open</p><button type="button" data-action="inspect-source">${state.sourceOpen ? "Hide source values" : "Inspect source values"}</button>${state.sourceOpen || expanded ? `<dl><dt>command</dt><dd>UPDATE</dd><dt>key</dt><dd>order-1042</dd><dt>qty</dt><dd>18</dd><dt>status</dt><dd>open</dd><dt>snapshot</dt><dd>false</dd></dl>` : ""}</section>`;
}

function targetBoundary() {
  const target = targetState();
  return `<section class="target-card ${target.tone}"><div class="card-heading"><div><span class="eyebrow">Local Injection Target · ${target.label}</span><strong>orders.command / portfolio</strong></div><span class="status-pill ${target.tone}">${target.label}</span></div>
    <dl><dt>Subscription</dt><dd>sub-7 · Session S-9</dd><dt>Mode</dt><dd>COMMAND</dd><dt>Item</dt><dd>portfolio</dd><dt>Boundary</dt><dd>${target.boundary}</dd></dl>
    <p class="boundary-copy">Delivers one Logical Update to every current listener on this Subscription. Does not contact Lightstreamer Server.</p></section>`;
}

function draftEditor(origin) {
  const readOnly = state.phase === "review";
  const mutation = mutationCount();
  return `<section class="draft-card ${origin}"><div class="card-heading"><div><span class="eyebrow">Injection Draft · ${state.entry === "author" ? "newly authored" : `${mutation} mutation${mutation === 1 ? "" : "s"}`}</span><strong>${state.command} ${state.key}</strong></div><span class="draft-revision">revision ${state.executions + 1}</span></div>
    <div class="draft-controls">
      <label><span>Command</span><select name="command" ${readOnly ? "disabled" : ""}>${["ADD", "UPDATE", "DELETE"].map((v) => `<option ${v === state.command ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label class="${state.scenario === "invalid" ? "field-error" : ""}"><span>Key</span><input name="key" value="${state.scenario === "invalid" ? "" : state.key}" ${readOnly ? "readonly" : ""}/><small>${state.scenario === "invalid" ? "A COMMAND key is required." : state.entry === "author" ? "Required for a newly authored COMMAND update" : "was order-1042"}</small></label>
      <label><span>Snapshot</span><input type="checkbox" name="snapshot" ${state.snapshot ? "checked" : ""} ${readOnly ? "disabled" : ""}/><small>${state.snapshot ? "Included in the local snapshot phase" : "Not a snapshot update"}</small></label>
      <label><span>Changed fields</span><select name="changed-mode" ${readOnly ? "disabled" : ""}><option ${state.changedMode === "Auto" ? "selected" : ""}>Auto</option><option ${state.changedMode === "Manual" ? "selected" : ""}>Manual</option></select><small>Controls isValueChanged semantics.</small></label>
    </div>
    <div class="field-grid"><div class="field-head"><span>Field</span><span>Source</span><span>Draft</span><span>Semantics</span></div>
      ${fieldRow("qty", "18", state.qty, readOnly)}${fieldRow("status", "open", state.status, readOnly)}</div>
    ${state.entry !== "author" && mutation > 0 && !readOnly ? `<button type="button" class="secondary">Reset draft to source</button>` : ""}</section>`;
}

function fieldRow(name, source, value, readOnly) {
  const changed = state.entry === "author" || source !== value;
  return `<label class="field-row"><span><strong>${name}</strong><small>string</small></span><span class="source-value">${state.entry === "author" ? "—" : source}</span><input name="${name}" value="${value}" ${readOnly ? "readonly" : ""}/><span class="change-flag ${changed ? "changed" : ""}">${changed ? "changed" : "unchanged"}</span></label>`;
}

function validationBlock() {
  const validation = validationState();
  return `<section class="validation-card ${validation.tone}"><div class="card-heading"><div><span class="eyebrow">Validation</span><strong>${validation.title}</strong></div><span class="status-pill ${validation.tone}">${validation.count}</span></div><p>${validation.detail}</p>${validation.action ? `<button type="button">${validation.action}</button>` : ""}</section>`;
}

function executionBlock() {
  if (isOutcome()) return outcomePanel();
  const blocked = state.scenario !== "ready";
  return `<section class="execution-card"><span class="eyebrow">Execution boundary</span><p>Target identity and compatibility are checked again immediately before dispatch. Each execution creates a new Injection identity.</p><button class="primary execute" type="button" data-action="inject" ${blocked ? "disabled" : ""}>Inject update into sub-7</button><small>No keyboard shortcut executes an Injection.</small></section>`;
}

function reviewEdit() {
  return `<div class="review-edit-grid"><section><div class="review-stage-title"><span class="eyebrow">Step 1 · editable</span><h1>Prepare the draft</h1><p>Source and target stay pinned while you edit.</p></div>${sourceBlock()}${draftEditor("review")}</section><aside>${targetBoundary()}${validationBlock()}<button class="primary review-button" type="button" data-action="review" ${state.scenario !== "ready" ? "disabled" : ""}>Review execution →</button></aside></div>`;
}

function immutableReview() {
  return `<div class="immutable-review"><div class="review-stage-title"><span class="eyebrow">Step 2 · read-only execution boundary</span><h1>Review exactly what will be delivered locally</h1><p>Any change returns to the editor. The live target is revalidated again when you execute.</p></div>
    <div class="review-summary"><section>${targetBoundary()}</section><section>${sourceBlock()}${immutablePayloadSummary()}</section></div>
    <div class="review-boundary"><div><strong>Local browser delivery only</strong><p>One Logical Update → 2 current listeners of sub-7. Lightstreamer Server is not contacted.</p></div><div class="review-actions"><button type="button" data-action="edit">← Edit draft</button><button class="primary" type="button" data-action="inject">Confirm and inject update</button></div></div></div>`;
}

function immutablePayloadSummary() {
  return `<section class="sealed-payload"><div class="card-heading"><div><span class="eyebrow">Sealed payload · read only</span><strong>${state.command} ${state.key}</strong></div><span class="status-pill success">Checks current</span></div>
    <dl><dt>Item</dt><dd>portfolio</dd><dt>Command / key</dt><dd>${state.command} / ${state.key}</dd><dt>Snapshot</dt><dd>${state.snapshot ? "true" : "false"}</dd><dt>Changed semantics</dt><dd>${state.changedMode}</dd><dt>qty</dt><dd>${state.qty}${state.entry === "author" ? "" : " · was 18"}</dd><dt>status</dt><dd>${state.status}${state.entry === "author" ? "" : " · was open"}</dd></dl>
    <div class="preflight-checks"><span>✓ Exact target</span><span>✓ Schema</span><span>✓ Listener set</span><span>✓ Page bridge</span><span>✓ Draft</span></div></section>`;
}

function outcomePanel(full = false) {
  const outcome = outcomeState();
  return `<section class="outcome-card ${outcome.tone} ${full ? "full" : ""}" tabindex="-1"><div class="outcome-icon">${outcome.icon}</div><div><span class="eyebrow">Injection inj-${18 + Math.max(0, state.executions - 1)} · ${outcome.eyebrow}</span><h2>${outcome.title}</h2><p>${outcome.detail}</p>${outcome.projections ? projectionCompare() : ""}<div class="outcome-actions">${outcome.trace ? `<button class="primary" type="button" data-action="trace">Trace Injected Update</button><button type="button">View Local Effective State</button><button type="button" data-action="repeat">Create repeat draft</button>` : `<button class="primary" type="button" data-action="return-draft">Return to draft</button><button type="button">Inspect diagnostics</button>`}</div></div></section>`;
}

function projectionCompare() {
  return `<div class="projection-compare"><div><span>Observed Server COMMAND State</span><strong>qty 18 · status open</strong><small>Unchanged by Local Injection</small></div><div class="local"><span>Local Effective COMMAND State</span><strong>qty ${state.qty} · status ${state.status}</strong><small>Includes inj-${18 + Math.max(0, state.executions - 1)}</small></div></div>`;
}

function traceInspector() {
  return `<div class="pane-heading"><div><span class="eyebrow">Trace result</span><strong>inj-${18 + Math.max(0, state.executions - 1)} · Injected Update</strong></div><button type="button" data-action="return-outcome">Back to outcome</button></div><div class="inspector-body"><span class="local-mark">Local Injection</span><dl><dt>Draft</dt><dd>D-7 · revision ${state.executions + 1}</dd><dt>Target</dt><dd>sub-7 · Session S-9</dd><dt>Item / key</dt><dd>portfolio / ${state.key}</dd><dt>Deliveries</dt><dd>2 of 2 current listeners</dd></dl>${projectionCompare()}</div>`;
}

function traceReturnBar() {
  return `<div class="trace-return"><span><strong>Injected Update selected</strong> · prior evidence view and outcome are preserved</span><button type="button" data-action="return-outcome">Back to outcome</button></div>`;
}

function draftResumeStrip() {
  if (!state.minimized) return "";
  return `<div class="draft-resume"><span><strong>${state.variant === "A" ? `Local Injection ${finalBuffers.length === 1 ? "Draft" : "Draft Set"} · ${finalBuffers.length} ${finalBuffers.length === 1 ? "document" : "documents"}` : "Local Injection Draft D-7"}</strong> · ${statusLabel()} · anchored to ${state.entry === "author" ? "COMMAND item portfolio" : "evt-1842"}</span><button type="button" data-action="resume">Resume draft</button></div>`;
}

function validationState() {
  if (state.scenario === "invalid") return { tone: "danger", title: "1 blocking error", count: "Blocked", detail: "COMMAND key is required. Draft values are preserved.", action: "Go to key" };
  if (state.scenario === "unavailable") return { tone: "warning", title: "Delivery boundary unavailable", count: "Blocked", detail: "sub-7 has 0 current listeners. Wait for a listener or select another compatible live Subscription.", action: "Select target" };
  if (state.scenario === "stale") return { tone: "danger", title: "Target retired", count: "Stale", detail: "sub-7 retired after the draft opened. Workbench will not silently retarget it.", action: "Select current target" };
  if (state.scenario === "mismatch") return { tone: "danger", title: "Target is incompatible", count: "Blocked", detail: "The candidate Subscription does not contain item portfolio and field status.", action: "Review mismatch" };
  return { tone: "success", title: "Ready to inject", count: "0 errors", detail: "Target, item, schema, COMMAND fields, and local delivery boundary are valid." };
}

function targetState() {
  if (state.scenario === "unavailable") return { tone: "warning", label: "Unavailable", boundary: "0 current listeners" };
  if (state.scenario === "stale") return { tone: "danger", label: "Stale", boundary: "Subscription retired" };
  if (state.scenario === "mismatch") return { tone: "danger", label: "Mismatched", boundary: "Candidate schema differs" };
  return { tone: "success", label: "Live", boundary: "2 current listeners" };
}

function outcomeState() {
  if (state.scenario === "listener-error") return { tone: "danger", icon: "!", eyebrow: "failed local boundary", title: "Listener delivery failed", detail: "1 of 2 listener calls completed before listener-metrics threw. No rollback is implied. A successful Injected Update was not added to evidence or Local Effective COMMAND State.", trace: false };
  if (state.scenario === "wire-error") return { tone: "danger", icon: "!", eyebrow: "failed local boundary", title: "Wire delivery failed", detail: "The page delivery path rejected the Logical Update. No successful Injected Update or projection effect was recorded.", trace: false };
  if (state.scenario === "bridge-error") return { tone: "warning", icon: "?", eyebrow: "acknowledgement unavailable", title: "Completion was not acknowledged", detail: "Workbench lost the inspected-page acknowledgement. Delivery cannot be confirmed, so no successful Injected Update was added. Review diagnostics before deliberately creating another execution.", trace: false };
  return { tone: "success", icon: "✓", eyebrow: "delivered", title: "Delivered locally", detail: "One Logical Update reached 2 current listeners of sub-7. This confirms the local delivery boundary; it does not claim application business success or server effect.", trace: true, projections: true };
}

function isOutcome() {
  return ["success", "listener-error", "wire-error", "bridge-error"].includes(state.scenario);
}

function shouldShowInjectedEvidence() {
  return state.scenario === "success";
}

function outcomeShort() {
  return state.scenario === "success" ? "Delivered" : state.scenario === "bridge-error" ? "Not acknowledged" : "Failed";
}

function statusTone() {
  if (["invalid", "stale", "mismatch", "listener-error", "wire-error"].includes(state.scenario)) return "danger";
  if (["unavailable", "bridge-error"].includes(state.scenario)) return "warning";
  return "success";
}

function statusLabel() {
  if (isOutcome()) return outcomeShort();
  return validationState().count === "0 errors" ? "Ready" : validationState().count;
}

function sourceLabel() {
  return state.entry === "author" ? "Newly authored · no Injection Source" : "anchored to evt-1842";
}

function mutationCount() {
  if (state.entry === "author") return 0;
  return Number(state.qty !== "18") + Number(state.status !== "open") + Number(state.command !== "UPDATE") + Number(state.key !== "order-1042") + Number(state.snapshot);
}
