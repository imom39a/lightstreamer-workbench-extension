const VARIANTS = {
  A: { name: "Plain Ledger", thesis: "Words and position carry meaning; chroma stays quiet." },
  B: { name: "Signal Rail", thesis: "Fixed lanes accelerate expert semantic scanning." },
  C: { name: "Evidence Blocks", thesis: "Labelled boundaries explain related evidence sequences." }
};

const SCENARIOS = {
  mixed: "Mixed Server + Local evidence",
  degraded: "Limited Capture + diagnostics",
  frozen: "Frozen high volume",
  projections: "COMMAND projection difference",
  raw: "Immutable raw Server evidence",
  empty: "Empty current Scope",
  injection: "Local Injection · ready",
  invalid: "Local Injection · invalid draft",
  stale: "Local Injection · retired target",
  delivered: "Local Injection · delivered locally",
  failed: "Local Injection · delivery failed"
};

const FRAMES = {
  auto: "Actual viewport",
  compact: "563 × 700 compact",
  normal: "900 × 700 normal",
  shallow: "900 × 320 shallow",
  wide: "1440 × 900 wide"
};

const BASE_EVENTS = [
  { id: "evt-1838", time: "14:08:38.610", origin: "runtime", phase: "none", op: "—", lifecycle: "active", severity: "none", outcome: "none", kind: "Subscription started", identity: "orders.command / portfolio", summary: "COMMAND · 11 fields", block: "runtime" },
  { id: "evt-1839", time: "14:08:39.112", origin: "server", phase: "snapshot", op: "ADD", lifecycle: "active", severity: "none", outcome: "none", kind: "Item Update", identity: "order-1042", summary: "6 fields", block: "snapshot" },
  { id: "evt-1840", time: "14:08:39.441", origin: "server", phase: "snapshot", op: "ADD", lifecycle: "active", severity: "none", outcome: "none", kind: "Item Update", identity: "order-1088", summary: "7 fields", block: "snapshot" },
  { id: "evt-1841", time: "14:08:40.006", origin: "server", phase: "boundary", op: "—", lifecycle: "active", severity: "none", outcome: "none", kind: "End of snapshot", identity: "orders.command", summary: "2 active keys", block: "snapshot" },
  { id: "evt-1842", time: "14:08:41.238", origin: "server", phase: "live", op: "UPDATE", lifecycle: "active", severity: "warning", outcome: "none", kind: "Item Update", identity: "order-1042", summary: "qty, status", block: "server-live" },
  { id: "evt-1843", time: "14:08:41.239", origin: "server", phase: "live", op: "UPDATE", lifecycle: "active", severity: "none", outcome: "none", kind: "Update Delivery", identity: "listener-view", summary: "order-1042", block: "server-live" },
  { id: "evt-1844", time: "14:08:41.239", origin: "server", phase: "live", op: "UPDATE", lifecycle: "active", severity: "none", outcome: "none", kind: "Update Delivery", identity: "listener-metrics", summary: "order-1042", block: "server-live" },
  { id: "evt-1845", time: "14:08:52.003", origin: "local", phase: "none", op: "UPDATE", lifecycle: "active", severity: "none", outcome: "delivered", kind: "Local Injection", identity: "inj-031 → sub-7", summary: "Delivered to 2 listeners", block: "local-trace" },
  { id: "evt-1846", time: "14:08:52.004", origin: "local", phase: "live", op: "UPDATE", lifecycle: "active", severity: "none", outcome: "none", kind: "Injected Update", identity: "order-1042", summary: "qty, status", block: "local-trace" },
  { id: "evt-1847", time: "14:08:52.005", origin: "local", phase: "live", op: "UPDATE", lifecycle: "active", severity: "none", outcome: "none", kind: "Update Delivery", identity: "listener-view", summary: "order-1042", block: "local-trace" },
  { id: "evt-1848", time: "14:08:52.005", origin: "local", phase: "live", op: "UPDATE", lifecycle: "active", severity: "warning", outcome: "none", kind: "Update Delivery", identity: "listener-metrics", summary: "listener threw after delivery", block: "local-trace" },
  { id: "evt-1849", time: "14:09:06.102", origin: "server", phase: "live", op: "DELETE", lifecycle: "active", severity: "none", outcome: "none", kind: "Item Update", identity: "order-0991", summary: "key removed", block: "server-live" },
  { id: "evt-1850", time: "14:09:08.377", origin: "runtime", phase: "none", op: "—", lifecycle: "recovering", severity: "info", outcome: "none", kind: "Session status", identity: "S-9", summary: "RECOVERING", block: "runtime" },
  { id: "evt-1851", time: "14:09:09.201", origin: "workbench", phase: "unknown", op: "—", lifecycle: "unknown", severity: "error", outcome: "none", kind: "Capture diagnostic", identity: "orders.command", summary: "late attachment limits phase", block: "diagnostic" }
];

