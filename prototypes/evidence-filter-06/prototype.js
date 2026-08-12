const VARIANTS = {
  A: { name: "A · Inline composer", description: "Author with Evidence; open a bounded value explorer" },
  B: { name: "B · Context lens", description: "Temporarily author structured Filter in Context" },
  C: { name: "C · Filter worksheet", description: "Stage the complete Filter in a transient document" }
};

const FRAMES = {
  compact: "563 × 700 compact",
  normal: "900 × 700 normal",
  shallow: "900 × 320 shallow",
  wide: "1440 × 900 wide"
};

const SCENARIOS = {
  primary: "Primary applied Filter",
  zero: "Zero matching Evidence",
  conflict: "Valid cross-facet conflict",
  high: "3,842 COMMAND keys",
  unavailable: "Facet discovery unavailable",
  hidden: "Selected Evidence hidden",
  live: "Passive Live Capture growth",
  terminal: "Terminal final boundary",
  fallback: "Memory fallback"
};

const FACETS = [
  "Client", "Session", "Subscription", "Subscription mode", "Evidence kind", "Item",
  "Listener", "COMMAND key", "COMMAND operation", "Update phase", "Provenance", "Observation path"
];

const params = new URLSearchParams(location.search);
const requestedVariant = params.get("variant")?.toUpperCase();
const initialScenario = SCENARIOS[params.get("scenario")] ? params.get("scenario") : "primary";
const initialDiscoveryScenario = initialScenario === "high" || initialScenario === "unavailable";
const state = {
  variant: VARIANTS[requestedVariant] ? requestedVariant : "A",
  frame: FRAMES[params.get("frame")] ? params.get("frame") : "normal",
  theme: ["dark", "light"].includes(params.get("theme")) ? params.get("theme") : "dark",
  scenario: initialScenario,
  filterOpen: params.get("filterOpen") === "1" || initialDiscoveryScenario,
  addStep: initialDiscoveryScenario,
  explorerOpen: initialDiscoveryScenario,
  explorerFacet: "COMMAND key",
  explorerSearch: "",
  explorerPage: 1,
  valueFocus: 0,
  valueDraft: new Map(),
  draftText: "order",
  appliedText: "order",
  appliedCriteria: criteriaForScenario(initialScenario),
  around: false,
  reset: false,
  selected: params.get("event") ?? (initialScenario === "hidden" ? "event-0068" : "event-0075"),
  findOpen: params.get("find") === "1",
  findText: params.get("findText") ?? "",
  findIndex: 0,
  flash: "",
  restoreFocus: null
};

const EVENTS = createEvents(96);

function createEvents(count) {
  const keys = ["order-1047", "order-1055", "basket-alpha", "basket-beta", "quote-7", "order-long-production-identity-99218"];
  const items = ["orders.eu", "orders.us", "portfolio.main", "quotes.primary"];
  return Array.from({ length: count }, (_, index) => {
    const sequence = index + 1;
    const local = sequence % 23 === 0;
    const delivery = sequence % 13 === 0;
    const runtime = sequence % 37 === 0;
    const provenance = runtime ? "RUNTIME" : local ? "LOCAL" : "SERVER";
    const kind = runtime ? "Session status" : delivery ? "Update delivery" : local ? "Injected update" : "Item update";
    const command = runtime || delivery ? "—" : sequence % 19 === 0 ? "DELETE" : sequence % 7 === 0 ? "ADD" : "UPDATE";
    const key = keys[sequence % keys.length];
    const item = items[sequence % items.length];
    return {
      id: `event-${String(sequence).padStart(4, "0")}`,
      sequence,
      time: `22:40:${String(Math.floor(sequence / 10)).padStart(2, "0")}.${String(sequence * 7).padStart(3, "0").slice(-3)}`,
      provenance,
      phase: sequence < 14 ? "SNAPSHOT" : "LIVE",
      command,
      kind,
      key,
      item,
      summary: runtime ? "Session connected" : `${item} · ${key} · order qty ${sequence * 3}`
    };
  });
}

function layout() { return state.frame; }

function render() {
  document.documentElement.dataset.theme = state.theme;
  const filterLens = state.variant === "B" && state.filterOpen;
  document.querySelector("#app").innerHTML = `<section class="prototype-stage frame-${state.frame}">
    <section class="prototype-frame">
      <section class="workbench" data-layout="${layout()}" data-filter-lens="${filterLens}" aria-label="Lightstreamer Workbench filter authoring prototype">
        ${renderOperating()}
        ${renderScopeStrip()}
        <div class="workspace" role="group" aria-label="Scoped Evidence Workspace">
          ${renderScopePane()}<div class="splitter scope-split" role="separator" aria-label="Resize Scope"></div>
          ${renderEvidence()}<div class="splitter context-split" role="separator" aria-label="Resize Context"></div>
          ${renderContext()}
          ${renderOverlay()}
        </div>
        ${renderStatus()}
      </section>
    </section>
    ${renderPrototypeControls()}
    ${renderSwitcher()}
  </section>`;
  restoreFocus();
}

