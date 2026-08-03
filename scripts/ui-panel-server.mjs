#!/usr/bin/env node

import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporaryRoot = await mkdtemp(join(tmpdir(), "lsew-ui-panel-"));
const server = createServer(createStaticHandler(temporaryRoot));
let shuttingDown = false;

try {
  await buildScenarioBundle(temporaryRoot);
  await mkdir(join(temporaryRoot, "icons"), { recursive: true });
  await copyFile(
    resolve(projectRoot, "public/icons/title-icon.svg"),
    join(temporaryRoot, "icons/title-icon.svg")
  );
  await writeFile(join(temporaryRoot, "index.html"), htmlSource());

  const port = Number(process.env.LSEW_UI_PORT ?? 4173);
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(port, "127.0.0.1", resolvePromise);
  });

  console.log(`Workbench UI scenario server listening on http://127.0.0.1:${port}`);
  await new Promise(() => {});
} finally {
  await shutdown();
}

async function buildScenarioBundle(outputDir) {
  const entryPath = join(outputDir, "entry.ts");
  await writeFile(entryPath, scenarioHarnessSource());
  await build({
    bundle: true,
    entryPoints: [entryPath],
    format: "esm",
    loader: { ".css": "css" },
    outdir: outputDir,
    platform: "browser",
    sourcemap: false,
    target: "chrome120"
  });
}

function scenarioHarnessSource() {
  const mainPath = JSON.stringify(resolve(projectRoot, "src/extension/panel/main.ts"));
  const storePath = JSON.stringify(resolve(projectRoot, "src/core/event-store.ts"));
  const scenarioPath = JSON.stringify(resolve(projectRoot, "tests/support/panel-scenarios.ts"));
  const scenarioDomPath = JSON.stringify(
    resolve(projectRoot, "tests/support/panel-scenario-dom.ts")
  );

  return `
import { renderPanel } from ${mainPath};
import { createEventStore } from ${storePath};
import {
  getPanelScenario,
  isPanelScenarioId
} from ${scenarioPath};
import { applyPanelScenario } from ${scenarioDomPath};

const scenarioId = new URLSearchParams(window.location.search).get("scenario") ?? "command-state";
if (!isPanelScenarioId(scenarioId)) {
  throw new Error("Unknown Workbench UI scenario: " + scenarioId);
}

const root = document.querySelector("#app");
if (!(root instanceof HTMLElement)) {
  throw new Error("Workbench UI scenario requires #app.");
}

const store = createEventStore();
const bridge = {
  reinjectDraft() {
    return Promise.resolve({
      requestId: "ui-scenario-preview",
      ok: true,
      status: "success",
      timestamp: 1780872000000
    });
  }
};
const panel = renderPanel(root, undefined, { store, bridge });
applyPanelScenario(root, panel, store, getPanelScenario(scenarioId));

await new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(resolve));
});
document.documentElement.dataset.scenario = scenarioId;
document.documentElement.dataset.sceneReady = "true";
`;
}

function htmlSource() {
  return `<!doctype html>
<html lang="en" data-workbench-ui-harness="true" data-store-listing-harness="true">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark light">
    <link rel="icon" href="/icons/title-icon.svg">
    <title>Lightstreamer Workbench UI scenario</title>
    <link rel="stylesheet" href="/entry.css">
    <style>
      html, body, #app {
        height: 100%;
        margin: 0;
      }
      body {
        overflow: hidden;
      }
    </style>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/entry.js"></script>
  </body>
</html>
`;
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
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (server.listening) {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
