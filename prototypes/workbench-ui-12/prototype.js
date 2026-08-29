const variants = {
  A: {
    label: "A — Targeted two-line fix",
    summary: "Targeted fix with existing density",
    scopeNote: "Only the selected page stacks; child rows keep today's compact ledger.",
    evidenceNote: "Time and event ID use a measured, aligned two-line cell."
  },
  B: {
    label: "B — Root summary + split order/time",
    summary: "Dense children below a fixed root summary",
    scopeNote: "The page summary moves into the pane header; child rows stay compact.",
    evidenceNote: "Sequence and clock time become independent sortable columns."
  },
  C: {
    label: "C — Priority blocks + order rail",
    summary: "Semantic scanning leads at narrow widths",
    scopeNote: "Type, identity, state, and facts get explicit visual priority.",
    evidenceNote: "A quiet order rail anchors rows while event meaning leads."
  }
};

const scopeNodes = [
  { level: 1, type: "Client", name: "client-1", meta: "Web Client 9.2.3 build 20250225 · public-api", state: "Active" },
  { level: 2, type: "Session", name: "Session S884901401bee7", meta: "ws-streaming · 15 subscriptions", state: "Active" },
  { level: 3, type: "Subscription", name: "subscription-3", meta: "COMMAND · 1 real · 1 delivery", state: "Active" },
  { level: 4, type: "Item", name: "scenario.inventory.store-la-002", meta: "snapshot-complete · 1 update", state: "Active" },
  { level: 4, type: "Listener", name: "listener-3", meta: "4 callbacks · 1 delivery", state: "Active" },
  { level: 3, type: "Subscription", name: "subscription-4", meta: "COMMAND · 1 real · 1 delivery", state: "Active" },
  { level: 4, type: "Item", name: "scenario.inventory.store-ny-018", meta: "snapshot-complete · 1 update", state: "Active" },
  { level: 4, type: "Listener", name: "listener-4", meta: "4 callbacks · 1 delivery", state: "Active" },
  { level: 3, type: "Subscription", name: "subscription-1", meta: "COMMAND · 2 real · 2 deliveries", state: "Active" },
  { level: 4, type: "Item", name: "scenario.session.metadata", meta: "snapshot-complete · 2 updates", state: "Active" },
  { level: 4, type: "Listener", name: "listener-1", meta: "4 callbacks · 2 deliveries", state: "Active" },
  { level: 3, type: "Subscription", name: "subscription-10", meta: "COMMAND · 4 real · 4 deliveries", state: "Active" },
  { level: 4, type: "Item", name: "scenario.promotions.store-ny-018", meta: "snapshot-complete · 4 updates", state: "Active" },
  { level: 4, type: "Listener", name: "listener-10", meta: "4 callbacks · 4 deliveries", state: "Active" },
  { level: 3, type: "Subscription", name: "subscription-7", meta: "COMMAND · 9 real · 9 deliveries", state: "Active" },
  { level: 4, type: "Item", name: "scenario.return-requests.store-ny-018", meta: "snapshot-complete · 9 updates", state: "Active" }
];