function renderOperating() {
  const terminal = state.scenario === "terminal";
  const fallback = state.scenario === "fallback";
  const live = state.scenario === "live";
  const findMatches = state.findText ? 17 : 0;
  return `<header class="operating">
    <strong>Capture ${terminal ? "STOPPED" : "RUNNING"}</strong>
    <span class="coverage">Coverage ${fallback ? "LIMITED" : "USEFUL"}</span>
    <span>View ${live ? "FOLLOW LIVE" : "FROZEN · 16 newer"}</span>
    <div class="operating-actions">
      ${state.findOpen ? `<div class="find-box" role="search" aria-label="Find in matching Evidence"><label for="find-text">Find</label><input id="find-text" data-focus-key="find-input" value="${escapeAttribute(state.findText)}"><span>${findMatches ? `${state.findIndex + 1} of ${findMatches}` : "0 matches"}</span><button data-action="find-prev" aria-label="Previous Find match">Previous</button><button data-action="find-next" aria-label="Next Find match">Next</button><button data-action="close-find">Close Find</button></div>` : `<button data-action="open-find" data-focus-key="find-trigger">Find</button>`}
      <button data-action="edit-filter" data-focus-key="filter-trigger" aria-expanded="${state.filterOpen}">Filter</button>
      <button>More actions</button>
    </div>
  </header>`;
}

function renderScopeStrip() {
  return `<nav class="scope-strip" aria-label="Current runtime Scope"><button>Scope</button><strong>Inspected page › Session session-9f2a › COMMAND subscription sub-7</strong><span>Active · 8,410 Evidence</span></nav>`;
}

function renderScopePane() {
  return `<nav class="pane scope-pane" aria-label="Structural runtime Scope">
    <header class="pane-header"><span class="pane-title"><span class="eyebrow">Runtime Scope</span><strong>Inspected page</strong></span><button>Collapse Scope</button></header>
    <div class="scope-tree" role="tree">
      ${scopeNode("Inspected page", "1 client · Active", 1, true)}
      ${scopeNode("Web Client 9.2.3", "Active", 2)}
      ${scopeNode("Session session-9f2a", "2 subscriptions", 3)}
      ${scopeNode("COMMAND subscription sub-7", "Active", 4)}
      ${scopeNode("orders.eu", "4,205 Evidence", 5)}
      ${scopeNode("orders.us", "4,205 Evidence", 5)}
    </div>
  </nav>`;
}

function scopeNode(label, detail, depth, selected = false) {
  return `<button class="scope-node" role="treeitem" aria-level="${depth}" aria-selected="${selected}" style="--depth:${depth - 1}"><span>${label}</span><em>${detail}</em></button>`;
}