const params = new URLSearchParams(location.search);
const state = {
  variant: VARIANTS[params.get("variant")] ? params.get("variant") : "A",
  scenario: SCENARIOS[params.get("scenario")] ? params.get("scenario") : "mixed",
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "auto",
  theme: params.get("theme") === "light" ? "light" : "dark",
  presentation: params.get("presentation") === "1",
  selectedId: params.get("event") && BASE_EVENTS.some((event) => event.id === params.get("event"))
    ? params.get("event")
    : "evt-1846"
};

const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function eventsForScenario() {
  if (state.scenario === "empty") return [];
  if (state.scenario === "degraded") {
    return BASE_EVENTS.filter((event) => ["evt-1838", "evt-1842", "evt-1843", "evt-1850", "evt-1851"].includes(event.id));
  }
  if (state.scenario === "frozen") {
    return [
      ...BASE_EVENTS,
      ...Array.from({ length: 34 }, (_, index) => ({
        id: `evt-volume-${index}`,
        time: `14:10:${String(index).padStart(2, "0")}.220`,
        origin: index % 9 === 0 ? "local" : "server",
        phase: "live",
        op: index % 7 === 0 ? "DELETE" : index % 5 === 0 ? "ADD" : "UPDATE",
        lifecycle: "active",
        severity: index % 13 === 0 ? "warning" : "none",
        outcome: "none",
        kind: index % 9 === 0 ? "Injected Update" : "Item Update",
        identity: `order-${1200 + index}`,
        summary: index % 3 === 0 ? "status" : "price, qty",
        block: index % 9 === 0 ? "local-trace" : "server-live"
      }))
    ];
  }
  return BASE_EVENTS;
}

function isDocumentScenario() {
  return ["raw", "injection", "invalid", "stale", "delivered", "failed"].includes(state.scenario);
}

function writeParams() {
  const next = new URLSearchParams();
  next.set("variant", state.variant);
  if (state.scenario !== "mixed") next.set("scenario", state.scenario);
  if (state.frame !== "auto") next.set("frame", state.frame);
  if (state.theme !== "dark") next.set("theme", state.theme);
  if (state.presentation) next.set("presentation", "1");
  history.replaceState(null, "", `${location.pathname}?${next}`);
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  const model = VARIANTS[state.variant];
  app.innerHTML = `
    ${state.presentation ? "" : renderPrototypeControls()}
    <section class="prototype-stage frame-${state.frame}">
      <section class="workbench variant-${state.variant.toLowerCase()} scenario-${state.scenario}" aria-label="Lightstreamer Workbench visual semantics prototype">
        ${renderOperatingStrip()}
        ${renderScopeStrip()}
        ${isDocumentScenario() ? renderDocument() : state.scenario === "projections" ? renderProjections() : renderWorkspace()}
        ${renderStatusStrip()}
      </section>
    </section>
    ${state.presentation ? "" : renderSemanticInspector(model)}
  `;
  bindInteractions();
}

function renderPrototypeControls() {
  return `<aside class="prototype-controls" aria-label="Prototype controls">
    <button data-cycle="-1" aria-label="Previous variant">←</button>
    <label>Model <select data-control="variant">${options(VARIANTS, state.variant, (item) => item.name)}</select></label>
    <label>State <select data-control="scenario">${options(SCENARIOS, state.scenario)}</select></label>
    <label>Frame <select data-control="frame">${options(FRAMES, state.frame)}</select></label>
    <label>Theme <select data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select></label>
    <button data-cycle="1" aria-label="Next variant">→</button>
  </aside>`;
}

function options(items, selected, label = (value) => value) {
  return Object.entries(items).map(([key, value]) => `<option value="${key}" ${key === selected ? "selected" : ""}>${key} — ${escapeHtml(label(value))}</option>`).join("");
}

