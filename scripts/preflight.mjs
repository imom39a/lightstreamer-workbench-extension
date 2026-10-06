import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const groupNames = ["docs", "site", "runtime", "companion", "panel", "fixture"];

export function createPreflightPlan(paths, { release = false } = {}) {
  const groups = Object.fromEntries(groupNames.map(name => [name, release]));
  for (const path of paths) {
    if (path.startsWith("agent/") || path.startsWith(".agents/skills/lightstreamer-workbench/")
      || path.startsWith("src/") || path.startsWith("public/") || path.startsWith("tests/agent")
      || /^scripts\/(?:test-firefox|build-extension|build-content-scripts|extension-manifest|verify-extension-build|package-extension)\./.test(path)) {
      for (const name of groupNames.filter(name => name !== "site")) groups[name] = true;
    } else if (path.startsWith("docs/assets/") || path.startsWith("site/") || path.startsWith("tests/site/")
      || ["PRIVACY.md", "SECURITY.md", "playwright.site.config.ts", "scripts/build-site.mjs", "scripts/check-site.mjs", "scripts/site-server.mjs"].includes(path)) {
      groups.docs = true;
      groups.site = true;
    } else if (path.endsWith(".md")) groups.docs = true;
    else for (const name of groupNames) groups[name] = true;
  }
  const checks = [];
  if (groups.docs) checks.push({ id: "docs", args: ["run", "docs:check"] });
  if (groups.site) checks.push({ id: "site", args: ["run", "test:site"] });
  if (groups.runtime) {
    for (const command of ["test:scripts", "typecheck", "test:release", "build", "build:firefox"]) checks.push({ id: command, args: ["run", command] });
    checks.push({ id: "chrome-package", args: ["run", "release:zip", "--", "--skip-typecheck", "--skip-tests", "--skip-build"] });
    checks.push({ id: "firefox-package", args: ["run", "release:package:firefox", "--", "--skip-typecheck", "--skip-tests", "--skip-build"] });
  }
  if (groups.companion) for (const command of ["agent:build", "agent:test:package", "agent:test:extension"]) checks.push({ id: command, args: ["run", command] });
  if (groups.panel) for (const command of ["test:ui", "test:ui:visual", "test:ui:extension"]) checks.push({ id: command, args: ["run", command] });
  if (groups.fixture) {
    checks.push({ id: "fixture-runner", args: ["run", "fixture:test:dry-run"] });
    checks.push({ id: "official-client", args: ["run", "agent:test:browser"] });
    checks.push({ id: "firefox", args: ["run", "test:firefox"], fixture: true });
  }
  return { schemaVersion: 1, scope: release ? "release" : "changes", paths: [...new Set(paths)].sort(), groups, checks };
}

const requiredJobs = {
  fixture: { "fixture-runner": "fixture", "local-injection-browser": "fixture" },
  panel: { "panel-ui": "panel" },
  site: { build: "site" },
  companion: { checks: "docs", package: "companion", portable: "companion", firefox: "companion", "release-bundle": "companion" }
};

export function evaluatePreflightGate(plan, results, workflow) {
  const errors = [];
  if (!requiredJobs[workflow]) errors.push(`Unknown verification workflow ${workflow}`);
  const validPlan = plan?.schemaVersion === 1 && ["changes", "release"].includes(plan.scope)
    && Array.isArray(plan.paths) && plan.paths.every(path => typeof path === "string")
    && groupNames.every(name => typeof plan.groups?.[name] === "boolean");
  if (!validPlan) errors.push("Missing or invalid preflight selection plan");
  else {
    const expected = createPreflightPlan(plan.paths, { release: plan.scope === "release" });
    if (!groupNames.every(name => expected.groups[name] === plan.groups[name])) errors.push("Preflight groups disagree with the selected paths or release scope");
  }
  if (results?.plan?.result !== "success") errors.push(`Preflight planning did not succeed (${results?.plan?.result ?? "missing"})`);
  const required = [];
  if (errors.length === 0) {
    for (const [job, group] of Object.entries(requiredJobs[workflow])) {
      if (!plan.groups[group]) continue;
      required.push(job);
      if (results?.[job]?.result !== "success") errors.push(`Selected job ${job} did not succeed (${results?.[job]?.result ?? "missing"})`);
    }
  }
  return { ok: errors.length === 0, required, errors };
}

