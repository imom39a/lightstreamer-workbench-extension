// PROTOTYPE: four research-backed raw JSON structures, switchable with ?variant=.
const variants = {
  D: { label: "D — Revision Editor", render: renderRevisionEditor },
  E: { label: "E — Patch Forge", render: renderPatchForge },
  F: { label: "F — Quiet Buffer", render: renderQuietBuffer },
  G: { label: "G — Draft Set", render: renderDraftSet }
};

const query = new URLSearchParams(window.location.search);
document.documentElement.dataset.presentation = query.get("presentation") === "1" ? "true" : "false";
const state = {
  variant: variants[query.get("variant")] ? query.get("variant") : "D",
  fieldCount: [84, 240, 500].includes(Number(query.get("fields"))) ? Number(query.get("fields")) : 240,
  bufferCount: [4, 6].includes(Number(query.get("drafts"))) ? Number(query.get("drafts")) : 1,
  scenario: ["ready", "invalid", "stale", "no-source"].includes(query.get("scenario")) ? query.get("scenario") : "ready",
  collapse: query.get("collapse") !== "0",
  patchView: "patch",
  paletteOpen: query.get("palette") === "1",
  paletteQuery: "",
  activeBuffer: 0,
  setCompare: query.get("compare") === "1",
  review: false,
  difference: 1
};

const root = document.querySelector("#prototype");
const lab = document.querySelector("#prototype-lab");
const variantLabel = document.querySelector("#variant-label");
let buffers = buildBuffers(state.bufferCount, state.fieldCount);

render();

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button, [data-action]") : null;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.switch) return cycleVariant(target.dataset.switch === "next" ? 1 : -1);
  const action = target.dataset.action;
  if (!action) return;
  if (action === "toggle-collapse") state.collapse = !state.collapse;
  if (action === "previous-diff") state.difference = state.difference <= 1 ? differenceCount() : state.difference - 1;
  if (action === "next-diff") state.difference = state.difference >= differenceCount() ? 1 : state.difference + 1;
  if (action === "patch-view") state.patchView = target.dataset.view ?? "patch";
  if (action === "set-view") state.setCompare = target.dataset.view === "compare";
  if (action === "palette") state.paletteOpen = !state.paletteOpen;
  if (action === "close-palette") state.paletteOpen = false;
  if (action === "select-buffer") {
    state.activeBuffer = Number(target.dataset.buffer ?? 0);
    state.paletteOpen = false;
    state.review = false;
  }
  if (action === "focus-buffer") {
    state.activeBuffer = Number(target.dataset.buffer ?? 0);
    state.review = false;
  }
  if (action === "review") state.review = true;
  if (action === "edit") state.review = false;
  updateUrl();
  render();
});

document.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.name === "field-count") state.fieldCount = Number(target.value);
  if (target.name === "buffer-count") {
    state.bufferCount = Number(target.value);
    state.activeBuffer = 0;
  }
  if (target.name === "scenario") state.scenario = target.value;
  buffers = buildBuffers(state.bufferCount, state.fieldCount);
  updateUrl();
  render();
});

document.addEventListener("input", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.name === "draft-switcher-search") {
    state.paletteQuery = target.value;
    render();
    requestAnimationFrame(() => {
      const search = document.querySelector('input[name="draft-switcher-search"]');
      if (search instanceof HTMLInputElement) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
      }
    });
  }
});

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  const editing = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active?.getAttribute("contenteditable") === "true";
  if (event.key === "Escape" && (state.review || state.paletteOpen)) {
    event.preventDefault();
    if (state.review) state.review = false;
    else state.paletteOpen = false;
    render();
    return;
  }
  if (event.key === "F7") {
    event.preventDefault();
    state.difference = event.shiftKey
      ? (state.difference <= 1 ? differenceCount() : state.difference - 1)
      : (state.difference >= differenceCount() ? 1 : state.difference + 1);
    render();
    return;
  }
  if (!editing && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    cycleVariant(event.key === "ArrowRight" ? 1 : -1);
  }
});

