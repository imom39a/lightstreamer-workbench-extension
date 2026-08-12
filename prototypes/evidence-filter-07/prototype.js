import {
  FACETS,
  FACET_LABELS,
  createEvidenceFixture,
  createFilter,
  createMemoryAdapter,
  createIndexedDbAdapter,
  mutateFilter,
  normalizeSnapshot,
  runAdapterParity,
  typedValue
} from "./query-model.js";

const FRAMES = Object.freeze({
  compact: "563 × 700 compact",
  normal: "900 × 700 normal",
  shallow: "900 × 320 shallow",
  wide: "1440 × 900 wide"
});

const SCENARIOS = Object.freeze({
  primary: "Primary incorrect-state investigation",
  high: "10,000 Evidence · 3,842 COMMAND keys",
  empty: "Unobserved key · exact zero",
  contradiction: "Cross-facet empty intersection",
  scopeConflict: "Scope and Filter conflict",
  unavailable: "One facet discovery unavailable",
  limited: "Limited Coverage · normal storage",
  fallback: "Lower memory capacity · Useful Coverage",
  hidden: "Hidden selected Evidence and Reveal",
  retired: "Retired identity with retained Evidence",
  clear: "Successful Clear and restoration barrier",
  terminal: "Terminal final committed boundary",
  live: "Passive Capture growth",
  unsupported: "Unsupported Criterion · fail closed"
});

const WALKTHROUGHS = Object.freeze({
  primary: Object.freeze({
    title: "Incorrect Local COMMAND state",
    description: "Start with one suspicious Local update, narrow by Item and Provenance, preserve Find and selection, then reset only Filter.",
    steps: Object.freeze([
      { label: "1 · Select suspicious Local update", action: "walk-select-local" },
      { label: "2 · Include its Item", action: "include-item" },
      { label: "3 · Exclude LOCAL", action: "exclude-local" },
      { label: "4 · Reveal selected Evidence", action: "reveal-selected" },
      { label: "5 · Reset Filter", action: "reset-filter" }
    ])
  }),
  authoring: Object.freeze({
    title: "Draft isolation and high-cardinality values",
    description: "Open the inline constructor, stage free text, inspect exact page 37, Cancel unchanged, then reopen and Apply once.",
    steps: Object.freeze([
      { label: "1 · Open Filter", action: "open-filter" },
      { label: "2 · Stage text", action: "walk-stage-text" },
      { label: "3 · Open key page 37", action: "walk-open-page-37" },
      { label: "4 · Stage a key", action: "walk-stage-value" },
      { label: "5 · Cancel unchanged", action: "cancel-filter" },
      { label: "6 · Reopen and Apply", action: "walk-reopen-apply" }
    ])
  }),
  lifecycle: Object.freeze({
    title: "History lifecycle",
    description: "Add ordinary and Around criteria, Clear the interval, then inspect the final terminal boundary without resurrecting old Evidence.",
    steps: Object.freeze([
      { label: "1 · Add ordinary + Around", action: "walk-add-around" },
      { label: "2 · Clear History", action: "clear-history" },
      { label: "3 · Attempt old read point", action: "walk-query-old-point" },
      { label: "4 · Load terminal fixture", action: "walk-terminal" }
    ])
  })
});

const params = new URLSearchParams(location.search);
const initialScenario = SCENARIOS[params.get("scenario")] ? params.get("scenario") : "primary";
const initialFrame = FRAMES[params.get("frame")] ? params.get("frame") : "normal";
const RECORDS = createEvidenceFixture(10_000);
const RECORD_BY_ID = new Map(RECORDS.map((record) => [record.eventId, record]));
const VALUE_CATALOG = buildValueCatalog(RECORDS);
const memoryAdapter = createMemoryAdapter(RECORDS);
let indexedAdapter = null;
const initialHistory = historyForScenario(initialScenario);

const state = {
  frame: initialFrame,
  theme: ["dark", "light"].includes(params.get("theme")) ? params.get("theme") : "dark",
  scenario: initialScenario,
  walkthrough: WALKTHROUGHS[params.get("walkthrough")] ? params.get("walkthrough") : "primary",
  walkStep: 0,
  history: initialHistory,
  coverage: initialScenario === "limited" || initialScenario === "terminal" ? "LIMITED" : "USEFUL",
  captureOperation: initialScenario === "terminal" ? "STOPPED" : "RUNNING",
  scope: scopeForScenario(initialScenario),
  filter: filterForScenario(initialScenario),
  composer: { open: false, draft: null, baseRevision: null, addStep: false, explorerOpen: false, facet: "key", search: "", offset: 0, focusIndex: 0, returnFocus: "filter-trigger" },
  snapshot: null,
  snapshotError: null,
  parity: [],
  parityRunning: true,
  selected: selectedForScenario(initialScenario),
  focused: selectedForScenario(initialScenario),
  context: "selected-evidence",
  find: { open: true, text: "state mismatch", current: null },
  view: initialScenario === "live" ? "LIVE" : "FROZEN",
  frozenBoundary: initialScenario === "live" ? null : initialHistory.committedBoundary,
  newerMatching: 0,
  investigationRevision: 1,
  restorationBarrier: 0,
  flash: "",
  log: ["Prepared 10,000 deterministic accepted Evidence records."],
  queryGeneration: 0,
  publishedQueryGeneration: 0,
  restoreFocus: null,
  oldReadPointProbe: null,
  compactContextOpen: false
};

const readiness = bootstrap();

async function bootstrap() {
  try {
    indexedAdapter = await createIndexedDbAdapter(RECORDS);
    await prepareAdapters(initialScenario);
    state.log.unshift("Opened disposable IndexedDB adapter with the same 10,000-record truth fixture.");
    await refreshSnapshot("Initial coherent query");
    await refreshParity();
  } catch (error) {
    state.parityRunning = false;
    state.snapshotError = String(error);
    state.log.unshift(`Prototype bootstrap failed: ${String(error)}`);
    render();
  }
}

async function prepareAdapters(scenario) {
  const options = scenario === "terminal"
    ? { terminal: true, terminalReason: "CAPACITY_LIMIT_REACHED" }
    : {};
  await Promise.all([memoryAdapter.reset(options), indexedAdapter.reset(options)]);
  if (scenario === "clear") await Promise.all([memoryAdapter.clear(), indexedAdapter.clear()]);
}

function historyForScenario(scenario) {
  if (scenario === "clear") return Object.freeze({ intervalId: "H8", retainedFirstSequence: 1, committedBoundary: null, terminal: false, capacityTier: "NORMAL", storage: "indexeddb" });
  if (scenario === "terminal") return Object.freeze({ intervalId: "H7", retainedFirstSequence: 1, committedBoundary: 10_000, terminal: true, terminalReason: "CAPACITY_LIMIT_REACHED", capacityTier: "NORMAL", storage: "indexeddb" });
  if (scenario === "fallback") return Object.freeze({ intervalId: "H7", retainedFirstSequence: 1, committedBoundary: 5_000, terminal: false, capacityTier: "LOWER", storage: "memory" });
  if (scenario === "live") return Object.freeze({ intervalId: "H7", retainedFirstSequence: 1, committedBoundary: 9_998, terminal: false, capacityTier: "NORMAL", storage: "indexeddb" });
  return Object.freeze({ intervalId: "H7", retainedFirstSequence: 1, committedBoundary: 10_000, terminal: false, capacityTier: "NORMAL", storage: "indexeddb" });
}

function scopeForScenario(scenario) {
  if (scenario === "scopeConflict") {
    return Object.freeze({ kind: "facet", facet: "subscription", value: value("subscription", "sub-command-1") });
  }
  return Object.freeze({ kind: "page" });
}

function filterForScenario(scenario) {
  let filter = createFilter(1);
  if (scenario === "empty") filter = applyOperations(filter, [{ type: "set-polarity", facet: "key", polarity: "include", value: typedValue("key", "string", "order-missing-404", "order-missing-404") }]);
  if (scenario === "contradiction") filter = applyOperations(filter, [
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") },
    { type: "set-polarity", facet: "kind", polarity: "include", value: value("kind", "session-status") }
  ]);
  if (scenario === "scopeConflict") filter = applyOperations(filter, [
    { type: "set-polarity", facet: "subscription", polarity: "include", value: value("subscription", "sub-merge-2") }
  ]);
  if (scenario === "hidden") filter = applyOperations(filter, [
    { type: "set-polarity", facet: "provenance", polarity: "exclude", value: value("provenance", "LOCAL") }
  ]);
  if (scenario === "retired") filter = applyOperations(filter, [
    { type: "set-polarity", facet: "subscription", polarity: "include", value: value("subscription", "sub-retired-0") }
  ]);
  if (scenario === "unsupported") filter = applyOperations(filter, [
    { type: "add-unsupported", entry: { id: "future:diagnostic-severity:v9", label: "Diagnostic severity from schema v9" } }
  ]);
  return filter;
}

function selectedForScenario(scenario) {
  if (scenario === "hidden") return findRecord((record) => record.provenance === "LOCAL" && record.mode === "COMMAND")?.eventId ?? "event-09982";
  if (scenario === "retired") return findRecord((record) => record.subscription === "sub-retired-0")?.eventId ?? "event-00119";
  return findRecord((record) => record.provenance === "LOCAL" && record.mode === "COMMAND")?.eventId ?? "event-09982";
}

function findRecord(predicate) {
  for (let index = RECORDS.length - 1; index >= 0; index -= 1) if (predicate(RECORDS[index])) return RECORDS[index];
  return null;
}

