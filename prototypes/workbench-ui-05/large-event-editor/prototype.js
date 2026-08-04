const variants = {
  A: { label: "A — Injection Matrix", render: renderMatrix },
  B: { label: "B — Draft Document", render: renderDocument },
  C: { label: "C — Focus Queue", render: renderFocusQueue }
};

const query = new URLSearchParams(window.location.search);
const state = {
  variant: variants[query.get("variant")] ? query.get("variant") : "A",
  fieldCount: [84, 240, 500].includes(Number(query.get("fields"))) ? Number(query.get("fields")) : 84,
  scenario: ["ready", "invalid", "stale"].includes(query.get("scenario")) ? query.get("scenario") : "invalid",
  filter: "all",
  queueFilter: "problems",
  search: "",
  selected: "routing_metadata",
  drawerOpen: true,
  outlineOpen: true,
  compareOpen: true,
  documentMode: "tree",
  review: false,
  outcome: false,
  changedPolicy: "Automatic"
};

let fields = buildFields(state.fieldCount);
let searchRenderTimer = 0;
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
  if (action === "filter") state.filter = target.dataset.filter ?? "all";
  if (action === "queue-filter") state.queueFilter = target.dataset.filter ?? "problems";
  if (action === "select") state.selected = target.dataset.field ?? state.selected;
  if (action === "toggle-drawer") state.drawerOpen = !state.drawerOpen;
  if (action === "toggle-outline") state.outlineOpen = !state.outlineOpen;
  if (action === "toggle-compare") state.compareOpen = !state.compareOpen;
  if (action === "document-mode") state.documentMode = target.dataset.mode ?? "tree";
  if (action === "review") state.review = true;
  if (action === "edit") state.review = false;
  if (action === "inject") state.outcome = true;
  if (action === "close-outcome") state.outcome = false;
  if (action === "next-problem") selectRelativeProblem(1);
  if (action === "next-field") selectRelativeField(1);
  if (action === "previous-field") selectRelativeField(-1);
  if (action === "fix-selected") fixSelectedField();
  if (action === "reset-selected") resetSelectedField();
  if (action === "toggle-changed") toggleSelectedChanged();
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
  if (target.name === "field-search") return;
  let handled = false;
  if (target.name === "field-count") {
    state.fieldCount = Number(target.value);
    fields = buildFields(state.fieldCount);
    state.selected = "routing_metadata";
    handled = true;
  }
  if (target.name === "scenario") {
    state.scenario = target.value;
    handled = true;
  }
  if (target.name === "changed-policy") {
    state.changedPolicy = target.value;
    handled = true;
  }
  if (target.dataset.fieldValue) {
    updateField(target.dataset.fieldValue, target.value);
    handled = true;
  }
  if (!handled) return;
  updateUrl();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.name !== "field-search") return;
  state.search = target.value;
  window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(() => {
    render();
    const input = document.querySelector('input[name="field-search"]');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }, 80);
});

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  if (event.key === "F8") {
    event.preventDefault();
    selectRelativeProblem(event.shiftKey ? -1 : 1);
    render();
    return;
  }
  if (event.altKey && event.key === "ArrowDown") {
    event.preventDefault();
    selectRelativeField(1);
    render();
    return;
  }
  if (event.altKey && event.key === "ArrowUp") {
    event.preventDefault();
    selectRelativeField(-1);
    render();
    return;
  }
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement || active?.getAttribute("contenteditable") === "true") return;
  cycleVariant(event.key === "ArrowRight" ? 1 : -1);
});

