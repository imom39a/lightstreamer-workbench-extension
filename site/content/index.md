<section class="hero">
  <div class="hero__copy">
    <span class="eyebrow">Chrome DevTools · Lightstreamer Web Client</span>
    <h1>See the Lightstreamer runtime. Keep the evidence.</h1>
    <p class="lede">Capture clients, Sessions, Subscriptions, updates, snapshots, and COMMAND lifecycles in one investigation workspace. Then reproduce the hard case locally—without waiting for the backend sequence to happen again.</p>
    <div class="hero__actions">
      <a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Add to Chrome</a>
      <a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a>
    </div>
    <p class="hero__note"><span>Local-first</span><span>No account</span><span>No analytics</span><span>Open source</span></p>
  </div>
  <figure class="product-frame product-frame--hero">
    <figcaption><span></span><span></span><span></span><strong>Release-current Workbench</strong></figcaption>
    <img src="{{site}}assets/app-command-projections.png" alt="Lightstreamer Workbench showing Runtime Scope, Ordered Evidence, and selected Evidence Context in one Chrome DevTools workspace." width="960" height="600" fetchpriority="high">
  </figure>
</section>

<section class="outcome-strip" aria-label="Product boundaries">
  <p><strong>Lightstreamer-native</strong><span>Observe official Web Client objects and callbacks instead of guessing from generic socket frames.</span></p>
  <p><strong>Evidence-first</strong><span>Keep event order, timestamp, Source, phase, operation, object, and COMMAND key explicit.</span></p>
  <p><strong>Safe reproduction</strong><span>Preview changes and inject a valid local-only Item Update directly; Server Evidence remains distinct.</span></p>
</section>

<section class="section" id="capabilities">
  <header class="section__header">
    <span class="eyebrow">Current capabilities</span>
    <h2>Everything you need to investigate a stream.</h2>
    <p>Workbench stays close to the inspected page and keeps every conclusion tied to captured or deliberately created Evidence.</p>
  </header>
  <div class="capability-grid">
    <article class="capability-card"><span>Scope</span><h3>Navigate the runtime</h3><p>Move from Page to client, Session, Subscription, item, and listener. Current and retired objects remain clearly separated.</p></article>
    <article class="capability-card"><span>Evidence</span><h3>Read retained order</h3><p>Scan a stable event sequence with exact identities, timestamps, provenance, snapshot/live phase, operation, object, and key.</p></article>
    <article class="capability-card"><span>Diagnostics</span><h3>Notifications without noise</h3><p>Review active conditions and recent Lightstreamer notices in one document. Dismiss a footer copy without deleting the notification or changing Evidence.</p></article>
    <article class="capability-card"><span>COMMAND</span><h3>Compare two projections</h3><p>Separate Observed Server COMMAND State from Local Effective COMMAND State without calling either authoritative server state.</p></article>
    <article class="capability-card"><span>Reproduction</span><h3>Inject one update—or a sequence</h3><p>Compare, edit, validate, and inject a standalone local-only Draft from one surface. Build ordered Scenarios with explicit Steps, Checkpoints, and immutable reviewed Runs.</p></article>
    <article class="capability-card"><span>History</span><h3>Filter, find, freeze, and export</h3><p>Investigate high-volume current-session history with bounded rendering, deliberate navigation, and credential-safe JSON or offline HTML export.</p></article>
  </div>
</section>

