// PROTOTYPE — two variants of the existing panel; only renderLedger() changes.
const VARIANTS = {
  A: { name: "Today's ledger", description: "Current six-column Ordered Evidence" },
  B: { name: "Surgical JSON console", description: "Only the ledger header and rows change" }
};

const FRAMES = {
  auto: "Auto viewport",
  compact: "563 × 700 compact",
  normal: "900 × 700 normal",
  shallow: "900 × 320 shallow",
  wide: "1440 × 900 wide"
};

const params = new URLSearchParams(location.search);
const requestedVariant = params.get("variant")?.toUpperCase();
const state = {
  variant: VARIANTS[requestedVariant] ? requestedVariant : "A",
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "wide",
  theme: ["dark", "light"].includes(params.get("theme")) ? params.get("theme") : "dark",
  selected: params.get("event") ?? "event-0165",
  query: params.get("q") ?? "",
  findCurrent: params.get("findEvent") ?? null,
  filter: params.get("filter") ?? "",
  findOpen: params.get("find") === "1",
  filterOpen: params.get("filterOpen") === "1",
  surface: ["evidence", "context", "scope"].includes(params.get("surface")) ? params.get("surface") : "evidence",
  scopeOpen: false,
  scopeCollapsed: false,
  contextCollapsed: false,
  frozen: true,
  ensureSelection: true,
  pendingFocus: null,
  scroll: { A: { top: 0, left: 0 }, B: { top: 0, left: 0 } }
};

const ALL_EVENTS = createEvents(180);
let renderQueued = false;

function createEvents(count) {
  const keys = ["alpha", "beta", "gamma", "delta"];
  const items = ["scenario.snapshot-basic", "scenario.add-update-delete"];
  return Array.from({ length: count }, (_, offset) => {
    const sequence = offset + 1;
    const id = `event-${String(sequence).padStart(4, "0")}`;
    const time = formatTime(sequence);
    const source = sequence % 29 === 0 ? "LOCAL" : sequence % 41 === 0 ? "WORKBENCH" : sequence % 23 === 0 ? "RUNTIME" : "SERVER";
    const key = sequence % 47 === 0 ? "customer-order-command-key-with-long-production-identity" : keys[sequence % keys.length];
    const item = items[sequence % items.length];
    const snapshot = sequence <= 18;
    const isDelivery = source === "SERVER" && sequence % 7 === 0;
    const isDiagnostic = source === "WORKBENCH";
    const isRuntime = source === "RUNTIME";
    const command = isDelivery || isDiagnostic || isRuntime ? null : sequence % 31 === 0 ? "DELETE" : sequence % 11 === 0 ? "ADD" : "UPDATE";
    const phase = isDiagnostic || isRuntime ? null : snapshot ? "SNAPSHOT" : "LIVE";
    const kind = isDiagnostic ? "Capture Diagnostic" : isRuntime ? "Session Status" : isDelivery ? "Update Delivery" : source === "LOCAL" ? "Injected Update" : "Item Update";
    const fields = kind.includes("Update") && !isDelivery ? {
      command,
      key,
      name: key[0].toUpperCase() + key.slice(1),
      qty: (sequence * 7) % 100,
      status: sequence % 9 === 0 ? "review" : sequence % 5 === 0 ? "closed" : "open",
      version: sequence
    } : null;
    const changedFields = fields ? (sequence % 3 === 0 ? { qty: fields.qty, status: fields.status, version: fields.version } : { qty: fields.qty, version: fields.version }) : null;
    const raw = {
      id,
      timestamp: Date.UTC(2026, 7, 6, 12, 29, 30) + sequence * 237,
      direction: "inbound",
      source: source === "LOCAL" ? "synthetic" : "server",
      ...(source === "SERVER" ? { captureSource: "listener" } : {}),
      synthetic: source === "LOCAL",
      kind: kind.toLowerCase().replaceAll(" ", "-"),
      client: { id: "client-main", sessionId: "session-9f2a" },
      subscription: { id: "sub-7", mode: "COMMAND", items: [item], fields: ["command", "key", "name", "qty", "status", "version"] },
      ...(isDelivery ? { listener: { id: sequence % 2 ? "listener-view" : "listener-metrics" } } : {}),
      item: { name: item, position: sequence % 2 + 1 },
      ...(fields ? { update: { isSnapshot: snapshot, fields, changedFields, command, key } } : {})
    };
    const event = {
      id,
      sequence,
      time,
      source,
      phase,
      command,
      key: fields || isDelivery ? key : null,
      kind,
      object: isRuntime ? "client-main" : item,
      summary: changedFields ? Object.keys(changedFields).join(", ") : isDelivery ? "listener delivery" : isDiagnostic ? "late attachment" : "session connected",
      fields,
      raw
    };
    return { ...event, jsonLine: serializeConsoleLine(event) };
  });
}

