import { build } from "esbuild";
import { cp, mkdir, readFile, readdir, writeFile, rm, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";

// Resolve from this script so npm pack ./agent and npm --prefix agent pack agree.
process.chdir(resolve(import.meta.dirname, ".."));
await rm("agent/dist", { recursive: true, force: true });
await rm("agent/skills", { recursive: true, force: true });
await mkdir("release", { recursive: true });
await mkdir("agent/dist", { recursive: true });
const result = await build({ absWorkingDir: process.cwd(), entryPoints: ["src/agent/companion/cli.ts"], outfile: "agent/dist/cli.mjs", bundle: true, metafile: true, platform: "node", format: "esm", target: "node22", banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
await chmod("agent/dist/cli.mjs", 0o755);
await cp(".agents/skills/lightstreamer-workbench", "agent/skills/lightstreamer-workbench", { recursive: true });
await cp("LICENSE", "agent/LICENSE");

const packages = new Set(Object.keys(result.metafile.inputs).flatMap(input => {
  const marker = input.lastIndexOf("node_modules/");
  if (marker < 0) return [];
  const parts = input.slice(marker + 13).split("/");
  return [resolve(input.slice(0, marker + 13), parts.slice(0, parts[0].startsWith("@") ? 2 : 1).join("/"))];
}));
const notices = [];
for (const directory of [...packages].sort()) {
  const metadata = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const licenses = (await readdir(directory)).filter(name => /^(license|copying)([-.].*)?$/i.test(name));
  notices.push(`${metadata.name} ${metadata.version} (${metadata.license ?? "see package license"})\n${(await Promise.all(licenses.map(name => readFile(join(directory, name), "utf8")))).join("\n")}`);
}
await writeFile("agent/dist/THIRD_PARTY_NOTICES.txt", notices.join("\n\n----------------------------------------\n\n") + "\n");