function buildBuffers(count, fieldCount) {
  const ids = ["evt-1842", "evt-1828", "evt-1814", "new-01", "evt-1780", "evt-1761"];
  const names = ["order-1042-update.json", "order-1044-update.json", "order-1046-delete.json", "authored-add.json", "order-1050-update.json", "order-1052-update.json"];
  return Array.from({ length: count }, (_, index) => {
    const source = buildPayload(fieldCount, index, false);
    const draft = buildPayload(fieldCount, index, true);
    if (index === 2) draft.fields.key = "";
    return {
      id: ids[index] ?? `evt-${1700 - index}`,
      name: names[index] ?? `event-${index + 1}.json`,
      source,
      draft,
      sourceText: JSON.stringify(source, null, 2),
      draftText: index === 2 ? JSON.stringify(draft, null, 2).replace(/,\n(\s+)"status"/, "\n$1\"status\"") : JSON.stringify(draft, null, 2),
      target: index % 2 ? "inventory.command / warehouse" : "orders.command / portfolio",
      subscription: index % 2 ? "sub-11" : "sub-7",
      command: index === 3 ? "ADD" : index === 2 ? "DELETE" : "UPDATE",
      key: `order-${1042 + index * 2}`,
      listeners: index === 1 ? 1 : 2,
      stale: index === 1,
      authored: index === 3
    };
  });
}

