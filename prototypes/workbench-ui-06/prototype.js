const VARIANTS = {
  A: {
    name: "Elastic Triad",
    short: "Move and park stable panes as geometry changes."
  },
  B: {
    name: "Anchored Context Deck",
    short: "Keep evidence visible behind a resizable task deck."
  },
  C: {
    name: "Viewport Lease",
    short: "Give exactly one working surface the available canvas."
  }
};

const FRAMES = {
  auto: { label: "Actual browser", width: null, height: null },
  compact: { label: "Compact · 563×700", width: 563, height: 700 },
  normal: { label: "Normal · 900×700", width: 900, height: 700 },
  shallow: { label: "Shallow · 900×320", width: 900, height: 320 },
  wide: { label: "Wide · 1440×900", width: 1440, height: 900 }
};

const SCENARIOS = {
  evidence: "Live evidence",
  detail: "Selected detail",
  injection: "Local Injection draft",
  diagnostics: "Capture diagnostics",
  export: "Export review",
  volume: "High-volume evidence"
};

const params = new URLSearchParams(location.search);
const state = {
  variant: VARIANTS[params.get("variant")] ? params.get("variant") : "A",
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "auto",
  scenario: SCENARIOS[params.get("scenario")] ? params.get("scenario") : "detail",
  theme: params.get("theme") === "light" ? "light" : "dark",
  presentation: params.get("presentation") === "1",
  deckMaximized: params.get("max") === "1",
  scopePinned: params.get("scope") !== "0",
  filterOpen: params.get("filter") === "1"
};

const app = document.querySelector("#prototype");

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

const injectionJson = `{
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
    "average_price": 41.88,
    "route": "SMART",
    "risk_score": 84,
    "audit_note": "workbench-local / attempt-4"
  }
}`;

