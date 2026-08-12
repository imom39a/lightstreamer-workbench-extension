const DESIGNS = {
  A: {
    name: "A · Atomic query",
    title: "One coherent EvidenceSnapshot",
    intro: "One request names every section the caller needs. Optional sections cost nothing when omitted.",
    signature: `history.query({
  at: "LATEST_COMMITTED",
  scope,
  filter,
  page: { order: "NEWEST_FIRST", size: 60 },
  discover: [
    { facet: "COMMAND_KEY", size: 50 },
    { facet: "PROVENANCE", size: 50 }
  ],
  lookup: selectedEvidence
}) -> Outcome<EvidenceSnapshot>`,
    hidden: "Boundary latch, query planning, posting intersections, residual scans, exact self-facet counts, adapter transactions.",
    dependency: "WorkbenchRuntime depends on one EventHistory query seam; memory and IndexedDB are internal substitutes.",
    failure: "Base failure is outer Outcome; a failed discovery is UNAVAILABLE without blanking the page.",
    calls: ["query page + totals + discoveries + lookup"],
    recommendation: "Recommended: coherence is structural, the interface is small, and optional work preserves the fast path."
  },
  B: {
    name: "B · Prepared view",
    title: "A lifecycle-bound PreparedEvidenceView",
    intro: "Prepare one view and ask it incrementally for page, totals, facets, and lookup.",
    signature: `const view = await history.prepare({
  at: "LATEST_COMMITTED", scope, filter
});

await view.page({ size: 60 });
await view.totals();
await view.discover({ facet: "COMMAND_KEY" });
await view.lookup(selectedEvidence);
view.close();`,
    hidden: "The implementation must simulate a durable snapshot after IndexedDB's transaction ends.",
    dependency: "Callers own a prepared object, its staleness, and close lifecycle.",
    failure: "Each method can fail independently; caller decides whether the view is still useful.",
    calls: ["prepare view", "page", "totals", "discover key", "discover provenance", "lookup", "close"],
    recommendation: "Rejected: clean-looking incrementality creates materialization or transaction-lifetime obligations."
  },
  C: {
    name: "C · Task methods",
    title: "Explicit pin plus task-oriented reads",
    intro: "Small methods expose each query task. The caller fans them out and merges the answer.",
    signature: `const point = await history.pin("LATEST_COMMITTED");

await Promise.all([
  history.readPage(point, page),
  history.count(point, { scope, filter }),
  history.discover(point, keyFacet),
  history.discover(point, provenanceFacet),
  history.lookup(point, selectedEvidence)
]);`,
    hidden: "Little: callers see the read point, fan-out, orchestration, and partial-result policy.",
    dependency: "WorkbenchRuntime becomes the query coordinator and must never omit or replace the pin.",
    failure: "Partial calls are plausible; a single accidental LATEST call can mix boundaries.",
    calls: ["pin boundary", "read page", "count totals", "discover key", "discover provenance", "lookup"],
    recommendation: "Rejected publicly: useful as private adapter helpers, but it makes every caller preserve coherence."
  }
};

const params = new URLSearchParams(location.search);
const state = {
  variant: DESIGNS[params.get("variant")?.toUpperCase()] ? params.get("variant").toUpperCase() : "A",
  captureAdvances: params.get("advance") !== "0",
  discoveryFails: params.get("failure") === "discovery",
  step: 0
};

function render() {
  const design = DESIGNS[state.variant];
  const boundaries = simulateBoundaries();
  document.querySelector("#app").innerHTML = `<section class="stage">
    <header class="hero">
      <h1>PROTOTYPE — coherent Event History query seam</h1>
      <p>Question: can the caller receive a bounded page, exact totals, contextual discovery, and selected-Evidence facts without learning how memory or IndexedDB obtains them?</p>
    </header>
    <section class="question">
      <div><strong>Guided scenario</strong><span>Capture starts at boundary #842 and ${state.captureAdvances ? "commits #843 between logical tasks" : "does not advance"}. ${state.discoveryFails ? "COMMAND key discovery is unavailable." : "All requested discoveries succeed."}</span></div>
      <div class="controls">
        <button data-action="toggle-advance">${state.captureAdvances ? "Hold Capture boundary" : "Advance between calls"}</button>
        <button data-action="toggle-failure">${state.discoveryFails ? "Restore discovery" : "Fail one discovery"}</button>
        <button data-action="step">Run ${state.step ? "again" : "scenario"}</button>
      </div>
    </section>
    <section class="design">
      <article class="panel">
        <header><h2>${design.title}</h2><p>${design.intro}</p></header>
        <pre class="signature"><code>${escapeHtml(design.signature)}</code></pre>
        <div class="facts">
          ${fact("Hides", design.hidden)}
          ${fact("Dependencies", design.dependency)}
          ${fact("Failure", design.failure)}
        </div>
      </article>
      <article class="panel">
        <header><h2>Execution trace</h2><p>Every visible value must be qualified by one interval and committed boundary.</p></header>
        <div class="simulation">
          <div class="calls">${design.calls.map((call, index) => renderCall(call, index, boundaries)).join("")}</div>
          ${renderResult(boundaries)}
        </div>
      </article>
    </section>
    <section class="comparison"><h3>Decision</h3><ul><li>${design.recommendation}</li><li>The common newest-page request omits discovery and lookup; it never pays for facet enumeration.</li><li>Read points before Clear become unavailable, never reinterpreted against a new interval.</li><li>See INTERFACES.md for typed results, planner bounds, schema strategy, failures, and adapter-parity proof.</li></ul></section>
    <nav class="switcher" aria-label="Interface variants"><button data-action="previous" aria-label="Previous interface">←</button><span>${design.name}</span><button data-action="next" aria-label="Next interface">→</button></nav>
  </section>`;
}