function renderOperatingStrip() {
  const degraded = state.scenario === "degraded";
  const frozen = state.scenario === "frozen";
  if (state.variant === "A") {
    return `<header class="operating-strip plain-operating"><strong>Capture RUNNING</strong><span>Coverage ${degraded ? "LIMITED" : "USEFUL"}</span>${degraded ? '<button class="semantic-warning">! Listener coverage incomplete</button>' : ""}<span>View ${frozen ? "FROZEN · 2,418 newer" : "FOLLOW LIVE"}</span><div class="operating-actions"><button>Find</button><button>Filter</button><button>More actions</button></div></header>`;
  }
  if (state.variant === "B") {
    return `<header class="operating-strip capture-band"><span class="capture-segment"><i class="signal-shape solid-circle"></i><strong>Capture active</strong></span><span class="capture-segment ${degraded ? "warning-segment" : ""}"><i>${degraded ? "!" : "✓"}</i>Coverage ${degraded ? "limited" : "useful"}</span><span class="capture-segment"><i>${frozen ? "❚" : "↓"}</i>View: ${frozen ? "Frozen · 2,418 newer" : "Live · Following"}</span><div class="operating-actions"><button>Find</button><button>Filter</button><button>⋮</button></div></header>`;
  }
  return `<header class="operating-strip zone-operating"><section><small>CAPTURE</small><strong>● Active</strong></section><section class="${degraded ? "zone-warning" : ""}"><small>COVERAGE</small><strong>${degraded ? "! Limited" : "✓ Useful"}</strong></section><section><small>EVIDENCE VIEW</small><strong>${frozen ? "❚ Frozen · 2,418 newer" : "↓ Live · Following"}</strong></section><div class="operating-actions"><button>Find</button><button>Filter</button><button>⋮</button></div></header>`;
}

function renderScopeStrip() {
  return `<nav class="scope-strip" aria-label="Runtime scope"><button>Scope</button><span>Page</span><b>›</b><span>client-main</span><b>›</b><span>Session S-9</span><b>›</b><strong>orders.command</strong><b>›</b><span>portfolio</span><span class="scope-state">Subscribed · Snapshot complete</span></nav>`;
}

function renderWorkspace() {
  const events = eventsForScenario();
  const selected = events.find((event) => event.id === state.selectedId) ?? events[0] ?? null;
  return `<section class="workspace">
    ${renderScopePane()}
    ${renderEvidencePane(events, selected)}
    ${renderContextPane(selected)}
  </section>`;
}

function renderScopePane() {
  const states = state.scenario === "degraded"
    ? [
        ["▾", "client-main", "RECOVERING", "recovering"],
        ["  ▾", "Session S-9", "STALLED", "warning"],
        ["    ▾", "orders.command", "SUBSCRIBED", "active"],
        ["      ", "portfolio", "PHASE UNKNOWN", "unknown"],
        ["    ", "prices.merge", "RETIRED", "retired"]
      ]
    : [
        ["▾", "client-main", "CONNECTED", "active"],
        ["  ▾", "Session S-9", "ACTIVE", "active"],
        ["    ▾", "orders.command", "SUBSCRIBED", "active"],
        ["      ", "portfolio", "LIVE", "active"],
        ["    ", "prices.merge", "RETIRED", "retired"]
      ];
  return `<aside class="scope-pane pane"><header><small>Scope</small><strong>Runtime structure</strong></header><div class="scope-tree" role="tree">${states.map(([prefix, label, status, tone], index) => `<div class="scope-node ${tone} ${index === 2 ? "committed" : ""}" role="treeitem" aria-selected="${index === 2}"><span>${prefix} ${label}</span>${state.variant === "B" ? `<i class="life-mark ${tone}"></i>` : ""}<em>${status}</em></div>`).join("")}</div></aside>`;
}

function renderEvidencePane(events, selected) {
  return `<section class="evidence-pane pane"><header class="pane-heading"><div><small>Ordered evidence</small><strong>orders.command / portfolio</strong></div><span>${state.scenario === "frozen" ? "48 shown / 118,420" : `${events.length} shown / 12,482`}</span></header>${state.scenario === "degraded" ? renderCoverageNotice() : ""}${state.variant === "A" ? renderPlainLedger(events, selected) : state.variant === "B" ? renderSignalLedger(events, selected) : renderEvidenceBlocks(events, selected)}${events.length === 0 ? renderEmptyState() : ""}</section>`;
}

