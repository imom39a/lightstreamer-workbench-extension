const VARIANTS = {
  A: { name: "Diagnose", states: ["live", "selected", "command", "frozen", "raw", "export", "empty"] },
  B: { name: "Local Injection", states: ["edit", "compare", "invalid", "stale", "review", "delivered", "failed"] },
  C: { name: "Recover", states: ["coverage", "disconnected", "storage", "retired", "recovering"] }
};

const STATE_LABELS = {
  live: "Live orientation",
  selected: "Selected evidence",
  command: "COMMAND projections",
  frozen: "Frozen high volume",
  raw: "Complete raw evidence",
  export: "Scoped export",
  empty: "Empty current Scope",
  edit: "Draft editing",
  compare: "Compare Source",
  invalid: "Invalid Draft",
  stale: "Retired target",
  review: "Review boundary",
  delivered: "Delivered locally",
  failed: "Delivery failed",
  coverage: "Coverage limited",
  disconnected: "Inspected page disconnected",
  storage: "In-memory fallback",
  retired: "Historical selection",
  recovering: "Session recovering"
};

const FRAMES = {
  auto: "Auto viewport",
  compact: "563 × 700 compact",
  normal: "900 × 700 normal",
  shallow: "900 × 320 shallow",
  wide: "1440 × 900 wide"
};

const THEMES = { dark: "Dark", light: "Light" };
const params = new URLSearchParams(location.search);
const requestedVariant = params.get("variant")?.toUpperCase();
const variant = VARIANTS[requestedVariant] ? requestedVariant : "A";
const requestedState = params.get("state");
const stateKey = VARIANTS[variant].states.includes(requestedState) ? requestedState : VARIANTS[variant].states[0];
const visualSetup = params.get("setup") ?? "none";

const state = {
  variant,
  state: stateKey,
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "auto",
  theme: THEMES[params.get("theme")] ? params.get("theme") : "dark",
  selected: params.get("event") ?? (
    visualSetup === "selected-json"
      ? "json-string-event"
      : ["retained-find", "long-identities"].includes(visualSetup)
        ? highVolumeEventId(3_970)
        : stateKey === "live" ? "" : "evt-1842"
  ),
  surface: params.get("surface") ?? "evidence",
  presentation: params.get("presentation") === "1",
  filtered: params.get("filter") === "updates",
  visualSetup
};

const EVENTS = [
  { id: "evt-1838", time: "14:08:38.610", source: "RUNTIME", phase: "—", op: "—", kind: "Subscription started", object: "orders.command / portfolio", change: "COMMAND · 11 fields", severity: "—" },
  { id: "evt-1839", time: "14:08:39.112", source: "SERVER", phase: "SNAPSHOT", op: "ADD", kind: "Item Update", object: "order-1042", change: "6 fields", severity: "—" },
  { id: "evt-1840", time: "14:08:39.441", source: "SERVER", phase: "SNAPSHOT", op: "ADD", kind: "Item Update", object: "order-1088", change: "7 fields", severity: "—" },
  { id: "evt-1841", time: "14:08:40.006", source: "SERVER", phase: "END OF SNAPSHOT", op: "—", kind: "End of snapshot", object: "orders.command", change: "2 active keys", severity: "—" },
  { id: "evt-1842", time: "14:08:41.238", source: "SERVER", phase: "LIVE", op: "UPDATE", kind: "Item Update", object: "order-1042", change: "qty, status", severity: "Warning" },
  { id: "evt-1843", time: "14:08:41.239", source: "SERVER", phase: "LIVE", op: "UPDATE", kind: "Update Delivery", object: "listener-view", change: "order-1042", severity: "—" },
  { id: "evt-1844", time: "14:08:41.239", source: "SERVER", phase: "LIVE", op: "UPDATE", kind: "Update Delivery", object: "listener-metrics", change: "order-1042", severity: "—" },
  { id: "evt-1845", time: "14:08:52.003", source: "LOCAL", phase: "—", op: "UPDATE", kind: "Local Injection", object: "inj-031 → sub-7", change: "Delivered to 2 listeners", severity: "—" },
  { id: "evt-1846", time: "14:08:52.004", source: "LOCAL", phase: "LIVE", op: "UPDATE", kind: "Injected Update", object: "order-1042", change: "qty, status", severity: "—" },
  { id: "evt-1847", time: "14:08:52.005", source: "LOCAL", phase: "LIVE", op: "UPDATE", kind: "Update Delivery", object: "listener-view", change: "order-1042", severity: "—" },
  { id: "evt-1848", time: "14:08:52.005", source: "LOCAL", phase: "LIVE", op: "UPDATE", kind: "Update Delivery", object: "listener-metrics", change: "listener threw after delivery", severity: "Warning" },
  { id: "evt-1849", time: "14:09:06.102", source: "SERVER", phase: "LIVE", op: "DELETE", kind: "Item Update", object: "order-0991", change: "key removed", severity: "—" },
  { id: "evt-1850", time: "14:09:08.377", source: "RUNTIME", phase: "—", op: "—", kind: "Session status", object: "S-9", change: "RECOVERING", severity: "Information" },
  { id: "evt-1851", time: "14:09:09.201", source: "WORKBENCH", phase: "UNKNOWN", op: "—", kind: "Capture diagnostic", object: "orders.command", change: "late attachment limits phase", severity: "Error" }
];

const JSON_STRING_EVENT = {
  id: "json-string-event",
  time: "22:40:00.114",
  source: "SERVER",
  phase: "LIVE",
  op: "ADD",
  kind: "Item Update",
  object: "topology-small-item",
  change: "json-string-alpha",
  severity: "—"
};