function buildFields(count) {
  const seeded = [
    field("COMMAND", "command", "command", "UPDATE", "UPDATE", true),
    field("COMMAND", "key", "string", "order-1042", "order-1042", true),
    field("Order", "qty", "number", "18", "42", true),
    field("Order", "status", "string", "open", "review", true),
    field("Order", "side", "string", "BUY", "BUY", false),
    field("Order", "order_type", "string", "LIMIT", "LIMIT", false),
    field("Order", "limit_price", "number", "42.15", "42.15", false),
    field("Order", "average_price", "number", "41.88", "42.02", true),
    field("Order", "filled_qty", "number", "12", "12", false),
    field("Order", "remaining_qty", "number", "6", "30", true),
    field("Instrument", "symbol", "string", "LS-CORP", "LS-CORP", false),
    field("Instrument", "venue", "string", "XNAS", "XNAS", false),
    field("Instrument", "currency_code", "string", "USD", "US", true, "Use a three-letter currency code."),
    field("Instrument", "tick_size", "number", "0.01", "0.01", false),
    field("Customer", "account_id", "string", "acct-7781", "acct-7781", false),
    field("Customer", "customer_segment", "string", "professional", "professional", false),
    field("Risk", "risk_score", "number", "71", "84", true),
    field("Risk", "risk_status", "string", "monitor", "review", true),
    field("Risk", "compliance_hold", "boolean", "false", "false", false),
    field("Routing", "route", "string", "SMART", "SMART", false),
    field("Routing", "routing_metadata", "json", '{"priority":"normal","owner":{"team":"execution"},"venues":["XNAS","BATS"]}', '{"priority":"urgent","owner":{"team":"execution"},"venues":["XNAS","BATS"]}', true, "Duplicate venue code in fallbackRoutes[2].", true),
    field("Routing", "allocations", "json", '[{"book":"primary","qty":12},{"book":"hedge","qty":6}]', '[{"book":"primary","qty":24},{"book":"hedge","qty":18}]', true, "", true),
    field("Audit", "audit_context", "json", '{"trace":"tr-9931","actor":"matching-engine","attempt":3}', '{"trace":"tr-9931","actor":"workbench-local","attempt":4}', true, "", true),
    field("Audit", "update_reason", "string", "market movement", "local scenario", true),
    field("Audit", "server_timestamp", "string", "2026-08-03T21:08:41.238Z", "2026-08-03T21:08:41.238Z", false)
  ];
  const groups = ["Pricing", "Execution", "Settlement", "Diagnostics", "Adapter", "Custom"];
  let index = 1;
  while (seeded.length < count) {
    const group = groups[(index - 1) % groups.length];
    const name = `${group.toLowerCase()}_${String(index).padStart(3, "0")}`;
    const source = index % 7 === 0 ? "" : `value-${index}`;
    const changed = index % 19 === 0;
    seeded.push(field(group, name, index % 11 === 0 ? "number" : "string", source, changed ? `scenario-${index}` : source, changed));
    index += 1;
  }
  return seeded;
}

function field(group, name, type, source, draft, changed, error = "", structured = false) {
  return { group, name, type, source, draft, changed, sourceChanged: changed, error, structured };
}

function render() {
  document.documentElement.dataset.variant = state.variant;
  variantLabel.textContent = variants[state.variant].label;
  lab.innerHTML = renderLab();
  root.innerHTML = renderShell(state.outcome ? renderOutcome() : state.review ? renderReview() : variants[state.variant].render());
}

function renderShell(content) {
  const issueCount = visibleIssues().length;
  const blocked = state.scenario !== "ready" || issueCount > 0;
  return `<section class="prototype-canvas large-editor variant-${state.variant.toLowerCase()}">
    <header class="instrument-bar"><div class="instrument-state"><span class="signal success"></span><strong>Capture active</strong><span>Session S-9</span><span>Draft anchored to evt-1842</span></div><div class="bar-actions"><button type="button">Frozen · 37 newer</button><button type="button" aria-label="More actions">⋮</button></div></header>
    <div class="editor-titlebar"><button type="button">← Evidence · evt-1842</button><div><span class="eyebrow">Temporary primary workspace</span><strong>Local Injection Draft D-7</strong></div><span class="dirty-pill">${changedFields().length} value differences</span><span class="issue-pill ${blocked ? "blocked" : "ready"}">${blocked ? `${Math.max(1, issueCount)} issue${issueCount === 1 ? "" : "s"}` : "Ready"}</span></div>
    <div class="target-strip"><span><b>Target</b> sub-7 · orders.command / portfolio · COMMAND · Session S-9 · 2 listeners</span><span><b>Source</b> evt-1842 · Server Update · immutable</span><span class="local-boundary">LOCAL ONLY · server not contacted</span></div>
    ${content}
    ${!state.review && !state.outcome ? `<footer class="editor-footer"><div><strong>${visibleIssues().length} errors · ${changedFields().length} differences · ${declaredChanged().length} declared changed</strong><span>${state.fieldCount} Lightstreamer fields · target checked 2s ago</span></div><button class="primary" type="button" data-action="review" ${blocked ? "disabled" : ""}>Review Local Injection…</button></footer>` : ""}
  </section>`;
}