function renderCoverageNotice() {
  return `<div class="coverage-notice"><strong>! Coverage limited</strong><span>Capture attached after this Subscription began. Snapshot phase and earlier lifecycle evidence may be incomplete.</span><button>Open diagnostics</button></div>`;
}

function renderPlainLedger(events, selected) {
  return `<div class="plain-ledger evidence-grid" role="grid" tabindex="0" aria-label="Ordered Lightstreamer evidence"><div class="ledger-header" role="row"><span>Time / #</span><span>Source</span><span>Phase</span><span>Op</span><span>Evidence / object</span><span>Change</span><span>Severity</span></div>${events.map((event) => `<div class="evidence-row ${selected?.id === event.id ? "selected" : ""}" role="row" aria-selected="${selected?.id === event.id}" data-event="${event.id}"><span><time>${event.time}</time><small>${event.id}</small></span><strong>${originLabel(event.origin).toUpperCase()}</strong><span>${phaseLabel(event.phase).toUpperCase()}</span><b>${event.op}</b><span><strong>${event.kind}</strong><small>${event.identity}</small></span><span>${event.summary}</span><span class="severity ${event.severity}">${severityLabel(event.severity, true)}</span></div>`).join("")}</div>`;
}

function renderSignalLedger(events, selected) {
  return `<div class="signal-ledger evidence-grid" role="grid" tabindex="0" aria-label="Ordered Lightstreamer evidence"><div class="signal-header" role="row"><span class="cursor-cell">Sel</span><span class="signals-title">P Φ C L D O</span><span>Time / evidence</span><span>Object / change</span></div>${events.map((event) => `<div class="signal-row evidence-row ${selected?.id === event.id ? "selected" : ""}" role="row" aria-selected="${selected?.id === event.id}" data-event="${event.id}"><span class="cursor-cell">${selected?.id === event.id ? "▸" : ""}</span>${renderSignalRail(event)}<span><time>${event.time}</time><strong>${event.kind}</strong><small>${event.id}</small></span><span><strong>${event.identity}</strong><small>${event.summary}</small></span></div>`).join("")}</div>`;
}

function renderSignalRail(event) {
  const origin = { server: "SVR", local: "LOC", runtime: "RUN", workbench: "WB" }[event.origin] ?? "?";
  const phase = { snapshot: "▣", live: "›", boundary: "│", unknown: "?", none: "" }[event.phase];
  const op = { ADD: "A", UPDATE: "U", DELETE: "D", "—": "" }[event.op];
  const life = { active: "●", recovering: "◌", retired: "○", unknown: "?" }[event.lifecycle] ?? "";
  const severity = { info: "i", warning: "!", error: "×", none: "" }[event.severity];
  const outcome = { delivered: "✓", failed: "×", none: "" }[event.outcome];
  return `<span class="signal-rail origin-${event.origin} severity-${event.severity}" aria-label="${originLabel(event.origin)}, ${phaseLabel(event.phase)}, ${event.op}, ${event.lifecycle}, ${severityLabel(event.severity)}"><i>${origin}</i><i>${phase}</i><i>${op}</i><i>${life}</i><i>${severity}</i><i>${outcome}</i></span>`;
}

function renderEvidenceBlocks(events, selected) {
  const groups = [];
  for (const event of events) {
    const previous = groups.at(-1);
    if (previous?.key === event.block) previous.events.push(event);
    else groups.push({ key: event.block, events: [event] });
  }
  return `<div class="block-ledger evidence-grid" role="grid" tabindex="0" aria-label="Ordered Lightstreamer evidence">${groups.map((group) => `<section class="evidence-block block-${group.key}"><header>${blockLabel(group.key)}<span>${blockDescription(group.key)}</span></header>${group.events.map((event) => `<div class="block-row evidence-row ${selected?.id === event.id ? "selected" : ""}" role="row" aria-selected="${selected?.id === event.id}" data-event="${event.id}"><time>${event.time}</time><span><strong>${event.kind}</strong><small>${originLabel(event.origin)} · ${phaseLabel(event.phase)} · ${event.op}</small></span><span><strong>${event.identity}</strong><small>${event.summary}</small></span><span class="severity ${event.severity}">${severityLabel(event.severity, true)}</span></div>`).join("")}</section>`).join("")}</div>`;
}