const RETAINED_FIND_EVENTS = Array.from({ length: 12 }, (_, index) => highVolumeEvent(index + 1, {
  searchAnchor: [5, 8, 11].includes(index + 1) ? "complete-retained-find-anchor" : ""
}));
const LONG_IDENTITY_EVENTS = Array.from({ length: 14 }, (_, index) => highVolumeEvent(3_961 + index));
const HIGH_VOLUME_SELECTED_EVENT = highVolumeEvent(3_970);

function highVolumeEventId(sequence) {
  return `retained-evidence-event-${String(sequence).padStart(4, "0")}-from-orders-command-subscription-with-long-production-identity`;
}

function highVolumeEvent(sequence, extra = {}) {
  return {
    id: highVolumeEventId(sequence),
    time: `22:40:03.${String(sequence % 1_000).padStart(3, "0")}`,
    source: "SERVER",
    phase: "LIVE",
    op: "UPDATE",
    kind: "Item Update",
    object: "portfolio/orders/north-america/enterprise-customer-primary-book",
    change: `customer-order-command-key-with-long-production-identity-${sequence % 10}`,
    severity: "—",
    ...extra
  };
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.frame = state.frame;
  document.querySelector("#app").innerHTML = `
    <section class="prototype-stage frame-${state.frame}">
      <section class="workbench variant-${state.variant.toLowerCase()} surface-${state.surface}" aria-label="Integrated Lightstreamer Workbench prototype">
        ${renderOperatingStrip()}
        ${renderScopeStrip()}
        ${renderPrimarySurface()}
        ${renderStatusStrip()}
      </section>
      ${state.presentation ? "" : renderControls()}
      ${state.presentation ? "" : renderInspector()}
    </section>`;
  wireInteractions();
  restoreEvidenceFocus();
}

function renderOperatingStrip() {
  const degraded = state.variant === "C";
  const frozen = state.state === "frozen";
  const disconnected = state.state === "disconnected";
  const capture = disconnected ? "STOPPED" : "RUNNING";
  const coverage = degraded ? (disconnected ? "UNAVAILABLE" : "LIMITED") : "USEFUL";
  const view = frozen
    ? `FROZEN · ${["retained-find", "long-identities"].includes(state.visualSetup) ? "30" : "2,418"} newer`
    : "FOLLOW LIVE";
  return `<header class="operating-strip">
    <strong>Capture ${capture}</strong>
    <span class="${degraded ? "condition" : ""}">Coverage ${coverage}</span>
    <span>View ${view}</span>
    <div class="operating-actions">
      ${state.visualSetup === "retained-find" ? renderPrototypeFind() : `<button data-action="find">Find</button>`}
      <button data-action="filter-toggle">${state.filtered ? "Filter: Updates" : "Filter"}</button>
      <button aria-label="More actions">More actions</button>
    </div>
  </header>`;
}

function renderPrototypeFind() {
  const query = "complete-retained-find-anchor";
  const matches = evidenceForState().filter((event) => event.searchAnchor === query);
  return `<div class="prototype-find" role="search" aria-label="Find in ordered Evidence"><label for="prototype-find">Find</label><input id="prototype-find" value="${query}" readonly><span>1 of ${matches.length} matches</span><button>Previous</button><button>Next</button><button>Close Find</button></div>`;
}

function renderScopeStrip() {
  const session = state.state === "recovering" ? "Session S-9 · RECOVERING" : state.state === "disconnected" ? "Session S-9 · RETAINED" : "Session S-9";
  const scopeStatus = {
    coverage: "Subscribed · Coverage limited",
    disconnected: "Disconnected · retained Evidence",
    storage: "Subscribed · in-memory history",
    retired: "Historical · read-only",
    recovering: "Recovering · target readiness pending",
    stale: "Historical · read-only"
  }[state.state] ?? "Subscribed · Snapshot complete";
  if (state.visualSetup !== "none") return `<nav class="scope-strip" aria-label="Runtime scope">
    <button data-action="scope">Scope</button>
    <strong>${state.variant === "B" ? "Inspected page › topology-small-client › Session topology-small-session › topology-small-subscription" : "Inspected page"}</strong>
    <em class="scope-state">Active · 1 clients · 1 subscriptions</em>
  </nav>`;
  return `<nav class="scope-strip" aria-label="Runtime scope">
    <button data-action="scope">Scope</button>
    <span>Page</span><b>›</b><span>client-main</span><b>›</b><span>${session}</span><b>›</b><strong>orders.command</strong><b>›</b><span>portfolio</span>
    <em class="scope-state">${scopeStatus}</em>
  </nav>`;
}

function renderPrimarySurface() {
  if (state.variant === "B") return renderInjectionDocument();
  if (state.variant === "A" && state.state === "command") return renderCommandDocument();
  if (state.variant === "A" && state.state === "raw") return renderRawDocument();
  if (state.variant === "A" && state.state === "export") return renderExportDocument();
  return renderWorkspace();
}

function renderWorkspace() {
  return `<section class="workspace">
    ${renderScopePane()}
    ${renderEvidencePane()}
    ${renderContextPane()}
  </section>`;
}

