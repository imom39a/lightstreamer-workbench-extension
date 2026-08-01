import { type TopologyStructuredSnapshot } from "./topology-export";

const HTML_REPORT_EVIDENCE_LIMIT = 25;

export function renderTopologyHtmlReport(snapshot: TopologyStructuredSnapshot): string {
  const clients = recordArray(snapshot.clients);
  const unassigned = recordArray(snapshot.unassignedSubscriptions);
  const diagnostics = snapshot.diagnostics;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Lightstreamer Workbench Topology report</title>
<style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;line-height:1.45}body{max-width:1200px;margin:0 auto;padding:24px;background:#111827;color:#e5e7eb}h1,h2,h3{line-height:1.2}h1{margin-bottom:4px}.meta{color:#9ca3af;margin-top:0}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px}.metric,.panel,details{border:1px solid #374151;border-radius:8px;background:#1f2937}.metric{padding:10px}.metric strong{display:block;font-size:1.35rem}.panel{padding:16px;margin:16px 0}details{margin:8px 0;padding:8px 10px}summary{cursor:pointer;font-weight:650}.hierarchy details{margin-left:14px}dl{display:grid;grid-template-columns:minmax(140px,240px) minmax(0,1fr);gap:4px 12px}dt{color:#9ca3af}dd{margin:0;overflow-wrap:anywhere}code{overflow-wrap:anywhere}.evidence{max-height:320px;overflow:auto}.diagnostic-warning{border-left:4px solid #f59e0b}.diagnostic-info{border-left:4px solid #3b82f6}label{display:grid;gap:6px}input{font:inherit;padding:9px;border:1px solid #4b5563;border-radius:6px;background:#111827;color:inherit}[hidden]{display:none!important}@media print{body{background:#fff;color:#111}.panel,.metric,details{background:#fff;border-color:#aaa}input{display:none}}
</style>
</head>
<body>
<header>
<h1>Lightstreamer Workbench Topology report</h1>
<p class="meta">Schema ${escapeHtml(snapshot.schema.id)} v${snapshot.schema.version} · generated ${escapeHtml(snapshot.generatedAt)}</p>
<p class="meta">Redaction: ${escapeHtml(snapshot.privacy.redactedCategories.join(", ") || "none")} · complete evidence: ${snapshot.privacy.completeEvidenceIncluded ? "included" : "not included"} · credentials: excluded</p>
</header>
<section class="panel" aria-labelledby="capture-heading">
<h2 id="capture-heading">Capture coverage</h2>
${definitionList(snapshot.capture as unknown as Record<string, unknown>)}
</section>
<section class="panel" aria-labelledby="overview-heading">
<h2 id="overview-heading">Overview</h2>
<div class="metrics">${Object.entries(snapshot.overview)
    .map(([label, value]) => `<div class="metric"><span>${escapeHtml(humanize(label))}</span><strong>${escapeHtml(String(value))}</strong></div>`)
    .join("")}</div>
</section>
<section class="panel" aria-labelledby="diagnostics-heading">
<h2 id="diagnostics-heading">Diagnostics (${diagnostics.length})</h2>
${diagnostics.length === 0 ? "<p>No diagnostics captured.</p>" : `<ul>${diagnostics.map((diagnostic) => `<li class="diagnostic-${diagnostic.severity}"><strong>${escapeHtml(diagnostic.code)}</strong> · ${escapeHtml(diagnostic.subject)} — ${escapeHtml(diagnostic.message)}</li>`).join("")}</ul>`}
</section>
<section class="panel hierarchy" aria-labelledby="hierarchy-heading">
<h2 id="hierarchy-heading">Topology hierarchy</h2>
<label>Search hierarchy<input id="topology-search" type="search" placeholder="Client, Session, Subscription, item, listener, key, diagnostic…"></label>
<div id="topology-tree">${clients.map(renderClient).join("")}${unassigned.length > 0 ? `<details data-search-node open><summary>Unassigned Subscriptions (${unassigned.length})</summary>${unassigned.map(renderSubscription).join("")}</details>` : ""}</div>
</section>
<script>
(()=>{const input=document.getElementById('topology-search');const nodes=Array.from(document.querySelectorAll('[data-search-node]'));input.addEventListener('input',()=>{const query=input.value.trim().toLowerCase();for(const node of nodes){const match=!query||node.textContent.toLowerCase().includes(query);node.hidden=!match;if(match&&query)node.open=true;}});})();
</script>
</body>
</html>`;
}

function renderClient(client: Record<string, unknown>): string {
  const sessions = recordArray(client.sessions);
  const waiting = recordArray(client.waitingSubscriptions);
  return `<details data-search-node open><summary>Client ${escapeHtml(valueText(client.id))}</summary>
  <h3>Client identity and coverage</h3>${definitionList(client, new Set(["runtime", "metrics", "sessions", "waitingSubscriptions"]))}
  <h3>Observed runtime</h3>${definitionList(record(client.runtime))}
  <h3>Metrics</h3>${definitionList(record(client.metrics))}
  ${sessions.map(renderSession).join("")}
  ${waiting.length > 0 ? `<details data-search-node><summary>Waiting Subscriptions (${waiting.length})</summary>${waiting.map(renderSubscription).join("")}</details>` : ""}
  </details>`;
}

function renderSession(session: Record<string, unknown>): string {
  const subscriptions = recordArray(session.subscriptions);
  return `<details data-search-node open><summary>Session ${escapeHtml(valueText(session.id))} · ${escapeHtml(valueText(session.normalizedStatus))}</summary>
  <h3>Session state</h3>${definitionList(session, new Set(["runtime", "metrics", "subscriptions"]))}
  <h3>Observed runtime</h3>${definitionList(record(session.runtime))}
  <h3>Metrics</h3>${definitionList(record(session.metrics))}
  ${subscriptions.map(renderSubscription).join("")}
  </details>`;
}

function renderSubscription(subscription: Record<string, unknown>): string {
  const items = recordArray(subscription.items);
  const listeners = recordArray(subscription.listeners);
  const semantic = record(subscription.semanticLifecycle);
  return `<details data-search-node open><summary>Subscription ${escapeHtml(valueText(subscription.id))} · ${escapeHtml(valueText(record(subscription.configuration).mode))}</summary>
  <h3>Subscription identity</h3>${definitionList(subscription, new Set(["lifecycle", "configuration", "metrics", "semanticLifecycle", "items", "listeners"]))}
  <h3>Lifecycle</h3>${definitionList(record(subscription.lifecycle))}
  <h3>Configuration</h3>${definitionList(record(subscription.configuration))}
  <h3>Observed metrics</h3>${definitionList(record(subscription.metrics))}
  <h3>Semantic lifecycle</h3>
  ${renderBoundedEvidence("Establishments", record(semantic.establishments))}
  ${renderBoundedEvidence("COMMAND generations", record(semantic.commandGenerations))}
  ${items.map(renderItem).join("")}
  ${listeners.map(renderListener).join("")}
  </details>`;
}

function renderItem(item: Record<string, unknown>): string {
  return `<details data-search-node><summary>Item ${escapeHtml(valueText(item.name))} · position ${escapeHtml(valueText(item.position))}</summary>${definitionList(item, new Set(["metrics"]))}<h3>Metrics</h3>${definitionList(record(item.metrics))}</details>`;
}

function renderListener(listener: Record<string, unknown>): string {
  return `<details data-search-node><summary>Listener ${escapeHtml(valueText(listener.id))}</summary>${definitionList(listener)}</details>`;
}

function renderBoundedEvidence(label: string, collection: Record<string, unknown>): string {
  const entries = Array.isArray(collection.entries) ? collection.entries : [];
  const total = numberValue(collection.total);
  const reportEntries = entries.slice(-HTML_REPORT_EVIDENCE_LIMIT);
  const included = reportEntries.length;
  const omitted = Math.max(0, total - included);
  const snapshotIncluded = numberValue(collection.includedCount);
  return `<details data-search-node><summary>${escapeHtml(label)} · ${included.toLocaleString("en-US")} shown / ${total.toLocaleString("en-US")} total · ${omitted.toLocaleString("en-US")} omitted from report · snapshot included ${snapshotIncluded.toLocaleString("en-US")} (${escapeHtml(valueText(collection.samplingStrategy))})</summary><ol class="evidence">${reportEntries.map((entry) => `<li><code>${escapeHtml(JSON.stringify(entry))}</code></li>`).join("")}</ol></details>`;
}

function definitionList(
  values: Record<string, unknown>,
  omitted = new Set<string>()
): string {
  return `<dl>${Object.entries(values)
    .filter(([key]) => !omitted.has(key))
    .map(([key, value]) => `<dt>${escapeHtml(humanize(key))}</dt><dd>${escapeHtml(valueText(value))}</dd>`)
    .join("")}</dl>`;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unavailable";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function humanize(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