function simulateBoundaries() {
  const design = state.variant;
  const result = [];
  const pinned = 842;
  const calls = DESIGNS[design].calls;
  for (let index = 0; index < calls.length; index += 1) {
    let boundary = pinned;
    if (state.captureAdvances && design === "C" && index > 1) boundary = 843;
    if (state.captureAdvances && design === "B") boundary = pinned;
    result.push(boundary);
  }
  return result;
}

function renderCall(call, index, boundaries) {
  const discovery = call.includes("discover");
  const failed = state.discoveryFails && discovery && call.includes("key");
  const torn = state.variant === "C" && new Set(boundaries).size > 1 && boundaries[index] !== boundaries[0];
  const className = failed ? "warn" : torn ? "bad" : state.step ? "good" : "";
  const output = !state.step ? "not run" : failed ? "UNAVAILABLE" : `interval H7 · #${boundaries[index]}`;
  return `<div class="call ${className}"><b>${index + 1}</b><span>${call}</span><output>${output}</output></div>`;
}

function renderResult(boundaries) {
  if (!state.step) return `<div class="result"><strong>Run the scenario</strong><span>Then compare coherence and partial-failure behavior.</span></div>`;
  const torn = new Set(boundaries).size > 1;
  const coherent = !torn;
  const discovery = state.discoveryFails ? "COMMAND key UNAVAILABLE · Provenance AVAILABLE" : "2 requested facets AVAILABLE";
  return `<div class="result"><strong class="${coherent ? "coherent" : "torn"}">${coherent ? "COHERENT SNAPSHOT" : "TORN RESULT — plausible counts from different boundaries"}</strong><dl>
    <dt>Page</dt><dd>60 rows at #${boundaries[1] ?? boundaries[0]}</dd>
    <dt>Matching</dt><dd>${torn ? "244 at #843" : "243 at #842"}</dd>
    <dt>In Scope</dt><dd>${torn ? "8,411 at #843" : "8,410 at #842"}</dd>
    <dt>Discoveries</dt><dd>${discovery}</dd>
    <dt>Base usability</dt><dd>${state.discoveryFails ? "Page and totals remain usable" : "All requested sections usable"}</dd>
  </dl></div>`;
}

function fact(label, value) { return `<div class="fact"><b>${label}</b><span>${value}</span></div>`; }

function cycle(direction) {
  const keys = Object.keys(DESIGNS);
  const index = keys.indexOf(state.variant);
  state.variant = keys[(index + direction + keys.length) % keys.length];
  state.step = 0;
  syncUrl();
  render();
}

function syncUrl() {
  const next = new URLSearchParams({ variant: state.variant, advance: state.captureAdvances ? "1" : "0" });
  if (state.discoveryFails) next.set("failure", "discovery");
  history.replaceState({}, "", `${location.pathname}?${next}`);
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "previous") return cycle(-1);
  if (action === "next") return cycle(1);
  if (action === "toggle-advance") state.captureAdvances = !state.captureAdvances;
  if (action === "toggle-failure") state.discoveryFails = !state.discoveryFails;
  if (action === "step") state.step += 1;
  syncUrl();
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.target.closest("button, select, input, textarea")) return;
  if (event.key === "ArrowLeft") { event.preventDefault(); cycle(-1); }
  if (event.key === "ArrowRight") { event.preventDefault(); cycle(1); }
});

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

render();