function buildValueCatalog(records) {
  const catalog = {};
  for (const facet of FACETS) catalog[facet] = new Map();
  for (const record of records) {
    for (const [facet, facetValue] of Object.entries(record.facets)) catalog[facet].set(facetValue.value, facetValue);
  }
  return catalog;
}

function value(facet, raw) {
  const existing = VALUE_CATALOG[facet]?.get(raw);
  if (existing) return existing;
  return typedValue(facet, typeof raw, raw, String(raw));
}

function applyOperations(filter, operations) {
  const outcome = mutateFilter(filter, { expectedRevision: filter.revision, operations });
  if (!outcome.ok) throw new Error(outcome.problem);
  return outcome.filter;
}

function queryRequest(overrides = {}) {
  const discover = overrides.discover ?? (state.composer.explorerOpen
    ? [{ facet: state.composer.facet, search: state.composer.search, offset: state.composer.offset, size: 50, ...(state.scenario === "unavailable" ? { forceUnavailable: "DISCOVERY_FAILED" } : {}) }]
    : []);
  const history = overrides.history ?? (state.view === "FROZEN" && state.frozenBoundary !== null
    ? { ...state.history, committedBoundary: state.history.committedBoundary === null ? null : Math.min(state.history.committedBoundary, state.frozenBoundary) }
    : state.history);
  return Object.freeze({
    history,
    scope: overrides.scope ?? state.scope,
    filter: overrides.filter ?? state.filter,
    page: overrides.page ?? { offset: 0, size: 60 },
    discover,
    lookup: overrides.lookup === undefined ? (state.selected ? { eventId: state.selected } : null) : overrides.lookup,
    find: overrides.find === undefined
      ? (state.find.open && state.find.text ? { text: state.find.text, currentEventId: state.find.current } : null)
      : overrides.find
  });
}

async function refreshSnapshot(reason) {
  if (!indexedAdapter) return;
  const generation = ++state.queryGeneration;
  const adapter = state.history.storage === "memory" ? memoryAdapter : indexedAdapter;
  try {
    const result = await adapter.query(queryRequest());
    if (generation !== state.queryGeneration) return;
    state.snapshot = result.value;
    state.snapshotError = null;
    state.publishedQueryGeneration = generation;
    state.find.current = state.snapshot.find?.currentEventId ?? null;
    if (state.selected && state.snapshot.lookup?.state === "RETAINED" && !state.snapshot.lookup.matchesFilter) {
      state.focused = state.snapshot.lookup.nearestMatchingEventId ?? "filter-trigger";
      state.restoreFocus = state.focused;
    } else if (state.selected && state.snapshot.page.evidence.some((record) => record.eventId === state.selected)) {
      state.focused = state.selected;
    } else if (state.selected && state.snapshot.lookup?.state === "NOT_RETAINED") {
      state.focused = "filter-trigger";
      state.restoreFocus = "filter-trigger";
    }
    state.log.unshift(`${reason}: published query generation ${generation} at ${readPointLabel(state.snapshot)}.`);
  } catch (error) {
    if (generation !== state.queryGeneration) return;
    state.snapshotError = error.code ? `${error.code}: ${error.message}` : String(error);
    state.publishedQueryGeneration = generation;
    state.log.unshift(`${reason}: ${state.snapshotError}`);
  }
  render();
}

async function refreshParity() {
  if (!indexedAdapter) return;
  state.parityRunning = true;
  render();
  const base = createFilter(1);
  const textAndMode = applyOperations(base, [
    { type: "set-text", text: "state update" },
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") }
  ]);
  const structured = applyOperations(base, [
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") },
    { type: "set-polarity", facet: "provenance", polarity: "exclude", value: value("provenance", "LOCAL") }
  ]);
  const counterfactual = applyOperations(structured, [
    { type: "set-polarity", facet: "key", polarity: "include", value: value("key", "order-00001") }
  ]);
  const activeZero = applyOperations(base, [
    { type: "set-polarity", facet: "key", polarity: "include", value: typedValue("key", "string", "order-missing-404", "order-missing-404") }
  ]);
  const activeConcrete = applyOperations(base, [
    { type: "set-polarity", facet: "key", polarity: "include", value: value("key", "order-03842") }
  ]);
  const baseZeroActive = applyOperations(activeZero, [
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") },
    { type: "set-polarity", facet: "kind", polarity: "include", value: value("kind", "session-status") }
  ]);
  const aroundAnchor = RECORDS[4_999];
  const around = applyOperations(base, [{ type: "set-around", around: { intervalId: "H7", anchorEventId: aroundAnchor.eventId, anchorSequence: aroundAnchor.sequence, anchorTimestamp: aroundAnchor.timestamp, start: aroundAnchor.timestamp - 35, end: aroundAnchor.timestamp + 35 } }]);
  const wrongIntervalAround = applyOperations(base, [{ type: "set-around", around: { intervalId: "H8", anchorEventId: aroundAnchor.eventId, anchorSequence: aroundAnchor.sequence, anchorTimestamp: aroundAnchor.timestamp, start: aroundAnchor.timestamp - 35, end: aroundAnchor.timestamp + 35 } }]);
  const findAnchor = findRecord((record) => record.provenance === "SERVER" && record.key && record.summary.includes("state update"));
  const findNearest = applyOperations(base, [{ type: "set-polarity", facet: "key", polarity: "exclude", value: findAnchor.facets.key }]);
  const primaryHistory = historyForScenario("primary");
  const cases = [
    { name: "Common page", request: queryRequest({ filter: base, discover: [], lookup: null, find: null }) },
    { name: "Structured posting path", request: queryRequest({ filter: structured, discover: [], lookup: null, find: null }) },
    { name: "Structured + free text", request: queryRequest({ filter: textAndMode, discover: [], lookup: null, find: null }) },
    { name: "Counterfactual self-facet", request: queryRequest({ filter: counterfactual, discover: [{ facet: "key", offset: 0, size: 50 }], lookup: null, find: null }) },
    { name: "Counterfactual key page 37", request: queryRequest({ filter: base, discover: [{ facet: "key", offset: 1_800, size: 50 }], lookup: null, find: null }) },
    { name: "Active zero pinned", request: queryRequest({ filter: activeZero, discover: [{ facet: "key", offset: 0, size: 50 }], lookup: null, find: null }) },
    { name: "Active zero pinned across search and page", request: queryRequest({ filter: activeZero, discover: [{ facet: "key", search: "order-03842", offset: 0, size: 50 }], lookup: null, find: null }) },
    { name: "Active concrete pinned outside search", request: queryRequest({ filter: activeConcrete, discover: [{ facet: "key", search: "order-00001", offset: 0, size: 50 }], lookup: null, find: null }) },
    { name: "Base zero remains distinct from active zero", request: queryRequest({ filter: baseZeroActive, discover: [{ facet: "key", offset: 0, size: 50 }], lookup: null, find: null }) },
    { name: "Around equal timestamps", request: queryRequest({ filter: around, discover: [], lookup: { eventId: aroundAnchor.eventId }, find: null }) },
    { name: "Around interval isolation", request: queryRequest({ filter: wrongIntervalAround, discover: [], lookup: { eventId: aroundAnchor.eventId }, find: null }) },
    { name: "Find at same read point", request: queryRequest({ filter: base, discover: [], lookup: null, find: { text: "state mismatch", currentEventId: null } }) },
    { name: "Find nearest surviving match", request: queryRequest({ filter: findNearest, discover: [], lookup: null, find: { text: "state update", currentEventId: findAnchor.eventId } }) },
    { name: "Lower 5,000 prefix", request: queryRequest({ history: { ...primaryHistory, committedBoundary: 5_000, storage: "memory", capacityTier: "LOWER" }, filter: base, discover: [{ facet: "provenance", size: 50 }], lookup: null, find: null }) }
  ];
  state.parity = await runAdapterParity(memoryAdapter, indexedAdapter, cases);
  state.parityRunning = false;
  state.log.unshift(`Adapter parity: ${state.parity.filter((entry) => entry.equal).length}/${state.parity.length} semantic snapshots match.`);
  render();
}

async function runSemanticEdgeProbes() {
  const base = createFilter(1);
  const missing = typedValue("key", "string", "order-missing-404", "order-missing-404");
  const activeZero = applyOperations(base, [{ type: "set-polarity", facet: "key", polarity: "include", value: missing }]);
  const activeConcrete = applyOperations(base, [{ type: "set-polarity", facet: "key", polarity: "include", value: value("key", "order-03842") }]);
  const baseZeroActive = applyOperations(activeZero, [
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") },
    { type: "set-polarity", facet: "kind", polarity: "include", value: value("kind", "session-status") }
  ]);
  const anchor = RECORDS[4_999];
  const wrongInterval = applyOperations(base, [{ type: "set-around", around: { intervalId: "H8", anchorEventId: anchor.eventId, anchorSequence: anchor.sequence, anchorTimestamp: anchor.timestamp, start: anchor.timestamp - 35, end: anchor.timestamp + 35 } }]);
  const requests = {
    activeZeroSearch: queryRequest({ history: historyForScenario("primary"), scope: { kind: "page" }, filter: activeZero, discover: [{ facet: "key", search: "order-03842", offset: 0, size: 50 }], lookup: null, find: null }),
    activeConcreteOutsideSearch: queryRequest({ history: historyForScenario("primary"), scope: { kind: "page" }, filter: activeConcrete, discover: [{ facet: "key", search: "order-00001", offset: 0, size: 50 }], lookup: null, find: null }),
    baseZeroWithPinned: queryRequest({ history: historyForScenario("primary"), scope: { kind: "page" }, filter: baseZeroActive, discover: [{ facet: "key", offset: 0, size: 50 }], lookup: null, find: null }),
    wrongIntervalAround: queryRequest({ history: historyForScenario("primary"), scope: { kind: "page" }, filter: wrongInterval, discover: [], lookup: { eventId: anchor.eventId }, find: null })
  };
  const output = {};
  for (const [name, request] of Object.entries(requests)) {
    const [memory, indexeddb] = await Promise.all([memoryAdapter.query(request), indexedAdapter.query(request)]);
    output[name] = {
      memory: normalizeSnapshot(memory.value),
      indexeddb: normalizeSnapshot(indexeddb.value),
      indexeddbTelemetry: indexeddb.value.telemetry
    };
  }
  return output;
}