function renderLab() {
  return `<span class="lab-heading">Prototype data</span><label>Payload size<select name="field-count"><option value="84" ${state.fieldCount === 84 ? "selected" : ""}>84 fields</option><option value="240" ${state.fieldCount === 240 ? "selected" : ""}>240 fields</option><option value="500" ${state.fieldCount === 500 ? "selected" : ""}>500 fields</option></select></label><label>Validation state<select name="scenario"><option value="invalid" ${state.scenario === "invalid" ? "selected" : ""}>2 field issues</option><option value="ready" ${state.scenario === "ready" ? "selected" : ""}>Ready</option><option value="stale" ${state.scenario === "stale" ? "selected" : ""}>Target stale</option></select></label><small>Test scaffolding—not proposed UI.</small>`;
}

function renderMatrix() {
  const shown = filteredFields();
  return `<main class="matrix-workspace">
    <div class="meta-strip"><span><b>command</b> UPDATE</span><span><b>key</b> order-1042</span><span><b>snapshot</b> false</span><span><b>changed policy</b> ${state.changedPolicy}</span><button type="button">Undo</button><button type="button">Bulk edit…</button></div>
    ${editorToolbar("Search field, Source, or Draft…")}
    <div class="matrix-main ${state.drawerOpen ? "drawer-open" : ""}">
      <section class="matrix-grid" role="grid"><div class="matrix-row matrix-head"><span>!</span><span>Field</span><span>Type</span><span>Source · immutable</span><span>Draft · editable</span><span>Δ</span><span>Changed?</span></div>${shown.map(matrixRow).join("")}</section>
      ${state.drawerOpen ? renderFieldDrawer() : ""}
    </div>
    <div class="matrix-status"><span>${shown.length} of ${state.fieldCount} fields</span><button type="button">Select visible</button><button type="button">Paste block…</button><button type="button" data-action="toggle-drawer">${state.drawerOpen ? "Close field detail" : "Open field detail"}</button></div>
  </main>`;
}

function matrixRow(item) {
  const selected = item.name === state.selected;
  const issue = fieldIssue(item);
  return `<button class="matrix-row ${selected ? "selected" : ""} ${item.changed ? "modified" : ""} ${issue ? "error" : ""}" type="button" data-action="select" data-field="${item.name}" role="row"><span>${issue ? "!" : ""}</span><span><strong>${item.name}</strong><small>${item.group}</small></span><span>${item.type}</span><span class="mono clipped">${escapeHtml(item.source || "(empty string)")}</span><span class="draft-cell">${escapeHtml(shortValue(item.draft))}</span><span>${item.source === item.draft ? "=" : "≠"}</span><span>${item.changed ? "✓" : "—"}</span></button>`;
}

function renderFieldDrawer() {
  const item = selectedField();
  return `<aside class="field-drawer"><div class="drawer-heading"><div><span class="eyebrow">Expanded cell editor</span><strong>${item.name}</strong><small>${fieldPosition(item)} · ${item.type}</small></div><button type="button" data-action="toggle-drawer">×</button></div><label><span>Source · immutable</span><textarea readonly>${escapeHtml(item.source)}</textarea></label><label><span>Draft value</span><textarea data-field-value="${item.name}">${escapeHtml(item.draft)}</textarea></label>${issueBlock(item)}<div class="drawer-actions"><button type="button" data-action="reset-selected">Reset field</button><button type="button" data-action="toggle-changed">Changed: ${item.changed ? "included" : "excluded"}</button>${fieldIssue(item) ? `<button class="primary" type="button" data-action="fix-selected">Apply suggested fix</button>` : ""}</div><p>Value difference and Lightstreamer changed-field membership are independent.</p></aside>`;
}

