const variants = {
  A: { label: "A — Scoped Evidence Console", render: renderEvidenceConsole },
  B: { label: "B — Runtime Lens", render: renderRuntimeLens },
  C: { label: "C — Investigation Stack", render: renderInvestigationStack }
};

const evidence = [
  { id: "evt-1838", time: "14:08:39.902", event: "COMMAND snapshot", command: "ADD", key: "order-1042", change: "6 fields", source: "Server", tone: "server" },
  { id: "evt-1840", time: "14:08:40.116", event: "Update Delivery", command: "ADD", key: "order-1042", change: "listener-view", source: "Server", tone: "server" },
  { id: "evt-1842", time: "14:08:41.238", event: "Item Update", command: "UPDATE", key: "order-1042", change: "qty, status", source: "Server", tone: "server" },
  { id: "evt-1843", time: "14:08:41.239", event: "Update Delivery", command: "UPDATE", key: "order-1042", change: "listener-view", source: "Server", tone: "server" },
  { id: "evt-1844", time: "14:08:41.239", event: "Update Delivery", command: "UPDATE", key: "order-1042", change: "listener-metrics", source: "Server", tone: "server" },
  { id: "evt-1849", time: "14:08:52.004", event: "Injected Update", command: "UPDATE", key: "order-1042", change: "qty, status", source: "Local", tone: "local" },
  { id: "evt-1850", time: "14:08:52.005", event: "Update Delivery", command: "UPDATE", key: "order-1042", change: "listener-view", source: "Local", tone: "local" },
  { id: "evt-1851", time: "14:08:52.005", event: "Update Delivery", command: "UPDATE", key: "order-1042", change: "listener-metrics", source: "Local", tone: "local" },
  { id: "evt-1854", time: "14:09:03.441", event: "Item Update", command: "UPDATE", key: "order-1088", change: "price", source: "Server", tone: "server" }
];

const query = new URLSearchParams(window.location.search);
const initialVariant = variants[query.get("variant")] ? query.get("variant") : "A";
const state = {
  variant: initialVariant,
  selectedId: "evt-1842",
  detailOpen: false,
  injectionOpen: false,
  injected: false,
  rawOpen: false,
  scopeOpen: false,
  frozen: true,
  cStep: "Evidence"
};

const root = document.querySelector("#prototype");
const variantLabel = document.querySelector("#variant-label");

render();

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button, [data-action]") : null;
  if (!(target instanceof HTMLElement)) return;

  const switchDirection = target.dataset.switch;
  if (switchDirection) {
    cycleVariant(switchDirection === "next" ? 1 : -1);
    return;
  }

  const action = target.dataset.action;
  if (!action) return;
  if (action === "select-event") state.selectedId = target.dataset.eventId ?? state.selectedId;
  if (action === "open-detail") state.detailOpen = true;
  if (action === "close-detail") state.detailOpen = false;
  if (action === "open-injection") {
    state.injectionOpen = true;
    state.detailOpen = true;
    state.cStep = "Act";
  }
  if (action === "close-injection") state.injectionOpen = false;
  if (action === "inject") state.injected = true;
  if (action === "open-raw") state.rawOpen = true;
  if (action === "close-raw") state.rawOpen = false;
  if (action === "toggle-scope") state.scopeOpen = !state.scopeOpen;
  if (action === "toggle-frozen") state.frozen = !state.frozen;
  if (action === "c-step") {
    state.cStep = target.dataset.step ?? "Evidence";
    state.injectionOpen = false;
  }
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement || active?.getAttribute("contenteditable") === "true") return;
  cycleVariant(event.key === "ArrowRight" ? 1 : -1);
});

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.detailOpen = false;
  state.injectionOpen = false;
  state.injected = false;
  state.rawOpen = false;
  state.scopeOpen = false;
  state.cStep = "Evidence";
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  window.history.replaceState({}, "", url);
  render();
}

function render() {
  document.documentElement.dataset.variant = state.variant;
  variantLabel.textContent = variants[state.variant].label;
  root.innerHTML = variants[state.variant].render();
}