function renderEvidence() {
  const counts = scenarioCounts();
  const rows = visibleEvents();
  const hidden = state.scenario === "hidden";
  return `<section class="pane evidence-pane" aria-label="Ordered Evidence">
    <header class="pane-header"><span class="pane-title"><span class="eyebrow">Ordered Evidence</span><strong>COMMAND subscription sub-7</strong></span><button data-action="open-selected-context">Open selected Context</button></header>
    ${renderFilterSummary(counts)}
    ${state.variant === "A" && state.filterOpen ? renderComposer("inline") : ""}
    ${renderCondition()}
    ${hidden ? `<div class="condition info"><strong>Selected Evidence is outside current results</strong><span>${escapeHtml(state.selected)} remains selected in Context.</span><div class="condition-actions"><button data-action="reveal-selected">Reveal selected Evidence</button><button data-action="clear-selection">Clear selection</button></div></div>` : ""}
    <div class="evidence-window"><button>Older</button><span>${counts.shown ? `Newest ${counts.shown} of ${formatNumber(counts.matching)} matching Evidence` : "No matching Evidence"}</span><button disabled>Newer</button></div>
    ${rows.length ? `<div class="ledger" role="grid" aria-label="Filtered Ordered Evidence" tabindex="0"><div class="ledger-header" role="row"><span role="columnheader">Time / #</span><span role="columnheader">Source</span><span role="columnheader">Phase</span><span role="columnheader">Op</span><span role="columnheader">Evidence / object</span><span role="columnheader">COMMAND key</span></div>${rows.map(renderEventRow).join("")}</div>` : renderEmpty()}
    ${state.selected && !hidden && rows.some((event) => event.id === state.selected) ? renderRowActions() : ""}
  </section>`;
}

function renderFilterSummary(counts) {
  return `<section class="filter-summary" aria-label="Applied Evidence Filter">
    <div class="summary-text"><strong>Filter</strong><span>${escapeHtml(filterSummary())}</span></div>
    <div class="counts">${counts.shown} shown · ${formatNumber(counts.matching)} matching · ${formatNumber(counts.inScope)} in Scope</div>
    <div class="summary-actions"><button data-action="edit-filter" data-focus-key="filter-summary-edit">${state.filterOpen ? "Close" : "Edit"} Filter</button><button data-action="reset-filter" ${state.reset ? "disabled" : ""}>Reset</button></div>
  </section>`;
}

function filterSummary() {
  if (state.reset) return "No active criteria";
  if (state.scenario === "zero") return "COMMAND key includes missing-order-404";
  if (state.scenario === "conflict") return "Subscription mode includes COMMAND; Evidence kind includes Session status";
  const parts = [];
  if (state.appliedText) parts.push(`Evidence contains “${state.appliedText}”`);
  for (const criterion of state.appliedCriteria) parts.push(`${criterion.facet} ${criterion.polarity === "include" ? "includes" : "excludes"} ${criterion.values.join(" or ")}`);
  if (state.around) parts.push("Around event-0075 · ±5 seconds");
  return parts.join("; ") || "No active criteria";
}

function renderComposer(location) {
  return `<section class="${location === "inline" ? "inline-composer" : "lens-body"}" aria-label="Filter constructor">
    <div class="composer-heading"><div><span class="eyebrow">Filter constructor</span><strong>${state.variant === "B" ? "Structured Filter lens" : state.variant === "C" ? "Filter worksheet draft" : "Edit Filter"}</strong></div>${location === "lens" ? `<button class="compact-back" data-action="cancel-filter">Back to Evidence</button>` : ""}</div>
    <label class="field-row" for="filter-text"><span>Evidence contains</span><input id="filter-text" data-focus-key="filter-text" value="${escapeAttribute(state.draftText)}" placeholder="Free text across retained Evidence"><span>AND</span></label>
    <ul class="criteria-list" aria-label="Structured criteria">${renderCriteria()}</ul>
    ${state.addStep ? renderAddStep() : `<button data-action="add-criterion" data-focus-key="add-criterion">Add structured criterion</button>`}
    <div class="composer-actions"><button data-action="cancel-filter">Cancel</button><button class="primary" data-action="apply-filter">Apply Filter</button></div>
  </section>`;
}

function renderCriteria() {
  const criteria = state.scenario === "conflict"
    ? [{ facet: "Subscription mode", polarity: "include", values: ["COMMAND"] }, { facet: "Evidence kind", polarity: "include", values: ["Session status"] }]
    : state.scenario === "zero"
      ? [{ facet: "COMMAND key", polarity: "include", values: ["missing-order-404"] }]
      : state.appliedCriteria;
  if (!criteria.length && !state.around) return `<li class="criterion"><b>Structured</b><span>No structured criteria</span><span></span></li>`;
  return `${criteria.map((criterion, index) => `<li class="criterion ${criterion.polarity}"><b>${escapeHtml(criterion.facet)}</b><span>${criterion.polarity === "include" ? "Include" : "Exclude"} · ${escapeHtml(criterion.values.join(" or "))}</span><button data-action="remove-criterion" data-index="${index}" aria-label="Remove ${escapeAttribute(criterion.facet)} criterion">Remove</button></li>`).join("")}${state.around ? `<li class="criterion include"><b>Around Evidence</b><span>event-0075 · 22:40:02.518 ≤ t &lt; 22:40:12.518</span><button data-action="remove-around">Remove</button></li>` : ""}`;
}

function renderAddStep() {
  return `<div class="field-row"><label for="facet-select">Facet</label><select id="facet-select" data-focus-key="facet-select">${FACETS.map((facet) => `<option ${facet === state.explorerFacet ? "selected" : ""}>${facet}</option>`).join("")}</select><button data-action="open-explorer" data-focus-key="choose-values">Choose values</button></div>`;
}

function renderCondition() {
  if (state.flash) return `<div class="condition info"><strong>Filter updated</strong><span>${escapeHtml(state.flash)}</span><button data-action="dismiss-flash">Dismiss</button></div>`;
  if (state.scenario === "zero") return `<div class="condition warning"><strong>0 matching Evidence</strong><span>The active COMMAND key was not observed in this retained interval. The zero-value intent remains active.</span><button data-action="reset-filter">Reset Filter</button></div>`;
  if (state.scenario === "conflict") return `<div class="condition warning"><strong>Valid criteria, empty intersection</strong><span>Session status Evidence has no COMMAND subscription mode in this Scope. No criterion was ignored.</span><button data-action="edit-filter">Edit Filter</button></div>`;
  if (state.scenario === "terminal") return `<div class="condition info"><strong>Capture STOPPED</strong><span>Counts are final and exact at committed Evidence boundary #8,410.</span><span></span></div>`;
  if (state.scenario === "fallback") return `<div class="condition warning"><strong>Coverage LIMITED</strong><span>IndexedDB was unavailable. Filter semantics and final counts remain exact within the 5,000-record memory capacity.</span><button>Open diagnostics</button></div>`;
  if (state.scenario === "live") return `<div class="condition info"><strong>2 Evidence committed</strong><span>Filter, selected Evidence, focus, and scroll anchor did not move while View follows Live.</span><button>Freeze Evidence</button></div>`;
  return "";
}