function updateUrl() {
  const next = new URLSearchParams();
  next.set("variant", state.variant);
  if (state.frame !== "auto") next.set("frame", state.frame);
  if (state.scenario !== "detail") next.set("scenario", state.scenario);
  if (state.theme !== "dark") next.set("theme", state.theme);
  if (state.presentation) next.set("presentation", "1");
  if (state.deckMaximized) next.set("max", "1");
  if (!state.scopePinned) next.set("scope", "0");
  if (state.filterOpen) next.set("filter", "1");
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

function render() {
  updateUrl();
  const frame = FRAMES[state.frame];
  const style = frame.width
    ? `--preview-width:${frame.width}px;--preview-height:${frame.height}px`
    : "";

  app.innerHTML = `
    <section class="prototype-stage" data-theme="${state.theme}" data-frame="${state.frame}">
      <div class="app-frame" style="${style}">
        ${renderWorkbench()}
      </div>
    </section>
    ${state.presentation ? "" : renderLab()}
    ${state.presentation ? "" : renderSwitcher()}
  `;
}

function renderWorkbench() {
  const documentScenario = ["injection", "diagnostics", "export"].includes(state.scenario);
  return `
    <section class="workbench model-${state.variant.toLowerCase()} ${documentScenario ? "document-scenario" : ""} ${state.deckMaximized ? "deck-maximized" : ""} ${state.scopePinned ? "" : "scope-unpinned"}" data-variant="${state.variant}" data-scenario="${state.scenario}">
      ${renderOperatingStrip()}
      ${renderScopeStrip()}
      <div class="workspace-shell">
        ${renderVariantWorkspace()}
      </div>
      ${renderStatusStrip()}
    </section>
  `;
}

function renderOperatingStrip() {
  return `
    <header class="operating-strip">
      <div class="operating-state"><span class="status-dot"></span><strong>Capture active</strong><span class="coverage">Complete coverage</span><span class="session">Session S-9</span></div>
      <div class="operating-actions">
        <button data-scenario="evidence">Frozen · 37 newer</button>
        <button>Find</button>
        <button data-action="filter">Filter${state.filterOpen ? " · 2" : ""}</button>
        <button aria-label="More actions">⋮</button>
      </div>
    </header>
  `;
}

function renderScopeStrip() {
  const back = state.variant === "C" && state.scenario !== "evidence";
  return `
    <nav class="scope-strip" aria-label="Runtime scope">
      ${back ? `<button data-scenario="evidence">← Evidence</button><strong>${SCENARIOS[state.scenario]}</strong>` : `<button data-action="scope">Scope</button><span>Page</span><i>›</i><span>client-main</span><i>›</i><span>S-9</span><i>›</i><strong>orders.command</strong><i>›</i><span>portfolio</span><i>›</i><span>order-1042</span>`}
      <span class="scope-live">live</span>
    </nav>
  `;
}

function renderVariantWorkspace() {
  if (state.variant === "A") return renderElasticTriad();
  if (state.variant === "B") return renderContextDeck();
  return renderViewportLease();
}

function renderElasticTriad() {
  const documentScenario = ["injection", "diagnostics", "export"].includes(state.scenario);
  if (documentScenario) {
    return `<div class="origin-strip"><button data-scenario="evidence">← Evidence</button><span>evt-1842 · UPDATE / order-1042</span><button>Peek evidence</button></div>${renderContext(state.scenario, true)}`;
  }
  return `
    ${renderScopePane()}
    ${renderEvidencePane()}
    ${renderContext(state.scenario)}
  `;
}

function renderContextDeck() {
  return `
    <div class="deck-canvas">
      ${renderEvidencePane()}
      <section class="context-deck">
        <header class="deck-handle">
          <div><span class="handle-mark">═</span><strong>${SCENARIOS[state.scenario]}</strong><small> anchored to evt-1842</small></div>
          <div><button data-action="deck-max">${state.deckMaximized ? "Restore evidence" : "Maximize"}</button><button data-scenario="evidence">Close</button></div>
        </header>
        ${renderContext(state.scenario, true)}
      </section>
    </div>
  `;
}

function renderViewportLease() {
  if (state.scenario === "evidence" || state.scenario === "volume") {
    return `<div class="lease-surface">${renderEvidencePane()}</div>`;
  }
  return `<div class="lease-surface">${renderContext(state.scenario, true)}</div>`;
}

function renderScopePane() {
  return `
    <aside class="pane scope-pane">
      <header class="pane-heading"><div><small>Runtime scope</small><strong>Inspected page</strong></div><button data-action="scope-pin">${state.scopePinned ? "«" : "»"}</button></header>
      <div class="scope-tree">
        <div><b>▾</b><strong>Page</strong><span>active</span></div>
        <div class="depth-1"><b>▾</b><strong>client-main</strong><span>active</span></div>
        <div class="depth-2"><b>▾</b><strong>Session S-9</strong><span>active</span></div>
        <div class="depth-3 selected"><b>▾</b><strong>orders.command</strong><span>COMMAND</span></div>
        <div class="depth-4 current"><b>•</b><strong>portfolio</strong><span>1 item</span></div>
        <div class="depth-4"><b>•</b><strong>listener-view</strong><span>5 deliveries</span></div>
        <div class="depth-4"><b>•</b><strong>listener-metrics</strong><span>5 deliveries</span></div>
        <div class="depth-3"><b>›</b><strong>prices.merge</strong><span>MERGE</span></div>
        <div class="depth-2 retired"><b>›</b><strong>Session S-8</strong><span>retired</span></div>
      </div>
      <button class="diagnostic-compact" data-scenario="diagnostics"><span>!</span><strong>1 lifecycle warning</strong><small>orders.command began before Capture</small></button>
    </aside>
  `;
}

function renderEvidencePane() {
  const visible = state.scenario === "volume" ? 12482 : 186;
  return `
    <section class="pane evidence-pane">
      <header class="pane-heading evidence-heading"><div><small>Ordered evidence</small><strong>orders.command / portfolio</strong></div><span>${visible.toLocaleString()} shown</span></header>
      <div class="filter-row"><span>⌕</span><span>key:order-1042</span><button>source:any ×</button>${state.filterOpen ? `<button>command:UPDATE ×</button>` : ""}</div>
      <div class="evidence-table" role="table" aria-label="Ordered evidence">
        <div class="evidence-columns" role="row"><span>Time</span><span>Evidence</span><span>Command / key</span><span>Change</span><span>Provenance</span></div>
        <div class="evidence-scroll">
          ${rows.map((row, index) => renderEvidenceRow(row, index)).join("")}
          ${state.scenario === "volume" ? rows.concat(rows, rows).map((row, index) => renderEvidenceRow([`${15 + index}:12:33.120`, ...row.slice(1)], index + 20)).join("") : ""}
        </div>
      </div>
      <footer class="selection-strip"><span>Selected <strong>UPDATE · order-1042</strong></span><button data-scenario="detail">Open details</button></footer>
    </section>
  `;
}

function renderEvidenceRow(row, index) {
  const selected = index === 2;
  const [time, kind, command, key, change, provenance] = row;
  return `
    <button class="evidence-row ${selected ? "selected" : ""}" role="row" data-scenario="detail">
      <time>${time}</time>
      <span class="row-kind">${kind}</span>
      <span class="row-command"><b data-command="${command}">${command}</b><span>${key}</span></span>
      <span class="row-change">${change}</span>
      <strong class="provenance ${provenance.toLowerCase()}">${provenance}</strong>
    </button>
  `;
}

function renderContext(scenario, document = false) {
  if (scenario === "injection") return renderInjection(document);
  if (scenario === "diagnostics") return renderDiagnostics(document);
  if (scenario === "export") return renderExport(document);
  return renderDetail();
}

function renderDetail() {
  return `
    <aside class="pane context-pane detail-context">
      <header class="pane-heading"><div><small>Selected evidence</small><strong>evt-1842 · Item Update</strong></div><button data-scenario="evidence">×</button></header>
      <div class="detail-tabs"><button class="active">Summary</button><button>Fields</button><button>Deliveries</button><button>State</button><button>Raw</button></div>
      <div class="context-scroll">
        <div class="context-title"><strong>Server Update</strong><time>14:08:41.238</time></div>
        <dl><dt>Subscription</dt><dd>orders.command</dd><dt>Item / key</dt><dd>portfolio / order-1042</dd><dt>Command</dt><dd>UPDATE</dd><dt>Changed</dt><dd>qty, status</dd><dt>Deliveries</dt><dd>2 of 2 listeners</dd></dl>
        <div class="projection-grid">
          <article><small>Observed Server</small><strong>qty 18</strong><strong>status open</strong><span>evt-1842 · Server</span></article>
          <article><small>Local Effective</small><strong>qty 42</strong><strong>status review</strong><span>inj-17 · Local</span></article>
        </div>
        <div class="context-actions"><button>Scope to this evidence</button><button class="primary" data-scenario="injection">Create Local Injection Draft</button></div>
      </div>
    </aside>
  `;
}

function renderInjection(document) {
  return `
    <section class="pane context-pane document-pane injection-pane ${document ? "promoted" : ""}">
      <header class="document-heading"><div><small>Local Injection Draft · single event</small><strong>Edit evt-1842 · UPDATE / order-1042</strong></div><div><span class="ready">● Ready</span><button data-scenario="evidence">Minimize draft</button></div></header>
      <div class="target-rail"><strong>LOCAL ONLY</strong><span>Target sub-7 · orders.command / portfolio · Session S-9</span><span>Source evt-1842 · immutable</span></div>
      <div class="editor-toolbar"><span>Raw JSON</span><div><button>Problems 0</button><button>Compare source</button></div></div>
      <div class="editor-shell"><pre class="line-numbers">${Array.from({length: 20}, (_, index) => index + 1).join("\n")}</pre><textarea spellcheck="false" aria-label="Injection Draft raw JSON">${injectionJson}</textarea></div>
      <footer class="document-footer"><span>JSON valid · 7 differences · Capture continues</span><button class="primary">Review draft…</button></footer>
    </section>
  `;
}

function renderDiagnostics(document) {
  return `
    <section class="pane context-pane document-pane diagnostics-pane ${document ? "promoted" : ""}">
      <header class="document-heading"><div><small>Capture diagnostics</small><strong>Coverage and runtime lifecycle</strong></div><button data-scenario="evidence">Close</button></header>
      <div class="diagnostic-summary"><strong>Capture useful with one known boundary</strong><span>Server and Local evidence remain distinguishable.</span></div>
      <div class="diagnostic-layout">
        <div class="diagnostic-list">
          <button class="selected"><span>!</span><strong>Subscription began before Capture</strong><small>orders.command · lifecycle incomplete</small></button>
          <button><span>i</span><strong>IndexedDB history active</strong><small>12,482 retained events</small></button>
          <button><span>✓</span><strong>Listener coverage current</strong><small>2 listeners observed</small></button>
          <button><span>i</span><strong>Frozen evidence window</strong><small>37 newer matching events</small></button>
        </div>
        <article class="diagnostic-detail"><h3>Subscription began before Capture</h3><p>The initial subscribe and snapshot boundary were not observed. Current Item Updates and deliveries remain usable, but Workbench cannot prove the complete lifecycle.</p><dl><dt>Affected</dt><dd>orders.command / portfolio</dd><dt>Trust</dt><dd>Evidence after 14:08:39.902</dd><dt>Next action</dt><dd>Reload the inspected page with DevTools open when complete lifecycle evidence is required.</dd></dl><button>Reveal related evidence</button></article>
      </div>
      <footer class="document-footer"><span>1 warning · 3 informational states</span><button>Copy diagnostic summary</button></footer>
    </section>
  `;
}

function renderExport(document) {
  return `
    <section class="pane context-pane document-pane export-pane ${document ? "promoted" : ""}">
      <header class="document-heading"><div><small>Topology export</small><strong>Review scoped offline artifact</strong></div><button data-scenario="evidence">Cancel</button></header>
      <div class="export-layout">
        <form class="export-controls">
          <label><span>Scope</span><strong>orders.command / portfolio</strong></label>
          <label><span>Version</span><strong>Workbench Topology v1</strong></label>
          <label><input type="checkbox" checked /> Include bounded evidence</label>
          <label><input type="checkbox" checked /> Redact application values</label>
          <p>Credential-like fields are always excluded.</p>
        </form>
        <pre class="export-preview">{
  "schema": "workbench-topology/v1",
  "scope": "orders.command/portfolio",
  "capturedAt": "2026-08-03T14:11:44Z",
  "evidence": { "included": 186, "retained": 12482 },
  "redaction": { "applicationValues": true, "credentials": "always" }
}</pre>
      </div>
      <footer class="document-footer"><span>Credential-safe · 186 included of 12,482 retained</span><div><button>Download JSON</button><button class="primary">Download HTML</button></div></footer>
    </section>
  `;
}

function renderStatusStrip() {
  return `
    <footer class="status-strip"><span>${state.scenario === "volume" ? "12,482" : "186"} shown / 12,482 retained · Frozen · 37 newer</span><span>Draft D-7 preserved · Capture continues</span></footer>
  `;
}

function renderLab() {
  return `
    <form class="prototype-lab" aria-label="Prototype controls">
      <strong>Prototype state</strong>
      <label>Scenario<select data-control="scenario">${Object.entries(SCENARIOS).map(([value, label]) => `<option value="${value}" ${state.scenario === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <label>Preview<select data-control="frame">${Object.entries(FRAMES).map(([value, item]) => `<option value="${value}" ${state.frame === value ? "selected" : ""}>${item.label}</option>`).join("")}</select></label>
      <label>Theme<select data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select></label>
      <small>${VARIANTS[state.variant].short}</small>
    </form>
  `;
}

function renderSwitcher() {
  return `
    <nav class="prototype-switcher" aria-label="Prototype variant">
      <button data-switch="previous" aria-label="Previous variant">←</button>
      <strong>PROTOTYPE ${state.variant} — ${VARIANTS[state.variant].name}</strong>
      <button data-switch="next" aria-label="Next variant">→</button>
    </nav>
  `;
}

function switchVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const current = keys.indexOf(state.variant);
  state.variant = keys[(current + direction + keys.length) % keys.length];
  state.deckMaximized = false;
  render();
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.switch) {
    switchVariant(button.dataset.switch === "next" ? 1 : -1);
    return;
  }
  if (button.dataset.scenario) {
    state.scenario = button.dataset.scenario;
    state.deckMaximized = false;
    render();
    return;
  }
  if (button.dataset.action === "deck-max") {
    state.deckMaximized = !state.deckMaximized;
    render();
    return;
  }
  if (button.dataset.action === "filter") {
    state.filterOpen = !state.filterOpen;
    render();
    return;
  }
  if (button.dataset.action === "scope-pin") {
    state.scopePinned = !state.scopePinned;
    render();
  }
});

app.addEventListener("change", (event) => {
  const control = event.target.dataset.control;
  if (!control) return;
  state[control] = event.target.value;
  if (control === "scenario") state.deckMaximized = false;
  render();
});

window.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  if (event.target.matches("input, textarea, select, [contenteditable]")) return;
  event.preventDefault();
  switchVariant(event.key === "ArrowRight" ? 1 : -1);
});

render();