function renderScopePane() {
  const currentState = state.variant === "C" ? state.state : "active";
  return `<nav class="pane scope-pane" aria-label="Structural runtime scope">
    <header><div><small>Runtime Scope</small><strong>Inspected page</strong></div><button aria-label="Close Scope">×</button></header>
    <div class="scope-tree" role="tree">
      ${scopeNode("▾ Page", "1 client", true)}
      ${scopeNode("  ▾ client-main", currentState === "disconnected" ? "disconnected" : "active")}
      ${scopeNode("    ▾ Session S-9", currentState === "recovering" ? "recovering" : currentState === "disconnected" ? "retained" : "connected")}
      ${scopeNode("      ▾ orders.command", currentState === "retired" ? "retired" : "subscribed", true)}
      ${scopeNode("        portfolio", state.variant === "C" ? "limited" : "2 keys")}
      ${scopeNode("        listener-view", "active")}
      ${scopeNode("        listener-metrics", "active")}
    </div>
  </nav>`;
}

function scopeNode(label, meta, selected = false) {
  return `<div class="scope-node ${selected ? "selected" : ""}" role="treeitem" aria-selected="${selected}"><span>${label}</span><em>${meta}</em></div>`;
}

function evidenceForState() {
  if (state.visualSetup === "retained-find") return RETAINED_FIND_EVENTS;
  if (state.visualSetup === "long-identities") return LONG_IDENTITY_EVENTS;
  if (state.visualSetup === "selected-json") return [JSON_STRING_EVENT, ...EVENTS.slice(0, 5)];
  if (state.visualSetup === "matching-summary") return EVENTS.slice(0, 5);
  if (["live-selected", "more-actions"].includes(state.visualSetup)) return EVENTS.slice(0, 6);
  if (state.state === "empty") return [];
  if (state.variant === "C") {
    if (state.state === "coverage") return EVENTS.filter((event) => ["evt-1838", "evt-1842", "evt-1843", "evt-1851"].includes(event.id));
    if (state.state === "disconnected") return EVENTS.filter((event) => event.id < "evt-1846");
    if (state.state === "storage") return EVENTS.slice(4, 12);
    if (state.state === "retired") return EVENTS.filter((event) => ["evt-1839", "evt-1842", "evt-1849"].includes(event.id));
    if (state.state === "recovering") return EVENTS.filter((event) => ["evt-1842", "evt-1843", "evt-1850", "evt-1851"].includes(event.id));
  }
  const visible = state.filtered ? EVENTS.filter((event) => event.kind.includes("Update")) : EVENTS;
  return visible;
}

function renderEvidencePane() {
  const events = evidenceForState();
  const scopeLabel = state.visualSetup === "none" ? "orders.command / portfolio" : "Inspected page";
  const total = ["retained-find", "long-identities"].includes(state.visualSetup)
    ? "60 shown / 4,000"
    : state.visualSetup !== "none"
      ? `${events.length} shown / ${events.length}`
      : state.state === "frozen" ? "48 shown / 118,420" : `${events.length} shown / 12,482`;
  return `<section class="pane evidence-pane" aria-label="Ordered Evidence">
    <header class="pane-heading"><div><small>Ordered Evidence</small><strong>${scopeLabel}</strong></div><span>${total}</span></header>
    ${renderConditionNotice()}
    ${events.length ? `<div class="evidence-grid" role="grid" aria-label="Ordered Lightstreamer Evidence">
      <div class="ledger-header" role="row"><span>Time / #</span><span>Source</span><span>Phase</span><span>Op</span><span>Evidence / object</span><span>Change</span><span>Diagnostic</span></div>
      ${events.map(renderEvidenceRow).join("")}
    </div>` : renderEmptyState()}
  </section>`;
}

function renderConditionNotice() {
  if (state.variant !== "C") return state.filtered ? `<div class="condition-notice info"><strong>Filter active</strong><span>Showing Item Updates and Injected Updates.</span><button data-action="clear-filter">Clear Filter</button></div>` : "";
  const copy = {
    coverage: ["Coverage limited", "Capture attached after this Subscription began. Earlier Snapshot and lifecycle Evidence may be incomplete.", "Open diagnostics"],
    disconnected: ["Inspected page disconnected", "Retained Evidence remains readable. Capture cannot observe new activity until the inspected context returns.", "Reconnect"],
    storage: ["Session history using in-memory fallback", "Capture continues, but history can be lost if this DevTools panel closes.", "Open diagnostics"],
    retired: ["Historical Scope", "The selected Subscription is retained Evidence and cannot be a Local Injection Target.", "Select current Scope"],
    recovering: ["Session recovering", "The Subscription remains visible while Workbench waits for the current runtime boundary to settle.", "Open diagnostics"]
  }[state.state];
  return `<div class="condition-notice warning"><strong>! ${copy[0]}</strong><span>${copy[1]}</span><button data-action="recover">${copy[2]}</button></div>`;
}

function renderEvidenceRow(event) {
  const selected = state.selected === event.id;
  const findCurrent = state.visualSetup === "retained-find" && event.searchAnchor && event === RETAINED_FIND_EVENTS.find((candidate) => candidate.searchAnchor);
  return `<div class="evidence-row ${selected ? "selected" : ""} ${findCurrent ? "find-current" : ""}" role="row" tabindex="${selected ? "0" : "-1"}" aria-selected="${selected}" data-event="${event.id}"${event.searchAnchor ? ` data-find-anchor="${event.searchAnchor}"` : ""}>
    <span><time>${event.time}</time><small>${event.id}</small></span>
    <strong>${event.source}</strong>
    <span>${event.phase}</span>
    <b>${event.op}</b>
    <span><strong>${event.kind}</strong><small>${event.object}</small></span>
    <span>${event.change}</span>
    <span class="severity ${event.severity.toLowerCase()}">${event.severity === "—" ? "—" : `${event.severity === "Warning" ? "!" : event.severity === "Error" ? "×" : "i"} ${event.severity}`}</span>
  </div>`;
}

