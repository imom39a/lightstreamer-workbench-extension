// PROTOTYPE: three raw-JSON-first Local Injection editor structures, switchable with ?variant=.
const variants = {
  A: { label: "A — Payload Document", render: renderPayloadDocument },
  B: { label: "B — Conditional Event Rail", render: renderEventRail },
  C: { label: "C — Batch Document", render: renderBatchDocument }
};

const query = new URLSearchParams(window.location.search);
document.documentElement.dataset.presentation = query.get("presentation") === "1" ? "true" : "false";
const state = {
  variant: variants[query.get("variant")] ? query.get("variant") : "A",
  fieldCount: [84, 240, 500].includes(Number(query.get("fields"))) ? Number(query.get("fields")) : 240,
  eventCount: Number(query.get("events")) === 6 ? 6 : 1,
  scenario: ["ready", "invalid", "stale"].includes(query.get("scenario")) ? query.get("scenario") : "ready",
  selectedEvent: 0,
  compare: query.get("compare") === "1",
  problems: false,
  review: false,
  railCollapsed: false,
  line: 1,
  column: 1
};

const root = document.querySelector("#prototype");
const lab = document.querySelector("#prototype-lab");
const variantLabel = document.querySelector("#variant-label");
let drafts = buildDrafts(state.eventCount, state.fieldCount);
let batchText = makeBatchText();

render();

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button, [data-action]") : null;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.switch) return cycleVariant(target.dataset.switch === "next" ? 1 : -1);
  const action = target.dataset.action;
  if (!action) return;

  if (action === "compare") state.compare = !state.compare;
  if (action === "problems") state.problems = !state.problems;
  if (action === "review") state.review = true;
  if (action === "edit") state.review = false;
  if (action === "close-review") state.review = false;
  if (action === "toggle-rail") state.railCollapsed = !state.railCollapsed;
  if (action === "select-event") {
    state.selectedEvent = Number(target.dataset.event ?? 0);
    state.review = false;
  }
  if (action === "next-event") selectEvent(1);
  if (action === "previous-event") selectEvent(-1);
  if (action === "format") formatCurrentText();
  if (action === "introduce-error") introduceSyntaxError();
  if (action === "fix-error") repairCurrentText();
  if (action === "next-problem") focusFirstProblem();

  updateUrl();
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.name === "field-count") {
    state.fieldCount = Number(target.value);
    rebuildDrafts();
  }
  if (target.name === "event-count") {
    state.eventCount = Number(target.value);
    state.selectedEvent = 0;
    rebuildDrafts();
  }
  if (target.name === "scenario") {
    state.scenario = target.value;
    applyScenario();
  }
  updateUrl();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-json-editor]")) return;
  if (state.variant === "C" && state.eventCount > 1) {
    batchText = target.value;
  } else {
    currentDraft().text = target.value;
  }
  state.scenario = parseCurrent().valid ? "ready" : "invalid";
  updateCaret(target);
  syncEditor(target);
  renderStatusOnly();
});

document.addEventListener("scroll", (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.matches("[data-json-editor]")) syncEditor(target);
}, true);

document.addEventListener("keyup", (event) => {
  const target = event.target;
  if (target instanceof HTMLTextAreaElement && target.matches("[data-json-editor]")) {
    updateCaret(target);
    renderStatusOnly();
  }
});

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active instanceof HTMLSelectElement;
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    if (canReview()) {
      state.review = true;
      render();
    }
    return;
  }
  if (event.key === "F8") {
    event.preventDefault();
    focusFirstProblem();
    render();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b" && state.variant === "B" && state.eventCount > 1) {
    event.preventDefault();
    state.railCollapsed = !state.railCollapsed;
    render();
    return;
  }
  if (event.key === "Escape" && (state.review || state.compare || state.problems)) {
    event.preventDefault();
    if (state.review) state.review = false;
    else if (state.compare) state.compare = false;
    else state.problems = false;
    render();
    return;
  }
  if (!editing && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    cycleVariant(event.key === "ArrowRight" ? 1 : -1);
  }
});

function rebuildDrafts() {
  drafts = buildDrafts(state.eventCount, state.fieldCount);
  batchText = makeBatchText();
  applyScenario();
}

