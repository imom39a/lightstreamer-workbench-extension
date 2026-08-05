#!/usr/bin/env node

import { readFile, readdir, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const projectRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const outputDirectory = resolve(
  projectRoot,
  args.dist ?? process.env.LSEW_EXTENSION_OUT_DIR ?? "dist"
);
const manifest = JSON.parse(await readFile(resolve(outputDirectory, "manifest.json"), "utf8"));
const failures = [];

if (manifest.manifest_version !== 3) {
  failures.push(`manifest.json is not Manifest V3 (received ${String(manifest.manifest_version)})`);
}

const extensionPagesCsp = manifest.content_security_policy?.extension_pages;
if (
  typeof extensionPagesCsp === "string" &&
  (/unsafe-eval|unsafe-inline/.test(extensionPagesCsp) || /script-src[^;]*https?:/i.test(extensionPagesCsp))
) {
  failures.push("manifest.json relaxes the extension-page script CSP");
}

const files = await listFiles(outputDirectory);
const sources = new Map();
for (const file of files) {
  if (!/\.(?:html|js|jsx|mjs|cjs)$/.test(file.relativePath)) continue;
  sources.set(file.relativePath, await readFile(file.absolutePath, "utf8"));
}

const contentScriptFiles = (manifest.content_scripts ?? []).flatMap((entry) => entry.js ?? []);
for (const file of contentScriptFiles) {
  const source = sources.get(file);
  if (source === undefined) {
    failures.push(`${file} is declared as a content script but is missing`);
    continue;
  }
  if (/^\s*import\s/m.test(source) || /^\s*export\s/m.test(source)) {
    failures.push(`${file} contains a top-level ESM import/export`);
  }
  if (/from\s*["']\.\.\//.test(source)) {
    failures.push(`${file} references an external relative chunk`);
  }
}

for (const [file, source] of sources) {
  if (file.endsWith(".html")) {
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attributes = match[1] ?? "";
      const body = match[2]?.trim() ?? "";
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1];
      if (src && /^(?:https?:)?\/\//i.test(src)) {
        failures.push(`${file} contains a remote executable script (${src})`);
      }
      if (!src && body) failures.push(`${file} contains inline executable script content`);
    }
    continue;
  }
  if (file.endsWith(".jsx")) failures.push(`${file} leaves JSX for runtime transformation`);
  if (/\bnew\s+Function\s*\(/.test(source)) failures.push(`${file} contains new Function`);
  if (/(^|[^.\w])eval\s*\(/m.test(source)) failures.push(`${file} contains direct eval`);
  if (/\b(?:import|export)\s*(?:\([^)]*)?\s*(?:from\s*)?["']https?:\/\//.test(source)) {
    failures.push(`${file} imports remote executable code`);
  }
  if (/@babel\/standalone|jsxDEV\s*\(/.test(source)) {
    failures.push(`${file} contains a runtime JSX transformer`);
  }
}

const panelPath = "extension/panel/index.js";
const panelSource = sources.get(panelPath);
if (panelSource === undefined) {
  failures.push(`${panelPath} is missing`);
} else {
  const panelBytes = (await stat(resolve(outputDirectory, panelPath))).size;
  if (panelBytes > 500_000) {
    failures.push(`${panelPath} initial panel chunk exceeds 500000 raw bytes (${panelBytes})`);
  }
  if (!/local-injection-document\.js/.test(panelSource)) {
    failures.push(`${panelPath} does not retain the lazy Local Injection editor boundary`);
  }
  if (!/__REACT|react-dom|useSyncExternalStore/.test(panelSource)) {
    failures.push(`${panelPath} does not contain the production React runtime`);
  }
  if (/LSEW_PANEL_RENDERER|renderPanel|PanelController|view-selector/.test(panelSource)) {
    failures.push(`${panelPath} contains legacy panel compatibility residue`);
  }
}

if (!sources.has("assets/local-injection-document.js")) {
  failures.push("assets/local-injection-document.js is missing; CodeMirror must remain lazy");
}

const reactSignatures = /__REACT|react-dom|useSyncExternalStore/;
for (const [file, source] of sources) {
  if (file === panelPath || file === "assets/local-injection-document.js") continue;
  if (file.endsWith(".js") && reactSignatures.test(source)) {
    failures.push(`${file} contains React runtime escaped the panel artifact`);
  }
}

if (failures.length > 0) {
  throw new Error(`Invalid release extension build:\n${failures.join("\n")}`);
}

console.log(
  `Verified release extension build: MV3 CSP, local scripts, one React panel, lazy editor, ${contentScriptFiles.length} self-contained content scripts.`
);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const argument = rawArgs[index];
    const [key, inlineValue] = argument.split("=", 2);
    if (key !== "--dist") throw new Error(`Unknown option: ${argument}`);
    const value = inlineValue ?? rawArgs[index + 1];
    if (!value || value.startsWith("--")) throw new Error("--dist requires a path");
    parsed.dist = value;
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFiles(absolutePath));
    } else if (entry.isFile()) {
      result.push({
        absolutePath,
        relativePath: relative(outputDirectory, absolutePath).split(sep).join("/")
      });
    }
  }
  return result;
}