function renderEmptyState() {
  return `<div class="empty-state"><strong>No Evidence in the current Scope.</strong><span>Capture is running with useful Coverage.</span><div><button data-action="scope">Change Scope</button><button data-action="clear-filter">Clear Filter</button></div></div>`;
}

function renderContextPane() {
  const selected = ["retained-find", "long-identities"].includes(state.visualSetup)
    ? HIGH_VOLUME_SELECTED_EVENT
    : EVENTS.find((event) => event.id === state.selected);
  if (state.visualSetup === "more-actions") return renderSessionOperations();
  if (state.visualSetup === "selected-json") return renderEvidenceContext(JSON_STRING_EVENT);
  if (state.variant === "C") return renderRecoveryContext(selected);
  if (!selected) return renderDossier();
  return renderEvidenceContext(selected);
}

function renderDossier() {
  return `<aside class="pane context-pane" aria-label="Runtime object Context">
    <header><div><small>Runtime object</small><strong>orders.command · sub-7</strong></div><button aria-label="Close Context">×</button></header>
    <div class="context-tabs" role="tablist"><button class="active">Summary</button><button>Listeners</button><button>COMMAND State</button><button>Raw</button></div>
    <div class="context-body"><dl>
      <dt>Mode</dt><dd>COMMAND</dd><dt>Session</dt><dd>S-9 · current</dd><dt>Items</dt><dd>portfolio</dd><dt>Fields</dt><dd>11 requested</dd><dt>Snapshot</dt><dd>Complete</dd><dt>Listeners</dt><dd>2 active</dd>
    </dl><div class="context-actions"><button data-action="command">Compare COMMAND State</button><button data-action="export">Export Scope…</button><button data-action="author-draft">Author COMMAND Item Update</button></div></div>
  </aside>`;
}

function renderEvidenceContext(event) {
  if (state.visualSetup === "matching-summary") return renderMatchingSummaryContext(event);
  if (state.visualSetup === "selected-json") return renderSelectedJsonContext(event);
  return `<aside class="pane context-pane" aria-label="Selected Evidence Context">
    <header><div><small>Selected Evidence</small><strong>${event.id} · ${event.kind}</strong></div><button data-action="close-context" aria-label="Close Context">×</button></header>
    <div class="context-tabs" role="tablist"><button class="active">Summary</button><button>Fields</button><button>Deliveries</button><button>COMMAND State</button><button data-action="raw">Raw</button></div>
    <div class="context-body"><dl>
      <dt>Source</dt><dd>${titleCase(event.source)}</dd><dt>Phase</dt><dd>${titleCase(event.phase)}</dd><dt>COMMAND operation</dt><dd>${event.op}</dd><dt>Evidence identity</dt><dd>${event.id}</dd><dt>Runtime object</dt><dd>sub-7 / portfolio / ${event.object}</dd><dt>Changed</dt><dd>${event.change}</dd>
    </dl>${event.severity !== "—" ? `<section class="diagnostic warning"><strong>! Warning · Delivery interpretation</strong><span>One later listener reports an application exception. The Logical Update remains captured Server Evidence.</span><button>Reveal related deliveries</button></section>` : ""}<div class="context-actions"><button data-action="raw">Open complete raw</button><button data-action="create-draft">Create Local Injection Draft</button></div></div>
  </aside>`;
}

function renderSessionOperations() {
  return `<aside class="pane context-pane" aria-label="Session operations">
    <header><div><small>Session operations</small><strong>Session operations</strong></div><button>Back to prior investigation</button></header>
    <div class="context-body prototype-operations"><p>The current DevTools session history uses <strong>IndexedDB</strong> and is cleared when this DevTools session closes.</p><section><strong>Retained Evidence copy</strong><p>6 captured · 6 retained · 6 currently shown for the active Scope and Filter.</p><button>Copy complete scoped Evidence</button></section><section><strong>Clear retained Evidence</strong><p>Clear all retained Evidence for this DevTools session.</p><button>Clear retained Evidence…</button></section><section><strong>Scoped export</strong><p>Prepare a versioned download for the current Scope.</p><button>Export Scope…</button></section></div>
  </aside>`;
}

function renderMatchingSummaryContext(event) {
  return `<aside class="pane context-pane" aria-label="Selected Evidence Context">
    <header><div><small>Selected Evidence</small><strong>${event.id} · ${event.kind}</strong></div><button aria-label="Close Context">×</button></header>
    <div class="context-body"><dl><dt>Source</dt><dd>SERVER</dd><dt>Phase</dt><dd>LIVE</dd><dt>COMMAND operation</dt><dd>UPDATE</dd><dt>Evidence identity</dt><dd>${event.id}</dd><dt>COMMAND key</dt><dd>alpha</dd></dl><section class="prototype-projection-summary"><div><strong>Observed Server COMMAND State</strong><span>Captured Server Updates only</span></div><div><strong>Local Effective COMMAND State</strong><span>Server Updates plus successfully delivered Local Injected Updates</span></div><strong>Matching projections</strong><p>Both named projections currently contain the same state; their evidence bases remain distinct.</p><p>Neither projection is Authoritative COMMAND State.</p><button>Compare COMMAND projections</button></section><div class="context-actions"><button>Create Local Injection Draft</button><button>Open complete raw</button></div></div>
  </aside>`;
}