function buildDrafts(eventCount, fieldCount) {
  return Array.from({ length: eventCount }, (_, index) => {
    const source = buildPayload(fieldCount, index, false);
    const draft = buildPayload(fieldCount, index, true);
    return {
      id: index === 0 ? "evt-1842" : index === 1 ? "new-01" : `evt-${1842 - index * 7}`,
      source,
      draft,
      sourceText: JSON.stringify(source, null, 2),
      text: JSON.stringify(draft, null, 2),
      target: index % 3 === 1 ? "inventory.command / warehouse" : "orders.command / portfolio",
      subscription: index % 3 === 1 ? "sub-11" : "sub-7",
      session: index > 3 ? "S-12" : "S-9",
      listeners: index % 4 === 2 ? 1 : 2,
      sourceKind: index === 1 ? "Newly authored" : "Server Update"
    };
  });
}

function buildPayload(fieldCount, eventIndex, edited) {
  const key = `order-${1042 + eventIndex}`;
  const command = eventIndex === 1 ? "ADD" : eventIndex === 4 ? "DELETE" : "UPDATE";
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
    audit_context: edited
      ? '{"trace":"tr-9931","actor":"workbench-local","attempt":4}'
      : '{"trace":"tr-9931","actor":"matching-engine","attempt":3}',
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

function render() {
  document.documentElement.dataset.variant = state.variant;
  variantLabel.textContent = variants[state.variant].label;
  lab.innerHTML = renderLab();
  root.innerHTML = renderShell(state.review ? renderReview() : variants[state.variant].render());
  requestAnimationFrame(restoreEditorScroll);
}

function renderLab() {
  return `<strong>Prototype data</strong>
    <label>Payload<select name="field-count"><option value="84" ${selected(state.fieldCount, 84)}>84 fields</option><option value="240" ${selected(state.fieldCount, 240)}>240 fields</option><option value="500" ${selected(state.fieldCount, 500)}>500 fields</option></select></label>
    <label>Drafts<select name="event-count"><option value="1" ${selected(state.eventCount, 1)}>1 event · today</option><option value="6" ${selected(state.eventCount, 6)}>6 events · future</option></select></label>
    <label>State<select name="scenario"><option value="ready" ${selected(state.scenario, "ready")}>Ready</option><option value="invalid" ${selected(state.scenario, "invalid")}>Invalid JSON</option><option value="stale" ${selected(state.scenario, "stale")}>Target stale</option></select></label>
    <small>Test scaffolding—not proposed UI.</small>`;
}

function renderShell(content) {
  const draft = currentDraft();
  const parsed = parseCurrent();
  const future = state.eventCount > 1;
  const stale = state.scenario === "stale";
  return `<section class="prototype-canvas variant-${state.variant.toLowerCase()} ${future ? "future-multi" : "single-event"}">
    <header class="context-header">
      <div class="context-title"><button type="button" class="back-button">← Evidence · ${draft.id}</button><span class="title-divider"></span><strong>Local Injection Draft</strong><span class="dirty-dot" title="Draft differs from source"></span>${state.variant === "A" && future ? renderPager() : ""}</div>
      <div class="context-status ${stale ? "blocked" : ""}"><span>${stale ? "Target unavailable" : `${draft.listeners} listeners · live`}</span><span>${parsed.valid ? `${differenceCount(draft)} differences` : "Invalid JSON"}</span></div>
    </header>
    <div class="target-bar ${stale ? "target-stale" : ""}"><span><b>Target</b> ${draft.subscription} · ${draft.target} · COMMAND · Session ${draft.session}</span><span><b>Source</b> ${draft.id} · ${draft.sourceKind} · immutable</span><span class="local-only">LOCAL ONLY · inspected runtime · server not contacted</span></div>
    ${content}
  </section>`;
}

function renderPayloadDocument() {
  return `<main class="document-workspace">
    ${renderEditorToolbar("Payload JSON", state.eventCount > 1 ? "Independent document" : "One event · one document")}
    ${renderEditorArea(currentText(), currentSourceText())}
    ${renderProblemsDrawer()}
    ${renderFooter()}
  </main>`;
}

function renderEventRail() {
  const hasRail = state.eventCount > 1;
  return `<main class="rail-workspace ${hasRail && !state.railCollapsed ? "rail-open" : ""}">
    ${hasRail && !state.railCollapsed ? renderDraftRail() : ""}
    <section class="rail-document">
      ${renderEditorToolbar("Draft JSON", hasRail ? `Event ${state.selectedEvent + 1} of ${state.eventCount}` : "Single event · no rail")}
      ${renderEditorArea(currentText(), currentSourceText())}
      ${renderProblemsDrawer()}
      ${renderFooter(hasRail ? `<button type="button" data-action="toggle-rail">${state.railCollapsed ? "Show events" : "Hide events"}</button>` : "")}
    </section>
  </main>`;
}

function renderBatchDocument() {
  const multi = state.eventCount > 1;
  const caption = multi ? `${state.eventCount} payloads in one JSON array` : "Single payload JSON";
  const sourceText = multi ? JSON.stringify(drafts.map((draft) => draft.source), null, 2) : currentSourceText();
  return `<main class="batch-workspace">
    ${multi ? renderBatchManifest() : ""}
    <section class="batch-document">
      ${renderEditorToolbar(multi ? "Batch payload document" : "Payload JSON", caption)}
      ${renderEditorArea(currentText(), sourceText)}
      ${renderProblemsDrawer()}
      ${renderFooter("", multi)}
    </section>
  </main>`;
}

function renderEditorToolbar(title, subtitle) {
  const parsed = parseCurrent();
  return `<div class="editor-toolbar">
    <div><strong>${title}</strong><span>${subtitle}</span></div>
    <div class="editor-actions">
      <button type="button" data-action="compare" class="${state.compare ? "active" : ""}">${state.compare ? "Close comparison" : "Compare source"}</button>
      <button type="button" data-action="format" ${parsed.valid ? "" : "disabled"}>Format</button>
      <button type="button" data-action="problems" class="${!parsed.valid || state.scenario === "stale" ? "has-problem" : ""}">Problems ${problemCount()}</button>
      ${state.variant === "B" && state.eventCount > 1 && state.railCollapsed ? `<button type="button" data-action="toggle-rail">Events ${state.selectedEvent + 1}/${state.eventCount}</button>` : ""}
    </div>
  </div>`;
}

function renderEditorArea(text, sourceText) {
  if (state.compare) {
    return `<div class="compare-layout">
      ${renderCompactDiffSummary()}
      <section class="compare-pane source-pane"><div><strong>Injection Source</strong><span>immutable</span></div>${renderReadOnlyCode(sourceText)}</section>
      <section class="compare-pane draft-pane"><div><strong>Injection Draft</strong><span>editable</span></div>${renderCodeEditor(text)}</section>
    </div>`;
  }
  return `<div class="single-editor">${renderCodeEditor(text)}</div>`;
}

function renderCompactDiffSummary() {
  const draft = currentDraft();
  const parsed = parseText(draft.text);
  const changed = parsed.valid
    ? [...new Set([...Object.keys(draft.source.fields), ...Object.keys(parsed.value.fields ?? {})])]
      .filter((key) => draft.source.fields[key] !== parsed.value.fields?.[key])
      .slice(0, 3)
      .map((key) => `<span><b>${key}</b> ${escapeHtml(shortValue(draft.source.fields[key]))} → ${escapeHtml(shortValue(parsed.value.fields[key]))}</span>`)
    : [];
  return `<div class="compact-diff"><strong>Unified source diff</strong>${changed.join("")}<em>${differenceCount(draft) > changed.length ? `+${differenceCount(draft) - changed.length} more` : ""}</em></div>`;
}

function renderCodeEditor(text) {
  return `<div class="code-editor ${parseCurrent().valid ? "valid" : "invalid"}">
    <pre class="line-numbers" aria-hidden="true">${makeLineNumbers(text)}</pre>
    <textarea data-json-editor aria-label="Editable Local Injection draft JSON" wrap="off" spellcheck="false">${escapeHtml(text)}</textarea>
    ${parseCurrent().valid ? "" : `<span class="error-marker" title="JSON syntax error">!</span>`}
  </div>`;
}

function renderReadOnlyCode(text) {
  return `<div class="code-editor readonly"><pre class="line-numbers" aria-hidden="true">${makeLineNumbers(text)}</pre><pre class="readonly-code">${syntaxHighlight(text)}</pre></div>`;
}

function renderFooter(prefix = "", batchBlocked = false) {
  const parsed = parseCurrent();
  const stale = state.scenario === "stale";
  const blocked = !parsed.valid || stale || batchBlocked;
  const batchMessage = batchBlocked ? "Future batch execution semantics intentionally undefined" : "";
  return `<footer class="editor-footer" data-status-region>
    <div class="footer-leading">${prefix}<span>Ln ${state.line}, Col ${state.column}</span><span class="${parsed.valid ? "ok" : "error"}">${parsed.valid ? "JSON valid" : "JSON invalid"}</span><span>${parsed.valid ? `${differenceCount(currentDraft())} differences` : parsed.error}</span><span>changedFields derived</span></div>
    <div class="footer-action">${batchMessage ? `<span class="batch-warning">${batchMessage}</span>` : ""}<button type="button" class="primary" data-action="review" ${blocked ? "disabled" : ""}>${state.eventCount > 1 ? "Review selected event…" : "Review Local Injection…"}</button></div>
  </footer>`;
}

function renderProblemsDrawer() {
  if (!state.problems) return "";
  const parsed = parseCurrent();
  const problems = [];
  if (!parsed.valid) problems.push(`<button type="button" data-action="next-problem"><b>JSON syntax</b><span>${escapeHtml(parsed.error)}</span><em>Blocking</em></button>`);
  if (state.scenario === "stale") problems.push(`<button type="button"><b>Local Injection Target</b><span>Exact Subscription ${currentDraft().subscription} is no longer available.</span><em>Blocking</em></button>`);
  if (parsed.valid && state.scenario !== "stale") problems.push(`<p>No blocking problems. Target and payload are ready for review.</p>`);
  return `<section class="problems-drawer"><header><strong>Problems</strong><button type="button" data-action="problems">×</button></header>${problems.join("")}</section>`;
}

function renderDraftRail() {
  return `<aside class="event-rail"><header><div><strong>Event drafts</strong><span>${state.selectedEvent + 1} / ${state.eventCount}</span></div><button type="button" data-action="toggle-rail" aria-label="Collapse event rail">‹</button></header>
    <div class="event-list">${drafts.map((draft, index) => {
      const parsed = parseText(draft.text);
      const selectedClass = index === state.selectedEvent ? "selected" : "";
      return `<button type="button" class="event-row ${selectedClass}" data-action="select-event" data-event="${index}"><span class="event-state ${parsed.valid ? "dirty" : "invalid"}"></span><span><strong>${draft.id}</strong><small>${draft.draft.command} / ${draft.draft.key}</small><small>${draft.target}</small></span><em>${parsed.valid ? `${draft.listeners}L` : "!"}</em></button>`;
    }).join("")}</div>
    <p>Navigation only. No batch selection or execution.</p>
  </aside>`;
}

function renderBatchManifest() {
  return `<aside class="batch-manifest"><header><strong>Target manifest</strong><span>read-only</span></header>${drafts.map((draft, index) => `<button type="button" data-action="select-event" data-event="${index}" class="${index === state.selectedEvent ? "selected" : ""}"><span>${index + 1}</span><span><b>${draft.id}</b><small>${draft.subscription} · ${draft.target}</small></span></button>`).join("")}<p>Array position maps to this locked manifest. Targets never enter editable JSON.</p></aside>`;
}

function renderPager() {
  return `<div class="event-pager"><button type="button" data-action="previous-event" aria-label="Previous event">‹</button><span>Event ${state.selectedEvent + 1} of ${state.eventCount}</span><button type="button" data-action="next-event" aria-label="Next event">›</button></div>`;
}

function renderReview() {
  const draft = currentDraft();
  const parsed = parseCurrent();
  return `<main class="review-surface">
    <header><div><span class="eyebrow">Read-only execution boundary</span><h1>Review Local Injection</h1></div><button type="button" data-action="close-review">×</button></header>
    <section class="review-summary">
      <dl><dt>Source</dt><dd>${draft.id} · ${draft.sourceKind} · immutable</dd><dt>Target</dt><dd>${draft.subscription} · ${draft.target} · Session ${draft.session}</dd><dt>Delivery</dt><dd>One Logical Update → ${draft.listeners} current listeners</dd><dt>COMMAND</dt><dd>${parsed.value?.command ?? "—"} / ${parsed.value?.key ?? "—"}</dd><dt>Payload</dt><dd>${Object.keys(parsed.value?.fields ?? {}).length} fields · ${differenceCount(draft)} differences</dd><dt>Snapshot</dt><dd>${String(parsed.value?.isSnapshot ?? false)}</dd></dl>
      <div class="boundary-card"><strong>LOCAL inspected-page runtime only</strong><p>The Lightstreamer Server will not be contacted. Observed Server COMMAND State will not change.</p></div>
    </section>
    <footer><button type="button" data-action="edit">Back to JSON</button><button type="button" class="primary">Inject locally into ${draft.subscription}</button></footer>
  </main>`;
}

function renderStatusOnly() {
  const region = document.querySelector("[data-status-region]");
  if (!(region instanceof HTMLElement)) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderFooter("", state.variant === "C" && state.eventCount > 1);
  region.replaceWith(wrapper.firstElementChild);
  const toolbarProblem = document.querySelector('[data-action="problems"]');
  if (toolbarProblem) toolbarProblem.textContent = `Problems ${problemCount()}`;
}

function currentDraft() {
  return drafts[state.selectedEvent] ?? drafts[0];
}

function currentText() {
  return state.variant === "C" && state.eventCount > 1 ? batchText : currentDraft().text;
}

function currentSourceText() {
  return currentDraft().sourceText;
}

function parseCurrent() {
  return parseText(currentText());
}

function parseText(text) {
  try {
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null) return { valid: false, error: "Draft JSON must be an object.", value: null };
    return { valid: true, error: "", value };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : "Invalid JSON", value: null };
  }
}