function serializeConsoleLine(event) {
  // Deliberate display contract: derived Workbench semantics first, complete persistable event last.
  return JSON.stringify({
    time: event.time,
    source: event.source,
    phase: event.phase,
    command: event.command,
    kind: event.kind,
    commandKey: event.key,
    id: event.id,
    object: event.object,
    summary: event.summary,
    event: event.raw
  });
}

function formatTime(sequence) {
  const totalMs = (22 * 60 * 60 + 40 * 60) * 1000 + sequence;
  const hours = Math.floor(totalMs / 3_600_000) % 24;
  const minutes = Math.floor(totalMs / 60_000) % 60;
  const seconds = Math.floor(totalMs / 1_000) % 60;
  const milliseconds = totalMs % 1_000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${String(milliseconds).padStart(3, "0")}`;
}

function pad(value) { return String(value).padStart(2, "0"); }

function filteredEvents() {
  const query = state.filter.trim().toLowerCase();
  if (!query) return ALL_EVENTS;
  return ALL_EVENTS.filter((event) => event.jsonLine.toLowerCase().includes(query));
}

function windowedEvents() {
  const filtered = filteredEvents();
  const currentFind = findCurrentEvent();
  if (state.findOpen && state.query && currentFind) {
    const matchIndex = filtered.findIndex((event) => event.id === currentFind.id);
    const start = Math.max(0, Math.min(matchIndex - 30, filtered.length - 60));
    return filtered.slice(start, start + 60);
  }
  return filtered.slice(Math.max(0, filtered.length - 60));
}

function findMatches() {
  const query = state.query.trim().toLowerCase();
  if (!query) return [];
  return filteredEvents().filter((event) => `${event.jsonLine} ${event.kind}`.toLowerCase().includes(query));
}

function findCurrentEvent() {
  const matches = findMatches();
  return matches.find((event) => event.id === state.findCurrent) ?? matches[0] ?? null;
}

function selectedEvent() { return ALL_EVENTS.find((event) => event.id === state.selected) ?? null; }

function layoutForFrame() {
  if (state.frame !== "auto") return state.frame;
  if (innerWidth >= 1120 && innerHeight >= 500) return "wide";
  if (innerWidth >= 700 && innerHeight >= 440) return "normal";
  if (innerWidth >= 700) return "shallow";
  return "compact";
}

function render() {
  renderQueued = false;
  document.documentElement.dataset.theme = state.theme;
  const layout = layoutForFrame();
  const events = windowedEvents();
  const filtered = filteredEvents();
  const selected = selectedEvent();
  document.querySelector("#app").innerHTML = `<section class="prototype-stage frame-${state.frame}">
    <section class="prototype-frame">
      <section class="workbench" data-layout="${layout}" data-surface="${state.surface}" data-scope-open="${state.scopeOpen}" data-scope-collapsed="${state.scopeCollapsed}" data-context-collapsed="${state.contextCollapsed}" aria-label="Lightstreamer Workbench surgical prototype">
        ${renderOperating()}
        ${renderScopeStrip()}
        <main class="workspace">
          ${renderScopePane()}
          <div class="splitter splitter-scope" role="separator" aria-label="Resize Scope"></div>
          ${renderEvidence(events, filtered.length)}
          <div class="splitter splitter-context" role="separator" aria-label="Resize Context"></div>
          ${renderContext(selected)}
        </main>
        ${renderStatus()}
      </section>
    </section>
    ${renderPrototypeControls(layout)}
    ${renderSwitcher()}
  </section>`;
  wireInteractions();
  restoreAfterRender();
}

function renderOperating() {
  const matches = findMatches();
  const current = findCurrentEvent();
  const currentIndex = matches.findIndex((event) => event.id === current?.id);
  return `<header class="operating">
    <strong>Capture RUNNING</strong><span>Coverage LIMITED</span><span>View ${state.frozen ? "FROZEN · 16 newer" : "FOLLOW LIVE"}</span>
    <div class="operating-actions">
      ${state.findOpen ? `<div class="find" role="search" aria-label="Find in ordered Evidence"><label for="find-input">Find</label><input id="find-input" value="${escapeAttribute(state.query)}"><span>${matches.length ? `${Math.max(currentIndex, 0) + 1} of ${matches.length} matches` : "0 matches"}</span><button data-action="find-prev">Previous</button><button data-action="find-next">Next</button><button data-action="close-find">Close Find</button></div>` : `<button data-action="open-find">Find</button>`}
      <button data-action="toggle-filter" aria-expanded="${state.filterOpen}">Filter</button><label class="eyebrow" for="theme">Theme</label><select id="theme" data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select><button>More actions</button>
    </div>
  </header>`;
}

function renderScopeStrip() {
  return `<nav class="scope-strip" aria-label="Current runtime scope"><button data-action="scope">Scope</button>${state.scopeCollapsed ? `<button data-action="restore-scope">Restore Scope</button>` : ""}${state.contextCollapsed ? `<button data-action="restore-context">Restore Context</button>` : ""}<strong>Inspected page</strong><span>Active · 1 clients · 1 subscriptions</span></nav>`;
}

function renderScopePane() {
  return `<nav class="pane scope-pane" aria-label="Structural runtime scope"><header class="pane-header"><div><span class="eyebrow">Runtime Scope</span><strong>Inspected page</strong></div><div><button class="collapse-scope" data-action="collapse-scope">Collapse Scope</button><button class="close-scope" data-action="close-scope">Close Scope</button><button class="compact-back" data-action="back-evidence">Back to Evidence</button></div></header><div class="scope-tree" role="tree">
    ${scopeNode("1 clients · 1 subscriptions", "Active", 1, true)}${scopeNode("Web Client 9.2.3 build 20250225", "public-api · Active", 2)}${scopeNode("Session session-9f2a", "1 subscriptions · Active", 3)}${scopeNode("COMMAND · 3 real · 0 deliveries", "Active", 4)}${scopeNode("scenario.snapshot-basic", "0 updates · Active", 5)}${scopeNode("scenario.add-update-delete", "0 updates · Active", 5)}
  </div></nav>`;
}

function scopeNode(label, detail, level, selected = false) {
  return `<button class="scope-node" role="treeitem" aria-level="${level}" aria-selected="${selected}" style="--depth:${level - 1}"><span>${label}</span><em>${detail}</em></button>`;
}

function renderEvidence(events, filteredTotal) {
  const filtered = filteredEvents();
  const selectedHidden = Boolean(state.filter && state.selected && !filtered.some((event) => event.id === state.selected));
  const visibleStart = events.length ? filtered.findIndex((event) => event.id === events[0].id) + 1 : 0;
  const visibleEnd = events.length ? visibleStart + events.length - 1 : 0;
  return `<section class="pane evidence-pane" aria-label="Ordered Evidence"><header class="pane-header"><div><span class="eyebrow">Ordered Evidence</span><strong>Inspected page</strong></div><div class="evidence-summary"><span>${events.length} shown / ${ALL_EVENTS.length}</span>${state.filter ? `<span>Filter: ${escapeHtml(state.filter)}</span><button data-action="clear-filter">Clear filters</button>` : ""}${state.selected ? `<button data-action="open-context">${layoutForFrame() === "compact" ? "Open selected Context" : "Focus selected Context"}</button>` : ""}</div></header>
    ${state.filterOpen ? `<form class="filter" id="filter-form"><label for="filter-input">Filter Evidence</label><input id="filter-input" value="${escapeAttribute(state.filter)}"><button type="submit">Apply Filter</button><button type="button" data-action="clear-filter">Clear filters</button><button type="button" data-action="close-filter">Close Filter</button></form>` : ""}
    ${selectedHidden ? `<div class="condition selection-condition"><strong>Selected event outside current results</strong><span>Evidence ${escapeHtml(state.selected)} remains selected in Context.</span><div><button data-action="reveal-selection">Reveal selected Evidence</button><button data-action="clear-selection">Clear selection</button></div></div>` : ""}
    <div class="condition warning"><strong>! Coverage LIMITED</strong><span>IndexedDB is unavailable. Evidence is held in memory for this DevTools session.</span><button>Open diagnostics</button></div>
    <div class="evidence-window"><button aria-disabled="${visibleStart <= 1}">Oldest</button><button aria-disabled="${visibleStart <= 1}">Older</button><span>${visibleStart}–${visibleEnd} of ${filteredTotal}</span><button aria-disabled="${visibleEnd >= filteredTotal}">Newer</button><button aria-disabled="${visibleEnd >= filteredTotal}">Newest</button></div>
    ${events.length ? renderLedger(events) : `<div class="empty"><strong>No Evidence in the current Scope.</strong><span>Capture running with Coverage limited.</span><button data-action="clear-filter">Clear filters</button></div>`}
  </section>`;
}

// The only product-surface branch in the surgical prototype.
function renderLedger(events) {
  return state.variant === "B" ? renderJsonConsole(events) : renderCurrentLedger(events);
}

function renderCurrentLedger(events) {
  const current = findCurrentEvent();
  return `<div class="ledger current-ledger" data-scroll-owner role="grid" aria-label="Ordered Lightstreamer Evidence" tabindex="0"><div class="ledger-header" role="row"><span role="columnheader">Time / #</span><span role="columnheader">Source</span><span role="columnheader">Phase</span><span role="columnheader">Op</span><span role="columnheader">Evidence / object</span><span role="columnheader">COMMAND key</span></div>${events.map((event) => {
    const selected = event.id === state.selected;
    return `<button class="evidence-row current-row" role="row" aria-selected="${selected}" tabindex="${selected ? 0 : -1}" data-event="${event.id}" data-find-current="${event.id === current?.id && state.query ? "true" : "false"}"><span role="gridcell"><time>${event.time}</time><small>${event.id}</small></span><strong role="gridcell">${event.source}</strong><span role="gridcell">${event.phase ?? "—"}</span><b role="gridcell">${event.command ?? "—"}</b><span role="gridcell"><strong>${event.kind}</strong><small>${event.object}</small></span><span role="gridcell">${event.key ?? "—"}</span></button>`;
  }).join("")}</div>`;
}

function renderJsonConsole(events) {
  const matches = findMatches();
  const current = findCurrentEvent();
  return `<div class="ledger json-ledger" data-scroll-owner role="grid" aria-label="Ordered Lightstreamer Evidence JSON console" tabindex="0"><div class="json-header" role="row"><span role="columnheader">Line</span><span role="columnheader">Event JSON · normalized Workbench evidence</span></div>${events.map((event) => `<button class="evidence-row json-row" role="row" aria-label="${escapeAttribute(`${event.time}, ${event.source}, ${event.phase ?? "no phase"}, ${event.command ?? "no operation"}, ${event.kind}, ${event.key ?? "no COMMAND key"}, ${event.id}`)}" aria-selected="${event.id === state.selected}" tabindex="${event.id === state.selected ? 0 : -1}" data-event="${event.id}" data-find-current="${event.id === current?.id && state.query ? "true" : "false"}"><span role="gridcell"><b>${event.sequence}</b>${event.id === current?.id && state.query ? `<small>Find ${matches.indexOf(current) + 1} of ${matches.length}</small>` : ""}</span><code role="gridcell" aria-hidden="true">${markText(event.jsonLine)}</code></button>`).join("")}</div>`;
}

function renderContext(event) {
  if (!event) return `<aside class="pane context-pane" aria-label="Context"><header class="pane-header"><div><span class="eyebrow">Runtime object</span><strong>Inspected page</strong></div><button class="collapse-context" data-action="collapse-context">Collapse Context</button></header><div class="context-body"><dl class="context-fields">${property("Scope type", "Page")}${property("Clients", "1")}${property("Active sessions", "1")}${property("Subscriptions", "1")}${property("Items", "2")}</dl></div></aside>`;
  return `<aside class="pane context-pane" aria-label="Context"><header class="pane-header"><div><span class="eyebrow">Selected Evidence</span><strong tabindex="-1">${event.id} · ${event.kind}</strong></div><div><button class="collapse-context" data-action="collapse-context">Collapse Context</button><button class="compact-back" data-action="back-evidence">Back to Evidence</button></div></header><div class="context-body" tabindex="0"><dl class="context-fields" aria-label="Evidence metadata">${property("Source", event.source)}${property("Phase", event.phase ?? "—")}${property("COMMAND operation", event.command ?? "—")}${property("Evidence identity", event.id)}${property("Client identity", "client-main")}${property("Session identity", "session-9f2a")}${property("Subscription identity", "sub-7")}${property("Runtime object", event.object)}${property("COMMAND key", event.key ?? "—")}${property("Observation path", event.source === "LOCAL" ? "Local Injection › synthetic delivery" : "Server › listener Capture")}${property("Evidence limitations", "Captured observation; unavailable properties remain Unknown and this is not Authoritative COMMAND State.")}</dl>${event.fields ? `<section class="selected-update" aria-label="Selected update"><h3>Selected update</h3><section aria-label="Fields"><h4>Fields</h4><dl>${Object.entries(event.fields).map(([key, value]) => property(key, JSON.stringify(value))).join("")}</dl></section></section>` : ""}<div class="context-actions">${event.command ? `<button>Compare current Scope COMMAND projections</button>` : ""}<button ${event.fields ? "" : "disabled"}>Create Local Injection Draft</button><button>Open complete raw</button></div></div></aside>`;
}

function property(term, value) { return `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>`; }

function renderStatus() {
  return `<footer class="status"><span>Observation requires care; retained Evidence remains readable.</span><button data-action="toggle-live">${state.frozen ? "Follow Live" : "Freeze Evidence"}</button></footer>`;
}

function renderPrototypeControls(layout) {
  return `<aside class="prototype-controls" aria-label="Prototype controls"><strong>PROTOTYPE · only the ledger changes</strong><label>Frame<select data-control="frame">${options(FRAMES, state.frame)}</select></label><code>variant=${state.variant} · layout=${layout} · selected=${state.selected || "none"} · find=${state.query || "none"} · filter=${state.filter || "none"} · surface=${state.surface}</code></aside>`;
}

function renderSwitcher() {
  return `<nav class="prototype-switcher" aria-label="Prototype variant switcher"><button data-action="variant-prev">Previous</button><span>${state.variant} — ${VARIANTS[state.variant].name}</span><button data-action="variant-next">Next</button></nav>`;
}

function options(record, selected) { return Object.entries(record).map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join(""); }

function wireInteractions() {
  document.querySelectorAll("[data-event]").forEach((row) => {
    row.addEventListener("click", () => selectEvent(row.dataset.event, false));
    row.addEventListener("keydown", handleEvidenceKey);
  });
  document.querySelectorAll("[data-action]").forEach((control) => control.addEventListener("click", () => handleAction(control.dataset.action)));
  document.querySelectorAll("[data-control]").forEach((control) => control.addEventListener("change", () => mutate(() => { state[control.dataset.control] = control.value; })));
  document.querySelector("#find-input")?.addEventListener("input", (event) => mutate(() => { state.query = event.currentTarget.value; state.findCurrent = null; state.pendingFocus = "find"; }));
  document.querySelector("#filter-form")?.addEventListener("submit", (event) => { event.preventDefault(); mutate(() => { state.filter = document.querySelector("#filter-input").value.trim(); state.filterOpen = false; }); });
}

function handleEvidenceKey(event) {
  const rows = [...document.querySelectorAll("[data-event]")];
  const index = rows.indexOf(event.currentTarget);
  if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    const delta = event.key === "PageDown" ? 10 : event.key === "PageUp" ? -10 : event.key === "ArrowDown" ? 1 : -1;
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + delta));
    selectEvent(rows[next].dataset.event, true);
  }
  if (event.key === "Enter") { event.preventDefault(); mutate(() => { state.surface = "context"; state.pendingFocus = "context"; }); }
}

function handleAction(action) {
  if (action === "variant-prev" || action === "variant-next") return cycleVariant(action === "variant-next" ? 1 : -1);
  if (action === "open-find") return mutate(() => { state.findOpen = true; state.pendingFocus = "find"; });
  if (action === "close-find") return mutate(() => { state.findOpen = false; state.query = ""; state.findCurrent = null; });
  if (action === "find-next" || action === "find-prev") return moveFind(action === "find-next" ? 1 : -1);
  if (action === "toggle-filter") return mutate(() => { state.filterOpen = !state.filterOpen; state.pendingFocus = state.filterOpen ? "filter" : null; });
  if (action === "close-filter") return mutate(() => { state.filterOpen = false; });
  if (action === "clear-filter") return mutate(() => { state.filter = ""; state.filterOpen = false; });
  if (action === "open-context") return mutate(() => { state.surface = "context"; state.pendingFocus = "context"; });
  if (action === "back-evidence") return mutate(() => { state.surface = "evidence"; state.scopeOpen = false; state.pendingFocus = "selected"; });
  if (action === "scope") return mutate(() => { if (layoutForFrame() === "compact") state.surface = "scope"; else state.scopeOpen = !state.scopeOpen; });
  if (action === "close-scope") return mutate(() => { state.scopeOpen = false; });
  if (action === "collapse-scope") return mutate(() => { state.scopeCollapsed = true; });
  if (action === "restore-scope") return mutate(() => { state.scopeCollapsed = false; });
  if (action === "collapse-context") return mutate(() => { state.contextCollapsed = true; });
  if (action === "restore-context") return mutate(() => { state.contextCollapsed = false; });
  if (action === "toggle-live") return mutate(() => { state.frozen = !state.frozen; });
  if (action === "reveal-selection") return mutate(() => { state.filter = ""; state.ensureSelection = true; });
  if (action === "clear-selection") return mutate(() => { state.selected = ""; });
}

function moveFind(direction) {
  const matches = findMatches();
  if (!matches.length) return;
  const current = matches.findIndex((event) => event.id === findCurrentEvent()?.id);
  const next = current < 0 ? 0 : (current + direction + matches.length) % matches.length;
  mutate(() => { state.findCurrent = matches[next].id; state.pendingFocus = "find"; });
}

function selectEvent(id, focusAfter) {
  mutate(() => { state.selected = id; state.pendingFocus = focusAfter ? "selected" : null; });
}

function cycleVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(state.variant);
  mutate(() => { state.variant = keys[(index + direction + keys.length) % keys.length]; state.ensureSelection = true; });
}

function mutate(change) { captureScroll(); change(); syncUrl(); render(); }

function captureScroll() {
  const owner = document.querySelector("[data-scroll-owner]");
  if (owner) state.scroll[state.variant] = { top: owner.scrollTop, left: owner.scrollLeft };
}

function restoreAfterRender() {
  const owner = document.querySelector("[data-scroll-owner]");
  const stored = state.scroll[state.variant];
  if (owner && stored) { owner.scrollTop = stored.top; owner.scrollLeft = stored.left; }
  if (state.ensureSelection) { document.querySelector(`[data-event="${CSS.escape(state.selected)}"]`)?.scrollIntoView({ block: "center", inline: "nearest" }); state.ensureSelection = false; }
  if (state.pendingFocus === "selected") document.querySelector(`[data-event="${CSS.escape(state.selected)}"]`)?.focus();
  if (state.pendingFocus === "find") { const input = document.querySelector("#find-input"); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }
  if (state.pendingFocus === "filter") document.querySelector("#filter-input")?.focus();
  if (state.pendingFocus === "context") document.querySelector(".context-pane .pane-header strong")?.focus();
  state.pendingFocus = null;
}

function syncUrl() {
  const next = new URLSearchParams({ variant: state.variant, frame: state.frame, theme: state.theme });
  if (state.selected) next.set("event", state.selected);
  if (state.query) next.set("q", state.query);
  if (state.findCurrent) next.set("findEvent", state.findCurrent);
  if (state.filter) next.set("filter", state.filter);
  if (state.findOpen) next.set("find", "1");
  if (state.filterOpen) next.set("filterOpen", "1");
  if (state.surface !== "evidence") next.set("surface", state.surface);
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

function markText(value) {
  const query = state.query.trim();
  if (!query) return escapeHtml(value);
  const expression = new RegExp(escapeRegExp(query), "ig");
  let last = 0;
  let result = "";
  for (const match of value.matchAll(expression)) { result += escapeHtml(value.slice(last, match.index)); result += `<mark>${escapeHtml(match[0])}</mark>`; last = match.index + match[0].length; }
  return result + escapeHtml(value.slice(last));
}

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', "&quot;"); }

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest?.(".workbench")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); cycleVariant(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); cycleVariant(1); }
});

window.addEventListener("resize", () => { if (state.frame !== "auto" || renderQueued) return; renderQueued = true; requestAnimationFrame(render); });
render();
