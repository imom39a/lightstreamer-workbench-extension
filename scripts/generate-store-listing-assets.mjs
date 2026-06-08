#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(projectRoot, "store-listing/screenshots");
const chromePath = findChrome();

const screenshots = [
  {
    file: "01-command-state-active-keys.png",
    scene: "command-state"
  },
  {
    file: "02-timeline-event-detail.png",
    scene: "timeline-detail"
  },
  {
    file: "03-new-command-update-editor.png",
    scene: "new-command"
  }
];

if (!chromePath) {
  fail("Chrome executable not found. Set CHROME_PATH or install Google Chrome.");
}

const tempDir = await mkdtemp(join(tmpdir(), "lsew-store-assets-"));
const server = createStaticServer(tempDir);

try {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(tempDir, "entry.ts"), screenshotHarnessSource());
  await writeFile(join(tempDir, "index.html"), htmlSource());
  await build({
    bundle: true,
    entryPoints: [join(tempDir, "entry.ts")],
    format: "esm",
    loader: { ".css": "css" },
    outdir: tempDir,
    sourcemap: false,
    target: "chrome120"
  });

  await new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", resolveServer);
  });
  const { port } = server.address();

  for (const screenshot of screenshots) {
    const url = `http://127.0.0.1:${port}/index.html?scene=${encodeURIComponent(screenshot.scene)}`;
    const outputPath = join(outputDir, screenshot.file);
    await runChromeScreenshot(url, outputPath);
    console.log(`Wrote ${outputPath}`);
  }
} finally {
  await new Promise((resolveServer) => server.close(resolveServer));
  await rm(tempDir, { recursive: true, force: true });
}