function blockLabel(block) {
  return {
    runtime: "RUNTIME LIFECYCLE",
    snapshot: "SERVER SNAPSHOT · epoch 12",
    "server-live": "SERVER LIVE EVIDENCE",
    "local-trace": "LOCAL INJECTION TRACE · inj-031",
    diagnostic: "WORKBENCH DIAGNOSTIC"
  }[block] ?? "EVIDENCE";
}

function blockDescription(block) {
  return {
    runtime: "Observed client/runtime transitions",
    snapshot: "Server evidence · boundary retained",
    "server-live": "Server evidence · chronological",
    "local-trace": "Local only · source evt-1842 → 2 deliveries",
    diagnostic: "Interpretation limit · not application evidence"
  }[block] ?? "";
}

function renderEmptyState() {
  return `<div class="empty-state"><strong>No evidence in the current Scope.</strong><span>Capture is running with useful coverage.</span><div><button>Change Scope</button><button>Clear Filter</button></div></div>`;
}

function renderContextPane(selected) {
  if (!selected) return `<aside class="context-pane pane"><header><small>Context</small><strong>No selected evidence</strong></header><div class="empty-context">Select Evidence to inspect provenance, lifecycle, values, and diagnostics.</div></aside>`;
  return `<aside class="context-pane pane"><header><small>Selected evidence</small><strong>${selected.id} · ${selected.kind}</strong><button>×</button></header><div class="context-tabs"><button class="active">Summary</button><button>Fields</button><button>Deliveries</button><button>State</button><button>Raw</button></div>${state.variant === "A" ? renderPlainContext(selected) : state.variant === "B" ? renderSignalContext(selected) : renderBlockContext(selected)}</aside>`;
}

function renderPlainContext(event) {
  return `<div class="context-body plain-context"><dl><dt>Source</dt><dd>${originLabel(event.origin)}</dd><dt>Phase</dt><dd>${phaseLabel(event.phase)}</dd><dt>COMMAND operation</dt><dd>${event.op}</dd><dt>Runtime lifecycle</dt><dd>${event.lifecycle}</dd><dt>Subscription</dt><dd>orders.command · sub-7</dd><dt>Item / key</dt><dd>portfolio / ${event.identity}</dd><dt>Changed</dt><dd>${event.summary}</dd></dl>${renderDiagnostic(event)}<div class="context-actions"><button>Open complete raw</button><button>Create Local Injection Draft</button></div></div>`;
}

function renderSignalContext(event) {
  return `<div class="context-body signal-context"><div class="signal-decode">${renderSignalRail(event)}<strong>${originLabel(event.origin)} · ${phaseLabel(event.phase)} · COMMAND ${event.op}</strong></div><dl><dt>Evidence identity</dt><dd>${event.id}</dd><dt>Runtime object</dt><dd>sub-7 / portfolio / ${event.identity}</dd><dt>Lifecycle</dt><dd>${event.lifecycle}</dd><dt>Changed</dt><dd>${event.summary}</dd></dl>${renderDiagnostic(event)}<div class="context-actions"><button>Open complete raw</button><button>Create Local Injection Draft</button></div></div>`;
}

function renderBlockContext(event) {
  return `<div class="context-body block-context"><section class="context-zone origin-${event.origin}"><small>PROVENANCE</small><strong>${originLabel(event.origin)}</strong><span>${event.origin === "local" ? "Known Local Injection evidence · never Server" : "Observed through the application’s ordinary path"}</span></section><section class="context-zone"><small>OPERATION</small><strong>${phaseLabel(event.phase)} · ${event.op}</strong><span>${event.kind} · ${event.identity}</span></section>${renderDiagnostic(event)}<div class="context-actions"><button>Open complete raw</button><button>Create Local Injection Draft</button></div></div>`;
}

function renderDiagnostic(event) {
  if (event.severity === "none") return "";
  const message = event.severity === "error" ? "Capture attached late; phase cannot be established." : event.severity === "warning" ? "This evidence may be incomplete before sequence 1,838." : "Session recovery is ordinary runtime evidence.";
  return `<section class="diagnostic ${event.severity}"><strong>${severityLabel(event.severity, true)}</strong><span>${message}</span><button>Reveal related evidence</button></section>`;
}

