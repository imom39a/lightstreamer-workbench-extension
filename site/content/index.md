<div class="a-home">
  <div class="a-eyebrow">Documentation / Overview</div>
  <h1>Lightstreamer Workbench</h1>
  <p class="a-definition">A Chrome DevTools extension for inspecting activity from the official Lightstreamer Web Client and testing how an application handles updates and messages.</p>

  <section class="a-home-section a-start" aria-labelledby="a-start-title">
    <div class="a-section-heading"><span class="a-section-number">01</span><h2 id="a-start-title">Start with a live page</h2></div>
    <div class="a-section-body">
      <p><a href="{{store}}" target="_blank" rel="noopener noreferrer">Install Workbench from the Chrome Web Store</a>. Open DevTools on the application page and select the Workbench panel. The <a href="{{site}}docs/getting-started/">getting started guide</a> shows how to check Capture and inspect your first Session.</p>
    </div>
  </section>

  <section class="a-home-section a-workspace-section" aria-labelledby="a-workspace-title">
    <div class="a-section-heading"><span class="a-section-number">02</span><h2 id="a-workspace-title">Read the workspace</h2></div>
    <div class="a-section-body">
      <p>Workbench organizes the inspected page into three parts. Select where to look, read what happened, then inspect the selected record.</p>
      <figure class="a-workspace-figure">
        <img src="{{site}}assets/app-workspace-context.png" alt="Workbench panel with Runtime Scope on the left, Ordered Evidence in the center, and Context on the right." width="960" height="600">
        <figcaption><strong>Runtime Scope</strong> selects a client, Session, or Subscription. <strong>Ordered Evidence</strong> lists captured activity. <strong>Context</strong> shows details for the selected record.</figcaption>
      </figure>
      <p class="a-related">Read more: <a href="{{site}}docs/workspace/">Workspace</a> · <a href="{{site}}docs/evidence/">Evidence and search</a> · <a href="{{site}}docs/command-state/">COMMAND lifecycles</a></p>
    </div>
  </section>

  <section class="a-home-section" aria-labelledby="a-task-title">
    <div class="a-section-heading"><span class="a-section-number">03</span><h2 id="a-task-title">Choose a task</h2></div>
    <div class="a-section-body">
      <div class="a-task-list">
        <a href="{{site}}docs/developer-guide/"><span>Inspect activity</span><span>Find a Session, Subscription, or Item Update in captured Evidence.</span><span aria-hidden="true">→</span></a>
        <a href="{{site}}docs/local-injection/"><span>Test an Item Update</span><span>Deliver a Local Injection to the page without a backend change.</span><span aria-hidden="true">→</span></a>
        <a href="{{site}}docs/server-injection/"><span>Send a Client Message</span><span>Review a Server Injection sent through the client's current Session.</span><span aria-hidden="true">→</span></a>
      </div>
    </div>
  </section>

  <section class="a-home-section" aria-labelledby="a-agent-title">
    <div class="a-section-heading"><span class="a-section-number">04</span><h2 id="a-agent-title">Connect an MCP agent</h2></div>
    <div class="a-section-body"><p>Agent access needs Node.js 22.12+, the npm companion, and an MCP app. Run setup and add its output to the app's MCP settings. The app starts the companion. Requested Evidence may reach your model provider. Follow the <a href="{{site}}docs/agent-access/">MCP setup guide</a>.</p></div>
  </section>

  <section class="a-home-section a-note-section" aria-labelledby="a-data-title">
    <div class="a-section-heading"><span class="a-section-number">05</span><h2 id="a-data-title">Data in this session</h2></div>
    <div class="a-section-body"><p>Workbench keeps temporary Evidence in the browser. An export is a deliberate download. See <a href="{{site}}docs/export-and-privacy/">export and privacy</a> for storage and sharing details.</p></div>
  </section>
</div>