function renderSelectedJsonContext(event) {
  return `<aside class="pane context-pane" aria-label="Selected Evidence Context">
    <header><div><small>Selected Evidence</small><strong>${event.id} · ${event.kind}</strong></div><button aria-label="Close Context">×</button></header>
    <div class="context-body"><dl><dt>Source</dt><dd>SERVER</dd><dt>Phase</dt><dd>LIVE</dd><dt>COMMAND operation</dt><dd>ADD</dd><dt>Evidence identity</dt><dd>${event.id}</dd><dt>Runtime object</dt><dd>topology-small-item</dd><dt>COMMAND key</dt><dd>json-string-alpha</dd></dl><section class="prototype-selected-update"><strong>Selected update</strong><small>Fields</small><dl><dt>command</dt><dd><code>ADD</code></dd><dt>key</dt><dd><code>json-string-alpha</code></dd><dt>modelValues</dt><dd><span>JSON string</span><pre>{
  "passenger": {
    "selected": false,
    "priority": false,
    "itinerary": [
      { "segment": 1, "from": "AIRPORT-00", "to": "AIRPORT-01" },
      { "segment": 2, "from": "AIRPORT-01", "to": "AIRPORT-02" }
    ]
  }
}</pre></dd></dl></section></div>
  </aside>`;
}

function renderRecoveryContext(selected) {
  const detail = {
    coverage: ["Capture coverage", "LIMITED", "Earlier Snapshot phase and lifecycle Evidence cannot be established."],
    disconnected: ["Inspected context", "DISCONNECTED", "Retained Evidence remains read-only while Capture is stopped."],
    storage: ["Session history", "IN-MEMORY FALLBACK", "Closing this DevTools panel can remove current-session history."],
    retired: ["Subscription sub-7", "RETIRED", "Historical Evidence remains inspectable but cannot receive Local Injection."],
    recovering: ["Session S-9", "RECOVERING", "Capture continues; current target readiness is temporarily unavailable."]
  }[state.state];
  return `<aside class="pane context-pane" aria-label="Degraded operation Context">
    <header><div><small>Operation Context</small><strong>${detail[0]}</strong></div><button aria-label="Close Context">×</button></header>
    <div class="context-body"><section class="diagnostic ${state.state === "disconnected" ? "error" : "warning"}"><strong>${state.state === "disconnected" ? "× Error" : "! Warning"} · ${detail[1]}</strong><span>${detail[2]}</span><span>Scope: client-main / Session S-9 / orders.command</span><button data-action="recover">${state.state === "disconnected" ? "Reconnect inspected page" : "Open complete diagnostics"}</button></section>
    <dl><dt>Capture</dt><dd>${state.state === "disconnected" ? "Stopped" : "Running"}</dd><dt>Coverage</dt><dd>${state.state === "disconnected" ? "Unavailable" : "Limited"}</dd><dt>View</dt><dd>Following Live</dd><dt>Selected Evidence</dt><dd>${selected?.id ?? "None"}</dd><dt>Safe conclusion</dt><dd>${detail[2]}</dd></dl></div>
  </aside>`;
}

function renderCommandDocument() {
  if (state.visualSetup === "command-comparison") return `<section class="document-pane projection-document" aria-label="COMMAND projection comparison">
    <header><div><small>COMMAND projection comparison</small><strong>Inspected page</strong></div><button>Back to Evidence</button></header>
    <div class="projection-columns">${projectionColumn("Observed Server COMMAND State", "Captured Server Updates only", [["scenario-subscription-1 / scenario.snapshot-basic / alpha", "command=UPDATE, key=alpha, qty=15, status=live"], ["scenario-subscription-1 / scenario.snapshot-basic / ghost", "command=UPDATE, key=ghost, qty=1, status=diagnostic"]])}${projectionColumn("Local Effective COMMAND State", "Server Updates plus successfully delivered Local Injected Updates", [["scenario-subscription-1 / scenario.snapshot-basic / alpha", "command=UPDATE, key=alpha, qty=15, status=live"], ["scenario-subscription-1 / scenario.snapshot-basic / ghost", "command=UPDATE, key=ghost, qty=1, status=diagnostic"]])}</div>
    <div class="projection-explanation"><strong>Why matching?</strong><span>Both projections contain the same contributing state for the current Scope.</span></div><footer>Neither projection is Authoritative COMMAND State.</footer>
  </section>`;
  return `<section class="document-pane projection-document" aria-label="COMMAND projection comparison">
    <header><div><small>COMMAND projection comparison</small><strong>orders.command / portfolio</strong></div><button data-action="minimize">← Evidence</button></header>
    <div class="projection-limit">! Observed Server COMMAND State may be incomplete before sequence 1,838.</div>
    <div class="projection-columns">
      ${projectionColumn("Observed Server COMMAND State", "Captured Server Updates only", [["order-1042 / qty", "18"], ["order-1042 / status", "open"], ["order-1088 / price", "41.25"], ["order-0991 / lifecycle", "deleted"]])}
      ${projectionColumn("Local Effective COMMAND State", "Server Updates + delivered Local Injected Updates", [["order-1042 / qty", "42 · changed"], ["order-1042 / status", "review · changed"], ["order-1088 / price", "41.25"], ["order-0991 / lifecycle", "deleted"]])}
    </div>
    <div class="projection-explanation"><strong>Why different?</strong><span>Local Injection inj-031 delivered UPDATE order-1042. Observed Server stayed unchanged; Local Effective advanced.</span><button>Reveal Evidence</button></div>
    <footer>Neither projection is Authoritative COMMAND State.</footer>
  </section>`;
}

function projectionColumn(title, basis, rows) {
  return `<section class="projection-column"><header><strong>${title}</strong><span>${basis}</span></header><div>${rows.map(([key, value]) => `<p><span>${key}</span><code>${value}</code></p>`).join("")}</div></section>`;
}