function renderEventRow(event) {
  const selected = event.id === state.selected;
  const findCurrent = state.findOpen && state.findText && event.summary.toLowerCase().includes(state.findText.toLowerCase());
  return `<div class="evidence-row" role="row" tabindex="${selected ? "0" : "-1"}" aria-selected="${selected}" data-event="${event.id}" data-action="select-event" data-focus-key="${event.id}" data-find-current="${Boolean(findCurrent)}">
    <time role="gridcell">${event.time}<small> #${event.sequence}</small></time><strong role="gridcell">${event.provenance}</strong><span role="gridcell">${event.phase}</span><b role="gridcell">${event.command}</b><span role="gridcell">${markFind(event.summary)}</span><code role="gridcell">${event.key}</code>
  </div>`;
}

function visibleEvents() {
  if (state.scenario === "zero" || state.scenario === "conflict") return [];
  let values = [...EVENTS].reverse();
  if (state.scenario === "hidden") values = values.filter((event) => event.id !== state.selected);
  return values.slice(0, 60);
}

function renderEmpty() {
  return `<div class="empty"><strong>No Evidence matches this Filter</strong><span>Scope still contains 8,410 retained Evidence records. Active criteria remain visible above.</span><div><button data-action="edit-filter">Edit Filter</button> <button data-action="reset-filter">Reset Filter</button></div></div>`;
}

function renderRowActions() {
  const event = selectedEvent();
  if (!event) return "";
  return `<div class="row-actions" aria-label="Filter actions for selected Evidence"><strong>Selected ${event.id}</strong><button data-action="include-item">Include this item · ${escapeHtml(event.item)}</button><button data-action="exclude-key">Exclude this COMMAND key · ${escapeHtml(event.key)}</button><button data-action="around-evidence">Around this Evidence · ±5 seconds</button></div>`;
}

function renderContext() {
  if (state.variant === "B" && state.filterOpen) {
    return `<aside class="pane context-pane" aria-label="Filter lens"><header class="pane-header"><span class="pane-title"><span class="eyebrow">Context</span><strong>Filter lens</strong></span><button data-action="cancel-filter">Close Filter lens</button></header>${renderComposer("lens")}</aside>`;
  }
  const event = selectedEvent();
  return `<aside class="pane context-pane" aria-label="Selected Evidence Context">
    <header class="pane-header"><span class="pane-title"><span class="eyebrow">Context</span><strong>${event ? event.id : "No selected Evidence"}</strong></span><button>Collapse Context</button></header>
    <div class="context-body">${event ? `<dl><dt>Evidence kind</dt><dd>${event.kind}</dd><dt>Provenance</dt><dd>${event.provenance}</dd><dt>Subscription</dt><dd>sub-7 · COMMAND</dd><dt>Item</dt><dd>${event.item}</dd><dt>COMMAND key</dt><dd>${event.key}</dd><dt>Update phase</dt><dd>${event.phase}</dd></dl><div class="context-actions"><button data-action="include-item">Include item</button><button data-action="exclude-key">Exclude COMMAND key</button><button data-action="around-evidence">Around this Evidence</button></div>` : `<p>Choose an Evidence row to inspect it.</p>`}</div>
  </aside>`;
}