async function runPrototypeBenchmarks(iterations = 12) {
  if (!indexedAdapter) await readiness;
  const base = createFilter(1);
  const structured = applyOperations(base, [
    { type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") },
    { type: "set-polarity", facet: "provenance", polarity: "exclude", value: value("provenance", "LOCAL") }
  ]);
  const residual = applyOperations(structured, [{ type: "set-text", text: "state update" }]);
  const cases = [
    { name: "recent-page", budgetMs: 50, request: queryRequest({ history: historyForScenario("primary"), filter: base, discover: [], lookup: null, find: null }) },
    { name: "structured", budgetMs: 100, request: queryRequest({ history: historyForScenario("primary"), filter: structured, discover: [], lookup: null, find: null }) },
    { name: "residual-text", budgetMs: 500, request: queryRequest({ history: historyForScenario("primary"), filter: residual, discover: [], lookup: null, find: null }) },
    { name: "exact-key-page-37", budgetMs: 500, request: queryRequest({ history: historyForScenario("primary"), filter: base, discover: [{ facet: "key", offset: 1_800, size: 50 }], lookup: null, find: null }) }
  ];
  const adapters = [{ name: "memory", adapter: memoryAdapter }, { name: "indexeddb", adapter: indexedAdapter }];
  const output = [];
  for (const { name: adapterName, adapter } of adapters) {
    for (const testCase of cases) {
      await adapter.query(testCase.request);
      const samples = [];
      for (let index = 0; index < iterations; index += 1) {
        const started = performance.now();
        await adapter.query(testCase.request);
        samples.push(performance.now() - started);
      }
      const sorted = [...samples].sort((left, right) => left - right);
      const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
      output.push({
        adapter: adapterName,
        case: testCase.name,
        iterations,
        p95Ms: Number(p95.toFixed(2)),
        medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
        budgetMs: testCase.budgetMs,
        withinBudget: p95 <= testCase.budgetMs
      });
    }
  }
  return output;
}

function nearestVisibleSequence(records, sequence) {
  return records.reduce((best, record) => {
    if (!best) return record;
    const delta = Math.abs(record.sequence - sequence);
    const bestDelta = Math.abs(best.sequence - sequence);
    return delta < bestDelta || (delta === bestDelta && record.sequence < best.sequence) ? record : best;
  }, null);
}

function render() {
  document.documentElement.dataset.theme = state.theme;
  const walkthrough = WALKTHROUGHS[state.walkthrough];
  const snapshot = state.snapshot;
  const selected = snapshot?.lookup?.state === "RETAINED" ? snapshot.lookup.evidence : null;
  document.querySelector("#app").innerHTML = `<section class="stage frame-${state.frame}">
    ${renderReviewBar(walkthrough)}
    <section class="prototype-frame">
      <section class="workbench" data-layout="${state.frame}" aria-label="Integrated contextual Evidence filtering prototype">
        ${renderOperating()}
        ${renderScopeStrip()}
        <div class="workspace" role="group" aria-label="Scoped Evidence Workspace">
          ${renderScopePane()}<div class="splitter scope-split" role="separator" aria-label="Resize Scope"></div>
          ${renderEvidence(snapshot, selected)}<div class="splitter context-split" role="separator" aria-label="Resize Context"></div>
          ${renderContext(selected, state.selected)}
          ${state.composer.explorerOpen ? renderExplorer() : ""}
        </div>
        ${renderStatus()}
      </section>
    </section>
    ${renderStateConsole()}
    ${renderPrototypeControls()}
    <div class="question-tag">PROTOTYPE · Does one atomic query truthfully drive the chosen contextual UI?</div>
  </section>`;
  if (state.composer.explorerOpen) {
    for (const element of document.querySelectorAll(".workspace > :not(.workspace-overlay)")) element.inert = true;
  }
  restoreFocus();
}

function renderReviewBar(walkthrough) {
  return `<section class="review-bar" aria-label="Prototype walkthrough">
    <div class="review-title"><span class="eyebrow">Build 7 integrated proof</span><strong>${walkthrough.title}</strong><span>${walkthrough.description}</span></div>
    <div class="walkthrough"><div class="walkthrough-steps">${walkthrough.steps.map((step, index) => `<button data-action="${step.action}" data-walk-index="${index}" data-current="${index === state.walkStep}">${step.label}</button>`).join("")}</div><p>Every visible count and row comes from the selected adapter’s atomic Evidence Snapshot.</p></div>
    <div class="review-actions"><button data-action="reset-walkthrough">Reset walkthrough</button><button data-action="run-parity" ${state.parityRunning ? "disabled" : ""}>${state.parityRunning ? "Checking adapters…" : "Re-run adapter parity"}</button></div>
  </section>`;
}

function renderOperating() {
  const matchCount = state.snapshot?.find?.total ?? 0;
  const currentOrdinal = state.snapshot?.find?.currentOrdinal ?? 0;
  return `<header class="operating">
    <strong>Capture ${state.captureOperation}</strong>
    <span class="${state.coverage === "LIMITED" ? "coverage-limited" : ""}">Coverage ${state.coverage}</span>
    <span>View ${state.view}${state.view === "FROZEN" ? ` · #${formatNumber(state.frozenBoundary ?? 0)} · ${state.newerMatching} newer` : " · follows newest matching"}</span>
    <div class="operating-actions">
      ${state.find.open ? `<div class="find" role="search" aria-label="Find in matching Evidence"><label for="find-text">Find</label><input id="find-text" data-focus-key="find-input" value="${escapeAttribute(state.find.text)}"><span>${matchCount ? `${currentOrdinal} of ${formatNumber(matchCount)}` : "0 matches"}</span><button data-action="find-prev">Previous</button><button data-action="find-next">Next</button><button data-action="close-find">Close Find</button></div>` : `<button data-action="open-find" data-focus-key="find-trigger">Find</button>`}
      <button data-action="open-filter" data-focus-key="filter-trigger" aria-expanded="${state.composer.open}">Filter</button>
      <button>More actions</button>
    </div>
  </header>`;
}

function renderScopeStrip() {
  const label = state.scope.kind === "page" ? "Inspected page" : `${FACET_LABELS[state.scope.facet]} ${state.scope.value.label}`;
  return `<nav class="scope-strip" aria-label="Current runtime Scope"><button>Scope</button><strong>${escapeHtml(label)}</strong><span>${state.scope.kind === "page" ? "Structural Page Scope" : "Structural Subscription Scope"}</span></nav>`;
}

function renderScopePane() {
  const scopeConflict = state.scenario === "scopeConflict";
  return `<nav class="pane scope-pane" aria-label="Structural runtime Scope"><header class="pane-header"><span class="pane-title"><span class="eyebrow">Runtime Scope</span><strong>Inspected page</strong></span><button>Collapse Scope</button></header><div class="scope-tree" role="tree">
    ${scopeNode("Inspected page", "10,000 retained Evidence", 1, state.scope.kind === "page")}
    ${scopeNode("Client client-main", "Session session-9f2a", 2)}
    ${scopeNode("COMMAND Subscription sub-command-1", "Active", 3, scopeConflict)}
    ${scopeNode("MERGE Subscription sub-merge-2", "Active", 3)}
    ${scopeNode("COMMAND Subscription sub-retired-0", "Retired · retained Evidence", 3)}
  </div></nav>`;
}

function scopeNode(label, detail, depth, selected = false) {
  return `<button class="scope-node" role="treeitem" aria-level="${depth}" aria-selected="${selected}" style="--depth:${depth - 1}"><span>${escapeHtml(label)}</span><em>${escapeHtml(detail)}</em></button>`;
}

function renderEvidence(snapshot, selected) {
  const shown = snapshot?.page.evidence.length ?? 0;
  const matching = snapshot?.totals.matching ?? 0;
  const inScope = snapshot?.totals.inScope ?? 0;
  const hidden = Boolean(snapshot?.lookup?.state === "RETAINED" && !snapshot.lookup.matchesFilter);
  return `<section class="pane evidence-pane" aria-label="Ordered Evidence">
    <header class="pane-header"><span class="pane-title"><span class="eyebrow">Ordered Evidence</span><strong>${state.scope.kind === "page" ? "Inspected page" : state.scope.value.label}</strong></span><button data-action="open-context" data-focus-key="context-trigger">Open selected Context</button></header>
    ${renderFilterSummary(shown, matching, inScope)}
    ${state.composer.open ? renderComposer() : ""}
    ${renderCondition(snapshot)}
    ${hidden ? `<div class="condition info"><strong>Selected Evidence is outside current results</strong><span>${escapeHtml(state.selected)} remains selected in Context. ${snapshot.lookup.blockingCriteria.length} exact blocker${snapshot.lookup.blockingCriteria.length === 1 ? "" : "s"}.</span><div class="condition-actions"><button data-action="reveal-selected">Reveal selected Evidence</button><button data-action="clear-selection">Clear selection</button></div></div>` : ""}
    <div class="evidence-window"><button ${!snapshot?.page.nextOffset ? "disabled" : ""}>Older</button><span>${shown ? `${shown} bounded rows rendered from ${formatNumber(matching)} matching Evidence` : "No matching Evidence"}</span><button disabled>Newer</button></div>
    ${shown ? `<div class="ledger" role="grid" aria-label="Filtered Ordered Evidence" tabindex="0"><div class="ledger-header" role="row"><span role="columnheader">Time / #</span><span role="columnheader">Source</span><span role="columnheader">Phase</span><span role="columnheader">Op</span><span role="columnheader">Evidence / object</span><span role="columnheader">COMMAND key</span></div>${snapshot.page.evidence.map(renderEvidenceRow).join("")}</div>` : renderEmpty(inScope)}
    ${selected && !hidden && snapshot?.page.evidence.some((record) => record.eventId === selected.eventId) ? renderRowActions(selected) : ""}
  </section>`;
}

function renderFilterSummary(shown, matching, inScope) {
  return `<section class="filter-summary" aria-label="Applied Evidence Filter"><div class="summary"><strong>Filter</strong><span>${escapeHtml(filterSummary(state.filter))}</span></div><div class="counts">${shown} shown · ${formatNumber(matching)} matching · ${formatNumber(inScope)} in Scope</div><div class="actions"><button data-action="open-filter" data-focus-key="summary-filter-trigger">${state.composer.open ? "Editing" : "Edit"} Filter</button><button data-action="reset-filter" ${isEmptyFilter(state.filter) ? "disabled" : ""}>Reset</button></div></section>`;
}

function renderComposer() {
  const draft = state.composer.draft;
  return `<section class="composer" aria-label="Filter constructor"><div class="composer-heading"><div><span class="eyebrow">Inline Filter constructor</span><strong>Draft · based on revision ${state.composer.baseRevision}</strong></div><span class="mono">Applied revision ${state.filter.revision}</span></div><label class="field-row" for="filter-text"><span>Evidence contains</span><input id="filter-text" data-focus-key="filter-text" value="${escapeAttribute(draft.text)}" placeholder="Free text across retained Evidence"><span>AND</span></label><ul class="criteria">${renderCriteria(draft)}</ul>${state.composer.addStep ? renderAddStep() : `<button data-action="add-criterion" data-focus-key="add-criterion">Add structured criterion</button>`}<div class="composer-actions"><button data-action="cancel-filter">Cancel</button><button class="primary" data-action="apply-filter">Apply Filter</button></div></section>`;
}

function renderCriteria(filter) {
  const rows = [];
  for (const [facet, facetState] of Object.entries(filter.facets)) {
    for (const entry of facetState.include) rows.push({ facet, polarity: "include", value: entry });
    for (const entry of facetState.exclude) rows.push({ facet, polarity: "exclude", value: entry });
  }
  if (filter.around) rows.push({ facet: "around", polarity: "include", value: { label: `${filter.around.anchorEventId} · ±5 seconds`, identity: "around" } });
  if (filter.unsupported.length) rows.push(...filter.unsupported.map((entry) => ({ facet: "unsupported", polarity: "exclude", value: { label: entry.label, identity: entry.id } })));
  if (!rows.length) return `<li class="criterion"><b>Structured</b><span>No structured criteria</span><span></span></li>`;
  return rows.map((entry) => `<li class="criterion ${entry.polarity}"><b>${entry.facet === "around" ? "Around Evidence" : entry.facet === "unsupported" ? "Unsupported" : FACET_LABELS[entry.facet]}</b><span>${entry.facet === "around" ? "Include interval" : entry.polarity === "include" ? "Include" : "Exclude"} · ${escapeHtml(entry.value.label)}</span><button data-action="remove-draft-criterion" data-facet="${entry.facet}" data-value="${escapeAttribute(entry.value.identity)}">Remove</button></li>`).join("");
}

function renderAddStep() {
  return `<div class="field-row"><label for="facet-select">Facet</label><select id="facet-select" data-focus-key="facet-select">${FACETS.map((facet) => `<option value="${facet}" ${state.composer.facet === facet ? "selected" : ""}>${FACET_LABELS[facet]}</option>`).join("")}</select><button data-action="open-explorer" data-focus-key="choose-values">Choose values</button></div>`;
}

function renderCondition(snapshot) {
  if (state.snapshotError) return `<div class="condition danger"><strong>Query unavailable</strong><span>${escapeHtml(state.snapshotError)}. The last coherent snapshot remains visible.</span><button data-action="refresh-query">Retry</button></div>`;
  if (state.flash) return `<div class="condition good"><strong>Investigation updated</strong><span>${escapeHtml(state.flash)}</span><button data-action="dismiss-flash">Dismiss</button></div>`;
  if (!snapshot) return `<div class="condition info"><strong>Preparing Evidence Snapshot</strong><span>Page, exact totals, requested discovery, and lookup will share one committed boundary.</span><span></span></div>`;
  if (snapshot.evaluation === "UNSUPPORTED_FILTER") return `<div class="condition danger"><strong>Unsupported Filter Criterion</strong><span>The Filter is preserved and fails closed at zero. No unsupported Criterion was ignored.</span><button data-action="open-filter">Inspect Filter</button></div>`;
  if (state.scenario === "contradiction") return `<div class="condition warning"><strong>Valid criteria, empty intersection</strong><span>Session Status Evidence has no COMMAND Subscription mode. Both Criteria remain active.</span><button data-action="open-filter">Edit Filter</button></div>`;
  if (state.scenario === "scopeConflict") return `<div class="condition warning"><strong>Scope and Filter conflict</strong><span>Scope remains Subscription sub-command-1; Filter still includes sub-merge-2. Workbench did not rescope.</span><button data-action="open-filter">Edit Filter</button></div>`;
  if (state.scenario === "empty") return `<div class="condition warning"><strong>0 matching Evidence</strong><span>The active unobserved key remains a valid zero-value intent.</span><button data-action="reset-filter">Reset Filter</button></div>`;
  if (state.scenario === "limited") return `<div class="condition warning"><strong>Coverage LIMITED</strong><span>Observation Coverage qualifies knowledge; storage remains IndexedDB at normal 10,000-record capacity and matching algebra is unchanged.</span><button>Open diagnostics</button></div>`;
  if (state.scenario === "fallback") return `<div class="condition warning"><strong>Lower memory capacity</strong><span>IndexedDB startup fallback selected 5,000-record memory capacity. Coverage remains USEFUL and query semantics match IndexedDB.</span><button>Open storage details</button></div>`;
  if (state.scenario === "retired") return `<div class="condition info"><strong>Subscription retired</strong><span>The typed criterion still matches its retained Evidence. New live actions are unavailable; no silent rescope occurred.</span><button>Explain retirement</button></div>`;
  if (state.scenario === "clear") return `<div class="condition info"><strong>History cleared</strong><span>Ordinary Criteria and Find remain; Around was removed; old restoration entries cannot resurrect H7 Evidence.</span><span></span></div>`;
  if (state.scenario === "terminal") return `<div class="condition info"><strong>Capture STOPPED</strong><span>This is the final exact result through committed Evidence boundary #10,000. Clear cannot restart acceptance.</span><span></span></div>`;
  if (state.scenario === "live") {
    if (state.history.committedBoundary < 10_000) return `<div class="condition info"><strong>Passive Capture ready</strong><span>The coherent read point is #9,998. Commit two accepted Evidence records to validate Live/Frozen independence.</span><button data-action="advance-capture">Commit 2 Evidence</button></div>`;
    if (state.view === "FROZEN") return `<div class="condition info"><strong>${state.newerMatching} newer matching</strong><span>Passive Capture advanced authoritative History to #10,000 while this Frozen read point, Filter, Find, selection, focus, and Context stayed inert.</span><button data-action="toggle-view">Go Live</button></div>`;
    return `<div class="condition info"><strong>2 Evidence committed</strong><span>Live published the next coherent snapshot at #10,000; Filter, Find, selection, focus, and Context stayed inert.</span><button data-action="toggle-view">Freeze Evidence</button></div>`;
  }
  return "";
}

function renderEvidenceRow(record) {
  const selected = record.eventId === state.selected;
  const findCurrent = record.eventId === state.find.current;
  return `<div class="evidence-row" role="row" tabindex="${record.eventId === state.focused ? "0" : "-1"}" aria-selected="${selected}" data-event="${record.eventId}" data-action="select-event" data-focus-key="${record.eventId}" data-find-current="${findCurrent}"><time role="gridcell">${formatTime(record.timestamp)} <small>#${record.sequence}</small></time><strong role="gridcell">${record.provenance ?? "RUNTIME"}</strong><span role="gridcell">${record.phase ?? "—"}</span><b role="gridcell">${record.operation ?? "—"}</b><span role="gridcell">${markFind(record.summary)}</span><code role="gridcell">${record.key ?? "—"}</code></div>`;
}

function renderEmpty(inScope) {
  return `<div class="empty"><strong>No Evidence matches this Filter</strong><span>Scope still contains ${formatNumber(inScope)} retained accepted Evidence records. Active Criteria remain visible above.</span><div><button data-action="open-filter">Edit Filter</button> <button data-action="reset-filter">Reset Filter</button></div></div>`;
}

function renderRowActions(record) {
  return `<div class="row-actions" aria-label="Filter actions for selected Evidence"><strong>Selected ${record.eventId}</strong>${record.item ? `<button data-action="include-item">Include this Item · ${escapeHtml(record.item)}</button>` : ""}${record.provenance ? `<button data-action="exclude-provenance">Exclude ${record.provenance}</button>` : ""}${record.key ? `<button data-action="exclude-key">Exclude this COMMAND key</button>` : ""}<button data-action="around-evidence">Around this Evidence · ±5 seconds</button></div>`;
}

function renderContext(selected, selectedIdentity) {
  const unretained = !selected && selectedIdentity;
  return `<aside class="pane context-pane" data-compact-open="${state.compactContextOpen}" aria-label="Selected Evidence Context"><header class="pane-header"><span class="pane-title"><span class="eyebrow">Context</span><strong>${selected?.eventId ?? selectedIdentity ?? "No selected Evidence"}</strong></span>${state.frame === "compact" ? `<button data-action="close-context" data-focus-key="close-context">Close Context</button>` : `<span class="mono">Selected Evidence</span>`}</header><div class="context-body">${selected ? `<dl><dt>Evidence kind</dt><dd>${titleCase(selected.kind)}</dd><dt>Subscription</dt><dd>${selected.subscription ?? "Not applicable"}</dd><dt>Item</dt><dd>${selected.item ?? "Not applicable"}</dd><dt>COMMAND key</dt><dd>${selected.key ?? "Not applicable"}</dd><dt>Provenance</dt><dd>${selected.provenance ?? "Not applicable"}</dd><dt>Observation path</dt><dd>${selected.observationPath ?? "Not applicable"}</dd><dt>Retention</dt><dd>Retained in current interval</dd></dl><div class="context-actions">${selected.item ? `<button data-action="include-item">Include Item</button>` : ""}${selected.provenance ? `<button data-action="exclude-provenance">Exclude ${selected.provenance}</button>` : ""}${selected.key ? `<button data-action="exclude-key">Exclude COMMAND key</button>` : ""}<button data-action="around-evidence">Around this Evidence</button></div>` : unretained ? `<div class="unretained-context"><strong>Selected Evidence is no longer retained</strong><p>${escapeHtml(selectedIdentity)} remains only as a cleared selection identity. Its erased payload and Around action are unavailable.</p><button data-action="clear-selection">Clear selection</button></div>` : `<p>Choose retained Evidence to inspect it.</p>`}</div></aside>`;
}

function renderExplorer() {
  const discovery = state.snapshot?.discoveries.find((entry) => entry.facet === state.composer.facet) ?? null;
  const values = discovery?.values ?? [];
  const start = discovery?.distinctTotal ? state.composer.offset + 1 : 0;
  const end = discovery?.distinctTotal ? Math.min(state.composer.offset + 50, discovery.distinctTotal) : 0;
  const baseLabel = !discovery
    ? "Loading…"
    : discovery.baseEvidenceCount === null
      ? `Base unavailable · ${readPointLabel(state.snapshot)}`
      : `Base ${formatNumber(discovery.baseEvidenceCount)} Evidence · ${readPointLabel(state.snapshot)}`;
  return `<section class="workspace-overlay"><section class="explorer" role="dialog" aria-modal="true" aria-labelledby="explorer-title"><header><div><span class="eyebrow">Exact contextual facet discovery</span><strong id="explorer-title">Choose ${FACET_LABELS[state.composer.facet]} values</strong></div><button data-action="close-explorer">Close value explorer</button></header><label class="explorer-search" for="value-search"><span>Search exact values</span><input id="value-search" data-focus-key="value-search" value="${escapeAttribute(state.composer.search)}"></label><div class="facet-status"><span>${discovery?.state === "UNAVAILABLE" ? "Discovery unavailable" : `${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(discovery?.distinctTotal ?? 0)} exact values`}</span><span>${baseLabel}</span></div>${renderDiscoveryBody(discovery, values)}<footer><button data-action="previous-values" ${!state.composer.offset ? "disabled" : ""}>Previous 50</button><button data-action="next-values" ${discovery?.nextOffset === null || discovery?.nextOffset === undefined ? "disabled" : ""}>Next 50</button><span class="spacer"></span><button data-action="close-explorer">Cancel values</button><button class="primary" data-action="accept-values">Accept staged values</button></footer></section></section>`;
}

function renderDiscoveryBody(discovery, values) {
  if (!discovery) return `<div class="explorer-empty"><strong>Loading exact discovery…</strong></div>`;
  if (discovery.state === "UNAVAILABLE") return `<div class="explorer-empty"><strong>Facet discovery unavailable</strong><span>The Ordered Evidence page, exact totals, lookup, and typed Context actions remain usable.</span></div>`;
  const pinned = values.filter((entry) => entry.pinned);
  if (discovery.state === "BASE_ZERO") return `<div class="discovery-state"><div class="explorer-empty"><strong>Other Criteria match no Evidence</strong><span>This base-zero state is distinct from the pinned active intent below.</span></div>${pinned.length ? `<div class="value-list" role="list" aria-label="Pinned active values">${pinned.map((entry, index) => renderValueRow(entry, index)).join("")}</div>` : ""}</div>`;
  if (discovery.state === "NO_CONCRETE_VALUES") return `<div class="discovery-state"><div class="explorer-empty"><strong>No concrete ${FACET_LABELS[discovery.facet]} values</strong><span>The base has Evidence, but this facet is not truthfully observed on it.</span></div>${pinned.length ? `<div class="value-list" role="list" aria-label="Pinned active values">${pinned.map((entry, index) => renderValueRow(entry, index)).join("")}</div>` : ""}</div>`;
  return `<div class="value-list" role="list" aria-label="Exact ${FACET_LABELS[discovery.facet]} values">${values.map((entry, index) => renderValueRow(entry, index)).join("")}</div>`;
}

function renderValueRow(entry, index) {
  const draftFacet = state.composer.draft.facets[state.composer.facet];
  const included = Boolean(draftFacet?.include.some((candidate) => candidate.identity === entry.value.identity));
  const excluded = Boolean(draftFacet?.exclude.some((candidate) => candidate.identity === entry.value.identity));
  return `<div class="value-row" role="listitem" data-active="${index === state.composer.focusIndex}"><button class="value-identity" data-value-index="${index}" data-focus-key="value-${index}" data-value="${escapeAttribute(entry.value.identity)}" aria-label="${escapeAttribute(entry.value.label)}, ${entry.count} Evidence, ${included ? "included" : excluded ? "excluded" : "neutral"}"><code>${escapeHtml(entry.value.label)}${entry.pinned ? ` · active pinned${entry.count === 0 ? " · exact zero" : ""}` : ""}</code></button><span class="value-count">${formatNumber(entry.count)} Evidence</span><button class="polarity" data-action="stage-polarity" data-polarity="include" data-value="${escapeAttribute(entry.value.identity)}" aria-pressed="${included}">Include</button><button class="polarity" data-action="stage-polarity" data-polarity="exclude" data-value="${escapeAttribute(entry.value.identity)}" aria-pressed="${excluded}">Exclude</button></div>`;
}

function renderStatus() {
  return `<footer class="status"><span>${state.history.capacityTier} capacity · ${state.history.storage} · interval ${state.history.intervalId} · ${state.history.terminal ? `final (${state.history.terminalReason ?? "UNKNOWN_TERMINAL_REASON"})` : "committed"} boundary ${state.history.committedBoundary === null ? "none" : `#${formatNumber(state.history.committedBoundary)}`}</span><span>Published query ${state.publishedQueryGeneration}/${state.queryGeneration} · investigation rev ${state.investigationRevision} · Filter rev ${state.filter.revision}</span></footer>`;
}

function renderStateConsole() {
  const snapshot = state.snapshot;
  return `<section class="state-console" aria-label="Full integrated prototype state"><section class="console-section"><h2>Investigation state</h2><dl class="state-grid"><dt>Scope</dt><dd>${state.scope.kind === "page" ? "Inspected page" : `${FACET_LABELS[state.scope.facet]} ${state.scope.value.label}`}</dd><dt>Filter</dt><dd>${escapeHtml(filterSummary(state.filter))}</dd><dt>Find</dt><dd>“${escapeHtml(state.find.text)}” · current ${state.find.current ?? "none"}</dd><dt>Selection</dt><dd>${state.selected ?? "none"}</dd><dt>Row focus</dt><dd>${state.focused ?? "none"}</dd><dt>Context</dt><dd>${state.context}</dd><dt>Capture</dt><dd>${state.captureOperation}</dd><dt>Coverage</dt><dd>${state.coverage}</dd><dt>View</dt><dd>${state.view}${state.frozenBoundary ? ` at #${formatNumber(state.frozenBoundary)}` : ""}</dd><dt>Composer</dt><dd>${state.composer.open ? `draft based on Filter revision ${state.composer.baseRevision}` : "closed"}</dd><dt>Read point</dt><dd>${snapshot ? readPointLabel(snapshot) : "none"}</dd><dt>Query work</dt><dd>${snapshot ? `${snapshot.telemetry.renderedCount}/${formatNumber(snapshot.telemetry.retainedCount)} rows rendered · ${snapshot.telemetry.requestedDiscoveryCount} facets requested · max ${snapshot.telemetry.maximumFacetPage} facet rows` : "none"}</dd></dl></section><section class="console-section"><h2>Memory / IndexedDB semantic parity</h2>${state.parityRunning ? `<p>Checking identical atomic requests…</p>` : `<ul class="parity-list">${state.parity.map((entry) => `<li><span>${escapeHtml(entry.name)}</span><strong class="${entry.equal ? "pass" : "fail"}">${entry.equal ? "MATCH" : "DIFF"}</strong></li>`).join("")}</ul>`}<p class="mono">${state.parity.every((entry) => entry.equal) && state.parity.length ? "All compared read points, page identities/order, totals, discoveries, counts, and lookup semantics match." : "Adapter comparison pending or divergent."}</p></section><section class="console-section"><h2>Typed leverage and event log</h2><div class="operation-list"><code>Around time</code><code>Evidence kind</code><code>Provenance</code><code>Subscription identity</code><code>Subscription-owned Item</code></div><ul class="event-log">${state.log.slice(0, 7).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul></section></section>`;
}

function renderPrototypeControls() {
  return `<aside class="prototype-controls" aria-label="Prototype controls"><strong>PROTOTYPE</strong><label>Frame <select data-control="frame">${Object.entries(FRAMES).map(([key, label]) => `<option value="${key}" ${state.frame === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Theme <select data-control="theme"><option value="dark" ${state.theme === "dark" ? "selected" : ""}>Dark</option><option value="light" ${state.theme === "light" ? "selected" : ""}>Light</option></select></label><label>State <select data-control="scenario">${Object.entries(SCENARIOS).map(([key, label]) => `<option value="${key}" ${state.scenario === key ? "selected" : ""}>${label}</option>`).join("")}</select></label><label>Walkthrough <select data-control="walkthrough">${Object.entries(WALKTHROUGHS).map(([key, value]) => `<option value="${key}" ${state.walkthrough === key ? "selected" : ""}>${value.title}</option>`).join("")}</select></label></aside>`;
}

function filterSummary(filter) {
  const parts = [];
  if (filter.text) parts.push(`Evidence contains “${filter.text}”`);
  for (const [facet, facetState] of Object.entries(filter.facets)) {
    if (facetState.include.length) parts.push(`${FACET_LABELS[facet]} includes ${facetState.include.map((entry) => entry.label).join(" or ")}`);
    if (facetState.exclude.length) parts.push(`${FACET_LABELS[facet]} excludes ${facetState.exclude.map((entry) => entry.label).join(" or ")}`);
  }
  if (filter.around) parts.push(`Around ${filter.around.anchorEventId} · ±5 seconds`);
  if (filter.unsupported.length) parts.push(`${filter.unsupported.length} unsupported Criterion`);
  return parts.join("; ") || "No active Criteria";
}

function isEmptyFilter(filter) {
  return !filter.text && !Object.keys(filter.facets).length && !filter.around && !filter.unsupported.length;
}

function readPointLabel(snapshot) {
  const boundary = snapshot.readPoint.committedBoundary;
  return `${snapshot.readPoint.intervalId} / ${boundary ? `#${formatNumber(boundary.sequence)}` : "empty"}`;
}

function openFilter(returnFocus = "filter-trigger") {
  if (state.composer.open) return;
  state.composer = { ...state.composer, open: true, draft: cloneFilter(state.filter), baseRevision: state.investigationRevision, addStep: false, explorerOpen: false, returnFocus };
  state.restoreFocus = "filter-text";
  state.log.unshift(`Opened a draft from applied Filter revision ${state.filter.revision}; applied state is unchanged.`);
  render();
}

function cloneFilter(filter) {
  const facets = {};
  for (const [facet, facetState] of Object.entries(filter.facets)) facets[facet] = { include: [...facetState.include], exclude: [...facetState.exclude] };
  return { revision: filter.revision, text: filter.text, facets, around: filter.around ? { ...filter.around } : null, unsupported: [...filter.unsupported] };
}

async function applyComposer() {
  if (state.composer.baseRevision !== state.investigationRevision) {
    state.flash = `Draft is stale: investigation revision moved from ${state.composer.baseRevision} to ${state.investigationRevision}. Nothing applied; the draft remains open.`;
    state.log.unshift("Rejected stale Filter draft atomically and preserved it for recovery.");
    render();
    return;
  }
  const draft = state.composer.draft;
  const outcome = mutateFilter(state.filter, {
    expectedRevision: draft.revision,
    operations: operationsFromDraft(draft)
  });
  if (!outcome.ok) {
    state.flash = `Draft mutation refused: ${outcome.problem}. Nothing applied; the draft remains open.`;
    state.log.unshift("The UI-to-runtime atomic mutation seam rejected a stale Filter revision.");
    render();
    return;
  }
  state.filter = outcome.filter;
  state.investigationRevision += 1;
  state.composer = { ...state.composer, open: false, draft: null, baseRevision: null, addStep: false, explorerOpen: false };
  state.flash = "The complete Filter draft applied once at the next coherent query read point.";
  state.restoreFocus = state.composer.returnFocus;
  await refreshSnapshot("Applied complete Filter draft");
}

function operationsFromDraft(draft) {
  const operations = [{ type: "reset" }];
  if (draft.text.trim()) operations.push({ type: "set-text", text: draft.text });
  for (const [facet, facetState] of Object.entries(draft.facets)) {
    for (const facetValue of facetState.include) operations.push({ type: "set-polarity", facet, polarity: "include", value: facetValue });
    for (const facetValue of facetState.exclude) operations.push({ type: "set-polarity", facet, polarity: "exclude", value: facetValue });
  }
  if (draft.around) operations.push({ type: "set-around", around: draft.around });
  for (const entry of draft.unsupported) operations.push({ type: "add-unsupported", entry });
  return operations;
}

function cancelComposer() {
  const unchanged = filterSummary(state.filter);
  const returnFocus = state.composer.returnFocus;
  state.composer = { ...state.composer, open: false, draft: null, baseRevision: null, addStep: false, explorerOpen: false };
  state.flash = `Draft cancelled. Applied Filter remains: ${unchanged}`;
  state.restoreFocus = returnFocus;
  state.log.unshift("Cancelled draft without issuing a query or changing applied Filter revision.");
  render();
}

async function commitFilterOperations(operations, reason) {
  const outcome = mutateFilter(state.filter, { expectedRevision: state.filter.revision, operations });
  if (!outcome.ok) {
    state.flash = `Mutation refused: ${outcome.problem}. Applied Filter is unchanged.`;
    render();
    return;
  }
  state.filter = outcome.filter;
  state.investigationRevision += 1;
  state.flash = reason;
  await refreshSnapshot(reason);
}

async function openExplorer() {
  state.composer = { ...state.composer, explorerOpen: true, offset: 0, focusIndex: 0 };
  state.restoreFocus = "value-search";
  await refreshSnapshot(`Requested exact ${FACET_LABELS[state.composer.facet]} discovery`);
}

async function refreshDiscovery(reason) {
  state.restoreFocus = "value-search";
  await refreshSnapshot(reason);
}

function closeExplorer() {
  state.composer = { ...state.composer, explorerOpen: false };
  state.restoreFocus = "choose-values";
  void refreshSnapshot("Closed facet discovery; common page path requests no facets");
}

function stagePolarity(facet, identity, polarity) {
  const discovery = state.snapshot?.discoveries.find((entry) => entry.facet === facet);
  const entry = discovery?.values.find((candidate) => candidate.value.identity === identity);
  const selected = state.snapshot?.lookup?.state === "RETAINED" ? state.snapshot.lookup.evidence : null;
  const catalogValue = entry?.value ?? Object.values(selected?.facets ?? {}).find((candidate) => candidate.identity === identity);
  if (!catalogValue) return;
  const draft = cloneFilter(state.composer.draft);
  const current = draft.facets[facet] ?? { include: [], exclude: [] };
  current.include = current.include.filter((candidate) => candidate.identity !== identity);
  current.exclude = current.exclude.filter((candidate) => candidate.identity !== identity);
  const already = state.composer.draft.facets[facet]?.[polarity]?.some((candidate) => candidate.identity === identity);
  if (!already) current[polarity].push(catalogValue);
  if (current.include.length || current.exclude.length) draft.facets[facet] = current;
  else delete draft.facets[facet];
  state.composer = { ...state.composer, draft };
  state.restoreFocus = `value-${state.composer.focusIndex}`;
  render();
}

function removeDraftCriterion(facet, identity) {
  const draft = cloneFilter(state.composer.draft);
  if (facet === "around") draft.around = null;
  else if (facet === "unsupported") draft.unsupported = draft.unsupported.filter((entry) => entry.id !== identity);
  else {
    const current = draft.facets[facet];
    if (current) {
      current.include = current.include.filter((entry) => entry.identity !== identity);
      current.exclude = current.exclude.filter((entry) => entry.identity !== identity);
      if (!current.include.length && !current.exclude.length) delete draft.facets[facet];
    }
  }
  state.composer = { ...state.composer, draft };
  render();
}

async function revealSelected() {
  const blockers = state.snapshot?.lookup?.blockingCriteria ?? [];
  const operations = [];
  for (const blocker of blockers) {
    if (blocker === "free-text") operations.push({ type: "set-text", text: "" });
    else if (blocker === "around-evidence") operations.push({ type: "remove-around" });
    else if (state.filter.unsupported.some((entry) => entry.id === blocker)) operations.push({ type: "remove-unsupported", id: blocker });
    else if (blocker.endsWith(":include")) {
      const facet = blocker.split(":")[0];
      for (const entry of state.filter.facets[facet]?.include ?? []) operations.push({ type: "remove-criterion", facet, value: entry });
    } else if (blocker.includes(":exclude:")) {
      const facet = blocker.split(":")[0];
      const identity = blocker.slice(`${facet}:exclude:`.length);
      const entry = state.filter.facets[facet]?.exclude.find((candidate) => candidate.identity === identity);
      if (entry) operations.push({ type: "remove-criterion", facet, value: entry });
    }
  }
  await commitFilterOperations(operations, `Reveal removed only ${operations.length} blocking Criterion${operations.length === 1 ? "" : "s"}; satisfying Criteria stayed active.`);
  state.focused = state.selected;
  state.restoreFocus = state.selected;
  render();
}

async function clearHistory() {
  if (state.history.terminal) {
    state.flash = `Clear refused: ${state.history.terminalReason ?? "terminal History"}. The final boundary, STOPPED Capture operation, Coverage, and retained Evidence remain unchanged.`;
    state.log.unshift("Terminal History rejected Clear and did not manufacture a new interval.");
    render();
    return;
  }
  const old = state.snapshot?.readPoint ?? null;
  try {
    await Promise.all([memoryAdapter.clear(), indexedAdapter.clear()]);
  } catch (error) {
    state.flash = `Clear failed: ${error.code ?? String(error)}. The old interval remains authoritative.`;
    state.log.unshift(state.flash);
    render();
    return;
  }
  state.history = Object.freeze({ intervalId: "H8", retainedFirstSequence: 1, committedBoundary: null, terminal: false, capacityTier: state.history.capacityTier, storage: state.history.storage });
  if (state.filter.around) state.filter = applyOperations(state.filter, [{ type: "remove-around" }]);
  state.investigationRevision += 1;
  state.restorationBarrier += 1;
  state.focused = "filter-trigger";
  state.find.current = null;
  state.frozenBoundary = null;
  state.newerMatching = 0;
  state.scenario = "clear";
  state.flash = `Clear succeeded. ${old ? `${old.intervalId} / #${old.committedBoundary?.sequence ?? 0}` : "The prior read point"} is invalid; ordinary Criteria, Find, selection identity, and View remain.`;
  state.log.unshift("Successful Clear created interval H8 and a Back/Forward restoration barrier; Around was removed.");
  await refreshSnapshot("Queried new empty interval after Clear");
}

async function probeOldReadPoint() {
  const oldHistory = { intervalId: "H7", retainedFirstSequence: 1, committedBoundary: 10_000, terminal: false, storage: "memory", capacityTier: "NORMAL" };
  const results = await Promise.all([memoryAdapter, indexedAdapter].map(async (adapter) => {
    try {
      await adapter.query(queryRequest({ history: oldHistory, discover: [], lookup: null, find: null }));
      return `${adapter.storage}:UNEXPECTEDLY_READABLE`;
    } catch (error) {
      return `${adapter.storage}:${error.code ?? String(error)}`;
    }
  }));
  state.oldReadPointProbe = results.join(" · ");
  state.flash = `Old read-point probe: ${state.oldReadPointProbe}. Removed Evidence was not manufactured.`;
  state.log.unshift(state.flash);
  render();
}

async function advancePassiveCapture() {
  if (state.scenario !== "live" || state.history.committedBoundary >= 10_000) return;
  const frozen = state.view === "FROZEN";
  const frozenMatching = state.snapshot?.totals.matching ?? 0;
  const nextHistory = Object.freeze({ ...state.history, committedBoundary: 10_000 });
  state.history = nextHistory;
  if (frozen) {
    const adapter = state.history.storage === "memory" ? memoryAdapter : indexedAdapter;
    const latest = await adapter.query(queryRequest({ history: nextHistory, discover: [], lookup: null, find: null }));
    state.newerMatching = Math.max(0, latest.value.totals.matching - frozenMatching);
  } else {
    state.newerMatching = 0;
  }
  state.flash = frozen
    ? `Passive Capture committed #9,999–#10,000; the Frozen read point stayed #9,998 with ${state.newerMatching} newer matching.`
    : "Passive Capture committed #9,999–#10,000 and Live published one new coherent read point.";
  state.log.unshift("Passive Capture changed History only; Filter, Find, selection, row focus, Context, Coverage, and composer draft were not mutated.");
  await refreshSnapshot("Accepted two passive Capture records");
}

async function setScenario(scenario) {
  await prepareAdapters(scenario);
  state.scenario = scenario;
  state.history = historyForScenario(scenario);
  state.coverage = scenario === "limited" || scenario === "terminal" ? "LIMITED" : "USEFUL";
  state.captureOperation = scenario === "terminal" ? "STOPPED" : "RUNNING";
  state.scope = scopeForScenario(scenario);
  state.filter = filterForScenario(scenario);
  state.composer = { ...state.composer, open: false, draft: null, baseRevision: null, addStep: false, explorerOpen: false, search: "", offset: 0 };
  state.selected = selectedForScenario(scenario);
  state.focused = state.selected;
  state.context = "selected-evidence";
  state.compactContextOpen = false;
  state.view = scenario === "live" ? "LIVE" : "FROZEN";
  state.frozenBoundary = scenario === "live" ? null : state.history.committedBoundary;
  state.newerMatching = 0;
  state.investigationRevision += 1;
  state.flash = "";
  state.oldReadPointProbe = null;
  syncUrl();
  await refreshSnapshot(`Loaded deterministic ${SCENARIOS[scenario]} state`);
  if (scenario === "high" || scenario === "unavailable") {
    openFilter("filter-trigger");
    state.composer = { ...state.composer, addStep: true, facet: "key", explorerOpen: true, offset: scenario === "high" ? 1_800 : 0 };
    await refreshSnapshot("Opened exact COMMAND key discovery");
  }
}

async function executeAction(action, target = null) {
  const selected = state.snapshot?.lookup?.state === "RETAINED" ? state.snapshot.lookup.evidence : null;
  if (action === "open-filter") { openFilter(target?.dataset.focusKey ?? "filter-trigger"); return; }
  if (action === "cancel-filter") { cancelComposer(); return; }
  if (action === "apply-filter") { await applyComposer(); return; }
  if (action === "add-criterion") { state.composer = { ...state.composer, addStep: true }; state.restoreFocus = "facet-select"; render(); return; }
  if (action === "open-explorer") { await openExplorer(); return; }
  if (action === "close-explorer") { closeExplorer(); return; }
  if (action === "accept-values") { closeExplorer(); return; }
  if (action === "previous-values") { state.composer.offset = Math.max(0, state.composer.offset - 50); state.composer.focusIndex = 0; await refreshDiscovery("Loaded previous exact facet page"); return; }
  if (action === "next-values") { state.composer.offset = state.snapshot?.discoveries[0]?.nextOffset ?? state.composer.offset; state.composer.focusIndex = 0; await refreshDiscovery("Loaded next exact facet page"); return; }
  if (action === "stage-polarity") { stagePolarity(state.composer.facet, target.dataset.value, target.dataset.polarity); return; }
  if (action === "remove-draft-criterion") { removeDraftCriterion(target.dataset.facet, target.dataset.value); return; }
  if (action === "include-item" && selected?.facets.item) { await commitFilterOperations([{ type: "set-polarity", facet: "item", polarity: "include", value: selected.facets.item }], `Amended Item includes with ${selected.item}; unrelated Criteria were preserved.`); return; }
  if (action === "exclude-local") { await commitFilterOperations([{ type: "set-polarity", facet: "provenance", polarity: "exclude", value: value("provenance", "LOCAL") }], "Excluded LOCAL Provenance without replacing other Provenance values or facets."); return; }
  if (action === "exclude-provenance" && selected?.facets.provenance) { await commitFilterOperations([{ type: "set-polarity", facet: "provenance", polarity: "exclude", value: selected.facets.provenance }], `Excluded ${selected.provenance}; selected Evidence and Context remain.`); return; }
  if (action === "exclude-key" && selected?.facets.key) { await commitFilterOperations([{ type: "set-polarity", facet: "key", polarity: "exclude", value: selected.facets.key }], `Amended COMMAND key Excludes with ${selected.key}; same-facet values remain.`); return; }
  if (action === "around-evidence" && selected) { await commitFilterOperations([{ type: "set-around", around: { intervalId: selected.intervalId, anchorEventId: selected.eventId, anchorSequence: selected.sequence, anchorTimestamp: selected.timestamp, start: selected.timestamp - 5_000, end: selected.timestamp + 5_000 } }], `Around ${selected.eventId} replaced only the prior Around Criterion.`); return; }
  if (action === "reveal-selected") { await revealSelected(); return; }
  if (action === "open-context") { state.compactContextOpen = true; state.context = "selected-evidence"; state.restoreFocus = "close-context"; render(); return; }
  if (action === "close-context") { state.compactContextOpen = false; state.restoreFocus = "context-trigger"; render(); return; }
  if (action === "clear-selection") { state.selected = ""; state.context = "none"; state.flash = "Selection cleared; Filter and Scope remain."; render(); return; }
  if (action === "reset-filter") { await commitFilterOperations([{ type: "reset" }], "Reset removed every Filter Criterion while preserving Scope, Find, selection, Capture, Coverage, and View."); return; }
  if (action === "clear-history") { await clearHistory(); return; }
  if (action === "refresh-query") { await refreshSnapshot("Retried coherent query"); return; }
  if (action === "dismiss-flash") { state.flash = ""; render(); return; }
  if (action === "select-event") { state.selected = target.dataset.event; state.focused = target.dataset.event; state.context = "selected-evidence"; await refreshSnapshot("Selected retained Evidence"); return; }
  if (action === "open-find") { state.find.open = true; state.restoreFocus = "find-input"; render(); return; }
  if (action === "close-find") { state.find.open = false; state.find.current = null; state.restoreFocus = "find-trigger"; await refreshSnapshot("Closed Find; inactive Find was omitted from the atomic query"); return; }
  if (action === "find-next" || action === "find-prev") { await moveFind(action === "find-next" ? 1 : -1); return; }
  if (action === "toggle-view") {
    state.view = state.view === "LIVE" ? "FROZEN" : "LIVE";
    state.frozenBoundary = state.view === "FROZEN" ? state.history.committedBoundary : null;
    state.newerMatching = 0;
    state.flash = `View changed to ${state.view}; Filter and selection did not change.`;
    await refreshSnapshot(`Published ${state.view} Evidence view`);
    return;
  }
  if (action === "advance-capture") { await advancePassiveCapture(); return; }
  if (action === "run-parity") { await refreshParity(); return; }
  if (action === "reset-walkthrough") { state.walkStep = 0; await setScenario(state.walkthrough === "primary" ? "primary" : state.walkthrough === "authoring" ? "high" : "primary"); return; }
  if (action === "walk-select-local") { await setScenario("primary"); state.selected = selectedForScenario("primary"); state.focused = state.selected; await refreshSnapshot("Selected suspicious Local COMMAND Evidence"); return; }
  if (action === "walk-stage-text") { if (!state.composer.open) openFilter(); state.composer.draft.text = "state mismatch"; state.flash = "Draft text changed; applied Filter and query snapshot are unchanged."; render(); return; }
  if (action === "walk-open-page-37") { if (!state.composer.open) openFilter(); state.composer = { ...state.composer, addStep: true, explorerOpen: true, facet: "key", offset: 1_800, search: "" }; await refreshSnapshot("Loaded exact COMMAND key page 37"); return; }
  if (action === "walk-stage-value") { const entry = state.snapshot?.discoveries[0]?.values[0]; if (entry) stagePolarity("key", entry.value.identity, "include"); return; }
  if (action === "walk-reopen-apply") { if (!state.composer.open) openFilter(); state.composer.draft.text = "state mismatch"; await applyComposer(); return; }
  if (action === "walk-add-around") { await setScenario("primary"); const current = state.snapshot?.lookup?.state === "RETAINED" ? state.snapshot.lookup.evidence : null; if (current) await commitFilterOperations([{ type: "set-polarity", facet: "mode", polarity: "include", value: value("mode", "COMMAND") }, { type: "set-around", around: { intervalId: current.intervalId, anchorEventId: current.eventId, anchorSequence: current.sequence, anchorTimestamp: current.timestamp, start: current.timestamp - 5_000, end: current.timestamp + 5_000 } }], "Added ordinary Mode and Around Criteria before Clear."); return; }
  if (action === "walk-query-old-point") { await probeOldReadPoint(); return; }
  if (action === "walk-terminal") { await setScenario("terminal"); return; }
}

async function moveFind(direction) {
  const find = state.snapshot?.find;
  if (!find?.total) return;
  state.find.current = direction > 0 ? find.nextEventId : find.previousEventId;
  state.restoreFocus = "find-input";
  await refreshSnapshot(direction > 0 ? "Moved Find to next match" : "Moved Find to previous match");
}

function restoreFocus() {
  const key = state.restoreFocus;
  state.restoreFocus = null;
  if (!key) return;
  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
    target?.focus();
    if (target instanceof HTMLInputElement) target.setSelectionRange(target.value.length, target.value.length);
  });
}