function differenceCount(draft) {
  const parsed = state.variant === "C" && state.eventCount > 1 ? { value: draft.draft, valid: true } : parseText(draft.text);
  if (!parsed.valid) return 0;
  const sourceFields = draft.source.fields;
  const draftFields = parsed.value?.fields ?? {};
  return new Set([...Object.keys(sourceFields), ...Object.keys(draftFields)]).size
    ? [...new Set([...Object.keys(sourceFields), ...Object.keys(draftFields)])].filter((key) => sourceFields[key] !== draftFields[key]).length
    : 0;
}

function problemCount() {
  return (parseCurrent().valid ? 0 : 1) + (state.scenario === "stale" ? 1 : 0);
}

function canReview() {
  return parseCurrent().valid && state.scenario !== "stale" && !(state.variant === "C" && state.eventCount > 1);
}

function selectEvent(direction) {
  state.selectedEvent = (state.selectedEvent + direction + state.eventCount) % state.eventCount;
  state.review = false;
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const current = keys.indexOf(state.variant);
  state.variant = keys[(current + direction + keys.length) % keys.length];
  state.review = false;
  updateUrl();
  render();
}

function formatCurrentText() {
  const parsed = parseCurrent();
  if (!parsed.valid) return;
  const formatted = JSON.stringify(parsed.value, null, 2);
  if (state.variant === "C" && state.eventCount > 1) batchText = formatted;
  else currentDraft().text = formatted;
}

