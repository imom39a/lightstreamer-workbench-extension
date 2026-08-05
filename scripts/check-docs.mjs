#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const documents = [
  "CONTRIBUTING.md",
  "tests/ui/README.md",
  "docs/agents/ui-verification.md",
  "docs/agents/ui-visual-qa.md"
];
const requiredCommands = [
  "typecheck",
  "test",
  "test:ui",
  "test:ui:update",
  "test:ui:visual",
  "test:ui:extension",
  "fixture:test:browser",
  "build",
  "release:package",
  "docs:check"
];
const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const sources = await Promise.all(documents.map(async (document) => ({
  document,
  text: await readFile(resolve(rootDir, document), "utf8")
})));
const namedCommands = new Set();

for (const { document, text } of sources) {
  if (/npm test(?:\s|`|$)/.test(text)) {
    namedCommands.add("test");
  }
  for (const [, command] of text.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)) {
    namedCommands.add(command);
    if (!packageJson.scripts[command]) {
      throw new Error(`${document} names npm run ${command}, but package.json does not define it.`);
    }
  }
}

for (const command of requiredCommands) {
  if (!packageJson.scripts[command]) {
    throw new Error(`Maintained verification command npm run ${command} is missing from package.json.`);
  }
  if (!namedCommands.has(command)) {
    throw new Error(`Document the purpose of npm run ${command} in the contributor or UI QA guidance.`);
  }
}

console.log(`Documentation command check passed for ${documents.length} documents and ${requiredCommands.length} maintained commands.`);