function renderProjections() {
  if (state.variant === "A") {
    return `<section class="projection-document"><header><small>COMMAND projection comparison</small><strong>orders.command / portfolio</strong></header><div class="projection-limit">! Observed Server projection may be incomplete before sequence 1,838.</div><div class="projection-table"><div class="projection-head"><span>Key / field</span><strong>OBSERVED SERVER</strong><strong>LOCAL EFFECTIVE</strong><span>Difference</span></div>${projectionRows().map((row) => `<div><span>${row[0]}</span><code>${row[1]}</code><code>${row[2]}</code><strong>${row[3]}</strong></div>`).join("")}</div><footer>Observed Server: Server Updates only · Local Effective: Server Updates + successfully delivered Local Injected Updates · Authoritative COMMAND State is not visible.</footer></section>`;
  }
  if (state.variant === "B") {
    return `<section class="projection-document signal-projections"><header><small>COMMAND projection comparison</small><strong>orders.command / portfolio</strong></header><div class="projection-bays"><section class="projection-bay observed"><header><b>OBS</b><div><strong>Observed Server COMMAND State</strong><span>Server Updates only</span></div><em>! Limited before seq 1,838</em></header>${projectionColumn(1)}</section><section class="projection-bay effective"><header><b>EFF</b><div><strong>Local Effective COMMAND State</strong><span>Server + delivered Local Injected Updates</span></div><em>S + L</em></header>${projectionColumn(2)}</section></div><footer>CHG and NEW are projection differences, not COMMAND operations. Authoritative COMMAND State is not visible.</footer></section>`;
  }
  return `<section class="projection-document block-projections"><header><small>COMMAND projection evidence zones</small><strong>orders.command / portfolio</strong></header><div class="projection-bays"><section class="projection-bay observed"><header><small>PROOF BASIS · SERVER ONLY</small><strong>Observed Server COMMAND State</strong><span>Limited before sequence 1,838</span></header>${projectionColumn(1)}</section><section class="projection-bay effective"><header><small>PROOF BASIS · SERVER + LOCAL</small><strong>Local Effective COMMAND State</strong><span>Includes Local Injection inj-031</span></header>${projectionColumn(2)}</section></div><div class="projection-trace"><strong>Why different?</strong><span>inj-031 delivered a Local UPDATE for order-1042. Observed Server stayed unchanged; Local Effective advanced.</span><button>Reveal trace</button></div><footer>Neither projection is Authoritative COMMAND State.</footer></section>`;
}

function projectionRows() {
  return [
    ["order-1042 / qty", "18", "42", "CHANGED LOCALLY"],
    ["order-1042 / status", "open", "review", "CHANGED LOCALLY"],
    ["order-1088 / price", "41.25", "41.25", "SAME"],
    ["order-0991 / lifecycle", "deleted", "deleted", "SAME"]
  ];
}

function projectionColumn(index) {
  return `<div class="projection-rows">${projectionRows().map((row) => `<div><span>${row[0]}</span><code>${row[index]}</code><em>${row[3] === "SAME" ? "" : index === 2 ? "CHG" : "BASE"}</em></div>`).join("")}</div>`;
}

function renderDocument() {
  if (state.scenario === "raw") return renderRawDocument();
  return renderInjectionDocument();
}

function renderRawDocument() {
  return `<section class="document-pane raw-pane"><header><div><small>Complete raw evidence</small><strong>evt-1842 · immutable Server evidence</strong></div><button>← Evidence</button></header><div class="document-boundary"><span>Source <strong>SERVER</strong></span><span>Phase <strong>LIVE</strong></span><span>Capture path <strong>listener</strong></span><span>Mutable <strong>NO</strong></span></div><pre tabindex="0">${escapeHtml(rawJson(false))}</pre><footer><span>Workbench semantics remain outside syntax highlighting.</span><button>Copy complete evidence</button></footer></section>`;
}

