import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const manifestPath = resolve(projectRoot, "dist/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const contentScripts = manifest.content_scripts ?? [];
const contentScriptFiles = contentScripts.flatMap((entry) => entry.js ?? []);
const failures = [];

for (const file of contentScriptFiles) {
  const outputPath = resolve(projectRoot, "dist", file);
  const source = await readFile(outputPath, "utf8");

  if (/^\s*import\s/m.test(source) || /^\s*export\s/m.test(source)) {
    failures.push(`${file} contains a top-level ESM import/export`);
  }

  if (/from\s*["']\.\.\//.test(source)) {
    failures.push(`${file} references an external relative chunk`);
  }
}

if (failures.length > 0) {
  throw new Error(`Invalid Chrome content-script build:\n${failures.join("\n")}`);
}

console.log(`Verified ${contentScriptFiles.length} Chrome content-script build outputs.`);