function renderRawDocument() {
  return `<section class="document-pane raw-document" aria-label="Complete raw Evidence">
    <header><div><small>Complete raw Evidence</small><strong>evt-1842 · immutable Server Evidence</strong></div><button data-action="minimize">← Evidence</button></header>
    <div class="document-boundary"><span>Source <strong>SERVER</strong></span><span>Phase <strong>LIVE</strong></span><span>Capture path <strong>listener</strong></span><span>Mutable <strong>NO</strong></span></div>
    <pre tabindex="0">${escapeHtml(rawEvidence())}</pre>
    <footer><span>Workbench semantics remain outside syntax highlighting.</span><button>Copy complete Evidence</button></footer>
  </section>`;
}

function renderExportDocument() {
  return `<section class="document-pane export-document" aria-label="Scoped diagnostic export">
    <header><div><small>Scoped diagnostic export</small><strong>orders.command / portfolio</strong></div><button data-action="minimize">← Evidence</button></header>
    <div class="export-body"><section><strong>Export boundary</strong><dl><dt>Scope</dt><dd>client-main / S-9 / orders.command / portfolio</dd><dt>Format</dt><dd>Workbench Topology v1</dd><dt>Retained Evidence</dt><dd>12,482 events</dd><dt>Credentials</dt><dd>Always excluded</dd></dl></section><section><strong>Redaction</strong><label><input type="checkbox" checked /> Redact item and field values</label><label><input type="checkbox" checked /> Hash runtime identifiers</label><label><input type="checkbox" /> Include raw diagnostic Evidence</label></section><section class="diagnostic info"><strong>i Information · Local download only</strong><span>Workbench creates one versioned snapshot. It does not upload Capture data.</span></section></div>
    <footer><span>Review scope and redaction before download.</span><div><button>Download JSON</button><button class="primary">Download offline HTML</button></div></footer>
  </section>`;
}

function renderInjectionDocument() {
  const injection = injectionState();
  if (state.state === "review") return renderInjectionReview(injection);
  const fixture = injectionFixture();
  return `<section class="document-pane injection-document" aria-label="Local Injection Draft">
    <header><div><small>Local Injection Draft · single event</small><strong>${fixture.title}</strong></div><button data-action="minimize">Minimize Draft</button></header>
    <dl class="injection-meta"><dt>Target</dt><dd>${fixture.target} <strong>${injection.target}</strong></dd><dt>Session</dt><dd>${fixture.session}</dd><dt>Source</dt><dd>${fixture.source}</dd><dt>Draft</dt><dd>LOCAL ONLY · ${injection.changed ? "changed" : "unchanged"}</dd><dt>Validation</dt><dd class="tone-${injection.tone}">${injection.validation}</dd><dt>Outcome</dt><dd class="tone-${injection.tone}">${injection.outcome}</dd></dl>
    <section class="editor-heading"><strong>${state.state === "compare" ? "Compare Source" : "Raw JSON"}</strong><span>Tab: Move focus</span><button>Problems ${state.state === "invalid" ? "2" : "0"}</button><button data-action="compare">${state.state === "compare" ? "Close comparison" : "Compare Source"}</button></section>
    ${state.state === "compare" ? renderSourceComparison() : renderEditor()}
    ${renderInjectionCondition()}
    ${renderInjectionOutcome(injection)}
    ${renderInjectionActionBar(injection)}
  </section>`;
}

function injectionFixture() {
  if (state.visualSetup === "captured-draft") return {
    title: "Edit json-string-event · ADD / topology-small-item",
    target: "topology-small-subscription · topology-small-item · COMMAND",
    session: "Session topology-small-session · Client topology-small-client",
    source: "json-string-event · SERVER · immutable"
  };
  if (state.visualSetup === "authored-review") return {
    title: "ADD topology-small-item",
    target: "topology-small-subscription · topology-small-item · COMMAND",
    session: "Session topology-small-session · Client topology-small-client",
    source: "None · newly authored"
  };
  return {
    title: "Edit evt-1842 · UPDATE / order-1042",
    target: "sub-7 · orders.command / portfolio · Session S-9",
    session: "Session S-9 · Client client-main",
    source: "evt-1842 · SERVER · immutable"
  };
}

function renderInjectionActionBar(injection) {
  if (state.state === "delivered") return `<footer class="action-bar"><span>Delivered Draft is retained with its immutable outcome.</span><button class="primary" data-action="minimize">Reveal Evidence</button></footer>`;
  if (state.state === "failed") return `<footer class="action-bar"><span>Draft preserved · correct or retry from the review boundary.</span><button class="primary" data-action="review">Review Draft…</button></footer>`;
  return `<footer class="action-bar"><span>${injection.blocked ? "Review unavailable · correct the blocking condition" : "JSON valid · Target current · Local only"}</span><button class="primary" data-action="review" ${injection.blocked ? "disabled" : ""}>${injection.blocked ? "Resolve problems" : "Review Draft…"}</button></footer>`;
}

function injectionState() {
  if (state.state === "invalid") return { target: "ACTIVE", changed: true, validation: "BLOCKED · 2 Draft errors", outcome: "NO INJECTION ATTEMPTED", tone: "error", blocked: true };
  if (state.state === "stale") return { target: "RETIRED", changed: true, validation: "BLOCKED · target retired", outcome: "NO INJECTION ATTEMPTED", tone: "warning", blocked: true };
  if (state.state === "delivered") return { target: "ACTIVE", changed: true, validation: "READY", outcome: "DELIVERED LOCALLY · 2 of 2 listeners", tone: "success", blocked: false };
  if (state.state === "failed") return { target: "ACTIVE", changed: true, validation: "READY", outcome: "DELIVERY FAILED · listener boundary error", tone: "error", blocked: false };
  return { target: "ACTIVE", changed: true, validation: "READY", outcome: "NOT RUN", tone: "neutral", blocked: false };
}