function renderOverlay() {
  if (state.explorerOpen) return `<section class="workspace-overlay">${renderExplorer()}</section>`;
  if (state.variant === "C" && state.filterOpen) return `<section class="workspace-overlay"><section class="worksheet" role="dialog" aria-modal="true" aria-labelledby="worksheet-title"><header><div><span class="eyebrow">Transient Filter worksheet</span><h2 id="worksheet-title">Construct Evidence Filter</h2></div><button data-action="cancel-filter">Close worksheet</button></header><div class="worksheet-body"><section tabindex="0" aria-label="Filter worksheet criteria">${renderComposer("worksheet")}</section><section tabindex="0" aria-label="Filter worksheet preview"><h3>Exact applied preview</h3><p>60 shown · 243 matching · 8,410 in Scope</p><p class="lens-note">Preview uses one coherent committed boundary. Apply is atomic; Cancel preserves the existing investigation.</p><h3>Selected Evidence</h3><p>${state.selected} remains selected. The draft would keep it visible.</p></section></div></section></section>`;
  return "";
}

function renderExplorer() {
  const unavailable = state.scenario === "unavailable";
  const high = state.scenario === "high";
  const values = facetValues(state.explorerFacet, high);
  const pageStart = high ? (state.explorerPage - 1) * 50 + 1 : values.length ? 1 : 0;
  const total = high ? 3842 : values.length;
  return `<section class="explorer" role="dialog" aria-modal="true" aria-labelledby="explorer-title">
    <header><div class="explorer-heading"><strong id="explorer-title">Choose ${escapeHtml(state.explorerFacet)} values</strong><span>Counts ignore both active polarities of this facet only.</span></div><button data-action="close-explorer">Close value explorer</button></header>
    <label class="explorer-search" for="value-search"><span>Search exact values</span><input id="value-search" data-focus-key="value-search" value="${escapeAttribute(state.explorerSearch)}" placeholder="Search ${escapeAttribute(state.explorerFacet)} labels"></label>
    <div class="facet-status"><span>${unavailable ? "Discovery unavailable" : `${pageStart}–${Math.min(pageStart + values.length - 1, total)} of ${formatNumber(total)} values · exact`}</span><span>${high ? `Page ${state.explorerPage} of 77` : "Stable typed order"}</span></div>
    ${unavailable ? `<div class="unavailable"><strong>COMMAND key discovery is unavailable</strong><span>Ordered Evidence and exact totals remain usable. Active key values stay visible in the Filter summary.</span><button data-action="close-explorer">Return to Filter</button></div>` : `<div class="value-list" role="list" aria-label="Exact ${escapeAttribute(state.explorerFacet)} values">${values.map((value, index) => renderValueOption(value, index, pageStart)).join("")}</div>`}
    <footer>${high && !unavailable ? `<button data-action="previous-values" ${state.explorerPage === 1 ? "disabled" : ""}>Previous 50</button><button data-action="next-values" ${state.explorerPage === 77 ? "disabled" : ""}>Next 50</button>` : ""}<span style="flex:1"></span><button data-action="close-explorer">Cancel</button><button class="primary" data-action="apply-values" ${unavailable ? "disabled" : ""}>Apply values</button></footer>
  </section>`;
}

function facetValues(facet, high) {
  if (high || facet === "COMMAND key") {
    const start = (state.explorerPage - 1) * 50;
    return Array.from({ length: 50 }, (_, index) => {
      const ordinal = start + index + 1;
      return { identity: `order-${String(ordinal).padStart(5, "0")}`, count: Math.max(0, 118 - ((ordinal * 17) % 119)) };
    }).filter((value) => !state.explorerSearch || value.identity.includes(state.explorerSearch.toLowerCase()));
  }
  const catalogs = {
    "Subscription mode": [["COMMAND", 239], ["MERGE", 130], ["DISTINCT", 84], ["RAW", 17]],
    Provenance: [["SERVER", 228], ["LOCAL", 15], ["RUNTIME", 7], ["WORKBENCH", 4]],
    "Evidence kind": [["Item update", 211], ["Update delivery", 19], ["Injected update", 15], ["Session status", 7]],
    "Update phase": [["LIVE", 215], ["SNAPSHOT", 28]],
    "COMMAND operation": [["UPDATE", 173], ["ADD", 48], ["DELETE", 22]]
  };
  const entries = catalogs[facet] ?? [[`${facet} value A`, 181], [`${facet} value B`, 62], [`${facet} active-zero`, 0]];
  return entries.map(([identity, count]) => ({ identity, count })).filter((value) => !state.explorerSearch || value.identity.toLowerCase().includes(state.explorerSearch.toLowerCase()));
}

