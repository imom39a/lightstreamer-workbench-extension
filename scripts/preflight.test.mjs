import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { createPreflightPlan, evaluatePreflightGate } from "./preflight.mjs";

test("a copied documentation asset receives the existing public-site checks", () => {
  const plan = createPreflightPlan(["docs/assets/app-agent-access.png"]);
  assert.deepEqual(plan.groups, {
    docs: true, site: true, runtime: false, companion: false, panel: false, fixture: false
  });
  assert.deepEqual(plan.checks.map(check => check.id), ["docs", "site"]);
  assert.deepEqual(plan.checks[1].args, ["run", "test:site"]);
});

test("public site sources, policy and browser checks select site without extension jobs", () => {
  for (const path of ["site/content/releases.md", "PRIVACY.md", "SECURITY.md", "tests/site/public-site.spec.ts", "scripts/check-site.mjs", "playwright.site.config.ts"]) {
    const plan = createPreflightPlan([path]);
    assert.equal(plan.groups.site, true, path);
    assert.equal(plan.groups.runtime, false, path);
    assert.deepEqual(plan.checks.map(check => check.id), ["docs", "site"], path);
  }
});

test("ordinary Markdown guidance uses documentation validation", () => {
  assert.deepEqual(createPreflightPlan(["AGENTS.md"]).checks.map(check => check.id), ["docs"]);
});

test("runtime and packaged companion changes require both browser integration boundaries", () => {
  for (const path of ["src/injected/lightstreamer-instrumentation.ts", "public/manifest.json", "agent/README.md", ".agents/skills/lightstreamer-workbench/SKILL.md", "tests/agent-runtime.test.ts", "scripts/test-firefox.mjs"]) {
    const plan = createPreflightPlan([path]);
    assert.deepEqual(plan.groups, { docs: true, site: false, runtime: true, companion: true, panel: true, fixture: true }, path);
    const commands = plan.checks.map(check => check.args[1]);
    for (const required of ["typecheck", "test:release", "build", "build:firefox", "release:zip", "release:package:firefox", "agent:test:package", "agent:test:extension", "test:ui", "agent:test:browser", "test:firefox"]) {
      assert(commands.includes(required), `${path} requires ${required}`);
    }
  }
});

test("shared dependencies, unknown executable inputs and explicit release select the full gate", () => {
  for (const path of ["package-lock.json", "vite.config.ts", ".github/workflows/pages.yml", "tools/new-check.py", "tests/support/browser-helper.ts"]) {
    assert(Object.values(createPreflightPlan([path]).groups).every(Boolean), path);
  }
  const release = createPreflightPlan(["AGENTS.md"], { release: true });
  assert(Object.values(release.groups).every(Boolean));
  assert.equal(release.scope, "release");
  assert.deepEqual(createPreflightPlan([]).checks, []);
});