function renderDocument() {
  return `<main class="document-workspace ${state.outlineOpen ? "outline-open" : ""} ${state.compareOpen ? "compare-open" : ""}">
    <div class="document-toolbar"><button type="button" data-action="toggle-outline">☰ Outline</button><input name="field-search" value="${escapeHtml(state.search)}" placeholder="Search paths or values…"/><div class="mode-tabs"><button class="${state.documentMode === "tree" ? "active" : ""}" type="button" data-action="document-mode" data-mode="tree">Tree</button><button class="${state.documentMode === "raw" ? "active" : ""}" type="button" data-action="document-mode" data-mode="raw">Raw JSON</button></div><button type="button" data-action="toggle-compare">${state.compareOpen ? "Hide Source" : "Compare Source"}</button></div>
    <div class="document-main">
      ${state.outlineOpen ? renderOutline() : ""}
      <section class="document-editor">${state.documentMode === "raw" ? renderRawDocument() : renderTreeDocument()}</section>
      ${state.compareOpen ? renderSourceCompare() : ""}
    </div>
  </main>`;
}

function renderOutline() {
  const groups = groupedFields();
  return `<aside class="document-outline"><div class="outline-stats"><button class="active" type="button">Problems ${visibleIssues().length}</button><button type="button">Differences ${changedFields().length}</button><button type="button">All ${state.fieldCount}</button></div>${Object.entries(groups).map(([group, items]) => `<section><strong>▾ ${group}</strong>${items.slice(0, 14).map((item) => `<button class="${item.name === state.selected ? "selected" : ""}" type="button" data-action="select" data-field="${item.name}"><span>${item.structured ? "▸" : "•"} ${item.name}</span><em>${fieldIssue(item) ? "!" : item.changed ? "Δ" : ""}</em></button>`).join("")}</section>`).join("")}</aside>`;
}

function renderTreeDocument() {
  const shown = filteredFields().slice(0, Math.min(state.fieldCount, 90));
  const current = selectedField();
  return `<div class="document-heading"><div><span class="eyebrow">Draft document</span><h1>COMMAND update · order-1042</h1></div><span>${shown.length} visible paths</span></div><section class="semantic-document"><div class="document-group"><strong>▾ COMMAND semantics</strong><button type="button" data-action="select" data-field="command"><span>command</span><code>UPDATE</code></button><button type="button" data-action="select" data-field="key"><span>key</span><code>order-1042</code></button><button type="button"><span>snapshot</span><code>false</code></button></div>${current.structured ? `<div class="document-group current-path"><strong>▾ Current structured field</strong>${documentRow(current)}</div>` : ""}${renderDocumentGroups(shown)}</section>`;
}

function renderDocumentGroups(items) {
  const groups = {};
  for (const item of items.filter((entry) => !["command", "key"].includes(entry.name) && !(entry.name === state.selected && entry.structured))) (groups[item.group] ??= []).push(item);
  return Object.entries(groups).map(([group, members]) => `<div class="document-group"><strong>▾ ${group}</strong>${members.map(documentRow).join("")}</div>`).join("");
}

function documentRow(item) {
  if (item.name === state.selected && item.structured) {
    return `<div class="document-node expanded ${fieldIssue(item) ? "error" : ""}"><button type="button" data-action="select" data-field="${item.name}"><span>▾ ${item.name}</span><em>${item.changed ? "Δ" : ""}</em></button><div class="nested-path"><span>priority</span><input value="urgent"/><small>source: normal</small></div><div class="nested-path level"><span>▾ owner</span><code>{…}</code></div><div class="nested-path level-2"><span>team</span><input value="execution"/></div><div class="nested-path level"><span>▾ venues</span><code>[2 values]</code></div>${fieldIssue(item) ? `<p class="inline-error">! ${fieldIssue(item)}</p>` : ""}<small>Nested edits serialize the complete top-level ${item.name} field.</small></div>`;
  }
  return `<button class="document-node ${item.name === state.selected ? "selected" : ""} ${fieldIssue(item) ? "error" : ""}" type="button" data-action="select" data-field="${item.name}"><span>${item.structured ? "▸" : ""} ${item.name}</span><code>${escapeHtml(shortValue(item.draft))}</code><em>${fieldIssue(item) ? "!" : item.changed ? "Δ" : ""}</em></button>`;
}