function syncUrl() {
  const next = new URLSearchParams({ frame: state.frame, theme: state.theme, scenario: state.scenario, walkthrough: state.walkthrough });
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

document.addEventListener("input", async (event) => {
  if (event.target.id === "filter-text") state.composer.draft.text = event.target.value;
  if (event.target.id === "find-text") {
    state.find.text = event.target.value;
    state.find.current = null;
    state.restoreFocus = "find-input";
    await refreshSnapshot("Evaluated Find at the current atomic read point");
  }
  if (event.target.id === "value-search") {
    state.composer.search = event.target.value;
    state.composer.offset = 0;
    await refreshDiscovery("Searched exact facet values globally");
  }
});

document.addEventListener("change", async (event) => {
  const control = event.target.dataset.control;
  if (control === "frame") { state.frame = event.target.value; syncUrl(); render(); return; }
  if (control === "theme") { state.theme = event.target.value; syncUrl(); render(); return; }
  if (control === "scenario") { await setScenario(event.target.value); return; }
  if (control === "walkthrough") { state.walkthrough = event.target.value; state.walkStep = 0; syncUrl(); render(); return; }
  if (event.target.id === "facet-select") { state.composer.facet = event.target.value; render(); }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  const action = target?.dataset.action;
  if (!action) return;
  if (target.dataset.walkIndex !== undefined) state.walkStep = Math.min(Number(target.dataset.walkIndex) + 1, WALKTHROUGHS[state.walkthrough].steps.length - 1);
  await executeAction(action, target);
});

document.addEventListener("keydown", async (event) => {
  if (state.composer.explorerOpen && event.key === "Tab") {
    const dialog = document.querySelector(".explorer");
    const focusable = [...dialog?.querySelectorAll('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []];
    if (focusable.length) {
      const current = focusable.indexOf(document.activeElement);
      const next = event.shiftKey
        ? (current <= 0 ? focusable.length - 1 : current - 1)
        : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
      event.preventDefault();
      focusable[next].focus();
      return;
    }
  }
  if (event.key === "Escape") {
    if (state.composer.explorerOpen) { event.preventDefault(); event.stopPropagation(); closeExplorer(); return; }
    if (state.composer.addStep) { event.preventDefault(); event.stopPropagation(); state.composer = { ...state.composer, addStep: false }; state.restoreFocus = "add-criterion"; render(); return; }
    if (state.composer.open) { event.preventDefault(); event.stopPropagation(); cancelComposer(); return; }
    if (state.find.open) { event.preventDefault(); event.stopPropagation(); await executeAction("close-find"); return; }
    return;
  }
  const evidenceRow = event.target.closest(".evidence-row");
  if (evidenceRow && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    await executeAction("select-event", evidenceRow);
  }
});

function markFind(text) {
  const query = state.find.text.trim();
  if (!query) return escapeHtml(text);
  const expression = new RegExp(escapeRegExp(query), "ig");
  let last = 0;
  let result = "";
  for (const match of text.matchAll(expression)) {
    result += escapeHtml(text.slice(last, match.index));
    result += `<mark>${escapeHtml(match[0])}</mark>`;
    last = match.index + match[0].length;
  }
  return result + escapeHtml(text.slice(last));
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}:${String(date.getUTCSeconds()).padStart(2, "0")}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}

function titleCase(value) { return String(value).replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatNumber(value) { return new Intl.NumberFormat("en-US").format(value); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function escapeHtml(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function escapeAttribute(value) { return escapeHtml(value).replaceAll('"', "&quot;"); }

window.__evidenceFilterPrototype = Object.freeze({
  ready: readiness,
  benchmark(iterations) {
    return runPrototypeBenchmarks(iterations);
  },
  semanticEdgeProbes() {
    return runSemanticEdgeProbes();
  },
  async probeAppliedFilter() {
    const boundedRequest = queryRequest({ discover: [], lookup: null, find: null });
    const fullRequest = queryRequest();
    const [memory, indexeddb, full] = await Promise.all([memoryAdapter.query(boundedRequest), indexedAdapter.query(boundedRequest), indexedAdapter.query(fullRequest)]);
    return { memory: normalizeSnapshot(memory.value), indexeddb: normalizeSnapshot(indexeddb.value), full: normalizeSnapshot(full.value) };
  },
  async action(action) {
    await executeAction(action);
  },
  async scenario(scenario) {
    await setScenario(scenario);
  },
  state() {
    return {
      frame: state.frame,
      theme: state.theme,
      scenario: state.scenario,
      history: state.history,
      coverage: state.coverage,
      captureOperation: state.captureOperation,
      scope: state.scope,
      filter: state.filter,
      composer: state.composer,
      snapshot: state.snapshot ? normalizeSnapshot(state.snapshot) : null,
      snapshotTelemetry: state.snapshot?.telemetry ?? null,
      snapshotError: state.snapshotError,
      parity: state.parity,
      selected: state.selected,
      focused: state.focused,
      context: state.context,
      find: state.find,
      view: state.view,
      frozenBoundary: state.frozenBoundary,
      newerMatching: state.newerMatching,
      investigationRevision: state.investigationRevision,
      restorationBarrier: state.restorationBarrier,
      queryGeneration: state.queryGeneration,
      publishedQueryGeneration: state.publishedQueryGeneration,
      oldReadPointProbe: state.oldReadPointProbe,
      activeElement: document.activeElement?.dataset.focusKey ||
        document.activeElement?.dataset.event ||
        (document.activeElement?.dataset.valueIndex !== undefined ? `value-${document.activeElement.dataset.valueIndex}` : null) ||
        document.activeElement?.id ||
        document.activeElement?.tagName ||
        null
    };
  }
});

window.addEventListener("beforeunload", () => { void indexedAdapter?.close(); });
