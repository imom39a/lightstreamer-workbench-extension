<section class="hero">
  <div class="hero__copy">
    <span class="eyebrow">2.0.3 release candidate · Chrome DevTools</span>
    <h1>Debug Lightstreamer in Chrome DevTools.</h1>
    <p class="lede">Inspect clients, Sessions, Subscriptions, Item Updates, snapshots, COMMAND lifecycles, and outbound Client Messages. Test an update locally or send one reviewed Client Message through the page's current Session.</p>
    <div class="hero__actions">
      <a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Install current 2.0.2</a>
      <a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a>
    </div>
    <p class="hero__note"><span>Captured data stays local</span><span>No account</span><span>Analytics control</span><span>Open source</span></p>
  </div>
  <figure class="product-frame product-frame--hero">
    <figcaption><span></span><span></span><span></span><strong>2.0.3 candidate Workbench</strong></figcaption>
    <img src="{{site}}assets/app-workspace-context.png" alt="Lightstreamer Workbench showing Runtime Scope, Ordered Evidence, and selected Evidence Context in one Chrome DevTools workspace." width="960" height="600" fetchpriority="high">
  </figure>
</section>

<section class="outcome-strip" aria-label="Product boundaries">
  <p><strong>Lightstreamer data</strong><span>Inspect official Web Client objects and callbacks.</span></p>
  <p><strong>Event details</strong><span>See the event order, time, Source, phase, operation, object, and COMMAND key.</span></p>
  <p><strong>Deliberate tests</strong><span>Inject an Item Update locally, or send one reviewed Client Message through the page-owned client.</span></p>
</section>

<section class="section" id="capabilities">
  <header class="section__header">
    <span class="eyebrow">2.0.3 candidate capabilities</span>
    <h2>Inspect Lightstreamer activity.</h2>
    <p>Workbench runs in Chrome DevTools. Each result links to captured Evidence or to an Injection that you deliberately created.</p>
  </header>
  <div class="capability-grid">
    <article class="capability-card"><span>Scope</span><h3>Select a runtime object</h3><p>Select the page, client, Session, Subscription, item, or listener. Workbench marks retired objects as read-only.</p></article>
    <article class="capability-card"><span>Evidence</span><h3>Read events in order</h3><p>See the event number, time, Source, phase, operation, object, and key for each event.</p></article>
    <article class="capability-card"><span>Diagnostics</span><h3>Review Notifications</h3><p>Review active conditions and recent Lightstreamer diagnostics. Dismiss a footer message without deleting its notification or Evidence.</p></article>
    <article class="capability-card"><span>Local Injection</span><h3>Test an update or sequence</h3><p>Compare, edit, validate, and inject a local Draft from one surface. Use a Scenario to test ordered Steps and Checkpoints.</p></article>
    <article class="capability-card"><span>Server Injection</span><h3>Send a Client Message</h3><p>Clone or author a message, review the exact sendMessage arguments, and send it once through the page-owned client.</p></article>
    <article class="capability-card"><span>History</span><h3>Search and export Evidence</h3><p>Use Filter, Find, and Freeze Evidence. Export the current Scope as JSON or offline HTML.</p></article>
  </div>
</section>