function renderRawDocument() {
  const body = Object.fromEntries(fields.slice(0, Math.min(state.fieldCount, 60)).map((item) => [item.name, item.draft]));
  return `<div class="document-heading"><div><span class="eyebrow">Bulk edit mode</span><h1>Raw draft fields</h1></div><span>Last valid structured draft retained</span></div><textarea class="raw-document" aria-label="Raw draft JSON">${escapeHtml(JSON.stringify(body, null, 2))}</textarea><p class="raw-note">Target identity is outside this document. Applying raw JSON cannot retarget the Local Injection.</p>`;
}

function renderSourceCompare() {
  const item = selectedField();
  return `<aside class="source-compare"><div class="drawer-heading"><div><span class="eyebrow">Injection Source · immutable</span><strong>${item.name}</strong><small>evt-1842 · synchronized path</small></div><button type="button" data-action="toggle-compare">×</button></div><pre>${escapeHtml(item.source)}</pre><div class="path-diff"><span>Current path difference</span><strong>${escapeHtml(shortValue(item.source))}</strong><i>→</i><strong>${escapeHtml(shortValue(item.draft))}</strong></div><button type="button" data-action="reset-selected">Restore top-level field</button><p>Lightstreamer changed semantics apply to the complete top-level field, not nested JSON paths.</p></aside>`;
}

function renderFocusQueue() {
  const item = selectedField();
  const queue = state.queueFilter === "problems" ? problemFields() : state.queueFilter === "changed" ? changedFields() : filteredFields();
  return `<main class="focus-workspace">
    <aside class="field-map"><div class="field-search"><input name="field-search" value="${escapeHtml(state.search)}" placeholder="Search ${state.fieldCount} fields…"/></div><div class="queue-tabs"><button class="${state.queueFilter === "problems" ? "active" : ""}" type="button" data-action="queue-filter" data-filter="problems">Issues ${visibleIssues().length}</button><button class="${state.queueFilter === "changed" ? "active" : ""}" type="button" data-action="queue-filter" data-filter="changed">Modified ${changedFields().length}</button><button class="${state.queueFilter === "all" ? "active" : ""}" type="button" data-action="queue-filter" data-filter="all">All ${state.fieldCount}</button></div><div class="field-map-list">${queue.slice(0, 80).map((entry) => `<button class="${entry.name === state.selected ? "selected" : ""} ${fieldIssue(entry) ? "error" : ""}" type="button" data-action="select" data-field="${entry.name}"><span><strong>${entry.name}</strong><small>${entry.group} · ${entry.type}</small></span><em>${fieldIssue(entry) ? "!" : entry.changed ? "Δ" : ""}</em></button>`).join("")}</div></aside>
    <section class="focus-station"><div class="focus-heading"><div><span class="eyebrow">Focus station · ${fieldPosition(item)}</span><h1>${item.name}</h1></div><div><button type="button" data-action="previous-field">↑ Previous</button><button type="button" data-action="next-field">Next ↓</button></div></div><div class="value-stack"><label><span>Injection Source · immutable</span><textarea readonly>${escapeHtml(item.source)}</textarea></label><label><span>Injection Draft</span><textarea data-field-value="${item.name}">${escapeHtml(item.draft)}</textarea></label></div>${issueBlock(item)}<div class="field-semantics"><div><span>Value</span><strong>${item.source === item.draft ? "Same as source" : "Modified"}</strong></div><div><span>changedFields</span><strong>${item.changed ? "Included" : "Excluded"}</strong></div><label><span>Policy</span><select name="changed-policy"><option ${state.changedPolicy === "Automatic" ? "selected" : ""}>Automatic</option><option ${state.changedPolicy === "Manual" ? "selected" : ""}>Manual</option></select></label><button type="button" data-action="toggle-changed">Toggle membership</button></div><div class="focus-actions"><button type="button" data-action="reset-selected">Reset field</button>${fieldIssue(item) ? `<button class="primary" type="button" data-action="fix-selected">Apply suggested fix</button>` : ""}<button type="button" data-action="next-problem">Next issue · F8</button></div></section>
    <aside class="patch-queue"><div class="patch-heading"><span class="eyebrow">Work queue</span><strong>Intentional draft changes</strong></div><section><h2>Blocking issues · ${visibleIssues().length}</h2>${problemFields().map((entry) => `<button type="button" data-action="select" data-field="${entry.name}"><span>!</span><div><strong>${entry.name}</strong><small>${fieldIssue(entry)}</small></div></button>`).join("") || "<p>No blocking issues.</p>"}</section><section><h2>Net patches · ${changedFields().length}</h2>${changedFields().slice(0, 10).map((entry) => `<button type="button" data-action="select" data-field="${entry.name}"><span>Δ</span><div><strong>${entry.name}</strong><small>${shortValue(entry.source)} → ${shortValue(entry.draft)}</small></div><em>↶</em></button>`).join("")}</section><button type="button">Preview batch operation…</button><button type="button">Undo last patch</button></aside>
  </main>`;
}

