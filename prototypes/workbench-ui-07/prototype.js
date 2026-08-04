const VARIANTS = {
  A: { name: "Roving Instrument", short: "Native composites; no Workbench command mode." },
  B: { name: "Operator Lens", short: "Search visible Find, Filter, Jump, Scope, Open, and Action commands." },
  C: { name: "One-Shot Key Lens", short: "Temporary mnemonic focus routing; one command, then exit." }
};

const FRAMES = {
  auto: { label: "Actual browser", width: null, height: null },
  compact: { label: "Compact · 563×700", width: 563, height: 700 },
  normal: { label: "Normal · 900×700", width: 900, height: 700 },
  shallow: { label: "Shallow · 900×320", width: 900, height: 320 },
  wide: { label: "Wide · 1440×900", width: 1440, height: 900 }
};

const SCENARIOS = {
  live: "Live updating evidence",
  frozen: "Frozen history · 37 newer",
  empty: "Empty evidence",
  volume: "High volume · 12,482 events",
  filtered: "Filter hides selected evidence",
  menu: "Object menu open",
  injection: "Local Injection draft",
  invalid: "Draft validation errors"
};

const rows = [
  ["14:08:39.902", "COMMAND snapshot", "ADD", "order-1042", "6 fields", "Server"],
  ["14:08:40.116", "Update Delivery", "ADD", "order-1042", "listener-view", "Server"],
  ["14:08:41.238", "Item Update", "UPDATE", "order-1042", "qty, status", "Server"],
  ["14:08:41.239", "Update Delivery", "UPDATE", "order-1042", "listener-view", "Server"],
  ["14:08:41.239", "Update Delivery", "UPDATE", "order-1042", "listener-metrics", "Server"],
  ["14:08:52.004", "Injected Update", "UPDATE", "order-1042", "qty, status", "Local"],
  ["14:08:52.005", "Update Delivery", "UPDATE", "order-1042", "listener-view", "Local"],
  ["14:08:52.005", "Update Delivery", "UPDATE", "order-1042", "listener-metrics", "Local"],
  ["14:09:03.441", "Item Update", "UPDATE", "order-1088", "price", "Server"],
  ["14:09:06.102", "Item Update", "DELETE", "order-0991", "key", "Server"],
  ["14:09:08.377", "Update Delivery", "UPDATE", "order-1088", "listener-view", "Server"],
  ["14:09:11.910", "Item Update", "UPDATE", "order-1042", "risk_score", "Server"]
];

const draftJson = `{
  "command": "UPDATE",
  "key": "order-1042",
  "isSnapshot": false,
  "fields": {
    "command": "UPDATE",
    "key": "order-1042",
    "account_id": "ACC-319",
    "symbol": "LS-CORP",
    "side": "BUY",
    "qty": 42,
    "status": "review",
    "limit_price": 42.18,
    "risk_score": 84
  }
}`;

const operatorCommands = [
  ["find", "Find order-1042", "Walk matches; evidence set unchanged"],
  ["filter", "Filter key:order-1042", "Preview 186 / 12,482 before applying"],
  ["jump", "Jump to 37 newer events", "Change position; keep Scope and Filter"],
  ["scope", "Scope to orders.command / portfolio", "Preview the authoritative runtime boundary"],
  ["raw", "Open complete raw evidence", "Promote document; preserve return checkpoint"],
  ["draft", "Create Local Injection Draft", "evt-1842 → sub-7 · Local only"],
  ["live", "Follow Live evidence", "Capture remains active"],
  ["copy", "Copy selected event", "Current selection evt-1842"]
];

const params = new URLSearchParams(location.search);
const scenario = SCENARIOS[params.get("scenario")] ? params.get("scenario") : "live";
const state = {
  variant: VARIANTS[params.get("variant")] ? params.get("variant") : "A",
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "auto",
  scenario,
  theme: params.get("theme") === "light" ? "light" : "dark",
  presentation: params.get("presentation") === "1",
  selectedIndex: 2,
  scopeIndex: 3,
  contextTab: 0,
  contextOpen: params.get("detail") === "1",
  surface: ["injection", "invalid"].includes(scenario) ? "injection" : "workspace",
  layer: scenario === "menu" ? "Object menu" : "None",
  layerOrigin: "Evidence / evt-1842",
  layerReturnSelector: `[data-event-index="2"]`,
  focusOwner: "Evidence",
  findQuery: "",
  filterQuery: "key:order-1042",
  operatorQuery: "",
  operatorIndex: 0,
  keyPrefix: "",
  lastAction: "Ready for keyboard input",
  newer: scenario === "frozen" ? 37 : 0,
  appended: 0,
  hiddenSelection: scenario === "filtered",
  tabIndents: false
};

const app = document.querySelector("#prototype");