<section class="section section--media">
  <div class="media-copy">
    <span class="eyebrow">Workspace</span>
    <h2>Use Scope, Evidence, and Context.</h2>
    <p>Select a runtime object in Scope. Read its events in Ordered Evidence. Select an event to inspect its Fields and metadata in Context.</p>
    <a href="{{site}}docs/workspace/">Read about the workspace →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-workspace-context.png" alt="Current Workbench workspace with two-line Scope identities, a dedicated Evidence order rail, and selected update Fields." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section section--media section--media-reverse">
  <div class="media-copy">
    <span class="eyebrow">Notifications</span>
    <h2>Review conditions in one place.</h2>
    <p>Notifications contains Capture, Coverage, History, storage, recovery, Subscription, snapshot, keepalive, and COMMAND diagnostics. A stable condition updates its existing entry.</p>
    <p class="boundary-note"><strong>Dismiss affects only the footer.</strong> The notification and its supporting Evidence remain available.</p>
    <a href="{{site}}docs/developer-guide/#review-notifications">Read the Notifications procedure →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-notifications.png" alt="Workbench Notifications showing active conditions, recent Lightstreamer diagnostics, and links to supporting Evidence or affected Scope." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section section--media">
  <div class="media-copy">
    <span class="eyebrow">Local Injection</span>
    <h2>Test an Item Update in the page.</h2>
    <p>Create a Draft from captured Evidence, or author a COMMAND Item Update for a live Scope. Captured Drafts compare Source and Draft by default. Edit, validate, and inject directly from that preview.</p>
    <p>Use a Scenario when you must test more than one update. A Scenario has ordered Steps, delays, Checkpoints, and results for each Step.</p>
    <a href="{{site}}docs/local-injection/">Read the Local Injection procedure →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-local-injection-editor.png" alt="Protected Local Injection Draft with default Source comparison, raw JSON editing, validation, exact target details, and direct local delivery." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section section--media section--media-reverse">
  <div class="media-copy">
    <span class="eyebrow">Server Injection</span>
    <h2>Review a Client Message before it leaves the page.</h2>
    <p>Clone a captured Client Message, author one for a live client, or start from an application-owned Message Recipe. Review the exact target and <code>sendMessage</code> arguments before one deliberate send.</p>
    <p class="boundary-note"><strong>Processed is not an application result.</strong> Only the server-side application decides whether a later update or business effect occurs.</p>
    <a href="{{site}}docs/server-injection/">Read the Server Injection procedure →</a>
  </div>
  <figure class="product-frame">
    <img src="{{site}}assets/app-server-injection.png" alt="Reviewed Server Injection Draft showing the protected client and Session, exact Client Message arguments, and one deliberate send action." width="960" height="600" loading="lazy">
  </figure>
</section>

<section class="section guide-callout" id="developer-guide">
  <div class="guide-callout__copy">
    <span class="eyebrow">How to use Workbench</span>
    <h2>Use the developer guide.</h2>
    <p>The guide shows how to start Capture, select a Scope, inspect Evidence, review Notifications, and use Local or Server Injection.</p>
    <a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a>
  </div>
  <ol class="guide-steps">
    <li><span>01</span><div><strong>Open DevTools first</strong><p>Reload the page if the Lightstreamer client existed before Workbench opened.</p></div></li>
    <li><span>02</span><div><strong>Select a Scope</strong><p>Select the smallest runtime object that contains the problem.</p></div></li>
    <li><span>03</span><div><strong>Check the Evidence boundary</strong><p>Check Capture, Coverage, History, Source, and phase before you make a conclusion.</p></div></li>
    <li><span>04</span><div><strong>Review before delivery</strong><p>Confirm the target and boundary before Local Injection. For Server Injection, review every Client Message argument before the one deliberate send.</p></div></li>
  </ol>
</section>

<section class="section evidence-boundary">
  <div>
    <span class="eyebrow">Data and storage</span>
    <h2>Workbench keeps temporary Evidence in the browser.</h2>
  </div>
  <ul class="check-list">
    <li>One Panel Session owns one temporary Event History: up to 100,000 records or 256 MiB with normal IndexedDB storage; 5,000 records or 32 MiB in startup memory fallback.</li>
    <li>Captured data stays in the browser extension context. Configured production builds send fixed usage events and a random installation identifier to Google Analytics; the control is under <strong>More actions → Help &amp; resources → Usage analytics</strong>.</li>
    <li>Workbench has no account, advertising, remote error logging, or maintainer-operated collection backend. Turning analytics off removes its saved identifier and session.</li>
    <li>Workbench creates a versioned JSON or offline HTML export only when you request it. Each export excludes credentials.</li>
    <li>Workbench shows Coverage and the Committed Evidence Boundary. Do not use missing data as proof beyond these limits.</li>
  </ul>
  <p class="section__action"><a href="{{site}}docs/export-and-privacy/">Read about export and privacy →</a></p>
</section>

<section class="final-cta">
  <span class="eyebrow">Get started</span>
  <h2>Install Lightstreamer Workbench.</h2>
  <p>The Chrome Web Store currently serves 2.0.2. Version 2.0.3 remains a release candidate until Store review and publication complete.</p>
  <div class="inline-actions"><a class="button" href="{{store}}" target="_blank" rel="noopener noreferrer">Install current 2.0.2</a><a class="button button--secondary" href="{{site}}docs/developer-guide/">Open the developer guide</a></div>
</section>
