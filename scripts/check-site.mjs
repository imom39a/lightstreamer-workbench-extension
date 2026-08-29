#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import { JSDOM } from "jsdom";

import { GITHUB_REPOSITORY_URL, SITE_BASE_PATH, SITE_URL } from "../site/site.config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "site-dist");
const requiredRoutes = [
  "index.html",
  "docs/index.html",
  "docs/developer-guide/index.html",
  "docs/getting-started/index.html",
  "docs/workspace/index.html",
  "docs/evidence/index.html",
  "docs/command-state/index.html",
  "docs/local-injection/index.html",
  "docs/export-and-privacy/index.html",
  "docs/troubleshooting/index.html",
  "docs/faq/index.html",
  "privacy/index.html",
  "security/index.html",
  "support/index.html",
  "releases/index.html",
  "roadmap/index.html"
];
const failures = [];

try {
  const socialCard = await readFile(resolve(outputRoot, "assets/og.png"));
  const width = socialCard.readUInt32BE(16);
  const height = socialCard.readUInt32BE(20);
  if (width !== 1280 || height !== 640) {
    failures.push(`assets/og.png must be 1280x640 (received ${width}x${height})`);
  }
} catch {
  failures.push("Missing public social card: assets/og.png");
}

for (const route of requiredRoutes) {
  try {
    await access(resolve(outputRoot, route));
  } catch {
    failures.push(`Missing required route: ${route}`);
  }
}

const htmlFiles = (await listFiles(outputRoot)).filter((file) => extname(file) === ".html");
for (const file of htmlFiles) {
  const source = await readFile(file, "utf8");
  const route = relative(outputRoot, file).replaceAll("\\", "/");
  const document = new JSDOM(source).window.document;
  if (document.querySelectorAll("h1").length !== 1) failures.push(`${route} must contain exactly one h1`);
  if (!document.querySelector("main")) failures.push(`${route} is missing a main landmark`);
  if (route !== "404.html" && !document.querySelector("header.site-header")) failures.push(`${route} is missing the site header`);
  if (route !== "404.html" && !document.querySelector("footer.site-footer")) failures.push(`${route} is missing the site footer`);
  if (document.querySelector("script")) failures.push(`${route} contains executable JavaScript`);
  if (/Lightstreamer Event Workbench|synthetic replay|re-inject/i.test(source)) failures.push(`${route} contains retired product language`);
  if (/<script[^>]+(?:google-analytics\.com|googletagmanager)|dataLayer\s*=/i.test(source)) failures.push(`${route} contains analytics or tracking code`);
  const canonical = document.querySelector('link[rel="canonical"]')?.href;
  if (route !== "404.html" && !canonical?.startsWith(SITE_URL)) failures.push(`${route} has an invalid canonical URL`);

  for (const anchor of document.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith(`${GITHUB_REPOSITORY_URL}/blob/`) && /(PRIVACY|SECURITY|README|RELEASE)\.md/i.test(href)) {
      failures.push(`${route} points customer documentation at a repository Markdown file: ${href}`);
    }
    if (!href.startsWith(SITE_BASE_PATH)) continue;
    const relativeTarget = href.slice(SITE_BASE_PATH.length).split(/[?#]/, 1)[0] ?? "";
    const target = relativeTarget === "" ? "index.html" : relativeTarget.endsWith("/") ? `${relativeTarget}index.html` : relativeTarget;
    try {
      await access(resolve(outputRoot, target));
    } catch {
      failures.push(`${route} contains a broken internal link: ${href}`);
    }
  }

  for (const image of document.querySelectorAll("img[src]")) {
    const src = image.getAttribute("src") ?? "";
    if (!src.startsWith(SITE_BASE_PATH)) continue;
    try {
      await access(resolve(outputRoot, src.slice(SITE_BASE_PATH.length)));
    } catch {
      failures.push(`${route} contains a missing image: ${src}`);
    }
  }
}

if (failures.length) {
  throw new Error(`Invalid public site:\n${failures.join("\n")}`);
}

console.log(`Verified ${htmlFiles.length} static pages: isolated routes, local assets, canonical policy links, and no executable tracking code.`);

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}
