<section class="hero">
  <div class="hero__copy">
    <span class="eyebrow">Chrome DevTools for Lightstreamer</span>
    <h1>Debug Lightstreamer where it runs.</h1>
    <p class="lede">Lightstreamer Workbench brings Runtime Scope, chronological Evidence, and precise Context into one continuous workspace—then lets you reproduce COMMAND behavior locally without waiting for the backend.</p>
    <div class="hero__actions">
      <a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Add Workbench 2.0</a>
      <a class="button button--secondary" href="{{site}}docs/">Read the 2.0 docs</a>
    </div>
    <p class="hero__note"><strong>Version 2.0 is live.</strong> Install the unified Scoped Evidence Workspace from the Chrome Web Store.</p>
  </div>
  <figure class="product-frame product-frame--hero">
    <figcaption><span></span><span></span><span></span><strong>Lightstreamer Workbench</strong></figcaption>
    <img src="{{site}}assets/app-command-projections.png" alt="Lightstreamer Workbench showing Runtime Scope, Ordered Evidence, and selected Evidence Context in one DevTools workspace." width="960" height="600" fetchpriority="high">
  </figure>
</section>

<section class="outcome-strip" aria-label="Product boundaries">
  <p><strong>Official Web Client focus</strong><span>Captures Lightstreamer semantics instead of guessing from generic WebSocket frames.</span></p>
  <p><strong>COMMAND-native evidence</strong><span>Follows keys, operations, snapshots, and distinct state projections.</span></p>
  <p><strong>Local by design</strong><span>Captured application data stays in the current browser debugging session.</span></p>
</section>

<section class="section section--split" id="why-workbench">
  <div>
    <span class="eyebrow">Why Workbench</span>
    <h2>Streaming bugs rarely wait for a convenient sequence.</h2>
  </div>
  <div class="prose-large">
    <p>When a keyed row disappears, a snapshot looks incomplete, or application state diverges, browser logs are rarely enough. Workbench records Lightstreamer-native Evidence next to the inspected page, preserves the runtime object you are investigating, and makes the next deliberate action explicit.</p>
    <p>It is developer infrastructure for applications using the official Lightstreamer Web Client—not a generic socket inspector and not an application-specific debugger.</p>
  </div>
</section>

<section class="section" id="workspace">
  <header class="section__header">
    <span class="eyebrow">One continuous investigation</span>
    <h2>Scope, Evidence, and Context stay together.</h2>
    <p>Version 2 replaces separate feature destinations with a responsive Scoped Evidence Workspace.</p>
  </header>
  <div class="workspace-flow">
    <article><span>01</span><h3>Choose Runtime Scope</h3><p>Navigate Page → client → Session → Subscription → item → listener without losing retired historical objects.</p></article>
    <article><span>02</span><h3>Follow Ordered Evidence</h3><p>Filter, find, select, and freeze a high-volume chronological stream while Capture continues.</p></article>
    <article><span>03</span><h3>Explain in Context</h3><p>Inspect the active runtime object or selected Evidence without silently changing the investigation boundary.</p></article>
  </div>
  <p class="section__action"><a href="{{site}}docs/workspace/">Understand the unified workspace →</a></p>
</section>

<section class="section section--media">
  <div class="media-copy">
    <span class="eyebrow">COMMAND without guesswork</span>
    <h2>Compare what the server showed with what local delivery changed.</h2>
    <p><strong>Observed Server COMMAND State</strong> uses captured Server Updates only. <strong>Local Effective COMMAND State</strong> adds successfully delivered Local Injected Updates. Workbench names both projections and never presents either as authoritative server state.</p>
    <a href="{{site}}docs/command-state/">Read the COMMAND projection guide →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/real-app-gallery.png" alt="Annotated Workbench COMMAND state walkthrough showing active keys, changed fields, and the Local Injection path." width="1400" height="900" loading="lazy">
  </figure>
</section>

<section class="section section--media section--media-reverse">
  <div class="media-copy">
    <span class="eyebrow">Deliberate Local Injection</span>
    <h2>Reproduce one update without touching the server stream.</h2>
    <p>Create one protected Draft from immutable captured Evidence or author a COMMAND update against a live Scope. Edit raw JSON, validate, review the exact target, then deliver locally through the inspected page.</p>
    <p class="boundary-note"><strong>Local means local.</strong> This workflow does not contact the Lightstreamer Server and successful Local Evidence remains visibly separate from Server Evidence.</p>
    <a href="{{site}}docs/local-injection/">Follow the Local Injection workflow →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-local-injection-editor.png" alt="Protected Local Injection Draft with raw JSON editing, validation, and Source comparison." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section evidence-boundary">
  <div>
    <span class="eyebrow">Session-scoped by default</span>
    <h2>Keep the investigation useful without turning it into a data service.</h2>
  </div>
  <ul class="check-list">
    <li>Current-DevTools-session Evidence uses temporary IndexedDB-backed batches with an in-memory fallback.</li>
    <li>Versioned JSON and offline HTML exports are deliberate downloads with credential exclusion.</li>
    <li>Version 2 and this website ship without analytics, tracking, accounts, advertising, or remote error logging.</li>
    <li>Observation limits remain explicit when instrumentation or runtime coverage is incomplete.</li>
  </ul>
  <p class="section__action"><a href="{{site}}privacy/">Read the privacy policy →</a></p>
</section>

<section class="section" id="roadmap-preview">
  <header class="section__header">
    <span class="eyebrow">What comes next</span>
    <h2>Deeper Evidence, not more disconnected destinations.</h2>
  </header>
  <div class="roadmap-preview">
    <article><span class="status-label">Next</span><h3>Normalized JSON Evidence</h3><p>A complete deterministic Evidence object per retained row, with the existing Context still providing semantic interpretation.</p></article>
    <article><span class="status-label">Next</span><h3>Faster, more conclusive diagnosis</h3><p>Contextual facets plus richer changed-field, delivery, provenance, recovery, and snapshot explanations.</p></article>
    <article><span class="status-label">Next</span><h3>Client Messages and Server Injection</h3><p>Capture outbound Client Messages and deliberately send through the inspected client's normal <code>sendMessage</code> path.</p></article>
  </div>
  <p class="section__action"><a href="{{site}}roadmap/">See Next and Exploring →</a></p>
</section>

<section class="section open-source">
  <img src="{{site}}assets/mascot.png" alt="Lightstreamer Workbench mascot" width="220" height="220" loading="lazy">
  <div><span class="eyebrow">Open source</span><h2>Built in public for Lightstreamer developers.</h2><p>The complete Workbench core remains available under Apache-2.0. Read the source, report an issue, or help sharpen generic Lightstreamer debugging infrastructure.</p><div class="inline-actions"><a class="button button--secondary" href="{{github}}" target="_blank" rel="noopener noreferrer">View source</a><a href="{{github}}/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">Contribute →</a></div></div>
</section>

<section class="final-cta">
  <span class="eyebrow">Ready when the stream is not</span>
  <h2>Bring the next Lightstreamer investigation into DevTools.</h2>
  <div class="inline-actions"><a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Add Workbench 2.0</a><a class="button button--secondary" href="{{site}}docs/getting-started/">Get started</a></div>
</section>