function renderEvidenceConsole() {
  return `
    <section class="prototype-canvas variant-a" data-detail-open="${state.detailOpen}" data-injection-open="${state.injectionOpen}" data-scope-open="${state.scopeOpen}">
      <header class="instrument-bar">
        <div class="instrument-state"><span class="signal success"></span><strong>Capture active</strong><span>Complete coverage</span><span class="session-name">Session S-9</span></div>
        <div class="bar-actions"><button data-action="toggle-frozen">${state.frozen ? "Follow live" : "Freeze"}</button><button>Find</button><button>Filter</button><button aria-label="More actions">⋮</button></div>
      </header>
      <div class="scope-bar"><button class="scope-toggle" data-action="toggle-scope">Scope</button><span>Page</span><i>›</i><span>client-main</span><i>›</i><span>S-9</span><i>›</i><strong>orders.command</strong><i>›</i><span>portfolio</span><i>›</i><span>order-1042</span><span class="live-object">live</span></div>
      <div class="a-workspace">
        <aside class="a-scope pane">${scopeTree("scope")}</aside>
        <section class="a-evidence pane">
          <div class="pane-heading"><div><span class="eyebrow">Ordered evidence</span><strong>orders.command / portfolio</strong></div><span>186 shown</span></div>
          <div class="filter-input"><span>⌕</span><span>key:order-1042</span><span class="filter-token">source:any ×</span></div>
          ${evidenceGrid()}
          <div class="compact-selection"><span>Selected <strong>UPDATE · order-1042</strong></span><button data-action="open-detail">Open details</button></div>
        </section>
        <aside class="a-inspector pane">${state.injectionOpen ? injectionDraft("a") : evidenceInspector("a")}</aside>
      </div>
      ${rawDrawer()}
      <footer class="status-bar"><span>186 shown / 12,482 retained</span><span>${state.frozen ? "Frozen · 37 newer matches" : "Live"}</span><span>IndexedDB</span><span class="push">Capture continues</span></footer>
    </section>`;
}

function renderRuntimeLens() {
  return `
    <section class="prototype-canvas variant-b" data-injection-open="${state.injectionOpen}" data-scope-open="${state.scopeOpen}">
      <header class="b-header">
        <div class="b-brand"><span class="brand-mark">LS</span><strong>Runtime Lens</strong></div>
        <div class="instrument-state"><span class="signal success"></span><strong>Observing inspected page</strong><span>Complete since 14:03:12</span></div>
        <div class="bar-actions"><button data-action="toggle-frozen">${state.frozen ? "Frozen · 37 new" : "Live"}</button><button aria-label="Workspace actions">⋮</button></div>
      </header>
      <div class="b-context"><button data-action="toggle-scope" aria-label="Open runtime navigator">‹</button><button>›</button><span>Page</span><i>›</i><span>client-main</span><i>›</i><span>S-9</span><i>›</i><strong>orders.command / portfolio / order-1042</strong><span class="live-object">live scope</span></div>
      <div class="b-workspace">
        <aside class="b-tree pane">${scopeTree("navigator")}</aside>
        <main class="b-dossier pane">${state.injectionOpen ? injectionDraft("b") : objectDossier()}</main>
        <aside class="b-activity pane">
          <div class="pane-heading"><div><span class="eyebrow">Activity in scope</span><strong>Ordered evidence</strong></div><button>Filter</button></div>
          ${activityList()}
          <div class="b-selected-actions"><span>evt-1842 selected</span><button data-action="open-raw">Raw</button><button data-action="open-injection">Create draft</button></div>
        </aside>
      </div>
      ${rawDrawer()}
      <footer class="status-bar"><span>186 / 901 in scope</span><span>12,482 retained</span><span class="push">Scope, selection, and Frozen position preserved</span></footer>
    </section>`;
}

function renderInvestigationStack() {
  return `
    <section class="prototype-canvas variant-c" data-step="${state.cStep}" data-injection-open="${state.injectionOpen}">
      <header class="c-header">
        <div><span class="eyebrow">Investigation</span><strong>Incorrect state · order-1042</strong></div>
        <div class="instrument-state"><span class="signal success"></span><strong>Capture active</strong><span>Complete coverage</span></div>
        <div class="bar-actions"><button>⌘ K</button><button aria-label="Investigation actions">⋮</button></div>
      </header>
      <div class="c-context"><span>client-main</span><i>›</i><span>S-9</span><i>›</i><span>orders.command</span><i>›</i><strong>portfolio / order-1042</strong><span class="live-object">live</span></div>
      <div class="c-workspace">
        <nav class="c-steps" aria-label="Investigation steps">${cStepButtons()}</nav>
        <main class="c-stage pane">${state.injectionOpen ? injectionDraft("c") : cStepContent()}</main>
        <aside class="c-notebook pane">
          <div class="pane-heading"><div><span class="eyebrow">Case context</span><strong>Evidence boundary</strong></div></div>
          <dl class="facts"><dt>Question</dt><dd>Why is the application still showing qty 18?</dd><dt>Current finding</dt><dd>Server UPDATE was captured and delivered to both listeners.</dd><dt>Next proof</dt><dd>Compare the two COMMAND projections, then vary the update locally.</dd></dl>
          <div class="confidence"><span class="signal success"></span><div><strong>Supported conclusion</strong><p>Divergence is downstream of the listener boundary.</p></div></div>
        </aside>
      </div>
      ${rawDrawer()}
      <footer class="status-bar"><span>Step ${["Orient", "Scope", "Evidence", "Explain", "Act"].indexOf(state.cStep) + 1} of 5</span><span>${state.frozen ? "Frozen · 37 newer" : "Live"}</span><span class="push">Back stack retains each step's state</span></footer>
    </section>`;
}