function changedPaths(cwd, base, head) {
  const commit = ref => execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { cwd, encoding: "utf8" }).trim();
  const source = { base: commit(base), head: commit(head) };
  const entries = execFileSync("git", ["diff", "--name-status", "-z", "--find-renames", source.base, source.head, "--"], { cwd, encoding: "utf8" }).split("\0");
  const paths = [];
  for (let index = 0; index < entries.length - 1;) {
    const status = entries[index++];
    const count = /^[RC]\d+$/.test(status) ? 2 : /^[AMDTUXB]$/.test(status) ? 1 : 0;
    if (!count || index + count > entries.length - 1) throw new Error(`Unsupported or incomplete Git change record: ${status}`);
    for (let pathIndex = 0; pathIndex < count; pathIndex++) paths.push(entries[index++]);
  }
  return { source, paths };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (["--release", "--dry-run", "--json", "--ci", "--help"].includes(key)) options[key.slice(2)] = true;
    else if (["--base", "--head", "--github-output", "--gate"].includes(key)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
      options[key.slice(2)] = value;
    } else throw new Error(`Unknown preflight option ${key}`);
  }
  return options;
}

async function runPlan(plan) {
  const { default: spawn } = await import("cross-spawn");
  const run = args => {
    console.log(`[preflight] npm ${args.join(" ")}`);
    const result = spawn.sync("npm", args, { stdio: "inherit", env: { ...process.env, LSEW_ANALYTICS_DISABLED: "1" } });
    if (result.error || result.status !== 0) throw new Error(`Preflight check failed: npm ${args.join(" ")} (${result.status ?? result.error?.message ?? "signal"})`);
  };
  for (const check of plan.checks) {
    if (!check.fixture) run(check.args);
    else {
      let failure;
      try {
        run(["run", "fixture:start"]);
        run(check.args);
      } catch (error) { failure = error; }
      finally {
        try { run(["run", "fixture:stop"]); }
        catch (error) {
          if (failure) console.error(`[preflight] Cleanup also failed: ${error.message}`);
          else failure = error;
        }
      }
      if (failure) throw failure;
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.gate) {
    const gate = evaluatePreflightGate(JSON.parse(process.env.PREFLIGHT_PLAN ?? "null"), JSON.parse(process.env.PREFLIGHT_RESULTS ?? "null"), options.gate);
    console.log(JSON.stringify(gate));
    if (!gate.ok) process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log("Usage: npm run preflight -- --base <ref> --head <ref> [--dry-run] [--json]\n       npm run preflight -- --release [--dry-run] [--json]");
    return;
  }
  if (options.ci) {
    if (process.env.PREFLIGHT_RELEASE === "true" || process.env.GITHUB_EVENT_NAME === "workflow_dispatch") options.release = true;
    else {
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
      if (process.env.GITHUB_EVENT_NAME === "pull_request") {
        options.base = event.pull_request?.base?.sha;
        options.head = event.pull_request?.head?.sha;
      } else if (process.env.GITHUB_EVENT_NAME === "push") {
        if (/^0{40}$/.test(event.before ?? "")) options.release = true;
        else { options.base = event.before; options.head = event.after; }
      } else throw new Error(`Unsupported CI event ${process.env.GITHUB_EVENT_NAME}; request the full release scope explicitly.`);
    }
  }
  if (!options.release && (!options.base || !options.head)) throw new Error("Specify both --base and --head, or --release for the full verification scope.");
  const comparison = options.base && options.head ? changedPaths(process.cwd(), options.base, options.head) : { paths: [], source: null };
  const plan = { ...createPreflightPlan(comparison.paths, options), source: comparison.source };
  if (options["github-output"]) await appendFile(options["github-output"], `plan=${JSON.stringify(plan)}\n${Object.entries(plan.groups).map(([key, value]) => `${key}=${value}\n`).join("")}`);
  if (options.json) console.log(JSON.stringify(plan));
  else for (const check of plan.checks) console.log(`[preflight] selected ${check.id}: npm ${check.args.join(" ")}`);
  if (!options["dry-run"] && !options.json) await runPlan(plan);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(); }
  catch (error) { console.error(`[preflight] ${error.message}`); process.exitCode = 1; }
}
