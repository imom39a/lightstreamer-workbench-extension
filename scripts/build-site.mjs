#!/usr/bin/env node

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { marked, Renderer } from "marked";

import {
  CHROME_WEB_STORE_URL,
  GITHUB_REPOSITORY_URL,
  SITE_BASE_PATH,
  SITE_URL,
  canonicalUrl,
  sitePath
} from "../site/site.config.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const outputRoot = resolve(projectRoot, "site-dist");
const contentRoot = resolve(projectRoot, "site/content");
const pages = [
  page("index.md", "index.html", "Lightstreamer Workbench 2.0", "Debug Lightstreamer Web Client behavior inside Chrome DevTools.", "home"),
  page("docs/index.md", "docs/index.html", "Documentation", "Install Lightstreamer Workbench and learn the unified investigation workspace.", "docs"),
  page("docs/getting-started.md", "docs/getting-started/index.html", "Getting started", "Install Workbench, open its DevTools panel, and capture your first Lightstreamer session.", "docs"),
  page("docs/workspace.md", "docs/workspace/index.html", "The unified workspace", "Use Runtime Scope, Ordered Evidence, and Context as one continuous investigation workspace.", "docs"),
  page("docs/evidence.md", "docs/evidence/index.html", "Ordered Evidence", "Filter, find, select, freeze, and inspect retained Lightstreamer Evidence.", "docs"),
  page("docs/command-state.md", "docs/command-state/index.html", "COMMAND projections", "Interpret Observed Server and Local Effective COMMAND State without overstating authority.", "docs"),
  page("docs/local-injection.md", "docs/local-injection/index.html", "Local Injection", "Create, review, and deliver one protected Local Injection Draft without contacting the server.", "docs"),
  page("docs/export-and-privacy.md", "docs/export-and-privacy/index.html", "Export and privacy", "Create credential-safe scoped exports and understand Workbench's local data boundary.", "docs"),
  page("docs/troubleshooting.md", "docs/troubleshooting/index.html", "Troubleshooting", "Resolve missing Capture, limited coverage, retired targets, and storage fallback.", "docs"),
  page("docs/faq.md", "docs/faq/index.html", "Frequently asked questions", "Answers about supported clients, Capture, COMMAND state, Local Injection, and storage.", "docs"),
  page("roadmap.md", "roadmap/index.html", "Roadmap", "Near-term and exploratory opportunities for Lightstreamer Workbench.", "page"),
  page("releases.md", "releases/index.html", "Release notes", "What shipped in the current Lightstreamer Workbench 2.0 release.", "page"),
  page("support.md", "support/index.html", "Support", "Get help, report a bug, request a feature, or ask a question.", "page")
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(resolve(outputRoot, "assets"), { recursive: true });

for (const definition of pages) {
  const markdown = await readFile(resolve(contentRoot, definition.source), "utf8");
  await writePage(definition, markdown);
}

await writePage(
  { output: "privacy/index.html", title: "Privacy policy", description: "How Lightstreamer Workbench processes inspected-page data locally.", layout: "page", sourceHeading: true },
  await readFile(resolve(projectRoot, "PRIVACY.md"), "utf8")
);
await writePage(
  { output: "security/index.html", title: "Security policy", description: "Supported versions and private vulnerability-reporting guidance.", layout: "page", sourceHeading: true },
  await readFile(resolve(projectRoot, "SECURITY.md"), "utf8")
);

await Promise.all([
  copy("site/assets/site.css", "assets/site.css"),
  copy("docs/assets/logo.svg", "assets/logo.svg"),
  copy("docs/assets/mascot.png", "assets/mascot.png"),
  copy("docs/assets/app-ordered-evidence-context.png", "assets/app-ordered-evidence-context.png"),
  copy("docs/assets/app-command-projections.png", "assets/app-command-projections.png"),
  copy("docs/assets/app-local-injection-editor.png", "assets/app-local-injection-editor.png"),
  copy("docs/assets/real-app-gallery.png", "assets/real-app-gallery.png"),
  copy("site/assets/og.png", "assets/og.png")
]);

await writeFile(resolve(outputRoot, ".nojekyll"), "");
await writeFile(resolve(outputRoot, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${canonicalUrl("sitemap.xml")}\n`);
await writeFile(resolve(outputRoot, "sitemap.xml"), renderSitemap());
await writeFile(resolve(outputRoot, "404.html"), renderNotFound());

console.log(`Built ${pages.length + 2} public pages in ${outputRoot}`);

function page(source, output, title, description, layout) {
  return { source, output, title, description, layout, sourceHeading: false };
}

async function copy(source, output) {
  const target = resolve(outputRoot, output);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(projectRoot, source), target);
}

async function writePage(definition, source) {
  const normalizedSource = definition.sourceHeading ? stripFirstHeading(source) : source;
  const body = renderMarkdown(replacePlaceholders(normalizedSource));
  const target = resolve(outputRoot, definition.output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderDocument(definition, body));
}

function replacePlaceholders(source) {
  return source
    .replaceAll("{{site}}", SITE_BASE_PATH)
    .replaceAll("{{store}}", CHROME_WEB_STORE_URL)
    .replaceAll("{{github}}", GITHUB_REPOSITORY_URL);
}

function stripFirstHeading(source) {
  return source.replace(/^#\s+[^\n]+\n+/, "");
}

function renderMarkdown(source) {
  const renderer = new Renderer();
  const usedSlugs = new Map();
  renderer.heading = function ({ tokens, depth }) {
    const text = this.parser.parseInline(tokens);
    const plain = text.replace(/<[^>]+>/g, "").replace(/&[^;]+;/g, " ").trim();
    const base = plain.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    const count = usedSlugs.get(base) ?? 0;
    usedSlugs.set(base, count + 1);
    const slug = count === 0 ? base : `${base}-${count + 1}`;
    return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
  };
  renderer.link = function ({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    const external = /^https?:\/\//.test(href);
    const externalAttributes = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(href)}"${titleAttribute}${externalAttributes}>${label}</a>`;
  };
  return marked.parse(source, { renderer, gfm: true });
}

function renderDocument(definition, body) {
  const canonical = canonicalUrl(definition.output === "index.html" ? "" : definition.output.replace(/index\.html$/, ""));
  const home = definition.layout === "home";
  const docs = definition.layout === "docs";
  const mainClass = home ? "home" : docs ? "article-shell docs-shell" : "article-shell";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(definition.title)} · Lightstreamer Workbench</title>
    <meta name="description" content="${escapeHtml(definition.description)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Lightstreamer Workbench">
    <meta property="og:title" content="${escapeHtml(definition.title)}">
    <meta property="og:description" content="${escapeHtml(definition.description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${canonicalUrl("assets/og.png")}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" href="${sitePath("assets/logo.svg")}" type="image/svg+xml">
    <link rel="stylesheet" href="${sitePath("assets/site.css")}">
  </head>
  <body>
    <a class="skip-link" href="#main-content">Skip to content</a>
    ${renderReleaseBanner()}
    ${renderHeader(definition.output)}
    <main id="main-content" class="${mainClass}">
      ${home ? body : `${renderArticleIntro(definition)}${docs ? renderDocsNavigation(definition.output) : ""}<article class="article-content">${body}</article>`}
    </main>
    ${renderFooter()}
  </body>
</html>\n`;
}

function renderReleaseBanner() {
  return `<aside class="release-banner" aria-label="Release status"><strong>Workbench 2.0 is available.</strong><span>The unified Scoped Evidence Workspace is live in the Chrome Web Store.</span><a href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener noreferrer">Install 2.0</a></aside>`;
}