function scopeTree(label) {
  return `
    <div class="pane-heading"><div><span class="eyebrow">Runtime ${label}</span><strong>Inspected page</strong></div><button data-action="toggle-scope" aria-label="Close runtime ${label}">«</button></div>
    <div class="tree" role="tree">
      <div class="tree-row level-0"><span>▾</span><strong>Page</strong><em>active</em></div>
      <div class="tree-row level-1"><span>▾</span><strong>client-main</strong><em>active</em></div>
      <div class="tree-row level-2"><span>▾</span><strong>Session S-9</strong><em>active</em></div>
      <div class="tree-row level-3 selected"><span>▾</span><strong>orders.command</strong><em>COMMAND</em></div>
      <div class="tree-row level-4 selected-child"><span>•</span><strong>portfolio</strong><em>1 item</em></div>
      <div class="tree-row level-4"><span>•</span><span>listener-view</span><em>5 deliveries</em></div>
      <div class="tree-row level-4"><span>•</span><span>listener-metrics</span><em>5 deliveries</em></div>
      <div class="tree-row level-3"><span>›</span><span>prices.merge</span><em>MERGE</em></div>
      <div class="tree-row level-2 muted"><span>›</span><span>Session S-8</span><em>retired</em></div>
    </div>
    <div class="tree-warning"><span>!</span><p><strong>One lifecycle warning</strong>orders.command began before Capture.</p></div>`;
}

function evidenceGrid() {
  return `<div class="evidence-grid" role="grid">
    <div class="evidence-row evidence-head" role="row"><span>Time</span><span>Evidence</span><span>Command / key</span><span>Change</span><span>Provenance</span></div>
    ${evidence.map((item) => `<button class="evidence-row ${item.id === state.selectedId ? "selected" : ""}" role="row" data-action="select-event" data-event-id="${item.id}"><span class="mono">${item.time}</span><span>${item.event}</span><span><b class="command ${item.command.toLowerCase()}">${item.command}</b> ${item.key}</span><span>${item.change}</span><span class="provenance ${item.tone}">${item.source}</span></button>`).join("")}
  </div>`;
}

function activityList() {
  return `<div class="activity-list">${evidence.slice(1, 8).map((item) => `<button class="activity-row ${item.id === state.selectedId ? "selected" : ""}" data-action="select-event" data-event-id="${item.id}"><span class="mono">${item.time.slice(0, 8)}</span><span><strong>${item.command}</strong> ${item.key}</span><span>${item.event}</span><span class="provenance ${item.tone}">${item.source}</span></button>`).join("")}</div>`;
}

function evidenceInspector(origin) {
  return `
    <div class="pane-heading"><div><span class="eyebrow">Selected evidence</span><strong>evt-1842 · Item Update</strong></div><button class="compact-only" data-action="close-detail">← Evidence</button></div>
    <div class="lens-tabs"><button class="active">Summary</button><button>Fields</button><button>Deliveries</button><button>State</button><button data-action="open-raw">Raw</button></div>
    <div class="inspector-body">
      <div class="evidence-identity"><span class="provenance server">Server Update</span><span class="mono">14:08:41.238</span></div>
      <dl class="facts"><dt>Subscription</dt><dd>orders.command</dd><dt>Item / key</dt><dd>portfolio / order-1042</dd><dt>Command</dt><dd>UPDATE</dd><dt>Changed</dt><dd>qty, status</dd><dt>Deliveries</dt><dd>2 of 2 listeners</dd></dl>
      ${projectionCompare()}
      <div class="action-stack"><button>Scope to this evidence</button><button class="primary" data-action="open-injection">Create Local Injection Draft</button></div>
      <p class="microcopy">The selected Server Update remains immutable.</p>
    </div>`;
}