function renderInjectionDocument() {
  const status = injectionStatus();
  const invalid = state.scenario === "invalid";
  const stale = state.scenario === "stale";
  const blocked = invalid || stale;
  return `<section class="document-pane injection-pane"><header><div><small>Local Injection Draft · single event</small><strong>Edit evt-1842 · UPDATE / order-1042</strong></div><button>Minimize draft</button></header>${state.variant === "A" ? renderPlainInjectionMeta(status) : state.variant === "B" ? renderSignalInjectionMeta(status) : renderBlockInjectionMeta(status)}<section class="editor-heading"><strong>Raw JSON</strong><span>Tab: Move focus</span><button>Problems ${invalid ? "2" : "0"}</button><button>Compare source</button></section><div class="editor"><span class="line-numbers">1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>10<br>11<br>12<br>13<br>14<br>15<br>16</span><pre tabindex="0">${escapeHtml(rawJson(invalid))}</pre></div>${invalid ? '<div class="validation error"><strong>× ERROR · Invalid JSON</strong><span>Unexpected token after document at line 16. No Local Injection attempted.</span></div>' : ""}${stale ? '<div class="validation warning"><strong>! TARGET RETIRED</strong><span>Subscription sub-7 is historical evidence only. No Local Injection attempted.</span></div>' : ""}${renderInjectionOutcome(status)}<footer class="action-bar"><span>${blocked ? "Review unavailable · correct the blocking condition" : "JSON valid · Target current · Local only"}</span><button class="primary" ${blocked ? "disabled" : ""}>${blocked ? "Resolve problems" : "Review draft…"}</button></footer></section>`;
}

function injectionStatus() {
  if (state.scenario === "invalid") return { validation: "BLOCKED · 2 draft errors", target: "ACTIVE", outcome: "NO INJECTION ATTEMPTED", tone: "error" };
  if (state.scenario === "stale") return { validation: "BLOCKED · target retired", target: "RETIRED", outcome: "NO INJECTION ATTEMPTED", tone: "warning" };
  if (state.scenario === "delivered") return { validation: "READY", target: "ACTIVE", outcome: "DELIVERED LOCALLY · 2 of 2 listeners", tone: "success" };
  if (state.scenario === "failed") return { validation: "READY", target: "ACTIVE", outcome: "DELIVERY FAILED · listener boundary error", tone: "error" };
  return { validation: "READY", target: "ACTIVE", outcome: "NOT RUN", tone: "neutral" };
}

function renderPlainInjectionMeta(status) {
  return `<dl class="injection-meta plain-meta"><dt>Target</dt><dd>sub-7 · orders.command / portfolio · Session S-9 <strong>${status.target}</strong></dd><dt>Source</dt><dd>evt-1842 · SERVER · immutable</dd><dt>Draft</dt><dd>LOCAL ONLY</dd><dt>Validation</dt><dd>${status.validation}</dd><dt>Outcome</dt><dd class="tone-${status.tone}">${status.outcome}</dd></dl>`;
}

function renderSignalInjectionMeta(status) {
  return `<section class="injection-bands"><div><span class="signal-mini origin-server">SVR</span><small>Source</small><strong>evt-1842 · immutable</strong></div><div><span class="signal-mini origin-local">LOC</span><small>Draft</small><strong>Local only</strong></div><div><span class="life-mark ${status.target.toLowerCase()}"></span><small>Target</small><strong>sub-7 · ${status.target}</strong></div><div class="tone-${status.tone}"><span>${status.tone === "error" ? "×" : status.tone === "warning" ? "!" : status.tone === "success" ? "✓" : "·"}</span><small>Validation</small><strong>${status.validation}</strong><em>Outcome · ${status.outcome}</em></div></section>`;
}

function renderBlockInjectionMeta(status) {
  return `<section class="injection-zones"><div class="source-zone"><small>IMMUTABLE SOURCE · SERVER</small><strong>evt-1842</strong><span>Ordinary captured evidence</span></div><div class="transition-arrow">→</div><div class="draft-zone"><small>PROSPECTIVE DRAFT · LOCAL ONLY</small><strong>UPDATE order-1042</strong><span>Target sub-7 · ${status.target}</span><em>Outcome · ${status.outcome}</em></div></section>`;
}

function renderInjectionOutcome(status) {
  if (status.outcome === "NOT RUN" || status.outcome === "NO INJECTION ATTEMPTED") return "";
  if (state.variant === "A") return `<section class="outcome-row tone-${status.tone}"><strong>Outcome</strong><span>${status.outcome}</span><em>Injection inj-031 · 14:08:52.003</em></section>`;
  if (state.variant === "B") return `<section class="outcome-dock tone-${status.tone}"><b>${status.tone === "success" ? "✓" : "×"}</b><div><small>LOCAL INJECTION OUTCOME</small><strong>${status.outcome}</strong><span>inj-031 · sub-7 · 14:08:52.003</span></div></section>`;
  return `<section class="trace-outcome tone-${status.tone}"><small>TRACE OUTCOME · inj-031</small><strong>${status.outcome}</strong><span>${status.tone === "success" ? "Injected Update evt-1846 created · Local Effective advanced · Observed Server unchanged" : "No successful Injected Update evidence created · Draft preserved"}</span><button>${status.tone === "success" ? "Reveal trace" : "Open failure evidence"}</button></section>`;
}