function editorToolbar(placeholder) {
  const filters = [["all", `All ${state.fieldCount}`], ["modified", `Modified ${changedFields().length}`], ["changed", `Declared ${declaredChanged().length}`], ["problems", `Errors ${visibleIssues().length}`], ["structured", "Structured"]];
  return `<div class="editor-toolbar"><input name="field-search" value="${escapeHtml(state.search)}" placeholder="${placeholder}"/>${filters.map(([key, label]) => `<button class="${state.filter === key ? "active" : ""}" type="button" data-action="filter" data-filter="${key}">${label}</button>`).join("")}<span class="toolbar-spacer"></span><button type="button">Group: schema</button><button type="button">Columns…</button></div>`;
}

function renderReview() {
  return `<main class="execution-review"><div class="review-heading"><span class="eyebrow">Read-only execution review</span><h1>Review the large Local Injection payload</h1><p>The editable workspace is preserved. Target and listener availability are checked again when you execute.</p></div><div class="review-grid"><section><h2>Exact target</h2><dl><dt>Subscription</dt><dd>sub-7 · orders.command</dd><dt>Session / item</dt><dd>S-9 / portfolio</dd><dt>Listeners</dt><dd>2 current</dd><dt>Boundary</dt><dd>Local inspected-page runtime only</dd></dl></section><section><h2>Payload</h2><dl><dt>COMMAND</dt><dd>UPDATE / order-1042</dd><dt>Snapshot</dt><dd>false</dd><dt>Total fields</dt><dd>${state.fieldCount}</dd><dt>Value differences</dt><dd>${changedFields().length}</dd><dt>Declared changed</dt><dd>${declaredChanged().length}</dd></dl></section><section class="review-differences"><h2>Differences from immutable source</h2>${changedFields().slice(0, 14).map((item) => `<div><strong>${item.name}</strong><span>${escapeHtml(shortValue(item.source))}</span><i>→</i><span>${escapeHtml(shortValue(item.draft))}</span></div>`).join("")}</section></div><div class="review-boundary"><div><strong>One additional Logical Update → every current listener of sub-7</strong><p>Lightstreamer Server is not contacted. Observed Server COMMAND State will not change.</p></div><button type="button" data-action="edit">← Back to editor</button><button class="primary" type="button" data-action="inject">Inject locally</button></div></main>`;
}