function renderValueOption(value, index, pageStart) {
  const key = `${state.explorerFacet}:${value.identity}`;
  const polarity = state.valueDraft.get(key) ?? "neutral";
  const pinned = value.count === 0 ? " · active zero pinned" : "";
  return `<div class="value-option" role="listitem" data-active="${index === state.valueFocus}"><button class="value-identity" tabindex="${index === state.valueFocus ? "0" : "-1"}" data-value-index="${index}" data-value="${escapeAttribute(value.identity)}" aria-pressed="${polarity !== "neutral"}" aria-label="${escapeAttribute(value.identity)}, ${formatNumber(value.count)} Evidence, ${polarity}"><code>${escapeHtml(value.identity)}${pinned}</code></button><span class="value-count">${formatNumber(value.count)} Evidence</span><button class="polarity" data-action="set-polarity" data-polarity="include" data-value="${escapeAttribute(value.identity)}" aria-pressed="${polarity === "include"}">Include</button><button class="polarity" data-action="set-polarity" data-polarity="exclude" data-value="${escapeAttribute(value.identity)}" aria-pressed="${polarity === "exclude"}">Exclude</button></div>`;
}

function renderStatus() {
  const terminal = state.scenario === "terminal";
  return `<footer class="status"><span>${terminal ? "Capture stopped · final boundary #8,410" : "Panel Session · retained interval H7 · committed boundary #8,410"}</span><span>${state.variant === "A" ? "Recommended exploration" : "Alternative exploration"} · Find and Filter independent</span></footer>`;
}