test("the supported CLI compares both rename sides and deleted paths without shell interpolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-preflight-"));
  const cli = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git(["init", "-q"]);
    git(["config", "user.name", "Preflight fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    await mkdir(join(root, "site"));
    await mkdir(join(root, "agent"));
    await mkdir(join(root, "docs/assets"), { recursive: true });
    const oldPath = "site/guide $() and `literal`.md";
    const newPath = "agent/guide $() and `literal`.md";
    await writeFile(join(root, oldPath), "# Fixture\nunchanged rename body\n");
    await writeFile(join(root, "docs/assets/deleted.png"), "fixture image");
    git(["add", "."]);
    git(["commit", "-qm", "base"]);
    const base = git(["rev-parse", "HEAD"]);
    await rename(join(root, oldPath), join(root, newPath));
    await rm(join(root, "docs/assets/deleted.png"));
    git(["add", "-A"]);
    git(["commit", "-qm", "rename and deletion"]);
    const head = git(["rev-parse", "HEAD"]);
    const result = spawnSync(process.execPath, [cli, "--base", base, "--head", head, "--dry-run", "--json"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepEqual(plan.paths, [newPath, "docs/assets/deleted.png", oldPath].sort());
    assert.equal(plan.groups.site, true);
    assert.equal(plan.groups.companion, true);
    assert.deepEqual(plan.source, { base, head });
    const eventFile = join(root, "push.json");
    await writeFile(eventFile, JSON.stringify({ before: base, after: head }));
    const ci = spawnSync(process.execPath, [cli, "--ci", "--json"], { cwd: root, encoding: "utf8", env: { ...process.env, PREFLIGHT_RELEASE: "false", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventFile } });
    assert.equal(ci.status, 0, ci.stderr);
    assert.deepEqual(JSON.parse(ci.stdout).paths, plan.paths);
    await writeFile(eventFile, JSON.stringify({ pull_request: { base: { sha: base }, head: { sha: head } } }));
    const pr = spawnSync(process.execPath, [cli, "--ci", "--json"], { cwd: root, encoding: "utf8", env: { ...process.env, PREFLIGHT_RELEASE: "false", GITHUB_EVENT_NAME: "pull_request", GITHUB_EVENT_PATH: eventFile } });
    assert.equal(pr.status, 0, pr.stderr);
    assert.deepEqual(JSON.parse(pr.stdout).source, plan.source);
    const invalid = spawnSync(process.execPath, [cli, "--base", "--output=owned", "--head", head, "--dry-run"], { cwd: root, encoding: "utf8" });
    assert.notEqual(invalid.status, 0, "invalid comparison must fail instead of selecting nothing");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("aggregate succeeds for intentional skips but requires every selected job to succeed", () => {
  const site = createPreflightPlan(["site/content/releases.md"]);
  assert.equal(evaluatePreflightGate(site, { plan: { result: "success" }, package: { result: "skipped" }, portable: { result: "skipped" }, firefox: { result: "skipped" }, "release-bundle": { result: "skipped" }, checks: { result: "success" } }, "companion").ok, true);
  const full = createPreflightPlan([], { release: true });
  const results = { plan: { result: "success" }, "fixture-runner": { result: "success" }, "local-injection-browser": { result: "success" } };
  assert.equal(evaluatePreflightGate(full, results, "fixture").ok, true);
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const broken = { ...results, "local-injection-browser": result ? { result } : undefined };
    const gate = evaluatePreflightGate(full, broken, "fixture");
    assert.equal(gate.ok, false, result ?? "missing");
    assert.match(gate.errors.join(" "), /local-injection-browser/);
  }
});

test("aggregate cannot approve missing plans or failed planning", () => {
  const plan = createPreflightPlan(["AGENTS.md"]);
  assert.equal(evaluatePreflightGate(plan, { plan: { result: "failure" } }, "panel").ok, false);
  assert.equal(evaluatePreflightGate(null, { plan: { result: "success" } }, "panel").ok, false);
  assert.equal(evaluatePreflightGate({ ...plan, groups: {} }, { plan: { result: "success" } }, "panel").ok, false);
  const untruthful = { ...plan, groups: Object.fromEntries(Object.keys(plan.groups).map(key => [key, false])) };
  assert.equal(evaluatePreflightGate(untruthful, { plan: { result: "success" } }, "companion").ok, false);
});

test("manual CI selection requests the full matrix and emits machine-readable job outputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-preflight-ci-"));
  try {
    const output = join(root, "output");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preflight.mjs", import.meta.url)), "--ci", "--json", "--github-output", output], {
      cwd: dirname(dirname(fileURLToPath(import.meta.url))), encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch" }
    });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.scope, "release");
    assert(Object.values(plan.groups).every(Boolean));
    const text = await readFile(output, "utf8");
    assert.match(text, /^plan=\{/);
    assert.match(text, /\ncompanion=true\n/);
    assert.match(text, /\nsite=true\n/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a new-branch push has a conservative full gate and unknown CI events fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "workbench-preflight-event-"));
  try {
    const eventFile = join(root, "event.json");
    await writeFile(eventFile, JSON.stringify({ before: "0".repeat(40), after: "a".repeat(40) }));
    const cli = fileURLToPath(new URL("./preflight.mjs", import.meta.url));
    const options = { cwd: root, encoding: "utf8", env: { ...process.env, PREFLIGHT_RELEASE: "false", GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventFile } };
    const pushed = spawnSync(process.execPath, [cli, "--ci", "--json"], options);
    assert.equal(pushed.status, 0, pushed.stderr);
    assert(Object.values(JSON.parse(pushed.stdout).groups).every(Boolean));
    const unknown = spawnSync(process.execPath, [cli, "--ci", "--json"], { ...options, env: { ...options.env, GITHUB_EVENT_NAME: "schedule" } });
    assert.notEqual(unknown.status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the aggregate CLI exits failed for a selected skipped job", () => {
  const plan = createPreflightPlan([], { release: true });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./preflight.mjs", import.meta.url)), "--gate", "site"], {
    encoding: "utf8", env: { ...process.env, PREFLIGHT_PLAN: JSON.stringify(plan), PREFLIGHT_RESULTS: JSON.stringify({ plan: { result: "success" }, build: { result: "skipped" } }) }
  });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).ok, false);
});
