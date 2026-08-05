#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-react-diagnose-"));
const server = createServer(createStaticHandler(temporaryRoot));
let shuttingDown = false;

try {
  await buildScenarioBundle(temporaryRoot);
  await mkdir(join(temporaryRoot, "icons"), { recursive: true });
  await copyFile(resolve(projectRoot, "public/icons/title-icon.svg"), join(temporaryRoot, "icons/title-icon.svg"));
  await writeFile(join(temporaryRoot, "index.html"), htmlSource());

  const port = Number(process.env.LSEW_REACT_UI_PORT ?? 4180);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });
  console.log(`React Diagnose scenario server listening on http://127.0.0.1:${port}`);
  await new Promise(() => {});
} finally {
  await shutdown();
}

async function buildScenarioBundle(outputDir) {
  const entryPath = join(outputDir, "entry.tsx");
  await writeFile(entryPath, scenarioHarnessSource());
  await build({
    absWorkingDir: projectRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    loader: { ".css": "css" },
    outdir: outputDir,
    platform: "browser",
    nodePaths: [resolve(projectRoot, "node_modules")],
    sourcemap: false,
    target: "chrome120"
  });
}

function scenarioHarnessSource() {
  const source = (path) => JSON.stringify(resolve(projectRoot, path));
  return `
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { createInMemoryEventHistory } from ${source("src/core/event-history.ts")};
import { WorkbenchPanel } from ${source("src/extension/panel/react/workbench-panel.tsx")};
import { createWorkbenchRuntime } from ${source("src/extension/panel/workbench-runtime.ts")};
import { getReactDiagnoseScenario, isReactDiagnoseScenarioId } from ${source("tests/support/react-diagnose-scenarios.ts")};

const params = new URLSearchParams(window.location.search);
const scenarioId = params.get("scenario") ?? "live-selected";
if (!isReactDiagnoseScenarioId(scenarioId)) throw new Error("Unknown React Diagnose scenario: " + scenarioId);
const theme = params.get("theme") === "auto" ? "auto" : params.get("theme") === "light" ? "light" : "dark";
const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) throw new Error("React Diagnose scenario requires #app.");

const scenario = getReactDiagnoseScenario(scenarioId);
const history = createInMemoryEventHistory();
for (const event of scenario.initialEvents) history.append(event);
const runtime = createWorkbenchRuntime({
  history,
  captureStatus: scenario.captureStatus,
  capture: scenario.capture,
  theme
});
for (const frame of scenario.topologySyncFrames ?? []) {
  runtime.dispatch({ type: "apply-topology-sync-frame", frame });
}
for (const message of scenario.captureMessages ?? []) {
  runtime.dispatch({ type: "ingest-capture-message", message });
}
const reactRoot = createRoot(root);
reactRoot.render(createElement(WorkbenchPanel, { runtime }));

await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
if (scenario.selectedScope) {
  const scope = runtime.getSnapshot().scope.nodes.find((node) =>
    node.kind === scenario.selectedScope.kind &&
    node.retired === scenario.selectedScope.retired &&
    node.label === scenario.selectedScope.label
  );
  if (!scope) throw new Error("React Diagnose scenario Scope was not projected: " + scenario.selectedScope.label);
  runtime.dispatch({ type: "set-scope", scopeId: scope.id });
  runtime.dispatch({ type: "set-scope-focus", scopeId: scope.id });
}
if (scenario.selectedEventId) runtime.dispatch({ type: "select-evidence", eventId: scenario.selectedEventId });
if (scenario.storage) runtime.dispatch({ type: "set-storage-state", storage: scenario.storage });
if (scenario.filterQuery) runtime.dispatch({ type: "set-filters", filters: { query: scenario.filterQuery } });
if (scenario.findQuery) runtime.dispatch({ type: "set-find", value: scenario.findQuery });
if (scenario.freezeBeforeLaterEvents) runtime.dispatch({ type: "freeze-evidence" });
for (const event of scenario.laterEvents ?? []) history.append(event);
if (scenario.openRawEvidence && scenario.selectedEventId) runtime.dispatch({ type: "open-raw-evidence", eventId: scenario.selectedEventId });
await new Promise((resolve) => setTimeout(resolve, 48));
document.documentElement.dataset.reactScenario = scenarioId;
document.documentElement.dataset.reactSceneReady = "true";
window.addEventListener("pagehide", () => { reactRoot.unmount(); runtime.dispose(); }, { once: true });
`;
}

function htmlSource() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <link rel="icon" href="/icons/title-icon.svg">
    <title>Lightstreamer Workbench React Diagnose scenario</title>
    <link rel="stylesheet" href="/entry.css">
    <style>html, body, #app { height: 100%; margin: 0; } body { overflow: hidden; }</style>
  </head>
  <body><main id="app"></main><script type="module" src="/entry.js"></script></body>
</html>`;
}

function createStaticHandler(root) {
  return (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const requested = resolve(root, `.${decodeURIComponent(pathname)}`);
    if ((requested !== root && !requested.startsWith(`${root}/`)) || !existsSync(requested)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(requested) });
    createReadStream(requested).pipe(response);
  };
}

function contentType(path) {
  switch (extname(path)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".js": return "text/javascript; charset=utf-8";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server.listening) await new Promise((resolvePromise) => server.close(resolvePromise));
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