function renderOutcome() {
  return `<main class="large-outcome"><div class="outcome-mark">✓</div><div><span class="eyebrow">Injection inj-18 · delivered</span><h1>Delivered locally to 2 of 2 listeners</h1><p>The marked Injected Update is additional evidence. This outcome confirms the local delivery boundary only.</p><div class="projection-summary"><section><span>Observed Server COMMAND State</span><strong>Unchanged</strong></section><section><span>Local Effective COMMAND State</span><strong>Advanced by inj-18</strong></section></div><div><button class="primary" type="button">Trace Injected Update</button><button type="button" data-action="close-outcome">Return to draft</button><button type="button">Start another Injection</button></div></div></main>`;
}

function filteredFields() {
  const needle = state.search.trim().toLowerCase();
  return fields.filter((item) => {
    const matchesSearch = !needle || `${item.name} ${item.source} ${item.draft} ${item.group} ${fieldIssue(item)}`.toLowerCase().includes(needle);
    if (!matchesSearch) return false;
    if (state.filter === "modified") return item.source !== item.draft;
    if (state.filter === "changed") return item.changed;
    if (state.filter === "problems") return Boolean(fieldIssue(item));
    if (state.filter === "structured") return item.structured;
    return true;
  });
}

function groupedFields() {
  const groups = {};
  for (const item of filteredFields()) (groups[item.group] ??= []).push(item);
  return groups;
}

function selectedField() {
  return fields.find((item) => item.name === state.selected) ?? fields[0];
}

function changedFields() {
  return fields.filter((item) => item.source !== item.draft);
}

function declaredChanged() {
  return fields.filter((item) => item.changed);
}

function problemFields() {
  return fields.filter((item) => Boolean(fieldIssue(item)));
}

function visibleIssues() {
  if (state.scenario === "ready") return [];
  if (state.scenario === "stale") return [{ name: "target", error: "Target Subscription retired." }];
  return problemFields();
}

function fieldIssue(item) {
  return state.scenario === "invalid" ? item.error : "";
}

function issueBlock(item) {
  const issue = fieldIssue(item);
  return issue ? `<div class="field-issue" role="alert"><span>!</span><div><strong>Blocking validation issue</strong><p>${issue}</p></div></div>` : "";
}

function updateField(name, value) {
  const item = fields.find((entry) => entry.name === name);
  if (!item) return;
  item.draft = value;
  item.changed = item.source !== value || item.sourceChanged;
  if (name === "currency_code" && /^[A-Z]{3}$/.test(value)) item.error = "";
  if (name === "routing_metadata" && value.includes("fallbackRoutes")) item.error = "";
}

function fixSelectedField() {
  const item = selectedField();
  if (item.name === "currency_code") item.draft = "USD";
  if (item.name === "routing_metadata") item.draft = '{"priority":"urgent","owner":{"team":"execution"},"venues":["XNAS","BATS"],"fallbackRoutes":["ARCX"]}';
  item.error = "";
  item.changed = item.source !== item.draft;
}

function resetSelectedField() {
  const item = selectedField();
  item.draft = item.source;
  item.changed = item.sourceChanged;
  item.error = "";
}

function toggleSelectedChanged() {
  selectedField().changed = !selectedField().changed;
  state.changedPolicy = "Manual";
}

function selectRelativeField(delta) {
  const index = fields.findIndex((item) => item.name === state.selected);
  state.selected = fields[(index + delta + fields.length) % fields.length].name;
}

function selectRelativeProblem(delta) {
  const problems = problemFields();
  if (!problems.length) return;
  const index = problems.findIndex((item) => item.name === state.selected);
  state.selected = problems[(Math.max(index, 0) + delta + problems.length) % problems.length].name;
}

function fieldPosition(item) {
  return `field ${fields.indexOf(item) + 1} of ${fields.length}`;
}

function shortValue(value) {
  const single = String(value).replace(/\s+/g, " ");
  return single.length > 42 ? `${single.slice(0, 39)}…` : single || "(empty string)";
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  state.review = false;
  state.outcome = false;
  updateUrl();
  render();
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("fields", String(state.fieldCount));
  url.searchParams.set("scenario", state.scenario);
  window.history.replaceState({}, "", url);
}