const evidence = [
  { sequence: 91, time: "12:33:54.894", source: "SERVER", phase: "LIVE", operation: "ADD", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-1042" },
  { sequence: 107, time: "12:33:54.910", source: "RUNTIME", phase: "END OF SNAPSHOT", operation: "—", kind: "End Of Snapshot", object: "scenario.inventory.store-la-002", key: "—" },
  { sequence: 2741, time: "12:34:26.826", source: "SERVER", phase: "LIVE", operation: "ADD", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-2740" },
  { sequence: 4433, time: "12:34:57.854", source: "SERVER", phase: "LIVE", operation: "UPDATE", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-4432" },
  { sequence: 6125, time: "12:35:28.800", source: "SERVER", phase: "LIVE", operation: "UPDATE", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-6124" },
  { sequence: 7817, time: "12:35:59.773", source: "SERVER", phase: "LIVE", operation: "DELETE", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-7816" },
  { sequence: 9509, time: "12:36:30.763", source: "SERVER", phase: "LIVE", operation: "ADD", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-9508" },
  { sequence: 11201, time: "12:37:01.712", source: "SERVER", phase: "LIVE", operation: "UPDATE", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-11200" },
  { sequence: 12893, time: "12:37:32.704", source: "SERVER", phase: "LIVE", operation: "UPDATE", kind: "Item Update", object: "scenario.inventory.store-la-002", key: "inventory-12892" }
];

const query = new URLSearchParams(window.location.search);
const state = {
  variant: variants[query.get("variant")] ? query.get("variant") : "A",
  frame: ["normal", "compact"].includes(query.get("frame")) ? query.get("frame") : "normal",
  selectedSequence: 4433
};

const root = document.querySelector("#prototype");
const variantLabel = document.querySelector("#variant-label");
const frameSelect = document.querySelector("#frame-select");

frameSelect.value = state.frame;
frameSelect.addEventListener("change", () => {
  state.frame = frameSelect.value;
  updateUrl();
  render();
});

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("button") : null;
  if (!(target instanceof HTMLButtonElement)) return;

  if (target.dataset.switch) {
    cycleVariant(target.dataset.switch === "next" ? 1 : -1);
    return;
  }

  if (target.dataset.sequence) {
    state.selectedSequence = Number(target.dataset.sequence);
    render();
  }
});

document.addEventListener("keydown", (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement || active instanceof HTMLTextAreaElement || active?.getAttribute("contenteditable") === "true") return;
  cycleVariant(event.key === "ArrowRight" ? 1 : -1);
});

function cycleVariant(direction) {
  const keys = Object.keys(variants);
  const current = keys.indexOf(state.variant);
  state.variant = keys[(current + direction + keys.length) % keys.length];
  updateUrl();
  render();
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", state.variant);
  url.searchParams.set("frame", state.frame);
  window.history.replaceState({}, "", url);
}

function render() {
  document.documentElement.dataset.variant = state.variant;
  document.documentElement.dataset.frame = state.frame;
  variantLabel.textContent = variants[state.variant].label;

  root.innerHTML = `
    <div class="prototype-stage frame-${state.frame}">
      <section class="workbench variant-${state.variant.toLowerCase()}" aria-label="Lightstreamer Workbench readability prototype">
        ${renderOperatingStrip()}
        ${renderScopeStrip()}
        <div class="workspace">
          ${renderScopePane()}
          ${renderEvidencePane()}
          ${renderContextPane()}
        </div>
        <footer class="status-strip">
          <span>2 diagnostics · Scroll to review all</span>
          <span>Selected event-${state.selectedSequence}</span>
          <span class="status-spacer">Notifications (40)</span>
          <button type="button">Freeze Evidence</button>
        </footer>
      </section>
      <aside class="prototype-rationale" aria-label="Current variant rationale">
        <strong>${variants[state.variant].summary}</strong>
        <span><b>Scope:</b> ${variants[state.variant].scopeNote}</span>
        <span><b>Evidence:</b> ${variants[state.variant].evidenceNote}</span>
      </aside>
    </div>`;
}

function renderOperatingStrip() {
  return `
    <header class="operating-strip">
      <strong>Capture&nbsp; RUNNING</strong>
      <strong class="coverage">Coverage&nbsp; LIMITED</strong>
      <strong>View&nbsp; FOLLOW LIVE</strong>
      <div class="operating-actions">
        <button type="button">Find</button>
        <button type="button">Filter</button>
        <button type="button">Theme</button>
        <button type="button" aria-label="More actions">•••</button>
      </div>
    </header>`;
}

function renderScopeStrip() {
  return `
    <div class="scope-strip">
      <button type="button">Scope</button>
      <strong>Inspected page</strong>
      <span>› client-1 › Session S884901401bee7 › subscription-3 › scenario.inventory.store-la-002</span>
      <em>Active · 1 update · read-only</em>
    </div>`;
}

function renderScopePane() {
  return `
    <aside class="scope-pane pane" aria-label="Runtime Scope">
      ${state.variant === "B" ? `
        <header class="pane-heading scope-summary-heading">
          <div><span>RUNTIME SCOPE</span><strong>Inspected page</strong><small>1 client · 15 subscriptions</small></div>
          <button type="button">Collapse Scope</button>
        </header>` : `
        <header class="pane-heading">
          <div><span>RUNTIME SCOPE</span><strong>Inspected page</strong></div>
          <button type="button">Collapse Scope</button>
        </header>`}
      ${state.variant === "A" ? renderStackedScope() : state.variant === "B" ? renderSummaryScope() : renderPriorityScope()}
    </aside>`;
}

function renderStackedScope() {
  return `
    <div class="scope-tree scope-targeted" role="tree">
      <button type="button" class="scope-row root selected level-0" role="treeitem" aria-selected="true">
        <strong>Inspected page</strong>
        <span class="row-facts">1 client · 15 subscriptions</span>
        <em>Active</em>
      </button>
      ${scopeNodes.map((node) => `
        <button type="button" class="scope-row level-${node.level}" role="treeitem">
          <span class="object-type">${node.type}</span>
          <strong title="${node.name}">${node.name}</strong>
          <span class="row-facts" title="${node.meta}">${node.meta}</span>
          <em>${node.state}</em>
        </button>`).join("")}
    </div>`;
}

function renderSummaryScope() {
  return `
    <div class="scope-tree-label">Captured objects</div>
    <div class="scope-tree scope-dense" role="tree">
      ${scopeNodes.map((node) => `
        <button type="button" class="scope-row level-${Math.max(0, node.level - 1)}" role="treeitem">
          <strong title="${node.name}">${node.name}</strong>
          <span class="row-facts" title="${node.meta}">${node.meta}</span>
          <em>${node.state}</em>
        </button>`).join("")}
    </div>`;
}

function renderPriorityScope() {
  const rootNode = { type: "Page", name: "Inspected page", meta: "1 client · 15 subscriptions", state: "Active", level: 0 };
  return `
    <div class="scope-tree scope-priority" role="tree">
      ${[rootNode, ...scopeNodes].map((node, index) => `
        <button type="button" class="scope-row level-${node.level} ${index === 0 ? "selected" : ""}" role="treeitem" aria-selected="${index === 0}">
          <span class="object-type">${node.type}</span>
          <strong title="${node.name}">${node.name}</strong>
          <em>${node.state}</em>
          <span class="row-facts" title="${node.meta}">${node.meta}</span>
        </button>`).join("")}
    </div>`;
}

function renderEvidencePane() {
  return `
    <section class="evidence-pane pane" aria-label="Ordered Evidence">
      <header class="pane-heading evidence-heading">
        <div><span>ORDERED EVIDENCE</span><strong>12,893 matching events</strong></div>
        <div><button type="button">Oldest first</button><button type="button">Follow live</button></div>
      </header>
      <div class="evidence-tools"><strong>Retained range</strong><span>event-1 → event-12,893</span><button type="button">Jump to latest</button></div>
      ${state.variant === "A" ? renderStackedEvidence() : state.variant === "B" ? renderSplitEvidence() : renderRailEvidence()}
    </section>`;
}

function renderStackedEvidence() {
  return `
    <div class="evidence-scroll">
      <div class="evidence-header evidence-grid-a"><span>Time / event</span><span>Source</span><span>Phase</span><span>Op</span><span>Evidence / object</span><span>COMMAND key</span></div>
      ${evidence.map((event) => `
        <button type="button" class="evidence-row evidence-grid-a ${event.sequence === state.selectedSequence ? "selected" : ""}" data-sequence="${event.sequence}">
          <span class="when"><time>${event.time}</time><small>event-${event.sequence}</small></span>
          <strong>${event.source}</strong>
          <span>${event.phase}</span>
          <strong>${event.operation}</strong>
          <span class="evidence-object"><b>${event.kind}</b><small title="${event.object}">${event.object}</small></span>
          <span title="${event.key}">${event.key}</span>
        </button>`).join("")}
    </div>`;
}

function renderSplitEvidence() {
  return `
    <div class="evidence-scroll">
      <div class="evidence-header evidence-grid-b"><span>#</span><span>Time</span><span>Source</span><span>Phase</span><span>Op</span><span>Evidence / object</span><span>COMMAND key</span></div>
      ${evidence.map((event) => `
        <button type="button" class="evidence-row evidence-grid-b ${event.sequence === state.selectedSequence ? "selected" : ""}" data-sequence="${event.sequence}">
          <strong class="sequence">${event.sequence}</strong>
          <time>${event.time}</time>
          <strong>${event.source}</strong>
          <span>${event.phase}</span>
          <strong>${event.operation}</strong>
          <span class="evidence-object"><b>${event.kind}</b><small title="${event.object}">${event.object}</small></span>
          <span title="${event.key}">${event.key}</span>
        </button>`).join("")}
    </div>`;
}

function renderRailEvidence() {
  return `
    <div class="evidence-scroll evidence-rail-list">
      <div class="evidence-header evidence-grid-c"><span>Order</span><span>Evidence</span><span>Command</span><span>Object</span></div>
      ${evidence.map((event) => `
        <button type="button" class="evidence-row evidence-grid-c ${event.sequence === state.selectedSequence ? "selected" : ""}" data-sequence="${event.sequence}">
          <span class="order-rail"><small>event</small><strong>${event.sequence}</strong></span>
          <span class="semantic-evidence"><b>${event.kind}</b><small><time>${event.time}</time> · ${event.source} · ${event.phase}</small></span>
          <strong>${event.operation}</strong>
          <span class="object-stack"><b title="${event.object}">${event.object}</b><small title="${event.key}">key ${event.key}</small></span>
        </button>`).join("")}
    </div>`;
}

function renderContextPane() {
  const selected = evidence.find((event) => event.sequence === state.selectedSequence) ?? evidence[0];
  return `
    <aside class="context-pane pane" aria-label="Selected Evidence context">
      <header class="pane-heading"><div><span>SELECTED EVIDENCE</span><strong>event-${selected.sequence}</strong></div></header>
      <dl>
        <dt>Timestamp</dt><dd><time>${selected.time}</time></dd>
        <dt>Source</dt><dd>${selected.source}</dd>
        <dt>Evidence</dt><dd>${selected.kind}</dd>
        <dt>Subscription</dt><dd>subscription-3</dd>
        <dt>Item</dt><dd>${selected.object}</dd>
        <dt>COMMAND key</dt><dd>${selected.key}</dd>
      </dl>
      <section>
        <strong>Selected fields</strong>
        <p><code>status</code> <span>ready</span></p>
        <p><code>quantity</code> <span>18</span></p>
      </section>
      <button type="button">Open complete raw</button>
    </aside>`;
}

render();