function objectDossier() {
  return `
    <div class="dossier-title"><div><span class="eyebrow">COMMAND key in live Subscription</span><h1>order-1042</h1><p>orders.command · portfolio · Session S-9</p></div><div class="dossier-actions"><button>Trace lifecycle</button><button class="primary" data-action="open-injection">Author or create draft</button></div></div>
    <div class="object-health"><div><span>Target</span><strong>Live</strong><small>2 current listeners</small></div><div><span>Snapshot</span><strong>Complete</strong><small>ADD at 14:08:39</small></div><div><span>Coverage</span><strong>Complete</strong><small>Official client API</small></div><div><span>Evidence</span><strong>186</strong><small>9 for this key</small></div></div>
    <section class="projection-section"><div class="section-heading"><div><span class="eyebrow">COMMAND projections</span><strong>What differs locally?</strong></div><button>Open complete lifecycle</button></div>${projectionCompare(true)}</section>
    <section class="boundary-section"><div><span class="signal success"></span><div><strong>Update reached both registered listeners</strong><p>The captured delivery boundary is complete. Remaining application divergence is downstream of Workbench's observable Lightstreamer behavior.</p></div></div><button data-action="open-raw">Verify raw evidence</button></section>
    <section class="recent-section"><div class="section-heading"><strong>Recent semantic evidence</strong><button>View all 186 in scope</button></div>${activityList()}</section>`;
}

function projectionCompare(full = false) {
  return `<div class="projection-compare ${full ? "full" : ""}">
    <div class="projection observed"><span>Observed Server</span><strong>qty 18</strong><strong>status open</strong><small>evt-1842 · Server Update</small></div>
    <div class="projection local"><span>Local Effective</span><strong>qty 42</strong><strong>status review</strong><small>inj-17 · Local effect</small></div>
  </div>`;
}

function injectionDraft(origin) {
  return `
    <div class="pane-heading draft-heading"><div><span class="eyebrow">Deliberate local action</span><strong>Local Injection Draft</strong></div><button data-action="close-injection">${origin === "c" ? "Back to Explain" : "Close"}</button></div>
    <div class="draft-body">
      <section class="draft-target"><div><span class="signal success"></span><div><span class="eyebrow">Local Injection Target · live</span><strong>orders.command / portfolio</strong><p>Session S-9 · COMMAND · 2 registered listeners</p></div></div><small>Delivers only inside this inspected browser runtime. It does not contact Lightstreamer Server.</small></section>
      <section class="draft-source"><span class="eyebrow">Injection Source · immutable</span><div><strong>evt-1842 · Server Update</strong><span>UPDATE order-1042</span></div></section>
      <section class="draft-fields"><span class="eyebrow">Injection Draft · 2 mutations</span><label><span>command</span><input value="UPDATE" readonly /></label><label><span>key</span><input value="order-1042" /></label><label><span>qty</span><input value="42" /><small>was 18</small></label><label><span>status</span><input value="review" /><small>was open</small></label></section>
      ${state.injected ? `<div class="outcome success-outcome"><strong>Delivered locally</strong><span>Injection inj-18 created one Injected Update and 2 Update Deliveries.</span><button>Trace Injected Update</button></div>` : `<div class="validation"><span class="signal success"></span><div><strong>Ready to inject</strong><p>Target and COMMAND fields are valid.</p></div></div><button class="primary inject-button" data-action="inject">Inject locally into this Subscription</button>`}
    </div>`;
}

function cStepButtons() {
  return ["Orient", "Scope", "Evidence", "Explain", "Act"].map((step, index) => `<button class="c-step ${step === state.cStep ? "active" : ""}" data-action="c-step" data-step="${step}"><span>${index + 1}</span><div><strong>${step}</strong><small>${["Verify runtime", "Choose subject", "Follow events", "Name boundary", "Test locally"][index]}</small></div></button>`).join("");
}

