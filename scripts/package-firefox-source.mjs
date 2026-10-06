import { execFileSync } from "node:child_process";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { writeDeterministicZip } from "./package-mcp-release.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {cwd:root,encoding:"utf8"}).trim();
const dirty = execFileSync("git", ["diff", "HEAD", "--name-only"], {cwd:root,encoding:"utf8"}).trim();
if (dirty) throw new Error("Commit the reviewed source before making the AMO source archive.");
const metadata = JSON.parse(await readFile(resolve(root,"package.json"),"utf8"));
const manifest = JSON.parse(await readFile(resolve(root,"dist-firefox/manifest.json"),"utf8"));
if (manifest.version !== metadata.version || manifest.browser_specific_settings?.gecko?.id !== "lightstreamer-workbench@imom39a") throw new Error("Build the matching Firefox release before packaging its source.");
const paths = execFileSync("git", ["ls-files", "-z"], {cwd:root,encoding:"utf8"}).split("\0").filter(path =>
  /^(src\/|public\/|scripts\/.*\.mjs$)/.test(path) || ["package.json","package-lock.json","tsconfig.json","vite.config.ts","LICENSE","PRIVACY.md","agent/package.json"].includes(path));
const files = await Promise.all(paths.map(async path => ({name:path,bytes:await readFile(resolve(root,path))})));
const env = loadEnv("production",root,"VITE_LSEW_");
// Only the extractable analytics ingestion configuration already shipped in
// the extension is included. Publisher, npm, signing and account credentials
// never enter this source archive.
const configuration = ["VITE_LSEW_GA_MEASUREMENT_ID","VITE_LSEW_GA_API_SECRET","VITE_LSEW_GA_DEBUG"].map(key => `${key}=${JSON.stringify(env[key] ?? "")}`).join("\n") + "\n";
files.push({name:".env.production",bytes:Buffer.from(configuration)});
if (process.env.LSEW_ANALYTICS_DISABLED === "1") throw new Error("AMO source packaging expects the configured store build, not an analytics-disabled test build.");
files.push({name:"README.md",bytes:Buffer.from(`# Mozilla reviewer source: Lightstreamer Workbench ${metadata.version}\n\nSource commit: ${sourceSha}\n\nBuilt with Node.js ${process.versions.node}, npm, TypeScript, Vite/Rollup and esbuild on ${process.platform}/${process.arch}. Node.js 24 is recommended. All dependencies are pinned by package-lock.json. No Docker, accounts, private credentials, network service, or signing tools are needed for this build.\n\nRun from this directory:\n\n\`\`\`sh\nnpm ci\nnpm run build:firefox\n\`\`\`\n\nCompare every file in dist-firefox/ with the submitted extension ZIP. The included .env.production supplies only the same analytics ingestion configuration embedded in that ZIP. Do not set LSEW_ANALYTICS_DISABLED or override VITE_LSEW_ variables for the comparison. Analytics is disabled at runtime until Firefox optional technicalAndInteraction permission and the Workbench preference both allow it.\n\nThird-party code is installed from the locked npm packages; no vendored remote or obfuscated executable code is used. React DOM's generated innerHTML assignments are framework code. Application-controlled values are rendered as text; the panel's JSON editor and instrumentation are bundled locally.\n\nThe extension is desktop-only, Firefox 140+, regular browsing only. See PRIVACY.md for the MCP and data boundaries. Reviewer test instructions are supplied separately in the AMO submission.\n`)});
await mkdir(resolve(root,"release"),{recursive:true});
const output = resolve(root,`release/lightstreamer-workbench-firefox-source-v${metadata.version}.zip`);
await writeDeterministicZip(files,output);
console.log(`AMO source archive: ${output} (${files.length} files, source ${sourceSha})`);