function screenshotHarnessSource() {
  const mainPath = JSON.stringify(resolve(projectRoot, "src/extension/panel/main.ts"));
  const storePath = JSON.stringify(resolve(projectRoot, "src/core/event-store.ts"));
  return `
import { renderPanel } from ${mainPath};
import { createEventStore } from ${storePath};

const scene = new URLSearchParams(window.location.search).get("scene") ?? "command-state";
const root = document.querySelector("#app");
const store = createEventStore();
const bridge = {
  reinjectDraft() {
    return Promise.resolve({
      requestId: "store-listing-preview",
      ok: true,
      status: "success",
      timestamp: 1780872000000
    });
  }
};
const panel = renderPanel(root, undefined, { store, bridge });
panel.setStatus("bridge connected");
seedEvents(store);

if (scene === "command-state") {
  clickView("COMMAND State");
  clickRow(".command-current-row", "alpha");
} else if (scene === "timeline-detail") {
  clickView("Timeline");
  clickRow(".event-row", "UPDATE/alpha");
  clickButton(".clone-button");
} else if (scene === "new-command") {
  clickView("COMMAND State");
  clickButton(".new-command-button");
  setValue(".command-draft-command", "UPDATE");
  setValue(".command-draft-key", "alpha");
  setValue('.command-draft-field-input[data-field-name="qty"]', "42");
  setValue('.command-draft-field-input[data-field-name="status"]', "review");
  const detail = document.querySelector(".command-detail-pane");
  if (detail) {
    detail.scrollTop = detail.scrollHeight;
  }
}

document.documentElement.dataset.sceneReady = "true";

function seedEvents(targetStore) {
  const base = 1780872000000;
  targetStore.append(event("event-1", base + 1, {
    command: "ADD",
    key: "alpha",
    snapshot: true,
    fields: {
      command: "ADD",
      key: "alpha",
      name: "Alpha",
      qty: "10",
      status: "snapshot",
      version: "1"
    },
    changedFields: {
      command: "ADD",
      key: "alpha",
      name: "Alpha",
      qty: "10",
      status: "snapshot",
      version: "1"
    }
  }));
  targetStore.append(event("event-2", base + 2, {
    command: "ADD",
    key: "beta",
    snapshot: true,
    fields: {
      command: "ADD",
      key: "beta",
      name: "Beta",
      qty: "5",
      status: "snapshot",
      version: "1"
    },
    changedFields: {
      command: "ADD",
      key: "beta",
      name: "Beta",
      qty: "5",
      status: "snapshot",
      version: "1"
    }
  }));
  targetStore.append(event("event-3", base + 3, {
    command: "UPDATE",
    key: "alpha",
    fields: {
      command: "UPDATE",
      key: "alpha",
      name: "Alpha",
      qty: "15",
      status: "live",
      version: "2"
    },
    changedFields: {
      qty: "15",
      status: "live",
      version: "2"
    }
  }));
  targetStore.append(event("event-4", base + 4, {
    command: "DELETE",
    key: "beta",
    fields: {
      command: "DELETE",
      key: "beta",
      name: "Beta",
      qty: "0",
      status: "deleted",
      version: "2"
    },
    changedFields: {
      status: "deleted",
      version: "2"
    }
  }));
  targetStore.append(event("event-5", base + 5, {
    command: "UPDATE",
    key: "alpha",
    source: "synthetic",
    synthetic: true,
    fields: {
      command: "UPDATE",
      key: "alpha",
      name: "Alpha",
      qty: "18",
      status: "synthetic replay",
      version: "3"
    },
    changedFields: {
      qty: "18",
      status: "synthetic replay",
      version: "3"
    },
    raw: {
      sourceEventId: "event-3",
      targetSubscriptionId: "subscription-1",
      targetListenerId: "listener-1"
    }
  }));
  targetStore.append(event("event-6", base + 6, {
    command: "UPDATE",
    key: "ghost",
    fields: {
      command: "UPDATE",
      key: "ghost",
      name: "Ghost",
      qty: "1",
      status: "diagnostic",
      version: "1"
    },
    changedFields: {
      status: "diagnostic"
    },
    raw: {
      diagnostic: "unknown-key-update"
    }
  }));
}

function event(id, timestamp, options) {
  return {
    id,
    timestamp,
    direction: "inbound",
    source: options.source ?? "server",
    captureSource: "listener",
    synthetic: options.synthetic ?? false,
    kind: "item-update",
    client: {
      id: "client-1",
      status: "CONNECTED:WS-STREAMING",
      serverAddress: "https://push.example.test/lightstreamer"
    },
    subscription: {
      id: "subscription-1",
      mode: "COMMAND",
      items: ["scenario.snapshot-basic"],
      fields: ["command", "key", "name", "qty", "status", "version"],
      requestedSnapshot: "yes"
    },
    listener: { id: "listener-1" },
    item: { name: "scenario.snapshot-basic", position: 1 },
    update: {
      isSnapshot: options.snapshot ?? false,
      command: options.command,
      key: options.key,
      fields: options.fields,
      changedFields: options.changedFields
    },
    raw: {
      callback: "onItemUpdate",
      sample: true,
      ...(options.raw ?? {})
    }
  };
}

function clickView(label) {
  const button = Array.from(document.querySelectorAll(".view-selector button"))
    .find((candidate) => candidate.textContent === label);
  button?.click();
}

function clickRow(selector, text) {
  const row = Array.from(document.querySelectorAll(selector))
    .find((candidate) => (candidate.textContent ?? "").includes(text));
  row?.click();
}

function clickButton(selector) {
  document.querySelector(selector)?.click();
}

function setValue(selector, value) {
  const element = document.querySelector(selector);
  if (!element) {
    return;
  }
  element.value = value;
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", {
    bubbles: true
  }));
}
`;
}

function htmlSource() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Lightstreamer Event Workbench Store Listing Screenshot</title>
    <link rel="stylesheet" href="/entry.css">
    <style>
      html, body, #app {
        height: 100%;
        margin: 0;
      }
      body {
        background: #ffffff;
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

function createStaticServer(root) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const requested = resolve(root, `.${decodeURIComponent(pathname)}`);
    if ((requested !== root && !requested.startsWith(`${root}/`)) || !existsSync(requested)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentType(requested)
    });
    createReadStream(requested).pipe(response);
  });
}

function contentType(path) {
  switch (extname(path)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function runChromeScreenshot(url, outputPath) {
  const profileDir = await mkdtemp(join(tmpdir(), "lsew-chrome-profile-"));
  try {
    await new Promise((resolveRun, rejectRun) => {
      let timedOut = false;
      const child = spawn(chromePath, [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--no-default-browser-check",
        "--force-device-scale-factor=1",
        "--run-all-compositor-stages-before-draw",
        "--window-size=1280,800",
        "--virtual-time-budget=2000",
        `--user-data-dir=${profileDir}`,
        `--screenshot=${outputPath}`,
        url
      ], {
        stdio: "pipe"
      });

      let stderr = "";
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, 15000);

      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        rejectRun(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code === 0 || (timedOut && existsSync(outputPath))) {
          resolveRun();
        } else {
          rejectRun(new Error(`Chrome screenshot failed for ${url} with exit ${code}:\n${stderr}`));
        }
      });
    });
  } finally {
    await rm(profileDir, { recursive: true, force: true });
  }
}

function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