function renderEditor() {
  return `<div class="editor"><span class="line-numbers">1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>10<br>11<br>12<br>13<br>14<br>15<br>16</span><pre tabindex="0">${escapeHtml(rawDraft(state.state === "invalid"))}</pre></div>`;
}

function renderSourceComparison() {
  return `<div class="compare-scroll" tabindex="0"><div class="compare-grid"><section><header>IMMUTABLE SOURCE · SERVER</header><pre>${escapeHtml(rawEvidence())}</pre></section><section><header>PROSPECTIVE DRAFT · LOCAL ONLY</header><pre>${escapeHtml(rawDraft(false))}</pre></section></div></div>`;
}

function renderInjectionCondition() {
  if (state.state === "invalid") return `<div class="validation error"><strong>× Error · Invalid JSON</strong><span>Unexpected token after document at line 16. No Local Injection attempted.</span></div>`;
  if (state.state === "stale") return `<div class="validation warning"><strong>! Warning · Target retired</strong><span>Subscription sub-7 is historical Evidence only. No Local Injection attempted.</span></div>`;
  return "";
}

function renderInjectionOutcome(injection) {
  if (!["delivered", "failed"].includes(state.state)) return "";
  return `<section class="outcome tone-${injection.tone}"><strong>Injection Outcome</strong><span>${injection.outcome}</span><em>${state.state === "delivered" ? "Injected Update evt-1846 created · Local Effective advanced · Observed Server unchanged" : "No successful Injected Update Evidence created · Draft preserved"}</em><button>${state.state === "delivered" ? "Reveal Evidence" : "Open failure Evidence"}</button></section>`;
}

function renderInjectionReview(injection) {
  const fixture = injectionFixture();
  return `<section class="document-pane review-document" aria-label="Review Local Injection">
    <header><div><small>Review Local Injection</small><strong>${fixture.title}</strong></div><button data-action="edit-draft">← Edit Draft</button></header>
    <div class="review-grid"><section><small>LOCAL INJECTION TARGET</small><strong>${fixture.target}</strong><span>${fixture.session} · ACTIVE</span></section><section><small>INJECTION SOURCE</small><strong>${fixture.source}</strong><span>${state.visualSetup === "authored-review" ? "No immutable Source; authored from current Scope" : "Draft has deliberate value changes"}</span></section><section><small>EXECUTION BOUNDARY</small><strong>LOCAL ONLY</strong><span>Deliver one Logical Update to the current listeners. Lightstreamer Server is not contacted.</span></section><section><small>VALIDATION</small><strong>READY</strong><span>JSON valid · target current · COMMAND identity valid</span></section></div>
    <pre>${escapeHtml(rawDraft(false))}</pre>
    <footer class="action-bar"><button data-action="edit-draft">Back to editing</button><span>Target and Draft revalidated at execution.</span><button class="primary" data-action="inject">Inject locally</button></footer>
  </section>`;
}

function renderStatusStrip() {
  const frozen = state.state === "frozen";
  const count = ["retained-find", "long-identities"].includes(state.visualSetup)
    ? "60 shown / 4,000 retained · Frozen · 30 newer"
    : state.visualSetup !== "none"
      ? `${evidenceForState().length} shown / ${evidenceForState().length} retained · Live`
      : frozen ? "48 shown / 118,420 retained · Frozen · 2,418 newer" : state.variant === "C" ? `${evidenceForState().length} shown / 12,482 retained · Evidence limit active` : "14 shown / 12,482 retained · Live";
  const operation = state.state === "disconnected" ? "Retained Evidence remains readable · Capture stopped" : "Selection and focus independent · Capture continues";
  return `<footer class="status-strip"><span>${count}</span><span>${operation}</span></footer>`;
}

function renderControls() {
  return `<section class="prototype-controls" aria-label="Prototype controls">
    <button data-action="variant-prev" aria-label="Previous journey">←</button>
    <label>Journey<select data-control="variant">${options(Object.fromEntries(Object.entries(VARIANTS).map(([key, value]) => [key, `${key} — ${value.name}`])), state.variant)}</select></label>
    <label>State<select data-control="state">${options(Object.fromEntries(VARIANTS[state.variant].states.map((key) => [key, STATE_LABELS[key]])), state.state)}</select></label>
    <label>Frame<select data-control="frame">${options(FRAMES, state.frame)}</select></label>
    <label>Theme<select data-control="theme">${options(THEMES, state.theme)}</select></label>
    <button data-action="variant-next" aria-label="Next journey">→</button>
  </section>`;
}

function renderInspector() {
  return `<aside class="prototype-inspector"><strong>PROTOTYPE — integrated validation</strong><span>${state.variant} — ${VARIANTS[state.variant].name} / ${STATE_LABELS[state.state]}</span><dl><dt>Scope</dt><dd>orders.command / portfolio</dd><dt>Selection</dt><dd>${state.selected || "None"}</dd><dt>Capture</dt><dd>${state.state === "disconnected" ? "Stopped" : "Running"}</dd><dt>View</dt><dd>${state.state === "frozen" ? "Frozen" : "Follow Live"}</dd><dt>Surface</dt><dd>${surfaceName()}</dd></dl><small>Use ←/→ outside Workbench to change journey.</small></aside>`;
}

function surfaceName() {
  if (state.variant === "B") return "Promoted Local Injection document";
  if (["command", "raw", "export"].includes(state.state)) return "Promoted document";
  return state.surface === "context" ? "Context" : state.surface === "scope" ? "Scope" : "Ordered Evidence";
}

