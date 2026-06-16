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
const magickPath = findExecutable(["magick", "convert"]);

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

if (!magickPath) {
  fail("ImageMagick executable not found. Install ImageMagick or ensure magick/convert is on PATH.");
}

const tempDir = await mkdtemp(join(tmpdir(), "lsew-store-assets-"));
const server = createStaticServer(tempDir);

try {
  await generateRasterBrandAssets();
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

  await generateRealAppPreviewAssets();
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
  clickRow(".command-current-row", "alpha");
  clickButton(".new-command-button");
  if (!document.querySelector(".command-draft-controls")) {
    throw new Error("New COMMAND editor did not open for the store listing screenshot.");
  }
  setValue(".command-draft-command", "UPDATE");
  setValue(".command-draft-key", "alpha");
  setValue('.command-draft-field-input[data-field-name="qty"]', "42");
  setValue('.command-draft-field-input[data-field-name="status"]', "review");
  const detail = document.querySelector(".command-detail-pane");
  const editor = document.querySelector(".new-command-editor");
  if (detail && editor instanceof HTMLElement) {
    detail.scrollTop = Math.max(0, editor.offsetTop - 72);
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

async function generateRasterBrandAssets() {
  const iconSource = resolve(projectRoot, "store-listing/source/icon.svg");
  const iconOutputs = [
    ["16x16", resolve(projectRoot, "public/icons/icon-16.png")],
    ["48x48", resolve(projectRoot, "public/icons/icon-48.png")],
    ["128x128", resolve(projectRoot, "public/icons/icon-128.png")],
    ["128x128", resolve(projectRoot, "store-listing/icons/icon-128.png")]
  ];

  await mkdir(resolve(projectRoot, "public/icons"), { recursive: true });
  await mkdir(resolve(projectRoot, "store-listing/icons"), { recursive: true });
  await mkdir(resolve(projectRoot, "store-listing/promo"), { recursive: true });

  for (const [size, outputPath] of iconOutputs) {
    await runImageMagick(["-background", "none", iconSource, "-resize", size, "-depth", "8", outputPath]);
    console.log(`Wrote ${outputPath}`);
  }

  await generatePromoTile({
    width: 440,
    height: 280,
    outputPath: resolve(projectRoot, "store-listing/promo/small-promo-tile.png"),
    iconSize: "64x64",
    iconGeometry: "+26+32",
    gradient: "rgba(9,17,31,0.98)-rgba(9,17,31,0.16)",
    overlaySvg: smallPromoOverlaySvg()
  });
  await generatePromoTile({
    width: 1400,
    height: 560,
    outputPath: resolve(projectRoot, "store-listing/promo/marquee-promo-tile.png"),
    iconSize: "104x104",
    iconGeometry: "+82+82",
    gradient: "rgba(9,17,31,0.98)-rgba(9,17,31,0.02)",
    overlaySvg: marqueePromoOverlaySvg()
  });
}

async function generatePromoTile(options) {
  const heroPath = resolve(projectRoot, "docs/assets/brand-hero-ai.png");
  const iconPath = resolve(projectRoot, "store-listing/icons/icon-128.png");
  const basePath = join(tempDir, `promo-base-${options.width}x${options.height}.png`);
  const iconOutputPath = join(tempDir, `promo-icon-${options.width}x${options.height}.png`);
  const gradientPath = join(tempDir, `promo-gradient-${options.width}x${options.height}.png`);
  const overlayPath = join(tempDir, `promo-overlay-${options.width}x${options.height}.svg`);
  const overlayPngPath = join(tempDir, `promo-overlay-${options.width}x${options.height}.png`);
  const withGradientPath = join(tempDir, `promo-with-gradient-${options.width}x${options.height}.png`);
  const withIconPath = join(tempDir, `promo-icon-composite-${options.width}x${options.height}.png`);

  await writeFile(overlayPath, options.overlaySvg);
  await runImageMagick([heroPath, "-resize", `${options.width}x${options.height}^`, "-gravity", "center", "-extent", `${options.width}x${options.height}`, basePath]);
  await runImageMagick([iconPath, "-resize", options.iconSize, iconOutputPath]);
  await runImageMagick(["-size", `${options.height}x${options.width}`, `gradient:${options.gradient}`, "-rotate", "90", gradientPath]);
  await runImageMagick(["-background", "none", overlayPath, overlayPngPath]);
  await runImageMagick([basePath, gradientPath, "-compose", "over", "-composite", withGradientPath]);
  await runImageMagick([withGradientPath, iconOutputPath, "-geometry", options.iconGeometry, "-compose", "over", "-composite", withIconPath]);
  await runImageMagick([withIconPath, overlayPngPath, "-compose", "over", "-composite", "-depth", "8", options.outputPath]);
  console.log(`Wrote ${options.outputPath}`);
}

async function generateRealAppPreviewAssets() {
  const docsAssetsDir = resolve(projectRoot, "docs/assets");
  const sourceScreenshots = [
    {
      source: resolve(projectRoot, "store-listing/screenshots/01-command-state-active-keys.png"),
      output: resolve(docsAssetsDir, "app-command-state.png")
    },
    {
      source: resolve(projectRoot, "store-listing/screenshots/02-timeline-event-detail.png"),
      output: resolve(docsAssetsDir, "app-timeline-detail.png")
    },
    {
      source: resolve(projectRoot, "store-listing/screenshots/03-new-command-update-editor.png"),
      output: resolve(docsAssetsDir, "app-replay-editor.png")
    }
  ];

  await mkdir(docsAssetsDir, { recursive: true });

  for (const screenshot of sourceScreenshots) {
    await runImageMagick([screenshot.source, "-resize", "960x600", "-strip", "-depth", "8", screenshot.output]);
    console.log(`Wrote ${screenshot.output}`);
  }

  await generateRealAppGallery({
    screenshots: sourceScreenshots.map((screenshot) => screenshot.output),
    outputPath: resolve(docsAssetsDir, "real-app-gallery.png")
  });
  await generateGitHubSocialPreviewAsset({
    screenshot: sourceScreenshots[0].output,
    outputPath: resolve(docsAssetsDir, "github-social-preview.png")
  });
}

async function generateRealAppGallery(options) {
  const canvasPath = join(tempDir, "real-app-gallery-canvas.png");
  const screenshotFramePath = join(tempDir, "real-app-gallery-command-state.png");
  const overlaySvgPath = join(tempDir, "real-app-gallery-overlay.svg");
  const overlayPngPath = join(tempDir, "real-app-gallery-overlay.png");
  const withScreenshotPath = join(tempDir, "real-app-gallery-with-screenshot.png");

  await writeFile(overlaySvgPath, realAppGalleryOverlaySvg());
  await runImageMagick(["-size", "1400x920", "gradient:#09111f-#102134", canvasPath]);
  await runImageMagick([options.screenshots[0], "-resize", "844x528^", "-gravity", "center", "-extent", "844x528", "-bordercolor", "#334155", "-border", "2", screenshotFramePath]);
  await runImageMagick(["-background", "none", overlaySvgPath, overlayPngPath]);
  await runImageMagick([canvasPath, screenshotFramePath, "-geometry", "+72+286", "-compose", "over", "-composite", withScreenshotPath]);
  await runImageMagick([withScreenshotPath, overlayPngPath, "-compose", "over", "-composite", "-depth", "8", options.outputPath]);
  console.log(`Wrote ${options.outputPath}`);
}

async function generateGitHubSocialPreviewAsset(options) {
  const heroPath = resolve(projectRoot, "docs/assets/brand-hero-ai.png");
  const logoPath = resolve(projectRoot, "docs/assets/logo.svg");
  const basePath = join(tempDir, "github-social-preview-base.png");
  const gradientPath = join(tempDir, "github-social-preview-gradient.png");
  const withGradientPath = join(tempDir, "github-social-preview-with-gradient.png");
  const screenshotFramePath = join(tempDir, "github-social-preview-screenshot.png");
  const withScreenshotPath = join(tempDir, "github-social-preview-with-screenshot.png");
  const logoRasterPath = join(tempDir, "github-social-preview-logo.png");
  const withLogoPath = join(tempDir, "github-social-preview-with-logo.png");
  const overlaySvgPath = join(tempDir, "github-social-preview-overlay.svg");
  const overlayPngPath = join(tempDir, "github-social-preview-overlay.png");

  await writeFile(overlaySvgPath, githubSocialPreviewOverlaySvg());
  await runImageMagick([heroPath, "-resize", "1280x640^", "-gravity", "center", "-extent", "1280x640", basePath]);
  await runImageMagick(["-size", "640x1280", "gradient:rgba(9,17,31,0.98)-rgba(9,17,31,0.28)", "-rotate", "90", gradientPath]);
  await runImageMagick([options.screenshot, "-resize", "474x296^", "-gravity", "center", "-extent", "474x296", "-bordercolor", "#334155", "-border", "2", screenshotFramePath]);
  await runImageMagick(["-background", "none", logoPath, "-resize", "92x92", logoRasterPath]);
  await runImageMagick(["-background", "none", overlaySvgPath, overlayPngPath]);
  await runImageMagick([basePath, gradientPath, "-compose", "over", "-composite", withGradientPath]);
  await runImageMagick([withGradientPath, screenshotFramePath, "-geometry", "+706+182", "-compose", "over", "-composite", withScreenshotPath]);
  await runImageMagick([withScreenshotPath, logoRasterPath, "-geometry", "+96+108", "-compose", "over", "-composite", withLogoPath]);
  await runImageMagick([withLogoPath, overlayPngPath, "-compose", "over", "-composite", "-depth", "8", options.outputPath]);
  console.log(`Wrote ${options.outputPath}`);
}

function smallPromoOverlaySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">
  <text x="26" y="132" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="800">Lightstreamer</text>
  <text x="26" y="166" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="27" font-weight="800">Workbench</text>
  <text x="28" y="204" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="16">Inspect COMMAND streams</text>
  <text x="28" y="229" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="16">inside Chrome DevTools.</text>
  <rect x="276" y="214" width="64" height="25" rx="7" fill="#2563eb"/>
  <text x="290" y="232" fill="#eff6ff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700">ADD</text>
  <rect x="350" y="214" width="74" height="25" rx="7" fill="#0f766e"/>
  <text x="361" y="232" fill="#ecfeff" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700">REPLAY</text>
</svg>`;
}

function marqueePromoOverlaySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="560" viewBox="0 0 1400 560">
  <text x="82" y="258" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="800">Lightstreamer</text>
  <text x="82" y="330" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="62" font-weight="800">Event Workbench</text>
  <text x="86" y="394" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="30">Inspect COMMAND streams, changed fields,</text>
  <text x="86" y="436" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="30">snapshots, and local synthetic replay.</text>
  <rect x="86" y="482" width="158" height="42" rx="8" fill="#2563eb"/>
  <text x="121" y="510" fill="#eff6ff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">ADD keys</text>
  <rect x="266" y="482" width="196" height="42" rx="8" fill="#0f766e"/>
  <text x="301" y="510" fill="#ecfeff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">UPDATE state</text>
  <rect x="484" y="482" width="194" height="42" rx="8" fill="#334155"/>
  <text x="520" y="510" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">Replay locally</text>
</svg>`;
}

function realAppGalleryOverlaySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="920" viewBox="0 0 1400 920">
  <text x="72" y="112" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800">COMMAND state walkthrough</text>
  <text x="74" y="166" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="26">One release-current panel capture, annotated around the developer workflow.</text>
  <rect x="72" y="210" width="208" height="42" rx="8" fill="#2563eb"/>
  <text x="104" y="238" fill="#eff6ff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">Active keys</text>
  <rect x="302" y="210" width="222" height="42" rx="8" fill="#0f766e"/>
  <text x="334" y="238" fill="#ecfeff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">Changed fields</text>
  <rect x="546" y="210" width="188" height="42" rx="8" fill="#334155"/>
  <text x="579" y="238" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="800">Replay path</text>
  <text x="72" y="854" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="22">Generated from the current extension screenshot harness before each release.</text>
  <rect x="966" y="286" width="352" height="132" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/>
  <text x="996" y="334" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800">1. Select a key</text>
  <text x="996" y="374" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">See the active COMMAND keys</text>
  <text x="996" y="402" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">for the selected subscription.</text>
  <rect x="966" y="446" width="352" height="132" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/>
  <text x="996" y="494" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800">2. Inspect fields</text>
  <text x="996" y="534" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">Compare current values and</text>
  <text x="996" y="562" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">recent changes at a glance.</text>
  <rect x="966" y="606" width="352" height="132" rx="12" fill="#0f172a" stroke="#334155" stroke-width="2"/>
  <text x="996" y="654" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="800">3. Clone for replay</text>
  <text x="996" y="694" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">Start a synthetic local update</text>
  <text x="996" y="722" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="20">from the captured event.</text>
</svg>`;
}

function githubSocialPreviewOverlaySvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640">
  <text x="210" y="148" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="800">Lightstreamer Event Workbench</text>
  <text x="212" y="186" fill="#cbd5e1" font-family="Arial, Helvetica, sans-serif" font-size="22">Chrome DevTools extension</text>
  <text x="96" y="298" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800">Inspect COMMAND</text>
  <text x="96" y="365" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="800">streams in DevTools</text>
  <text x="100" y="420" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="25">Track keys, changed fields, snapshots,</text>
  <text x="100" y="456" fill="#d8dee9" font-family="Arial, Helvetica, sans-serif" font-size="25">and local synthetic replay.</text>
  <rect x="100" y="502" width="120" height="38" rx="8" fill="#2563eb"/>
  <text x="127" y="527" fill="#eff6ff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800">ADD</text>
  <rect x="238" y="502" width="150" height="38" rx="8" fill="#0f766e"/>
  <text x="266" y="527" fill="#ecfeff" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800">UPDATE</text>
  <rect x="406" y="502" width="138" height="38" rx="8" fill="#334155"/>
  <text x="434" y="527" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800">REPLAY</text>
  <rect x="706" y="502" width="474" height="38" rx="8" fill="rgba(15,23,42,0.74)" stroke="#334155" stroke-width="1"/>
  <text x="728" y="527" fill="#f8fafc" font-family="Arial, Helvetica, sans-serif" font-size="18" font-weight="800">Backend-free Lightstreamer debugging in the browser</text>
</svg>`;
}

async function runImageMagick(args, options = {}) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(magickPath, args, {
      cwd: options.cwd,
      stdio: "pipe"
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`ImageMagick failed with exit ${code}:\n${stderr}`));
      }
    });
  });
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

function findExecutable(names) {
  const pathDirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  for (const name of names) {
    for (const pathDir of pathDirs) {
      const candidate = join(pathDir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
