#!/usr/bin/env node

import { access, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Browser, Cache } from "@puppeteer/browsers";
import { chromium } from "@playwright/test";
import { chromeTestArguments } from "./chrome-test-policy.mjs";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = "/tmp/filter-impl-14-visual-evidence";
const artifactRoot = resolve(projectRoot, "test-results/filter-impl-14-visual-qa");
const entries = Object.freeze([
  {
    id: "normal-selected-action-context-light",
    viewport: { width: 900, height: 700 },
    theme: "light",
    base: "base-normal-selected-action-context-light.png",
    current: "current-normal-selected-action-context-light.png"
  },
  {
    id: "hidden-selection-reveal-dark",
    viewport: { width: 900, height: 700 },
    theme: "dark",
    base: "base-hidden-selection-reveal-dark.png",
    current: "current-hidden-selection-reveal-dark.png"
  }
]);

for (const directory of ["reference", "current", "diff", "contact-sheets"]) {
  await mkdir(join(artifactRoot, directory), { recursive: true });
}

const browser = await chromium.launch({
  executablePath: await resolveChromeExecutable(),
  headless: true,
  args: chromeTestArguments({ headless: true })
});
const results = [];
try {
  for (const entry of entries) {
    const basePath = join(sourceRoot, entry.base);
    const currentPath = join(sourceRoot, entry.current);
    await access(basePath, constants.R_OK);
    await access(currentPath, constants.R_OK);
    const referencePath = join(artifactRoot, "reference", `${entry.id}.png`);
    const currentOutputPath = join(artifactRoot, "current", `${entry.id}.png`);
    const diffPath = join(artifactRoot, "diff", `${entry.id}.png`);
    await Promise.all([
      copyFile(basePath, referencePath),
      copyFile(currentPath, currentOutputPath)
    ]);
    const comparison = await createDiff(browser, await readFile(referencePath), await readFile(currentOutputPath), entry.viewport);
    await writeFile(diffPath, comparison.png);
    results.push({
      ...entry,
      artifacts: {
        reference: relative(projectRoot, referencePath),
        current: relative(projectRoot, currentOutputPath),
        diff: relative(projectRoot, diffPath)
      },
      changedPixels: comparison.changedPixels,
      totalPixels: comparison.totalPixels,
      changedRatio: comparison.changedPixels / comparison.totalPixels
    });
  }
  const contactSheetPath = join(artifactRoot, "contact-sheets", "filter-impl-14-reference-current-diff.png");
  await writeFile(contactSheetPath, await createContactSheet(browser, results, artifactRoot));
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    command: "node scripts/generate-filter-impl-14-visual-packet.mjs",
    browser: await browser.version(),
    browserPolicy: "fresh Playwright-owned temporary profile; chromeTestArguments() with mock keychain, basic password store, sync/sign-in/profile onboarding suppression",
    classification: "Material UI",
    visualBaselineIntent: "No committed baseline was updated. References are deterministic pre-action captures; maintainer approval is required before acceptance.",
    entries: results,
    contactSheet: relative(projectRoot, contactSheetPath)
  };
  await writeFile(join(artifactRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await browser.close();
}

async function createDiff(runningBrowser, reference, current, viewport) {
  const context = await runningBrowser.newContext({ viewport });
  const page = await context.newPage();
  try {
    return await page.evaluate(async ({ referenceUrl, currentUrl, width, height }) => {
      const load = async (url) => { const image = new Image(); image.src = url; await image.decode(); return image; };
      const [referenceImage, currentImage] = await Promise.all([load(referenceUrl), load(currentUrl)]);
      const referenceCanvas = document.createElement("canvas");
      const currentCanvas = document.createElement("canvas");
      referenceCanvas.width = currentCanvas.width = width;
      referenceCanvas.height = currentCanvas.height = height;
      const referenceContext = referenceCanvas.getContext("2d", { willReadFrequently: true });
      const currentContext = currentCanvas.getContext("2d", { willReadFrequently: true });
      if (!referenceContext || !currentContext) throw new Error("Canvas 2D is unavailable.");
      referenceContext.drawImage(referenceImage, 0, 0);
      currentContext.drawImage(currentImage, 0, 0);
      const referencePixels = referenceContext.getImageData(0, 0, width, height);
      const currentPixels = currentContext.getImageData(0, 0, width, height);
      const output = referenceContext.createImageData(width, height);
      let changedPixels = 0;
      for (let offset = 0; offset < output.data.length; offset += 4) {
        const red = Math.abs(referencePixels.data[offset] - currentPixels.data[offset]);
        const green = Math.abs(referencePixels.data[offset + 1] - currentPixels.data[offset + 1]);
        const blue = Math.abs(referencePixels.data[offset + 2] - currentPixels.data[offset + 2]);
        if (red + green + blue > 24) changedPixels += 1;
        output.data[offset] = Math.min(255, red * 3);
        output.data[offset + 1] = Math.min(255, green * 3);
        output.data[offset + 2] = Math.min(255, blue * 3);
        output.data[offset + 3] = 255;
      }
      referenceContext.putImageData(output, 0, 0);
      return { png: referenceCanvas.toDataURL("image/png"), changedPixels, totalPixels: width * height };
    }, {
      referenceUrl: `data:image/png;base64,${reference.toString("base64")}`,
      currentUrl: `data:image/png;base64,${current.toString("base64")}`,
      width: viewport.width,
      height: viewport.height
    }).then((result) => ({
      png: Buffer.from(result.png.split(",", 2)[1], "base64"),
      changedPixels: result.changedPixels,
      totalPixels: result.totalPixels
    }));
  } finally {
    await context.close();
  }
}

async function createContactSheet(runningBrowser, results, root) {
  const context = await runningBrowser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await context.newPage();
  try {
    const images = [];
    for (const result of results) {
      images.push({
        base: `data:image/png;base64,${(await readFile(resolve(root, "reference", `${result.id}.png`))).toString("base64")}`,
        current: `data:image/png;base64,${(await readFile(resolve(root, "current", `${result.id}.png`))).toString("base64")}`,
        diff: `data:image/png;base64,${(await readFile(resolve(root, "diff", `${result.id}.png`))).toString("base64")}`
      });
    }
    return Buffer.from((await page.evaluate(async (entries) => {
      const canvas = document.createElement("canvas");
      canvas.width = 900;
      canvas.height = entries.length * 240;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D is unavailable.");
      for (let row = 0; row < entries.length; row += 1) {
        for (const [column, key] of ["base", "current", "diff"].entries()) {
          const image = new Image(); image.src = entries[row][key]; await image.decode();
          context.drawImage(image, column * 300, row * 240, 300, 233);
        }
      }
      return canvas.toDataURL("image/png");
    }, images)).split(",", 2)[1], "base64");
  } finally {
    await context.close();
  }
}

async function resolveChromeExecutable() {
  const cacheDir = process.env.LSEW_BROWSER_CACHE_DIR?.trim() || resolve(projectRoot, ".cache/lsew-browsers");
  const installed = new Cache(cacheDir).getInstalledBrowsers()
    .filter((entry) => entry.browser === Browser.CHROME)
    .sort((left, right) => right.buildId.localeCompare(left.buildId, undefined, { numeric: true }))
    .map((entry) => entry.executablePath);
  const candidates = [process.env.CHROME_PATH?.trim(), ...installed, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* try the next browser */ }
  }
  throw new Error("Chrome was not found for the filter-14 visual packet.");
}