function wireInteractions() {
  document.querySelectorAll("[data-control]").forEach((control) => control.addEventListener("change", () => {
    const key = control.dataset.control;
    if (key === "variant") return setVariant(control.value);
    const next = new URLSearchParams(location.search);
    next.set(key, control.value);
    if (key === "state") {
      next.delete("event");
      next.delete("surface");
    }
    navigate(next);
  }));

  document.querySelectorAll("[data-event]").forEach((row) => {
    row.addEventListener("click", () => selectEvent(row.dataset.event));
    row.addEventListener("keydown", handleEvidenceKey);
  });

  document.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => handleAction(button.dataset.action)));
}

function restoreEvidenceFocus() {
  if (params.get("focus") !== "event" || !state.selected) return;
  requestAnimationFrame(() => document.querySelector(`[data-event="${CSS.escape(state.selected)}"]`)?.focus());
}

function handleEvidenceKey(event) {
  const rows = [...document.querySelectorAll("[data-event]")];
  const index = rows.indexOf(event.currentTarget);
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    selectEvent(rows[nextIndex].dataset.event, true);
  }
  if (event.key === "Enter") {
    event.preventDefault();
    const next = new URLSearchParams(location.search);
    next.set("surface", "context");
    navigate(next);
  }
  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    selectEvent(rows[event.key === "Home" ? 0 : rows.length - 1].dataset.event, true);
  }
}

function selectEvent(id, focusAfter = false) {
  const next = new URLSearchParams(location.search);
  next.set("variant", "A");
  next.set("state", "selected");
  next.set("event", id);
  if (focusAfter) next.set("focus", "event");
  navigate(next);
}

function handleAction(action) {
  const next = new URLSearchParams(location.search);
  if (action === "variant-prev") return cycleVariant(-1);
  if (action === "variant-next") return cycleVariant(1);
  if (action === "scope") { next.set("surface", state.surface === "scope" ? "evidence" : "scope"); return navigate(next); }
  if (action === "close-context" || action === "minimize") { next.set("variant", "A"); next.set("state", "selected"); next.set("surface", "evidence"); return navigate(next); }
  if (action === "filter-toggle") { next.set("filter", state.filtered ? "" : "updates"); return navigate(next); }
  if (action === "clear-filter") { next.delete("filter"); return navigate(next); }
  if (action === "create-draft" || action === "author-draft") return navigateTo("B", "edit");
  if (action === "compare") return navigateTo("B", state.state === "compare" ? "edit" : "compare");
  if (action === "review") return navigateTo("B", state.state === "invalid" || state.state === "stale" ? state.state : "review");
  if (action === "edit-draft") return navigateTo("B", "edit");
  if (action === "inject") return navigateTo("B", "delivered");
  if (action === "raw") return navigateTo("A", "raw");
  if (action === "command") return navigateTo("A", "command");
  if (action === "export") return navigateTo("A", "export");
  if (action === "recover") return navigateTo("C", state.state === "disconnected" ? "recovering" : state.state);
}

function navigateTo(nextVariant, nextState) {
  const next = new URLSearchParams(location.search);
  next.set("variant", nextVariant);
  next.set("state", nextState);
  next.delete("event");
  next.delete("surface");
  navigate(next);
}

function cycleVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(state.variant);
  setVariant(keys[(index + direction + keys.length) % keys.length]);
}

function setVariant(nextVariant) {
  const next = new URLSearchParams(location.search);
  next.set("variant", nextVariant);
  next.set("state", VARIANTS[nextVariant].states[0]);
  next.delete("event");
  next.delete("surface");
  navigate(next);
}

function navigate(next) {
  [...next.entries()].forEach(([key, value]) => { if (!value) next.delete(key); });
  location.search = next.toString();
}

function options(record, selected) {
  return Object.entries(record).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function titleCase(value) {
  if (value === "—") return value;
  return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rawEvidence() {
  return `{
  "evidenceId": "evt-1842",
  "source": "server",
  "subscriptionId": "sub-7",
  "itemName": "portfolio",
  "command": "UPDATE",
  "key": "order-1042",
  "isSnapshot": false,
  "fields": {
    "command": "UPDATE",
    "key": "order-1042",
    "account_id": "ACC-319",
    "symbol": "LS-CORP",
    "side": "BUY",
    "qty": 18,
    "status": "open",
    "limit_price": 42.18,
    "risk_score": 31
  }
}`;
}

function rawDraft(invalid) {
  if (state.visualSetup === "captured-draft") return `{
  "command": "ADD",
  "key": "json-string-alpha",
  "isSnapshot": false,
  "fields": {
    "command": "ADD",
    "key": "json-string-alpha",
    "modelValues": {
      "passenger": {
        "selected": false,
        "priority": false,
        "itinerary": [
          { "segment": 1, "from": "AIRPORT-00", "to": "AIRPORT-01" },
          { "segment": 2, "from": "AIRPORT-01", "to": "AIRPORT-02" }
        ]
      }
    }
  }
}${invalid ? "\ntrailing-token" : ""}`;
  if (state.visualSetup === "authored-review") return `{
  "command": "ADD",
  "key": "visual-review",
  "isSnapshot": false,
  "fields": {
    "command": "ADD",
    "key": "visual-review",
    "value": "42"
  }
}${invalid ? "\ntrailing-token" : ""}`;
  return `{
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
}${invalid ? "\ntrailing-token" : ""}`;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.closest?.(".workbench")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); cycleVariant(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); cycleVariant(1); }
});

render();