function cStepContent() {
  if (state.cStep === "Orient") return `
    <div class="stage-heading"><span class="stage-number">1</span><div><span class="eyebrow">Orient</span><h1>Is Workbench observing the right runtime?</h1></div></div>
    <div class="orientation-grid"><button class="orientation-card selected"><span class="signal success"></span><strong>client-main · Session S-9</strong><span>Connected · complete coverage · 3 Subscriptions</span></button><button class="orientation-card"><span class="signal retired"></span><strong>client-main · Session S-8</strong><span>Retired at 13:58 · historical evidence</span></button></div>
    <div class="stage-callout"><strong>One material warning</strong><span>orders.command lifecycle began 640 ms before semantic Capture.</span><button data-action="c-step" data-step="Scope">Choose affected scope →</button></div>`;
  if (state.cStep === "Scope") return `
    <div class="stage-heading"><span class="stage-number">2</span><div><span class="eyebrow">Scope</span><h1>What runtime object is suspicious?</h1></div></div>
    <div class="scope-choices"><button><span class="mode">MERGE</span><strong>prices.merge</strong><span>42 items · active</span></button><button class="selected"><span class="mode">COMMAND</span><strong>orders.command / portfolio</strong><span>1 item · 2 listeners · warning</span></button><button><span class="mode">DISTINCT</span><strong>notifications.distinct</strong><span>1 item · active</span></button></div>
    <div class="key-search"><label>Find item or COMMAND key<input value="order-1042" /></label><button data-action="c-step" data-step="Evidence">Investigate order-1042 →</button></div>`;
  if (state.cStep === "Evidence") return `
    <div class="stage-heading"><span class="stage-number">3</span><div><span class="eyebrow">Evidence</span><h1>Follow the ordered behavior</h1></div><div class="bar-actions"><button data-action="toggle-frozen">${state.frozen ? "Follow live" : "Freeze"}</button><button>Filter</button></div></div>
    <div class="stage-filter"><span>key:order-1042</span><span>186 / 12,482 retained</span><span>${state.frozen ? "37 newer" : "Live"}</span></div>
    ${evidenceGrid()}
    <div class="stage-next"><span><strong>evt-1842 selected</strong> · Delivered to 2 of 2 listeners</span><button data-action="open-raw">Raw</button><button class="primary" data-action="c-step" data-step="Explain">Explain boundary →</button></div>`;
  if (state.cStep === "Explain") return `
    <div class="stage-heading"><span class="stage-number">4</span><div><span class="eyebrow">Explain</span><h1>Where did behavior diverge?</h1></div></div>
    <div class="evidence-chain"><div class="chain-node success"><span>1</span><strong>Server Update captured</strong><small>evt-1842 · qty 18 · status open</small></div><i>→</i><div class="chain-node success"><span>2</span><strong>Logical Update reconstructed</strong><small>COMMAND UPDATE · order-1042</small></div><i>→</i><div class="chain-node success"><span>3</span><strong>Both listeners received delivery</strong><small>listener-view · listener-metrics</small></div><i>→</i><div class="chain-node unknown"><span>?</span><strong>Application interpretation</strong><small>Outside Workbench observation</small></div></div>
    ${projectionCompare(true)}
    <div class="stage-callout conclusion"><strong>Supported conclusion</strong><span>The expected update reached the application's listener boundary; remaining divergence is downstream.</span><button data-action="c-step" data-step="Act">Test a variation locally →</button></div>`;
  return `
    <div class="stage-heading"><span class="stage-number">5</span><div><span class="eyebrow">Act</span><h1>Choose a deliberate Local Injection path</h1></div></div>
    <div class="action-paths"><button data-action="open-injection"><span>1</span><strong>Reuse unchanged</strong><small>Use evt-1842 as the immutable source and draft.</small></button><button class="recommended" data-action="open-injection"><span>2</span><strong>Mutate captured update</strong><small>Start from evt-1842 and vary qty or status.</small><em>Recommended for this case</em></button><button data-action="open-injection"><span>3</span><strong>Author COMMAND update</strong><small>Start a newly authored draft for this target.</small></button></div>
    <div class="stage-callout"><strong>Exact target</strong><span>orders.command / portfolio · live · 2 registered listeners</span><button data-action="open-injection">Review draft →</button></div>`;
}

function rawDrawer() {
  if (!state.rawOpen) return "";
  return `<aside class="raw-drawer"><div class="pane-heading"><div><span class="eyebrow">Raw evidence · evt-1842</span><strong>Captured callback payload</strong></div><button data-action="close-raw">Close</button></div><pre>{
  "callback": "onItemUpdate",
  "subscriptionId": "orders.command",
  "item": "portfolio",
  "command": "UPDATE",
  "key": "order-1042",
  "changedFields": { "qty": "18", "status": "open" }
}</pre><p>Semantic scope and selected evidence are preserved while raw evidence is open.</p></aside>`;
}