function updateUrl() {
  const next = new URLSearchParams();
  next.set("variant", state.variant);
  if (state.frame !== "auto") next.set("frame", state.frame);
  if (state.scenario !== "live") next.set("scenario", state.scenario);
  if (state.theme !== "dark") next.set("theme", state.theme);
  if (state.presentation) next.set("presentation", "1");
  if (state.contextOpen) next.set("detail", "1");
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

function render(focusSelector = null) {
  updateUrl();
  const frame = FRAMES[state.frame];
  const style = frame.width
    ? `--preview-width:${frame.width}px;--preview-height:${frame.height}px`
    : "";
  app.innerHTML = `
    <section class="prototype-stage" data-theme="${state.theme}" data-frame="${state.frame}">
      <div class="app-frame" style="${style}">${renderWorkbench()}</div>
    </section>
    ${state.presentation ? "" : renderInspector()}
    ${state.presentation ? "" : renderLab()}
    ${state.presentation ? "" : renderSwitcher()}
  `;
  if (focusSelector) {
    const target = app.querySelector(focusSelector);
    target?.focus({ preventScroll: true });
  }
}

function renderWorkbench() {
  const detailClass = state.contextOpen ? "detail-open" : "";
  const documentClass = state.surface !== "workspace" ? "document-open" : "";
  return `
    <section class="workbench model-${state.variant.toLowerCase()} ${detailClass} ${documentClass}" data-variant="${state.variant}">
      ${renderOperatingStrip()}
      ${renderScopeStrip()}
      <div class="workspace-shell">
        ${state.surface === "workspace" ? renderWorkspace() : renderDocument()}
      </div>
      ${renderStatusStrip()}
      ${renderOwnedLayer()}
    </section>
  `;
}

function renderOperatingStrip() {
  const viewState = state.scenario === "frozen" ? `Frozen · ${state.newer} newer` : "Live evidence";
  const variantControls = state.variant === "B"
    ? `<button class="operator-trigger" data-action="operator" title="Search Workbench operations">⌕ <strong>Find or run…</strong><kbd>⌘F</kbd></button>`
    : `<button data-action="find" title="Find evidence (Command or Control + F)">Find</button><button data-action="filter">Filter</button>`;
  return `
    <header class="operating-strip" data-surface="Operating strip">
      <div class="capture-state"><span class="status-dot"></span><strong>Capture active</strong><span class="coverage">Complete</span></div>
      <div class="operating-actions">
        <button data-action="view-state">${viewState}</button>
        ${variantControls}
        ${state.variant === "A" ? `<button data-action="help">Keyboard</button>` : ""}
        ${state.variant === "C" ? `<button data-action="key-lens" title="Keyboard commands (semicolon)">Keyboard commands <kbd>;</kbd></button>` : ""}
        <button data-action="append" title="Simulate a passive captured update">+ update</button>
        <button data-action="menu" aria-label="More actions">⋮</button>
      </div>
    </header>
  `;
}

function renderScopeStrip() {
  const back = state.surface !== "workspace" || state.contextOpen;
  return `
    <nav class="scope-strip" aria-label="Runtime scope" data-surface="Scope breadcrumb">
      ${back ? `<button data-action="back">← Evidence</button>` : `<button data-action="scope">Scope</button>`}
      <span>Page</span><i>›</i><span>client-main</span><i>›</i><span>S-9</span><i>›</i><strong>orders.command</strong><i>›</i><span>portfolio</span>
      <span class="live-label">live</span>
    </nav>
  `;
}

function renderWorkspace() {
  return `${renderScopePane()}${renderEvidencePane()}${renderContextPane()}`;
}

function renderScopePane() {
  const labels = ["Page", "client-main", "Session S-9", "orders.command", "portfolio", "listener-view", "listener-metrics"];
  return `
    <aside class="pane scope-pane" data-surface="Scope">
      <header class="pane-heading"><div><small>Runtime scope</small><strong>Inspected page</strong></div><button data-action="scope-collapse">«</button></header>
      <div class="scope-tree" role="tree" aria-label="Lightstreamer runtime scope">
        ${labels.map((label, index) => `<button role="treeitem" class="scope-node depth-${Math.min(index, 4)} ${index === 3 ? "selected" : ""}" aria-selected="${index === 3}" tabindex="${index === state.scopeIndex ? 0 : -1}" data-scope-index="${index}"><span>${index < 4 ? "▾" : "•"}</span><strong>${label}</strong><small>${index === 3 ? "COMMAND" : index === 4 ? "1 item" : "active"}</small></button>`).join("")}
      </div>
    </aside>
  `;
}

function displayedRows() {
  if (state.scenario === "empty") return [];
  if (state.scenario === "volume") return rows.concat(rows, rows);
  const appended = Array.from({ length: state.appended }, (_, index) => [
    `14:10:${String(index + 1).padStart(2, "0")}.220`, "Item Update", "UPDATE", `order-${1200 + index}`, "status", "Server"
  ]);
  return rows.concat(appended);
}

function renderEvidencePane() {
  const items = displayedRows();
  const visible = state.scenario === "volume" ? 12482 : items.length - (state.scenario === "filtered" ? 1 : 0);
  return `
    <section class="pane evidence-pane" data-surface="Evidence">
      <header class="pane-heading evidence-heading"><div><small>Ordered evidence</small><strong>orders.command / portfolio</strong></div><span>${visible.toLocaleString()} shown</span></header>
      <div class="filter-row"><span>⌕</span><span>${state.filterQuery || "No filter"}</span>${state.filterQuery ? `<button data-action="clear-filter">×</button>` : ""}</div>
      ${items.length ? `<div class="evidence-grid" role="grid" aria-label="Ordered Lightstreamer evidence" aria-rowcount="${visible}">
        <div class="evidence-columns" role="row"><span>Time</span><span>Evidence</span><span>Command / key</span><span>Change</span><span>Provenance</span></div>
        <div class="evidence-scroll">
          ${items.map((row, index) => state.scenario === "filtered" && index === 2 ? "" : renderEvidenceRow(row, index)).join("")}
        </div>
      </div>` : `<div class="empty-evidence" role="group" tabindex="0" data-empty-grid><strong>No evidence in this scope</strong><span>Capture remains active. Adjust Scope or clear Filter.</span><button data-action="scope">Choose scope</button></div>`}
      <footer class="selection-strip"><span>Selected <strong>${state.hiddenSelection ? "evt-1842 · outside current results" : items.length ? `${items[state.selectedIndex % items.length][2]} · ${items[state.selectedIndex % items.length][3]}` : "none"}</strong></span><button data-action="open-detail" ${items.length ? "" : "disabled"}>Open details</button></footer>
    </section>
  `;
}

function renderEvidenceRow(row, index) {
  const [time, kind, command, key, change, provenance] = row;
  const selected = !state.hiddenSelection && index === state.selectedIndex;
  const active = selected || (state.hiddenSelection && index === 0);
  return `
    <div class="evidence-row ${selected ? "selected" : ""}" role="row" aria-selected="${selected}" tabindex="${active ? 0 : -1}" data-event-index="${index}" data-event-id="evt-${1840 + index}">
      <time role="gridcell">${time}</time><span role="gridcell">${kind}</span><span class="command-cell" role="gridcell"><b>${command}</b><span>${key}</span></span><span role="gridcell">${change}</span><strong class="provenance ${provenance.toLowerCase()}" role="gridcell">${provenance}</strong>
    </div>
  `;
}

function renderContextPane() {
  const tabs = ["Summary", "Fields", "Deliveries", "State", "Raw"];
  const current = state.hiddenSelection ? rows[2] : displayedRows()[state.selectedIndex % Math.max(1, displayedRows().length)] ?? rows[2];
  const selectedEventId = state.hiddenSelection ? "evt-1842" : `evt-${1840 + state.selectedIndex}`;
  return `
    <aside class="pane context-pane" data-surface="Context">
      <header class="pane-heading"><div><small>Selected evidence</small><strong>${selectedEventId} · ${current[1]}</strong></div><button data-action="close-detail">×</button></header>
      <div class="context-tabs" role="tablist" aria-label="Evidence detail lenses">
        ${tabs.map((tab, index) => `<button class="context-tab ${index === state.contextTab ? "active" : ""}" role="tab" aria-selected="${index === state.contextTab}" tabindex="${index === state.contextTab ? 0 : -1}" data-tab-index="${index}">${tab}</button>`).join("")}
      </div>
      <div class="context-scroll" role="tabpanel" tabindex="0">
        ${state.hiddenSelection ? `<div class="selection-outside"><strong>Selected event outside current results</strong><span>Context remains pinned while Filter hides its row.</span><div><button data-action="reveal-selection">Reveal</button><button data-action="clear-selection">Clear selection</button></div></div>` : ""}
        <div class="context-title"><strong>${current[5]} ${current[1]}</strong><time>${current[0]}</time></div>
        <dl><dt>Subscription</dt><dd>orders.command</dd><dt>Item / key</dt><dd>portfolio / ${current[3]}</dd><dt>Command</dt><dd>${current[2]}</dd><dt>Changed</dt><dd>${current[4]}</dd><dt>Selection</dt><dd>Persists when focus leaves Evidence</dd></dl>
        <div class="context-actions"><button data-action="raw">Open complete raw</button><button class="primary" data-action="draft">Create Local Injection Draft</button><button data-action="menu">Event actions</button></div>
      </div>
    </aside>
  `;
}

function renderDocument() {
  if (state.surface === "raw") {
    return `<section class="document-pane" data-surface="Raw evidence"><header class="document-heading"><div><small>Complete raw evidence</small><strong>evt-${1840 + state.selectedIndex} · immutable Server evidence</strong></div><button data-action="back">Back</button></header><pre class="raw-document" tabindex="0">${escapeHtml(JSON.stringify({ id: `evt-${1840 + state.selectedIndex}`, source: "server", subscriptionId: "sub-7", item: "portfolio", command: "UPDATE", key: "order-1042", changedFields: { qty: 18, status: "open" } }, null, 2))}</pre><footer class="document-footer"><span>Find remains document-local while raw owns focus</span><button>Copy complete evidence</button></footer></section>`;
  }
  const invalid = state.scenario === "invalid";
  return `
    <section class="document-pane injection-pane" data-surface="Local Injection Draft">
      <header class="document-heading"><div><small>Local Injection Draft · single event</small><strong>Edit evt-${1840 + state.selectedIndex} · UPDATE / order-1042</strong></div><div><span class="${invalid ? "invalid" : "ready"}">${invalid ? "! 2 errors" : "● Ready"}</span><button data-action="back">Minimize draft</button></div></header>
      <div class="target-rail" tabindex="0" data-target-rail><strong>LOCAL ONLY</strong><span>Target sub-7 · orders.command / portfolio · Session S-9</span><span>Source evt-${1840 + state.selectedIndex} · immutable</span></div>
      <div class="editor-toolbar"><span>Raw JSON</span><div><button data-action="tab-mode">Tab: ${state.tabIndents ? "Indent" : "Move focus"}</button><button data-action="problems">Problems ${invalid ? 2 : 0}</button><button>Compare source</button></div></div>
      <div class="editor-shell"><pre>${Array.from({ length: 18 }, (_, index) => index + 1).join("\n")}</pre><textarea class="draft-json" spellcheck="false" aria-label="Injection Draft raw JSON">${draftJson}${invalid ? "\n  trailing" : ""}</textarea></div>
      <footer class="document-footer"><span>${invalid ? "JSON invalid · Review unavailable" : "JSON valid · 7 differences · Capture continues"}</span><button class="primary review-button" data-action="review" aria-disabled="${invalid}">${invalid ? "Resolve problems" : "Review draft…"}</button></footer>
    </section>
  `;
}

function renderStatusStrip() {
  const total = state.scenario === "volume"
    ? "12,482"
    : String(displayedRows().length - (state.scenario === "filtered" ? 1 : 0));
  return `<footer class="status-strip"><span>${total} shown / 12,482 retained · ${state.scenario === "frozen" ? `Frozen · ${state.newer} newer` : "Live"}</span><span>Focus and selection preserved · Capture continues</span></footer>`;
}

function renderOwnedLayer() {
  if (state.layer === "Find") return renderFind();
  if (state.layer === "Filter") return renderFilter();
  if (state.layer === "Object menu") return renderObjectMenu();
  if (state.layer === "Operator Lens") return renderOperatorLens();
  if (state.layer === "Key Lens") return renderKeyLens();
  if (state.layer === "Help") return renderHelp();
  if (state.layer === "Problems") return renderProblems();
  if (state.layer === "Jump") return renderJump();
  return "";
}

function renderFind() {
  return `<section class="owned-layer find-layer" role="search" data-surface="Find"><label>Find <input class="find-input" value="${escapeAttribute(state.findQuery)}" placeholder="Text in retained evidence" /></label><span>${state.findQuery ? "3 of 18" : "0 of 0"}</span><button data-action="find-previous">↑</button><button data-action="find-next">↓</button><button data-action="close-layer">×</button></section>`;
}

function renderFilter() {
  return `<section class="owned-layer filter-layer" role="dialog" aria-label="Evidence Filter" data-surface="Filter"><label>Filter <input class="filter-input" value="${escapeAttribute(state.filterQuery)}" placeholder="key: command: provenance:" /></label><span>Preview: 186 / 12,482</span><button data-action="apply-filter">Apply</button><button data-action="close-layer">Cancel</button></section>`;
}

function renderObjectMenu() {
  const commands = ["Copy event", "Filter by this key", "Reveal related evidence", "Create Local Injection Draft"];
  return `<div class="menu-backdrop"><div class="object-menu" role="menu" aria-label="Selected event actions" data-surface="Object menu">${commands.map((label, index) => `<button role="menuitem" tabindex="${index === 0 ? 0 : -1}" data-menu-index="${index}" data-menu-command="${index}">${label}</button>`).join("")}<small>Escape restores evt-${1840 + state.selectedIndex}</small></div></div>`;
}

function filteredOperatorCommands() {
  const query = state.operatorQuery.toLowerCase().replace(/^(find|filter|jump|scope|open|do):\s*/, "");
  return operatorCommands.filter(([, label, detail]) => !query || `${label} ${detail}`.toLowerCase().includes(query));
}

function renderOperatorLens() {
  const commands = filteredOperatorCommands();
  state.operatorIndex = Math.min(state.operatorIndex, Math.max(0, commands.length - 1));
  return `<div class="lens-backdrop"><section class="operator-lens" role="dialog" aria-label="Find or run Workbench operation" data-surface="Operator Lens"><header><strong>Operator Lens</strong><small>Searches operations already visible in the current context</small></header><input class="operator-input" role="combobox" aria-expanded="true" value="${escapeAttribute(state.operatorQuery)}" placeholder="find: · filter: · jump: · scope: · open: · do:" /><div class="operator-results" role="listbox">${commands.map(([command, label, detail], index) => `<button role="option" aria-selected="${index === state.operatorIndex}" class="${index === state.operatorIndex ? "active" : ""}" data-operator-command="${command}" data-operator-index="${index}"><strong>${label}</strong><span>${detail}</span></button>`).join("") || `<p>No matching operation</p>`}</div><footer><span>↑↓ Navigate · Enter open/apply · Escape restore focus</span><strong>Never executes Inject locally</strong></footer></section></div>`;
}

function renderKeyLens() {
  const rootKeys = [["S","Scope"],["E","Evidence"],["D","Detail"],["R","Raw"],["F","Filter"],["/","Find"],["G","Jump"],["A","Actions"],["L","Live/Frozen"],["B","Back"],["I","Injection"],["?","Help"]];
  const injectionKeys = [["D","Draft editor"],["S","Source compare"],["T","Target"],["P","Problems"],["A","Review boundary"],["M","Minimize"]];
  const keys = state.keyPrefix === "I" ? injectionKeys : rootKeys;
  return `<section class="key-lens" role="dialog" aria-label="One-shot keyboard commands" data-surface="Key Lens"><header><strong>${state.keyPrefix === "I" ? "Injection commands" : "Keyboard commands"}</strong><span>One command, then exit</span></header><div>${keys.map(([key, label]) => `<button data-key-command="${key}"><kbd>${key}</kbd><span>${label}</span></button>`).join("")}</div><footer>Escape cancels · typing is never intercepted in inputs or editors</footer></section>`;
}

function renderHelp() {
  return `<div class="lens-backdrop"><section class="help-panel" role="dialog" aria-label="Keyboard help" data-surface="Keyboard help"><header><strong>${VARIANTS[state.variant].name}</strong><button data-action="close-layer">×</button></header><dl><dt>Tab / Shift+Tab</dt><dd>Cross semantic controls and composite entry points</dd><dt>Arrows · Home/End</dt><dd>Navigate the focused tree, grid, tablist, menu, or splitter</dd><dt>Enter</dt><dd>Open selected evidence or activate the focused control</dd><dt>⌘/Ctrl+F</dt><dd>Find evidence; editor-local when a document owns focus</dd><dt>Shift+F10</dt><dd>Focused-object menu</dd><dt>Escape</dt><dd>Close only the top visible Workbench transient layer</dd></dl><p>No shortcut executes Local Injection, clears history, stops Capture, reloads, or changes DevTools panels.</p></section></div>`;
}

function renderProblems() {
  return `<div class="lens-backdrop"><section class="problems-panel" role="dialog" aria-label="Draft problems" data-surface="Problems"><header><strong>2 validation problems</strong><button data-action="close-layer">×</button></header><button class="problem-item" autofocus><strong>Line 19 · Unexpected token</strong><span>Remove trailing content after the JSON document.</span></button><button class="problem-item"><strong>Target validation blocked</strong><span>Review remains unavailable until JSON is valid.</span></button><footer>Enter reveals a marker · Escape restores the Problems button</footer></section></div>`;
}

function renderJump() {
  return `<div class="lens-backdrop"><section class="jump-panel" role="dialog" aria-label="Jump to identity" data-surface="Jump"><header><strong>Jump</strong><button data-action="close-layer">×</button></header><button data-action="jump-selected">event evt-1842</button><button>key order-1042</button><button>Subscription sub-7</button><button>37 newer matching events</button></section></div>`;
}

function renderInspector() {
  return `<aside class="focus-inspector" aria-live="polite"><strong>Interaction state</strong><dl><dt>Variant</dt><dd>${state.variant}</dd><dt>Focus owner</dt><dd data-inspector="focus">${state.focusOwner}</dd><dt>Selection</dt><dd data-inspector="selection">evt-${1840 + state.selectedIndex}</dd><dt>Owned layer</dt><dd data-inspector="layer">${state.layer}</dd><dt>Last transition</dt><dd data-inspector="last">${state.lastAction}</dd></dl></aside>`;
}

function renderLab() {
  return `<form class="prototype-lab" aria-label="Prototype controls"><strong>Prototype state</strong><label>Scenario<select data-control="scenario">${Object.entries(SCENARIOS).map(([value,label]) => `<option value="${value}" ${state.scenario === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Preview<select data-control="frame">${Object.entries(FRAMES).map(([value,item]) => `<option value="${value}" ${state.frame === value ? "selected" : ""}>${item.label}</option>`).join("")}</select></label><label>Theme<select data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select></label><small>${VARIANTS[state.variant].short}</small></form>`;
}

function renderSwitcher() {
  return `<nav class="prototype-switcher" aria-label="Prototype variant"><button data-switch="previous" aria-label="Previous variant">←</button><strong>PROTOTYPE ${state.variant} — ${VARIANTS[state.variant].name}</strong><button data-switch="next" aria-label="Next variant">→</button></nav>`;
}

function isEditable(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}

function focusAndDescribe(selector, owner, description) {
  state.focusOwner = owner;
  state.lastAction = description;
  render(selector);
}

function closeLayer(description = "Closed transient layer and restored its trigger") {
  const returnSelector = state.layerReturnSelector;
  state.layer = "None";
  state.keyPrefix = "";
  state.lastAction = description;
  render(returnSelector || `[data-event-index="${state.selectedIndex}"]`);
}

function openLayer(layer, origin, focusSelector) {
  state.layer = layer;
  state.layerOrigin = origin;
  state.layerReturnSelector = returnSelectorForElement(document.activeElement);
  state.lastAction = `Opened ${layer}; origin checkpoint retained`;
  render(focusSelector);
}

function returnSelectorForElement(element) {
  const eventRow = element?.closest?.("[data-event-index]");
  if (eventRow) return `[data-event-index="${eventRow.dataset.eventIndex}"]`;
  const scopeNode = element?.closest?.("[data-scope-index]");
  if (scopeNode) return `[data-scope-index="${scopeNode.dataset.scopeIndex}"]`;
  const contextTab = element?.closest?.("[data-tab-index]");
  if (contextTab) return `[data-tab-index="${contextTab.dataset.tabIndex}"]`;
  const action = element?.closest?.("[data-action]");
  if (action) return `[data-action="${action.dataset.action}"]`;
  if (element?.matches?.(".draft-json")) return ".draft-json";
  if (element?.matches?.(".raw-document")) return ".raw-document";
  if (element?.matches?.("[data-target-rail]")) return "[data-target-rail]";
  return `[data-event-index="${state.selectedIndex}"]`;
}

function moveEvidence(nextIndex) {
  const count = displayedRows().length;
  if (!count) return;
  if (state.scenario === "filtered" && nextIndex === 2) {
    nextIndex = state.selectedIndex >= 3 ? 1 : 3;
  }
  state.selectedIndex = Math.max(0, Math.min(count - 1, nextIndex));
  state.hiddenSelection = false;
  state.contextOpen = false;
  focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", `Evidence focus and selection moved to evt-${1840 + state.selectedIndex}`);
}

function openDetail() {
  if (!displayedRows().length) return;
  state.contextOpen = true;
  state.lastAction = `Opened Context for evt-${1840 + state.selectedIndex}; Evidence checkpoint retained`;
  render(".context-tab.active");
}

function executeOperator(command) {
  if (command === "find") {
    state.operatorQuery = "";
    state.findQuery = "order-1042";
    openLayer("Find", "Evidence / evt-1842", ".find-input");
  } else if (command === "filter") {
    state.operatorQuery = "";
    openLayer("Filter", "Evidence / evt-1842", ".filter-input");
  } else if (command === "jump") {
    state.layer = "None";
    moveEvidence(displayedRows().length - 1);
  } else if (command === "scope") {
    state.layer = "None";
    focusAndDescribe(`[data-scope-index="${state.scopeIndex}"]`, "Scope", "Focused Scope; no rescope occurred");
  } else if (command === "raw") {
    state.layer = "None";
    state.surface = "raw";
    focusAndDescribe(".raw-document", "Raw evidence", "Promoted raw evidence; return checkpoint retained");
  } else if (command === "draft") {
    state.layer = "None";
    state.surface = "injection";
    focusAndDescribe(".draft-json", "Local Injection Draft", "Created one target-anchored draft; no Injection executed");
  } else if (command === "live") {
    state.layer = "None";
    state.scenario = "live";
    state.newer = 0;
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Returned view to Live; Capture was already active");
  } else {
    closeLayer("Copied selected evidence; focus restored");
  }
}

function executeKeyCommand(key) {
  const normalized = key.toUpperCase();
  if (state.keyPrefix === "I") {
    state.keyPrefix = "";
    if (normalized === "D") {
      state.layer = "None";
      state.surface = "injection";
      focusAndDescribe(".draft-json", "Local Injection Draft", "Focused Draft editor; mnemonic exited");
    } else if (normalized === "S") {
      state.layer = "None";
      state.surface = "injection";
      focusAndDescribe(".draft-json", "Local Injection Draft", "Opened synchronized Source comparison; no source mutation");
    } else if (normalized === "T") {
      state.layer = "None";
      state.surface = "injection";
      focusAndDescribe("[data-target-rail]", "Local Injection Target", "Focused exact target; no retarget occurred");
    } else if (normalized === "P") {
      state.surface = "injection";
      openLayer("Problems", "Local Injection Draft", ".problem-item");
    } else if (normalized === "A") {
      state.layer = "None";
      state.surface = "injection";
      focusAndDescribe(".review-button", "Local Injection action boundary", "Focused Review only; no Injection executed");
    } else if (normalized === "M") {
      state.layer = "None";
      state.surface = "workspace";
      focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Minimized draft and restored Evidence checkpoint");
    } else closeLayer("Unknown Injection mnemonic cancelled");
    return;
  }
  if (normalized === "I") {
    state.keyPrefix = "I";
    state.lastAction = "Entered Injection focus submap; no operation executed";
    render();
  } else if (normalized === "S") {
    state.layer = "None";
    focusAndDescribe(`[data-scope-index="${state.scopeIndex}"]`, "Scope", "Focused Scope; selection and Filter unchanged");
  } else if (normalized === "E") {
    state.layer = "None";
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Restored last Evidence cursor");
  } else if (normalized === "D") {
    state.layer = "None";
    openDetail();
  } else if (normalized === "R") {
    state.layer = "None";
    state.surface = "raw";
    focusAndDescribe(".raw-document", "Raw evidence", "Promoted raw evidence; mnemonic exited");
  } else if (normalized === "F") {
    openLayer("Filter", "Evidence / evt-1842", ".filter-input");
  } else if (key === "/") {
    openLayer("Find", "Evidence / evt-1842", ".find-input");
  } else if (normalized === "G") {
    openLayer("Jump", "Evidence / evt-1842", ".jump-panel button");
  } else if (normalized === "A") {
    openLayer("Object menu", "Evidence / evt-1842", ".object-menu [role=menuitem]");
  } else if (normalized === "L") {
    state.layer = "None";
    focusAndDescribe("[data-action=view-state]", "Operating strip", "Focused Live/Frozen control; state unchanged until activation");
  } else if (normalized === "B") {
    state.layer = "None";
    state.surface = "workspace";
    state.contextOpen = false;
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Restored Evidence checkpoint");
  } else if (key === "?") {
    openLayer("Help", "Operating strip", ".help-panel [data-action=close-layer]");
  } else closeLayer("Unknown mnemonic cancelled; focus restored");
}

app.addEventListener("focusin", (event) => {
  const owner = event.target.closest?.("[data-surface]")?.dataset.surface;
  if (owner) state.focusOwner = owner;
  updateInspector();
});

app.addEventListener("input", (event) => {
  if (event.target.matches(".find-input")) state.findQuery = event.target.value;
  if (event.target.matches(".filter-input")) state.filterQuery = event.target.value;
  if (event.target.matches(".operator-input")) {
    state.operatorQuery = event.target.value;
    state.operatorIndex = 0;
    render(".operator-input");
    const input = app.querySelector(".operator-input");
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  updateInspector();
});

app.addEventListener("click", (event) => {
  const switchButton = event.target.closest("[data-switch]");
  if (switchButton) {
    const keys = Object.keys(VARIANTS);
    const current = keys.indexOf(state.variant);
    const direction = switchButton.dataset.switch === "next" ? 1 : -1;
    state.variant = keys[(current + direction + keys.length) % keys.length];
    state.layer = "None";
    state.keyPrefix = "";
    state.lastAction = `Switched to ${VARIANTS[state.variant].name}`;
    render();
    return;
  }
  const row = event.target.closest("[data-event-index]");
  if (row) {
    state.selectedIndex = Number(row.dataset.eventIndex);
    state.lastAction = `Pointer selected evt-${1840 + state.selectedIndex}; detail did not steal focus`;
    render(`[data-event-index="${state.selectedIndex}"]`);
    return;
  }
  const scope = event.target.closest("[data-scope-index]");
  if (scope) {
    state.scopeIndex = Number(scope.dataset.scopeIndex);
    state.lastAction = `Pointer committed ${scope.textContent.trim()} as Scope`;
    render(`[data-scope-index="${state.scopeIndex}"]`);
    return;
  }
  const tab = event.target.closest("[data-tab-index]");
  if (tab) {
    state.contextTab = Number(tab.dataset.tabIndex);
    state.lastAction = `Activated Context lens ${tab.textContent}`;
    render(".context-tab.active");
    return;
  }
  const keyCommand = event.target.closest("[data-key-command]");
  if (keyCommand) {
    executeKeyCommand(keyCommand.dataset.keyCommand);
    return;
  }
  const operator = event.target.closest("[data-operator-command]");
  if (operator) {
    executeOperator(operator.dataset.operatorCommand);
    return;
  }
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "find") openLayer("Find", "Evidence / evt-1842", ".find-input");
  else if (action === "filter") openLayer("Filter", "Evidence / evt-1842", ".filter-input");
  else if (action === "operator") openLayer("Operator Lens", "Operating strip", ".operator-input");
  else if (action === "key-lens") openLayer("Key Lens", state.focusOwner, ".key-lens");
  else if (action === "help") openLayer("Help", "Operating strip", ".help-panel [data-action=close-layer]");
  else if (action === "menu") openLayer("Object menu", `Evidence / evt-${1840 + state.selectedIndex}`, ".object-menu [role=menuitem]");
  else if (action === "close-layer") closeLayer();
  else if (action === "open-detail") openDetail();
  else if (action === "close-detail" || action === "back") {
    state.surface = "workspace";
    state.contextOpen = false;
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Back restored exact Evidence selection and focus");
  } else if (action === "raw") {
    state.surface = "raw";
    focusAndDescribe(".raw-document", "Raw evidence", "Promoted complete raw evidence");
  } else if (action === "draft") {
    state.surface = "injection";
    focusAndDescribe(".draft-json", "Local Injection Draft", "Created one target-anchored draft; Source remains immutable");
  } else if (action === "problems") openLayer("Problems", "Local Injection Draft", ".problem-item");
  else if (action === "review") {
    if (state.scenario === "invalid") openLayer("Problems", "Local Injection Draft", ".problem-item");
    else setLast("Review opened; final Inject locally remains a separate labelled activation");
  } else if (action === "append") {
    state.appended += 1;
    if (state.scenario === "frozen") state.newer += 1;
    state.lastAction = `Passive update appended; focus stayed on ${state.focusOwner}`;
    const selector = document.activeElement?.matches?.("[data-event-index]") ? `[data-event-index="${state.selectedIndex}"]` : null;
    render(selector);
  } else if (action === "view-state") {
    state.scenario = state.scenario === "frozen" ? "live" : "frozen";
    state.newer = state.scenario === "frozen" ? 37 : 0;
    focusAndDescribe("[data-action=view-state]", "Operating strip", state.scenario === "frozen" ? "Froze investigation view; Capture continues" : "Returned view to Live; Capture continues");
  } else if (action === "clear-filter") {
    state.filterQuery = "";
    state.lastAction = "Cleared persistent Filter through its visible control";
    render(`[data-event-index="${state.selectedIndex}"]`);
  } else if (action === "reveal-selection") {
    state.hiddenSelection = false;
    state.scenario = "live";
    state.selectedIndex = 2;
    focusAndDescribe(`[data-event-index="2"]`, "Evidence", "Revealed the preserved selection and restored its row");
  } else if (action === "clear-selection") {
    state.hiddenSelection = false;
    state.selectedIndex = 0;
    focusAndDescribe(`[data-event-index="0"]`, "Evidence", "Cleared hidden selection and focused the nearest visible row");
  } else if (action === "tab-mode") {
    state.tabIndents = !state.tabIndents;
    focusAndDescribe("[data-action=tab-mode]", "Local Injection Draft", `Tab now ${state.tabIndents ? "inserts indentation" : "moves focus"}`);
  } else if (action === "apply-filter") {
    state.layer = "None";
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Applied Filter; shown/total updated; selection preserved");
  } else if (action === "jump-selected") {
    state.layer = "None";
    focusAndDescribe(`[data-event-index="${state.selectedIndex}"]`, "Evidence", "Jumped to evt-1842 without changing Scope or Filter");
  }
});

app.addEventListener("dblclick", (event) => {
  if (event.target.closest("[data-event-index]")) openDetail();
});

app.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target.matches?.(".draft-json") && event.key === "Tab" && state.tabIndents) {
    event.preventDefault();
    const start = target.selectionStart;
    const end = target.selectionEnd;
    target.setRangeText("  ", start, end, "end");
    setLast("Tab inserted indentation inside the editor-local opt-in mode");
    return;
  }
  const row = target.closest?.("[data-event-index]");
  if (row) {
    const count = displayedRows().length;
    if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = Number(row.dataset.eventIndex);
      if (event.ctrlKey && event.key === "Home") moveEvidence(0);
      else if (event.ctrlKey && event.key === "End") moveEvidence(count - 1);
      else if (event.key === "ArrowDown") moveEvidence(index + 1);
      else if (event.key === "ArrowUp") moveEvidence(index - 1);
      else if (event.key === "PageDown") moveEvidence(index + 8);
      else if (event.key === "PageUp") moveEvidence(index - 8);
      else setLast(`${event.key} moved the active grid cell; row selection unchanged horizontally`);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openDetail();
      return;
    }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      openLayer("Object menu", `Evidence / evt-${1840 + state.selectedIndex}`, ".object-menu [role=menuitem]");
      return;
    }
  }
  const scopeNode = target.closest?.("[data-scope-index]");
  if (scopeNode && ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    const index = Number(scopeNode.dataset.scopeIndex);
    if (event.key === "ArrowDown") state.scopeIndex = Math.min(6, index + 1);
    else if (event.key === "ArrowUp") state.scopeIndex = Math.max(0, index - 1);
    else if (event.key === "Home") state.scopeIndex = 0;
    else if (event.key === "End") state.scopeIndex = 6;
    state.lastAction = ["Enter", " "].includes(event.key) ? "Committed focused Scope node" : "Moved Scope cursor; committed Scope unchanged";
    render(`[data-scope-index="${state.scopeIndex}"]`);
    return;
  }
  const contextTab = target.closest?.("[data-tab-index]");
  if (contextTab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "ArrowRight") state.contextTab = (state.contextTab + 1) % 5;
    else if (event.key === "ArrowLeft") state.contextTab = (state.contextTab + 4) % 5;
    else state.contextTab = event.key === "Home" ? 0 : 4;
    state.lastAction = "Moved and activated an instant Context lens";
    render(".context-tab.active");
    return;
  }
  const menuItem = target.closest?.("[data-menu-index]");
  if (menuItem && ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    const items = [...app.querySelectorAll("[data-menu-index]")];
    let index = Number(menuItem.dataset.menuIndex);
    if (event.key === "ArrowDown") index = (index + 1) % items.length;
    else if (event.key === "ArrowUp") index = (index + items.length - 1) % items.length;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = items.length - 1;
    else {
      if (index === 3) {
        state.layer = "None";
        state.surface = "injection";
        focusAndDescribe(".draft-json", "Local Injection Draft", "Object menu created one explicit draft; no Injection executed");
      } else closeLayer(`Activated ${menuItem.textContent.trim()} and restored focus`);
      return;
    }
    items.forEach((item, itemIndex) => item.tabIndex = itemIndex === index ? 0 : -1);
    items[index].focus();
    return;
  }
  if (target.matches?.(".operator-input") && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
    event.preventDefault();
    const commands = filteredOperatorCommands();
    if (event.key === "ArrowDown") state.operatorIndex = Math.min(commands.length - 1, state.operatorIndex + 1);
    else if (event.key === "ArrowUp") state.operatorIndex = Math.max(0, state.operatorIndex - 1);
    else if (commands[state.operatorIndex]) {
      executeOperator(commands[state.operatorIndex][0]);
      return;
    }
    render(".operator-input");
    const input = app.querySelector(".operator-input");
    input?.setSelectionRange(input.value.length, input.value.length);
  }
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    if (event.target.matches?.(".draft-json, .raw-document")) {
      setLast("Document owns Command/Control+F; Workbench did not intercept it");
      return;
    }
    event.preventDefault();
    if (state.variant === "B") {
      state.operatorQuery = "find: ";
      openLayer("Operator Lens", state.focusOwner, ".operator-input");
    } else openLayer("Find", state.focusOwner, ".find-input");
    return;
  }
  if (event.key === "Escape") {
    if (state.layer !== "None") {
      event.preventDefault();
      event.stopPropagation();
      if (state.layer === "Find" && state.findQuery) {
        state.findQuery = "";
        state.lastAction = "First Escape cleared temporary Find query";
        render(".find-input");
      } else closeLayer("Escape closed only the owned transient layer and restored its trigger");
    } else setLast("Escape was not consumed; DevTools Drawer remains available");
    return;
  }
  if (state.layer === "Key Lens" && !isEditable(event.target) && event.key.length === 1) {
    event.preventDefault();
    executeKeyCommand(event.key);
    return;
  }
  if (state.variant === "B" && event.key === "." && !isEditable(event.target) && state.layer === "None" && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    state.operatorQuery = "do: ";
    openLayer("Operator Lens", state.focusOwner, ".operator-input");
    return;
  }
  if (state.variant === "C" && event.key === ";" && !isEditable(event.target) && state.layer === "None" && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    openLayer("Key Lens", state.focusOwner, ".key-lens");
    return;
  }
  if (["ArrowLeft", "ArrowRight"].includes(event.key) && !isEditable(event.target) && event.target.closest?.(".prototype-switcher")) {
    event.preventDefault();
  }
});

app.addEventListener("change", (event) => {
  const control = event.target.dataset.control;
  if (!control) return;
  state[control] = event.target.value;
  if (control === "scenario") {
    state.surface = ["injection", "invalid"].includes(state.scenario) ? "injection" : "workspace";
    state.layer = state.scenario === "menu" ? "Object menu" : "None";
    state.contextOpen = false;
    state.newer = state.scenario === "frozen" ? 37 : 0;
    state.hiddenSelection = state.scenario === "filtered";
    if (state.hiddenSelection) state.selectedIndex = 2;
    state.lastAction = `Loaded ${SCENARIOS[state.scenario]} state`;
  }
  render();
});

function setLast(message) {
  state.lastAction = message;
  updateInspector();
}

function updateInspector() {
  const focus = app.querySelector('[data-inspector="focus"]');
  const selection = app.querySelector('[data-inspector="selection"]');
  const layer = app.querySelector('[data-inspector="layer"]');
  const last = app.querySelector('[data-inspector="last"]');
  if (focus) focus.textContent = state.focusOwner;
  if (selection) selection.textContent = `evt-${1840 + state.selectedIndex}`;
  if (layer) layer.textContent = state.layer;
  if (last) last.textContent = state.lastAction;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

render();