<section class="section section--media">
  <div class="media-copy">
    <span class="eyebrow">One continuous investigation</span>
    <h2>Scope, Evidence, and Context stay aligned.</h2>
    <p>Choose the runtime boundary in Scope, follow matching events in Ordered Evidence, and inspect the selected update in Context. Supporting activity, Filter actions, and metadata stay one disclosure away while Fields remain immediately readable.</p>
    <a href="{{site}}docs/workspace/">Understand the workspace →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-command-projections.png" alt="Current Workbench workspace with two-line Scope identities, a dedicated Evidence order rail, and selected update Fields." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section section--media section--media-reverse">
  <div class="media-copy">
    <span class="eyebrow">Operational clarity</span>
    <h2>Warnings remain useful without taking over the workspace.</h2>
    <p>Notifications collects Coverage, Capture, History, storage, recovery, Subscription, snapshot, keepalive, and COMMAND diagnostics across the Panel Session. Stable conditions update in place instead of piling up.</p>
    <p class="boundary-note"><strong>Dismiss means presentation only.</strong> It hides the active footer copy, not the retained notification, supporting Evidence, or diagnostic observation.</p>
    <a href="{{site}}docs/developer-guide/#triage-notifications-without-losing-evidence">Use the Notifications workflow →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-notifications.png" alt="Workbench Notifications showing active operational conditions and recent Lightstreamer diagnostics with supporting investigation routes." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section section--media">
  <div class="media-copy">
    <span class="eyebrow">Deliberate Local Injection</span>
    <h2>Reproduce the hard sequence locally.</h2>
    <p>Create a protected Draft from captured Evidence or author a COMMAND update against a live Scope. Captured Drafts open in Source/Draft comparison by default. Edit, validate, preview the exact target on the same surface, and choose <strong>Inject locally</strong> directly.</p>
    <p>For multi-event cases, turn the work into an explicit Scenario with ordered Steps, active-time delays, Checkpoints, per-Step outcomes, and fresh identities for every reviewed Run.</p>
    <a href="{{site}}docs/local-injection/">Follow the Local Injection workflow →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-local-injection-editor.png" alt="Protected Local Injection Draft with default Source and Draft comparison, validation, exact target details, and a direct Inject locally action." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section guide-callout" id="developer-guide">
  <div class="guide-callout__copy">
    <span class="eyebrow">How to use Workbench</span>
    <h2>A practical guide, not a feature catalog.</h2>
    <p>Start with the page, narrow Scope, read Evidence in retained order, qualify the observation boundary, and reproduce only after you can name the exact target.</p>
    <a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a>
  </div>
  <ol class="guide-steps">
    <li><span>01</span><div><strong>Attach before activity</strong><p>Open DevTools and reload when the page created its client before Workbench attached.</p></div></li>
    <li><span>02</span><div><strong>Choose the smallest useful Scope</strong><p>Keep the investigation boundary explicit before filtering or selecting Evidence.</p></div></li>
    <li><span>03</span><div><strong>Read the Evidence boundary</strong><p>Check Capture, Coverage, History, Source, and phase before drawing a conclusion.</p></div></li>
    <li><span>04</span><div><strong>Preview, then inject</strong><p>Use the standalone authoring surface as the preview, or use Scenario Review before a multi-Step Run.</p></div></li>
  </ol>
</section>

<section class="section evidence-boundary">
  <div>
    <span class="eyebrow">Local by design</span>
    <h2>Useful history without a monitoring backend.</h2>
  </div>
  <ul class="check-list">
    <li>One Panel Session owns one temporary Event History: up to 100,000 records or 256 MiB with normal IndexedDB storage; 5,000 records or 32 MiB in startup memory fallback.</li>
    <li>Captured data stays in the browser extension context. Workbench ships without analytics, accounts, advertising, or remote error logging.</li>
    <li>Versioned JSON and offline HTML exports happen only after a deliberate download and exclude credentials.</li>
    <li>Observation Coverage and the Committed Evidence Boundary remain visible so missing data is never silently treated as proof.</li>
  </ul>
  <p class="section__action"><a href="{{site}}docs/export-and-privacy/">Review export and privacy boundaries →</a></p>
</section>

<section class="final-cta">
  <span class="eyebrow">Ready for the next investigation</span>
  <h2>Bring Lightstreamer debugging into DevTools.</h2>
  <p>Install Workbench, open the developer guide, and follow the evidence from runtime object to exact update.</p>
  <div class="inline-actions"><a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Add to Chrome</a><a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a></div>
</section>