function buildPayload(fieldCount, eventIndex, edited) {
  const command = eventIndex === 3 ? "ADD" : eventIndex === 2 ? "DELETE" : "UPDATE";
  const key = `order-${1042 + eventIndex * 2}`;
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

function render() {
  document.documentElement.dataset.variant = state.variant;
  variantLabel.textContent = variants[state.variant].label;
  lab.innerHTML = renderLab();
  const content = state.review ? renderReview() : variants[state.variant].render();
  root.innerHTML = state.variant === "G" ? renderDraftSetShell(content) : renderShell(content);
}

function renderShell(content) {
  const buffer = currentBuffer();
  const stale = state.scenario === "stale" || buffer.stale;
  return `<section class="prototype-canvas research-canvas variant-${state.variant.toLowerCase()}">
    <header class="context-header"><div class="context-title"><button type="button" class="back-button">← Evidence · ${buffer.id}</button><span class="title-divider"></span><strong>Local Injection Draft</strong><span class="dirty-dot"></span></div><div class="context-status ${stale ? "blocked" : ""}"><span>${stale ? "Target unavailable" : `${buffer.listeners} listeners · live`}</span><span>${differenceCount()} differences</span></div></header>
    <div class="target-bar ${stale ? "target-stale" : ""}"><span><b>Target</b> ${buffer.subscription} · ${buffer.target} · COMMAND · Session S-9</span><span><b>Source</b> ${buffer.authored ? "None · newly authored" : `${buffer.id} · immutable`}</span><span class="local-only">LOCAL ONLY · inspected runtime · server not contacted</span></div>
    ${content}
  </section>`;
}

function renderDraftSetShell(content) {
  const buffer = currentBuffer();
  const index = buffers.indexOf(buffer);
  const readyCount = buffers.filter((candidate, candidateIndex) => !isBufferInvalid(candidate, candidateIndex) && !isBufferStale(candidate, candidateIndex)).length;
  const invalidCount = buffers.filter(isBufferInvalid).length;
  const staleCount = buffers.filter(isBufferStale).length;
  return `<section class="prototype-canvas research-canvas variant-g">
    <header class="context-header"><div class="context-title"><button type="button" class="back-button">← Evidence</button><span class="title-divider"></span><strong>Local Injection Draft Set</strong><span class="dirty-dot"></span></div><div class="context-status"><span>${buffers.length} independent ${buffers.length === 1 ? "draft" : "drafts"}</span><span>${readyCount} ready${invalidCount ? ` · ${invalidCount} invalid` : ""}${staleCount ? ` · ${staleCount} stale` : ""}</span></div></header>
    <div class="target-bar ${isBufferStale(buffer, index) ? "target-stale" : ""}"><span><b>Focused</b> ${buffer.id} · ${buffer.subscription} · ${buffer.target}</span><span><b>Source</b> ${buffer.authored ? "None · newly authored" : `${buffer.id} · immutable`}</span><span class="local-only">LOCAL ONLY · focused draft review · no batch execution</span></div>
    ${content}
  </section>`;
}

function renderLab() {
  return `<strong>Prototype data</strong>
    <label>Payload<select name="field-count"><option value="84" ${selected(state.fieldCount, 84)}>84 fields</option><option value="240" ${selected(state.fieldCount, 240)}>240 fields</option><option value="500" ${selected(state.fieldCount, 500)}>500 fields</option></select></label>
    <label>Drafts<select name="buffer-count"><option value="1" ${selected(state.bufferCount, 1)}>1 · today</option><option value="4" ${selected(state.bufferCount, 4)}>4 · future</option><option value="6" ${selected(state.bufferCount, 6)}>6 · sequence</option></select></label>
    <label>State<select name="scenario"><option value="ready" ${selected(state.scenario, "ready")}>Ready</option><option value="invalid" ${selected(state.scenario, "invalid")}>Invalid JSON</option><option value="stale" ${selected(state.scenario, "stale")}>Target stale</option><option value="no-source" ${selected(state.scenario, "no-source")}>No captured source</option></select></label>
    <small>Test scaffolding—not proposed UI.</small>`;
}

function renderRevisionEditor() {
  const sourceText = currentBuffer().sourceText;
  const draftText = state.scenario === "invalid" ? "{\n  \"command\": \"UPDATE\",\n  \"fields\": {\n" : currentBuffer().draftText;
  return `<main class="revision-workspace">
    <div class="revision-toolbar"><div><strong>${differenceCount()} differences</strong><button type="button" data-action="previous-diff">↑ Previous</button><button type="button" data-action="next-diff">↓ Next</button><span>Difference ${state.difference} / ${differenceCount()}</span></div><div><button type="button" data-action="toggle-collapse">${state.collapse ? "Show all" : "Collapse unchanged"}</button><button type="button">Revert difference</button><button type="button">Format Draft</button></div></div>
    <section class="revision-side-by-side">
      <article><header><strong>Injection Source</strong><span>immutable · ${currentBuffer().id}</span></header><div class="revision-code source-revision">${renderDiffLines(sourceText, draftText, "source")}</div></article>
      <article><header><strong>Injection Draft</strong><span>editable · D-7</span></header><div class="revision-code draft-revision" contenteditable="true" spellcheck="false">${renderDiffLines(sourceText, draftText, "draft")}</div></article>
    </section>
    <section class="revision-inline"><header><strong>Inline revision</strong><span>${state.difference} / ${differenceCount()} differences</span></header>${renderUnifiedDiff(sourceText, draftText)}</section>
    ${renderEditorFooter(state.scenario === "invalid" ? "JSON invalid · visible buffer preserved" : `${differenceCount()} semantic differences · changedFields derived`, state.scenario === "invalid")}
  </main>`;
}

function renderPatchForge() {
  if (state.scenario === "no-source") return renderPatchUnavailable();
  const patch = patchDocument();
  const sourceText = currentBuffer().sourceText;
  const resultText = currentBuffer().draftText;
  const invalid = state.scenario === "invalid";
  return `<main class="patch-workspace">
    <div class="patch-toolbar"><div><strong>Source → RFC 6902 Patch → Result</strong><span>In-memory recipe · never sent to a server</span></div><div class="patch-tabs"><button type="button" data-action="patch-view" data-view="source" class="${state.patchView === "source" ? "active" : ""}">Source</button><button type="button" data-action="patch-view" data-view="patch" class="${state.patchView === "patch" ? "active" : ""}">Patch</button><button type="button" data-action="patch-view" data-view="result" class="${state.patchView === "result" ? "active" : ""}">Result</button></div></div>
    <section class="patch-columns active-${state.patchView}">
      <article class="patch-reference source-document"><header><strong>Injection Source</strong><span>immutable · #8d31</span></header>${renderReadonlyDocument(sourceText)}</article>
      <article class="patch-document"><header><strong>RFC 6902 Patch</strong><span>editable · 4 operations</span></header>${renderTextarea(invalid ? '[\n { "op": "replace" "path": "/fields/qty" }\n]' : patch, "Editable RFC 6902 JSON Patch")}</article>
      <article class="patch-reference result-document"><header><strong>Computed Result</strong><span>${invalid ? "unavailable for current revision" : "read-only · #bc90"}</span></header>${invalid ? `<div class="no-result"><strong>No current Result</strong><p>Operation document is invalid. The last valid result will not be reviewed.</p></div>` : renderReadonlyDocument(resultText)}</article>
    </section>
    ${renderEditorFooter(invalid ? "Patch invalid · op 1 expected ',' · no current Result" : "Patch valid · Result valid · 4 operations · 10 semantic differences", invalid)}
  </main>`;
}

function renderPatchUnavailable() {
  return `<main class="patch-unavailable"><div><span class="eyebrow">Patch mode unavailable</span><h1>A captured source is required</h1><p>RFC 6902 describes changes to an existing JSON document. Workbench will not fabricate an Injection Source for a newly authored COMMAND update.</p><button type="button" class="primary">Open Full JSON authoring</button></div></main>`;
}

function renderQuietBuffer() {
  const buffer = currentBuffer();
  const invalid = state.scenario === "invalid" || buffer.id === "evt-1814";
  const text = state.scenario === "invalid" ? "{\n  \"command\": \"UPDATE\",\n" : buffer.draftText;
  const problems = hiddenProblemCount();
  return `<main class="buffer-workspace">
    <div class="buffer-toolbar"><div>${state.bufferCount > 1 ? `<strong>${buffer.name}</strong>` : `<strong>Payload JSON</strong>`}<span>${state.bufferCount > 1 ? `${buffer.command} / ${buffer.key}` : "One event · one document"}</span></div><div><button type="button">Problems ${problems}</button><button type="button">Compare Source</button>${state.bufferCount > 1 ? `<button type="button" data-action="palette" class="buffer-count">${state.bufferCount} drafts · ${problems} ${problems === 1 ? "problem" : "problems"}</button>` : ""}</div></div>
    <section class="buffer-editor">${renderTextarea(text, "Editable Local Injection draft JSON")}</section>
    ${state.paletteOpen ? renderDraftSwitcher() : ""}
    ${renderEditorFooter(invalid ? "JSON invalid · draft preserved independently" : `${differenceCount()} differences · changedFields derived`, invalid)}
  </main>`;
}

function renderDraftSet() {
  return `<main class="draft-set-workspace">
    <div class="set-toolbar"><div><strong>Draft workspace</strong><span>${buffers.length} independent JSON ${buffers.length === 1 ? "document" : "documents"} · visual order is not injection order</span></div><div class="set-view-toggle"><button type="button" data-action="set-view" data-view="edit" class="${state.setCompare ? "" : "active"}">Edit payloads</button><button type="button" data-action="set-view" data-view="compare" class="${state.setCompare ? "active" : ""}">Compare sources</button>${state.setCompare ? `<button type="button" data-action="toggle-collapse">${state.collapse ? "Show unchanged" : "Collapse unchanged"}</button>` : ""}</div></div>
    <section class="set-scroll" aria-label="Independent Local Injection drafts">${buffers.map(renderDraftSetSection).join("")}</section>
    ${renderDraftSetFooter()}
  </main>`;
}

function renderDraftSetSection(buffer, index) {
  const invalid = isBufferInvalid(buffer, index);
  const stale = isBufferStale(buffer, index);
  const focused = index === state.activeBuffer;
  const status = invalid ? "Invalid JSON" : stale ? "Stale target" : "Ready";
  const sourceLabel = buffer.authored ? "No captured source" : `Source ${buffer.id}`;
  const body = state.setCompare ? renderDraftSetComparison(buffer, index) : renderDraftSetEditor(buffer, index);
  return `<article class="set-event ${focused ? "focused" : ""} ${invalid ? "invalid" : stale ? "stale" : "ready"}" data-event-id="${buffer.id}">
    <header class="set-event-boundary">
      <button type="button" data-action="focus-buffer" data-buffer="${index}" class="set-event-focus" aria-label="Focus ${buffer.id}"><span>${String(index + 1).padStart(2, "0")}</span><strong>${buffer.id}</strong><code>${buffer.command} / ${buffer.key}</code></button>
      <div class="set-event-scope"><span>${buffer.subscription} · ${buffer.target}</span><span>${sourceLabel} · ${differenceCountFor(buffer)} differences</span></div>
      <span class="set-event-status"><i></i>${status}</span>
    </header>
    ${body}
  </article>`;
}

function renderDraftSetEditor(buffer, index) {
  const invalid = isBufferInvalid(buffer, index);
  const text = draftTextFor(buffer, index);
  return `<div class="set-editor-body">${renderTextarea(text, `Editable JSON for ${buffer.id}`, invalid)}</div>`;
}

function renderDraftSetComparison(buffer, index) {
  const invalid = isBufferInvalid(buffer, index);
  const sourceUnavailable = buffer.authored || state.scenario === "no-source";
  const draftText = draftTextFor(buffer, index);
  if (sourceUnavailable) {
    return `<div class="set-authored-comparison"><div><span class="eyebrow">No captured source</span><strong>Full JSON authoring remains editable</strong><p>This draft is independent, but Workbench will not invent a server update to compare against.</p></div><div class="set-editor-body">${renderTextarea(draftText, `Editable JSON for ${buffer.id}`, invalid)}</div></div>`;
  }
  return `<div class="set-comparison">
    <section class="set-diff-wide">
      <article><header><strong>Captured source</strong><span>immutable · ${buffer.id}</span></header><div class="revision-code">${renderDiffLines(buffer.sourceText, draftText, "source")}</div></article>
      <article><header><strong>Injection draft</strong><span>${invalid ? "invalid · independently preserved" : "editable"}</span></header><div class="revision-code" contenteditable="true" spellcheck="false">${renderDiffLines(buffer.sourceText, draftText, "draft")}</div></article>
    </section>
    <section class="set-diff-inline"><header><strong>${buffer.id} source → draft</strong><span>${differenceCountFor(buffer)} differences</span></header>${renderUnifiedDiff(buffer.sourceText, draftText)}</section>
  </div>`;
}

function renderDraftSetFooter() {
  const buffer = currentBuffer();
  const index = buffers.indexOf(buffer);
  const invalid = isBufferInvalid(buffer, index);
  const stale = isBufferStale(buffer, index);
  return `<footer class="editor-footer set-footer"><div class="footer-leading"><span>Focused ${index + 1} of ${buffers.length}</span><strong>${buffer.id} · ${buffer.command} / ${buffer.key}</strong><span class="${invalid ? "error" : stale ? "warning" : "ok"}">${invalid ? "Invalid JSON" : stale ? "Target stale" : "Ready for review"}</span><span>Independent draft · no collection execution semantics</span></div><div class="footer-action"><button type="button" class="primary" data-action="review" ${(invalid || stale) ? "disabled" : ""}>Review focused draft…</button></div></footer>`;
}

function renderDraftSwitcher() {
  const queryText = state.paletteQuery.trim().toLowerCase();
  const commandMode = queryText.startsWith(">");
  const matches = commandMode ? [] : buffers.filter((buffer) => `${buffer.name} ${buffer.target} ${buffer.command} ${buffer.key}`.toLowerCase().includes(queryText));
  const commands = ["New authored COMMAND draft", "Create draft from selected evidence", "Rename current draft", "Duplicate current draft", "Format document", "View immutable source", "Reveal target scope", "Review current injection"];
  return `<section class="draft-switcher" role="dialog" aria-label="Open draft"><header><strong>Open draft…</strong><button type="button" data-action="close-palette">×</button></header><input name="draft-switcher-search" value="${escapeHtml(state.paletteQuery)}" placeholder="Search drafts or type > for commands" autofocus />
    <div class="switcher-results">${commandMode ? commands.filter((command) => command.toLowerCase().includes(queryText.slice(1).trim())).map((command) => `<button type="button"><span class="command-symbol">›</span><strong>${command}</strong></button>`).join("") : matches.map((buffer, index) => `<button type="button" data-action="select-buffer" data-buffer="${buffers.indexOf(buffer)}" class="${buffers.indexOf(buffer) === state.activeBuffer ? "active" : ""}"><span class="buffer-state ${buffer.id === "evt-1814" ? "invalid" : buffer.stale ? "stale" : "ready"}"></span><span><strong>${buffer.name}</strong><small>${buffer.subscription} · ${buffer.command} / ${buffer.key}${buffer.authored ? " · newly authored" : ""}</small></span><em>${buffers.indexOf(buffer) === state.activeBuffer ? "ACTIVE" : buffer.id === "evt-1814" ? "Invalid JSON" : buffer.stale ? "Stale target" : "Ready"}</em></button>`).join("")}</div>
    <footer>Search excludes payload values · collection order is not execution order</footer></section>`;
}

function renderReview() {
  const buffer = currentBuffer();
  return `<main class="review-surface"><header><div><span class="eyebrow">Read-only execution boundary</span><h1>Review Local Injection</h1></div></header><section class="review-summary"><dl><dt>Source</dt><dd>${buffer.authored ? "None · newly authored" : `${buffer.id} · immutable Server Update`}</dd><dt>Target</dt><dd>${buffer.subscription} · ${buffer.target} · Session S-9</dd><dt>Delivery</dt><dd>One Logical Update → ${buffer.listeners} current listeners</dd><dt>COMMAND</dt><dd>${buffer.command} / ${buffer.key}</dd><dt>Payload</dt><dd>${state.fieldCount} fields · ${differenceCount()} semantic differences</dd></dl><div class="boundary-card"><strong>LOCAL inspected-page runtime only</strong><p>The Lightstreamer Server will not be contacted. Observed Server COMMAND State will not change.</p></div></section><footer><button type="button" data-action="edit">Back to editor</button><button type="button" class="primary">Inject locally into ${buffer.subscription}</button></footer></main>`;
}

function renderEditorFooter(message, blocked = false) {
  const stale = state.scenario === "stale" || currentBuffer().stale;
  return `<footer class="editor-footer"><div class="footer-leading"><span>Ln 1, Col 1</span><span class="${blocked ? "error" : "ok"}">${blocked ? "Invalid" : "Valid"}</span><span>${message}</span></div><div class="footer-action"><button type="button" class="primary" data-action="review" ${(blocked || stale) ? "disabled" : ""}>${state.variant === "E" ? "Review computed result…" : "Review Local Injection…"}</button></div></footer>`;
}

function renderTextarea(text, label, invalid = state.scenario === "invalid") {
  return `<div class="code-editor ${invalid ? "invalid" : ""}"><pre class="line-numbers" aria-hidden="true">${lineNumbers(text)}</pre><textarea aria-label="${label}" wrap="off" spellcheck="false">${escapeHtml(text)}</textarea></div>`;
}

function renderReadonlyDocument(text) {
  const lines = text.split("\n");
  const shown = lines.length > 44 ? [...lines.slice(0, 36), `  ··· ${lines.length - 42} lines folded ···`, ...lines.slice(-6)] : lines;
  return `<div class="readonly-document">${shown.map((line, index) => `<div><span>${index < 36 ? index + 1 : index === 36 ? "" : lines.length - (shown.length - index) + 1}</span><code>${escapeHtml(line)}</code></div>`).join("")}</div>`;
}

function renderDiffLines(sourceText, draftText, side) {
  const source = sourceText.split("\n");
  const draft = draftText.split("\n");
  const max = Math.max(source.length, draft.length);
  const changed = Array.from({ length: max }, (_, index) => index).filter((index) => source[index] !== draft[index]);
  let visible = Array.from({ length: max }, (_, index) => index);
  if (state.collapse) {
    const keep = new Set([0, 1, 2, 3, 4, max - 2, max - 1]);
    for (const index of changed) for (let offset = -1; offset <= 1; offset += 1) if (index + offset >= 0 && index + offset < max) keep.add(index + offset);
    visible = [...keep].sort((a, b) => a - b);
  }
  const lines = [];
  let previous = -1;
  for (const index of visible) {
    if (previous >= 0 && index - previous > 1) lines.push(`<div class="fold-line"><span></span><em>··· ${index - previous - 1} unchanged lines ···</em></div>`);
    const changedLine = source[index] !== draft[index];
    const text = side === "source" ? source[index] : draft[index];
    lines.push(`<div class="json-line ${changedLine ? `changed ${side}` : ""}"><span>${index + 1}</span><code>${escapeHtml(text ?? "")}</code></div>`);
    previous = index;
  }
  return lines.join("");
}

function renderUnifiedDiff(sourceText, draftText) {
  const source = sourceText.split("\n");
  const draft = draftText.split("\n");
  const changed = Array.from({ length: Math.max(source.length, draft.length) }, (_, index) => index).filter((index) => source[index] !== draft[index]);
  const rows = [];
  let previous = -1;
  for (const index of changed) {
    if (previous >= 0 && index - previous > 1) rows.push(`<div class="unified-fold">··· ${index - previous - 1} unchanged lines ···</div>`);
    rows.push(`<div class="unified-line removed"><span>−</span><code>${escapeHtml(source[index] ?? "")}</code></div><div class="unified-line added" contenteditable="true"><span>+</span><code>${escapeHtml(draft[index] ?? "")}</code></div>`);
    previous = index;
  }
  return `<div class="unified-diff">${rows.join("")}</div>`;
}

function patchDocument() {
  return JSON.stringify([
    { op: "replace", path: "/fields/qty", value: 42 },
    { op: "replace", path: "/fields/status", value: "review" },
    { op: "replace", path: "/fields/risk_score", value: 84 },
    { op: "replace", path: "/fields/update_reason", value: "local scenario" }
  ], null, 2);
}

function differenceCount() {
  return differenceCountFor(currentBuffer());
}

function differenceCountFor(buffer) {
  const source = buffer.source.fields;
  const draft = buffer.draft.fields;
  return [...new Set([...Object.keys(source), ...Object.keys(draft)])].filter((key) => source[key] !== draft[key]).length;
}

function isBufferInvalid(buffer, index) {
  return buffer.id === "evt-1814" || (state.scenario === "invalid" && index === 0);
}

function isBufferStale(buffer, index) {
  return buffer.stale || (state.scenario === "stale" && index === 0);
}

function draftTextFor(buffer, index) {
  return state.scenario === "invalid" && index === 0
    ? "{\n  \"command\": \"UPDATE\",\n  \"fields\": {\n"
    : buffer.draftText;
}

function hiddenProblemCount() {
  return state.bufferCount > 1 ? buffers.filter((buffer) => buffer.id === "evt-1814" || buffer.stale).length : (state.scenario === "invalid" ? 1 : 0);
}

function currentBuffer() { return buffers[state.activeBuffer] ?? buffers[0]; }
function lineNumbers(text) { return Array.from({ length: text.split("\n").length }, (_, index) => index + 1).join("\n"); }
function selected(value, expected) { return value === expected ? "selected" : ""; }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]); }

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  state.variant = keys[(keys.indexOf(state.variant) + direction + keys.length) % keys.length];
  state.review = false;
  state.paletteOpen = false;
  updateUrl();
  render();
}

function updateUrl() {
  const params = new URLSearchParams();
  params.set("variant", state.variant);
  params.set("fields", String(state.fieldCount));
  params.set("drafts", String(state.bufferCount));
  params.set("scenario", state.scenario);
  params.set("collapse", state.collapse ? "1" : "0");
  if (state.setCompare) params.set("compare", "1");
  if (state.paletteOpen) params.set("palette", "1");
  if (document.documentElement.dataset.presentation === "true") params.set("presentation", "1");
  window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
}