function renderPrototypeControls() {
  return `<aside class="prototype-controls" aria-label="Prototype controls"><strong>PROTOTYPE</strong><label>Frame <select data-control="frame">${Object.entries(FRAMES).map(([value, label]) => `<option value="${value}" ${state.frame === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Theme <select data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select></label><label>State <select data-control="scenario">${Object.entries(SCENARIOS).map(([value, label]) => `<option value="${value}" ${state.scenario === value ? "selected" : ""}>${label}</option>`).join("")}</select></label></aside>`;
}

function renderSwitcher() {
  return `<nav class="prototype-switcher" aria-label="Authoring variants"><button data-action="previous-variant" aria-label="Previous authoring variant">←</button><span>${VARIANTS[state.variant].name} · ${VARIANTS[state.variant].description}</span><button data-action="next-variant" aria-label="Next authoring variant">→</button></nav>`;
}

function scenarioCounts() {
  if (state.reset) return { shown: 60, matching: 8410, inScope: 8410 };
  const values = {
    primary: { shown: 60, matching: 243, inScope: 8410 },
    zero: { shown: 0, matching: 0, inScope: 8410 },
    conflict: { shown: 0, matching: 0, inScope: 8410 },
    high: { shown: 60, matching: 1074, inScope: 8410 },
    unavailable: { shown: 60, matching: 243, inScope: 8410 },
    hidden: { shown: 60, matching: 242, inScope: 8410 },
    live: { shown: 60, matching: 245, inScope: 8412 },
    terminal: { shown: 60, matching: 243, inScope: 8410 },
    fallback: { shown: 60, matching: 243, inScope: 5000 }
  };
  if (state.around) return { shown: 60, matching: 121, inScope: values[state.scenario].inScope };
  return values[state.scenario];
}

function selectedEvent() { return state.selected ? EVENTS.find((event) => event.id === state.selected) ?? null : null; }

function criteriaForScenario(scenario) {
  const criteria = [
    { facet: "Subscription mode", polarity: "include", values: ["COMMAND"] },
    { facet: "Provenance", polarity: "exclude", values: ["LOCAL"] }
  ];
  if (scenario === "hidden") criteria.push({ facet: "COMMAND key", polarity: "exclude", values: ["basket-alpha"] });
  return criteria;
}

function openFilter(trigger) {
  state.filterOpen = true;
  state.addStep = state.scenario === "high" || state.scenario === "unavailable";
  state.draftText = state.appliedText;
  state.restoreFocus = state.addStep ? "choose-values" : "filter-text";
  if (state.scenario === "high" || state.scenario === "unavailable") state.explorerFacet = "COMMAND key";
  syncUrl();
  render();
  if (trigger) state.lastFilterTrigger = trigger;
}

function closeFilter(apply) {
  if (apply) {
    state.appliedText = state.draftText.trim();
    state.flash = "The complete Filter was applied atomically at committed boundary #8,410.";
  }
  state.filterOpen = false;
  state.addStep = false;
  state.explorerOpen = false;
  state.restoreFocus = "filter-trigger";
  syncUrl();
  render();
}

function openExplorer() {
  state.explorerOpen = true;
  state.valueFocus = 0;
  state.restoreFocus = "value-search";
  syncUrl();
  render();
}

function closeExplorer() {
  state.explorerOpen = false;
  state.restoreFocus = "choose-values";
  render();
}

function cycleVariant(direction) {
  const keys = Object.keys(VARIANTS);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.filterOpen = false;
  state.explorerOpen = false;
  state.addStep = false;
  syncUrl();
  render();
}

function immediateCriterion(action) {
  const event = selectedEvent();
  if (!event) return;
  if (action === "include-item") {
    upsertCriterion("Item", "include", event.item);
    state.flash = `Item includes ${event.item}. Selection and Context were preserved.`;
  }
  if (action === "exclude-key") {
    upsertCriterion("COMMAND key", "exclude", event.key);
    state.scenario = "hidden";
    state.flash = "The selected Evidence is hidden; its exact COMMAND key blocker is available to Reveal.";
  }
  if (action === "around-evidence") {
    state.around = true;
    state.flash = `Around Evidence now uses ${event.id} ±5 seconds and replaced only the prior Around criterion.`;
  }
  state.reset = false;
  syncUrl();
  render();
}

function upsertCriterion(facet, polarity, value) {
  state.appliedCriteria = state.appliedCriteria.filter((criterion) => criterion.facet !== facet);
  state.appliedCriteria.push({ facet, polarity, values: [value] });
}

function restoreFocus() {
  if (!state.restoreFocus) return;
  const key = state.restoreFocus;
  state.restoreFocus = null;
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    target?.focus();
    if (target instanceof HTMLInputElement) target.setSelectionRange(target.value.length, target.value.length);
  });
}

function syncUrl() {
  const next = new URLSearchParams({ variant: state.variant, frame: state.frame, theme: state.theme, scenario: state.scenario });
  if (state.filterOpen) next.set("filterOpen", "1");
  if (state.findOpen) next.set("find", "1");
  if (state.findText) next.set("findText", state.findText);
  if (state.selected) next.set("event", state.selected);
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

document.addEventListener("input", (event) => {
  if (event.target.id === "filter-text") state.draftText = event.target.value;
  if (event.target.id === "find-text") state.findText = event.target.value;
  if (event.target.id === "value-search") state.explorerSearch = event.target.value;
});

document.addEventListener("change", (event) => {
  const control = event.target.dataset.control;
  if (control === "frame") state.frame = event.target.value;
  if (control === "theme") state.theme = event.target.value;
  if (control === "scenario") {
    state.scenario = event.target.value;
    state.selected = state.scenario === "hidden" ? "event-0068" : "event-0075";
    state.appliedCriteria = criteriaForScenario(state.scenario);
    state.filterOpen = state.scenario === "high" || state.scenario === "unavailable";
    state.addStep = state.filterOpen;
    state.explorerOpen = state.filterOpen;
    state.explorerFacet = "COMMAND key";
    state.reset = false;
    state.flash = "";
  }
  if (event.target.id === "facet-select") state.explorerFacet = event.target.value;
  syncUrl();
  render();
});

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-action]");
  const action = target?.dataset.action;
  if (!action) return;
  if (action === "previous-variant") return cycleVariant(-1);
  if (action === "next-variant") return cycleVariant(1);
  if (action === "edit-filter") return state.filterOpen ? closeFilter(false) : openFilter(target.dataset.focusKey ?? "filter-trigger");
  if (action === "cancel-filter") return closeFilter(false);
  if (action === "apply-filter") return closeFilter(true);
  if (action === "add-criterion") { state.addStep = true; state.restoreFocus = "facet-select"; return render(); }
  if (action === "open-explorer") return openExplorer();
  if (action === "close-explorer") return closeExplorer();
  if (action === "apply-values") {
    const chosen = [...state.valueDraft.entries()].filter(([, polarity]) => polarity !== "neutral");
    const include = chosen.filter(([, polarity]) => polarity === "include").map(([key]) => key.split(":").slice(1).join(":"));
    const exclude = chosen.filter(([, polarity]) => polarity === "exclude").map(([key]) => key.split(":").slice(1).join(":"));
    state.appliedCriteria = state.appliedCriteria.filter((criterion) => criterion.facet !== state.explorerFacet);
    if (include.length) state.appliedCriteria.push({ facet: state.explorerFacet, polarity: "include", values: include });
    if (exclude.length) state.appliedCriteria.push({ facet: state.explorerFacet, polarity: "exclude", values: exclude });
    state.explorerOpen = false;
    state.restoreFocus = "choose-values";
    return render();
  }
  if (action === "set-polarity") {
    const key = `${state.explorerFacet}:${target.dataset.value}`;
    const current = state.valueDraft.get(key);
    state.valueDraft.set(key, current === target.dataset.polarity ? "neutral" : target.dataset.polarity);
    const optionIndex = target.closest(".value-option")?.querySelector("[data-value-index]")?.dataset.valueIndex;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-value-index="${optionIndex}"]`)?.focus());
    return;
  }
  if (action === "previous-values") { state.explorerPage = Math.max(1, state.explorerPage - 1); state.valueFocus = 0; return render(); }
  if (action === "next-values") { state.explorerPage = Math.min(77, state.explorerPage + 1); state.valueFocus = 0; return render(); }
  if (action === "remove-criterion") { state.appliedCriteria.splice(Number(target.dataset.index), 1); return render(); }
  if (action === "remove-around") { state.around = false; return render(); }
  if (action === "reset-filter") {
    state.reset = true; state.appliedText = ""; state.appliedCriteria = []; state.around = false; state.scenario = "primary"; state.flash = "All Filter criteria were reset in one step."; syncUrl(); return render();
  }
  if (action === "select-event") { state.selected = target.dataset.event; syncUrl(); return render(); }
  if (["include-item", "exclude-key", "around-evidence"].includes(action)) return immediateCriterion(action);
  if (action === "reveal-selected") { state.scenario = "primary"; state.appliedCriteria = state.appliedCriteria.filter((criterion) => criterion.facet !== "COMMAND key"); state.flash = "Removed only the COMMAND key exclusion blocking the selected Evidence."; syncUrl(); return render(); }
  if (action === "clear-selection") { state.selected = ""; return render(); }
  if (action === "dismiss-flash") { state.flash = ""; return render(); }
  if (action === "open-find") { state.findOpen = true; state.restoreFocus = "find-input"; syncUrl(); return render(); }
  if (action === "close-find") { state.findOpen = false; state.restoreFocus = "find-trigger"; syncUrl(); return render(); }
  if (action === "find-prev" || action === "find-next") { state.findIndex = (state.findIndex + (action === "find-next" ? 1 : 16)) % 17; state.restoreFocus = "find-input"; return render(); }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.explorerOpen) { event.preventDefault(); event.stopPropagation(); closeExplorer(); return; }
    if (state.addStep) { event.preventDefault(); event.stopPropagation(); state.addStep = false; state.restoreFocus = "add-criterion"; render(); return; }
    if (state.filterOpen) { event.preventDefault(); event.stopPropagation(); closeFilter(false); return; }
    return;
  }
  const option = event.target.closest("[data-value-index]");
  if (option && ["ArrowDown", "ArrowUp", "Home", "End", " "].includes(event.key)) {
    event.preventDefault();
    const options = [...document.querySelectorAll("[data-value-index]")];
    let next = Number(option.dataset.valueIndex);
    if (event.key === "ArrowDown") next = Math.min(options.length - 1, next + 1);
    if (event.key === "ArrowUp") next = Math.max(0, next - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = options.length - 1;
    if (event.key === " ") {
      const key = `${state.explorerFacet}:${option.dataset.value}`;
      state.valueDraft.set(key, state.valueDraft.get(key) === "include" ? "neutral" : "include");
      render();
      requestAnimationFrame(() => document.querySelector(`[data-value-index="${state.valueFocus}"]`)?.focus());
      return;
    }
    state.valueFocus = next;
    render();
    requestAnimationFrame(() => document.querySelector(`[data-value-index="${next}"]`)?.focus());
    return;
  }
  const evidenceRow = event.target.closest(".evidence-row");
  if (evidenceRow && ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    const rows = [...document.querySelectorAll(".evidence-row")];
    let index = rows.indexOf(evidenceRow);
    if (event.key === "ArrowDown") index = Math.min(rows.length - 1, index + 1);
    if (event.key === "ArrowUp") index = Math.max(0, index - 1);
    if (event.key === "Home") index = 0;
    if (event.key === "End") index = rows.length - 1;
    const nextId = rows[index]?.dataset.event ?? evidenceRow.dataset.event;
    state.selected = nextId;
    state.restoreFocus = nextId;
    syncUrl();
    render();
    return;
  }
  if (!event.target.closest(".workbench") && !event.target.closest(".prototype-controls") && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    cycleVariant(event.key === "ArrowRight" ? 1 : -1);
  }
});

function markFind(value) {
  const query = state.findText.trim();
  if (!query) return escapeHtml(value);
  const expression = new RegExp(escapeRegExp(query), "ig");
  let last = 0;
  let result = "";
  for (const match of value.matchAll(expression)) {
    result += escapeHtml(value.slice(last, match.index));
    result += `<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return result + escapeHtml(value.slice(last));
}

function formatNumber(value) { return new Intl.NumberFormat("en-US").format(value); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', "&quot;"); }

render();