function rawJson(invalid) {
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
}${invalid ? " trailing" : ""}`;
}

function renderStatusStrip() {
  const frozen = state.scenario === "frozen";
  return `<footer class="status-strip"><span>${frozen ? "48 shown / 118,420 retained · Frozen · 2,418 newer" : "14 shown / 12,482 retained · Live"}</span><span>Selection and focus independent · Capture continues</span></footer>`;
}

function renderSemanticInspector(model) {
  const selected = BASE_EVENTS.find((event) => event.id === state.selectedId) ?? BASE_EVENTS[8];
  return `<aside class="semantic-inspector"><strong>${state.variant} — ${model.name}</strong><span>${model.thesis}</span><dl><dt>Selected</dt><dd>${selected.id}</dd><dt>Provenance</dt><dd>${originLabel(selected.origin)}</dd><dt>Phase</dt><dd>${phaseLabel(selected.phase)}</dd><dt>COMMAND</dt><dd>${selected.op}</dd><dt>Lifecycle</dt><dd>${selected.lifecycle}</dd><dt>Severity</dt><dd>${severityLabel(selected.severity)}</dd><dt>Outcome</dt><dd>${selected.outcome}</dd></dl><small>These axes remain independent in every model.</small></aside>`;
}

function originLabel(origin) {
  return { server: "Server", local: "Local", runtime: "Runtime observation", workbench: "Workbench" }[origin] ?? "Unknown provenance";
}

function phaseLabel(phase) {
  return { snapshot: "Snapshot", live: "Live update", boundary: "End of snapshot", unknown: "Phase unknown", none: "—" }[phase] ?? "—";
}

function severityLabel(severity, includeGlyph = false) {
  const labels = { info: "Information", warning: "Warning", error: "Error", none: "—" };
  const glyphs = { info: "i ", warning: "! ", error: "× ", none: "" };
  return `${includeGlyph ? glyphs[severity] : ""}${labels[severity]}`;
}

function blockDescriptionForEvent(event) {
  return `${originLabel(event.origin)}, ${phaseLabel(event.phase)}, COMMAND ${event.op}, ${event.lifecycle}, ${severityLabel(event.severity)}`;
}

function bindInteractions() {
  document.querySelectorAll("[data-control]").forEach((control) => control.addEventListener("change", (event) => {
    state[event.currentTarget.dataset.control] = event.currentTarget.value;
    writeParams();
    render();
  }));
  document.querySelectorAll("[data-cycle]").forEach((button) => button.addEventListener("click", () => cycleVariant(Number(button.dataset.cycle))));
  document.querySelectorAll("[data-event]").forEach((row) => {
    row.setAttribute("aria-label", blockDescriptionForEvent(BASE_EVENTS.find((event) => event.id === row.dataset.event) ?? { origin: "server", phase: "live", op: "UPDATE", lifecycle: "active", severity: "none" }));
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.event;
      render();
    });
  });
  document.querySelectorAll(".evidence-grid").forEach((grid) => grid.addEventListener("keydown", (event) => {
    if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const events = eventsForScenario();
    if (!events.length) return;
    const current = Math.max(0, events.findIndex((item) => item.id === state.selectedId));
    const next = event.key === "ArrowDown" ? Math.min(events.length - 1, current + 1) : Math.max(0, current - 1);
    state.selectedId = events[next].id;
    event.preventDefault();
    render();
    document.querySelector(".evidence-grid")?.focus();
  }));
}

function cycleVariant(direction) {
  const variants = Object.keys(VARIANTS);
  const index = variants.indexOf(state.variant);
  state.variant = variants[(index + direction + variants.length) % variants.length];
  writeParams();
  render();
}

document.addEventListener("keydown", (event) => {
  const target = event.target;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
  if (target.closest?.(".workbench")) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    cycleVariant(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    cycleVariant(1);
  }
});

render();