function introduceSyntaxError() {
  if (state.variant === "C" && state.eventCount > 1) batchText = batchText.replace(/,\n(\s+)"status"/, "\n$1\"status\"");
  else currentDraft().text = currentDraft().text.replace(/,\n(\s+)"status"/, "\n$1\"status\"");
  state.scenario = "invalid";
}

function repairCurrentText() {
  if (state.variant === "C" && state.eventCount > 1) batchText = makeBatchText();
  else currentDraft().text = JSON.stringify(currentDraft().draft, null, 2);
  state.scenario = "ready";
}

function applyScenario() {
  if (state.scenario === "invalid") introduceSyntaxError();
  if (state.scenario === "ready") repairCurrentText();
}

function makeBatchText() {
  return JSON.stringify(drafts.map((draft) => draft.draft), null, 2);
}

function focusFirstProblem() {
  state.problems = true;
  requestAnimationFrame(() => document.querySelector(".problems-drawer button")?.focus());
}

function updateCaret(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  const lines = before.split("\n");
  state.line = lines.length;
  state.column = (lines.at(-1)?.length ?? 0) + 1;
}

function syncEditor(textarea) {
  const numbers = textarea.parentElement?.querySelector(".line-numbers");
  if (numbers instanceof HTMLElement) numbers.scrollTop = textarea.scrollTop;
  textarea.dataset.scrollTop = String(textarea.scrollTop);
  textarea.dataset.scrollLeft = String(textarea.scrollLeft);
}

function restoreEditorScroll() {
  document.querySelectorAll("textarea[data-json-editor]").forEach((editor) => {
    if (!(editor instanceof HTMLTextAreaElement)) return;
    editor.scrollTop = Number(editor.dataset.scrollTop ?? 0);
    editor.scrollLeft = Number(editor.dataset.scrollLeft ?? 0);
  });
}

function makeLineNumbers(text) {
  return Array.from({ length: text.split("\n").length }, (_, index) => index + 1).join("\n");
}

function shortValue(value) {
  if (value === undefined) return "(missing)";
  const text = String(value);
  return text.length > 18 ? `${text.slice(0, 15)}…` : text;
}

function syntaxHighlight(text) {
  return escapeHtml(text).replace(/(&quot;.*?&quot;)(\s*:)?/g, (match, value, colon) => `<span class="token-string">${value}</span>${colon ?? ""}`);
}

function selected(value, expected) {
  return value === expected ? "selected" : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("variant", state.variant);
  params.set("fields", String(state.fieldCount));
  params.set("events", String(state.eventCount));
  params.set("scenario", state.scenario);
  if (state.compare) params.set("compare", "1");
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}