function renderHeader(currentOutput) {
  const nav = [
    ["Product", sitePath(), currentOutput === "index.html"],
    ["Docs", sitePath("docs/"), currentOutput.startsWith("docs/")],
    ["Roadmap", sitePath("roadmap/"), currentOutput.startsWith("roadmap/")],
    ["Releases", sitePath("releases/"), currentOutput.startsWith("releases/")],
    ["GitHub", GITHUB_REPOSITORY_URL, false]
  ];
  return `<header class="site-header"><div class="site-header__inner"><a class="brand" href="${sitePath()}"><img src="${sitePath("assets/logo.svg")}" alt="" width="38" height="38"><span>Lightstreamer Workbench</span></a><nav aria-label="Primary">${nav.map(([label, href, current]) => `<a href="${href}"${current ? ' aria-current="page"' : ""}${String(href).startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`).join("")}</nav><a class="button button--compact" href="${CHROME_WEB_STORE_URL}" target="_blank" rel="noopener noreferrer">Add Workbench 2.0</a></div></header>`;
}

function renderArticleIntro(definition) {
  return `<header class="article-intro"><span class="eyebrow">Lightstreamer Workbench</span><h1>${escapeHtml(definition.title)}</h1><p>${escapeHtml(definition.description)}</p></header>`;
}

function renderDocsNavigation(currentOutput) {
  const links = pages.filter(({ layout }) => layout === "docs");
  return `<nav class="docs-navigation" aria-label="Documentation"><strong>Documentation</strong>${links.map((entry) => `<a href="${sitePath(entry.output.replace(/index\.html$/, ""))}"${entry.output === currentOutput ? ' aria-current="page"' : ""}>${escapeHtml(entry.title)}</a>`).join("")}</nav>`;
}

function renderFooter() {
  const links = [
    ["Documentation", sitePath("docs/")],
    ["Privacy", sitePath("privacy/")],
    ["Security", sitePath("security/")],
    ["Support", sitePath("support/")],
    ["Releases", sitePath("releases/")],
    ["Roadmap", sitePath("roadmap/")],
    ["Source", GITHUB_REPOSITORY_URL]
  ];
  return `<footer class="site-footer"><div><a class="brand brand--footer" href="${sitePath()}"><img src="${sitePath("assets/logo.svg")}" alt="" width="32" height="32"><span>Lightstreamer Workbench</span></a><p>Open-source developer infrastructure for applications using the official Lightstreamer Web Client.</p><p class="fine-print">Independent and not affiliated with Lightstreamer. Source is available under Apache-2.0.</p></div><nav aria-label="Footer">${links.map(([label, href]) => `<a href="${href}"${String(href).startsWith("http") ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`).join("")}</nav></footer>`;
}

function renderSitemap() {
  const urls = pages.map(({ output }) => canonicalUrl(output === "index.html" ? "" : output.replace(/index\.html$/, "")));
  urls.push(canonicalUrl("privacy/"), canonicalUrl("security/"));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${url}</loc></url>`).join("\n")}\n</urlset>\n`;
}

function renderNotFound() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · Lightstreamer Workbench</title><link rel="stylesheet" href="${sitePath("assets/site.css")}"></head><body><main class="not-found"><img src="${sitePath("assets/logo.svg")}" alt="" width="48" height="48"><p class="eyebrow">404</p><h1>That page is not part of the Workbench.</h1><p>Return to the product site or open the documentation.</p><p><a class="button" href="${sitePath()}">Product home</a> <a class="button button--secondary" href="${sitePath("docs/")}">Documentation</a></p></main></body></html>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
