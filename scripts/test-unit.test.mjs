import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : entry.isFile() && entry.name.endsWith(".test.ts") ? [relative(root, path).replaceAll("\\", "/")] : [];
  }).sort();
}

function runSerial(failurePhase) {
  const directory = mkdtempSync(join(tmpdir(), "workbench-serial-unit-"));
  try {
    const files = discover(join(root, "tests"));
    for (const file of files) {
      const path = join(directory, file);
      mkdirSync(resolve(path, ".."), { recursive: true });
      writeFileSync(path, "");
    }
    mkdirSync(join(directory, "scripts"));
    copyFileSync(join(root, "scripts/test-unit.mjs"), join(directory, "scripts/test-unit.mjs"));
    mkdirSync(join(directory, "node_modules/vitest"), { recursive: true });
    const trace = join(directory, "vitest-processes.jsonl");
    // This owned executable represents the external Vitest process boundary.
    // It records public arguments and can fail a selected phase without running
    // the production suites recursively inside this runner contract test.
    writeFileSync(join(directory, "node_modules/vitest/vitest.mjs"), `
      import { appendFileSync, existsSync, readFileSync } from "node:fs";
      const path = process.env.LSEW_TEST_UNIT_TRACE;
      const count = existsSync(path) ? readFileSync(path, "utf8").trim().split("\\n").length : 0;
      appendFileSync(path, JSON.stringify({ pid: process.pid, args: process.argv.slice(2) }) + "\\n");
      if (String(count) === process.env.LSEW_TEST_UNIT_FAILURE_PHASE) process.exit(17);
    `);
    const result = spawnSync(process.execPath, [join(directory, "scripts/test-unit.mjs"), "--serial", "--reporter=dot"], {
      cwd: directory, encoding: "utf8", timeout: 30000,
      env: { ...process.env, LSEW_TEST_UNIT_TRACE: trace, LSEW_TEST_UNIT_FAILURE_PHASE: String(failurePhase ?? "") }
    });
    const phases = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
    return { result, phases, files };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("serial release mode runs every discovered unit file exactly once in fresh serial phases", () => {
  const { result, phases, files } = runSerial();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(phases.length, 3);
  assert.equal(new Set(phases.map(phase => phase.pid)).size, 3, "Each phase owns a fresh Vitest process");
  const executed = phases.flatMap(phase => phase.args.filter(arg => arg.endsWith(".test.ts")));
  assert.deepEqual([...executed].sort(), files);
  assert.equal(new Set(executed).size, executed.length);
  for (const phase of phases) {
    assert.equal(phase.args[0], "run");
    assert(phase.args.includes("--no-file-parallelism"), "Release files remain serial in every phase");
    assert(phase.args.includes("--maxWorkers=1"));
    assert(!phase.args.includes("--maxWorkers=2"));
    assert(!phase.args.includes("--serial"), "Runner mode is not forwarded as a Vitest option");
    assert(phase.args.includes("--reporter=dot"));
  }
  for (const phase of phases.slice(0, 2)) {
    assert(!phase.args.some(arg => /^--(?:test|hook)Timeout=/.test(arg)), "Ordinary and IndexedDB budgets stay at their existing defaults");
  }
  assert(phases[2].args.includes("tests/workbench-runtime.test.ts"));
  assert(phases[2].args.includes("tests/workbench-runtime-performance.test.ts"));
  assert(phases[2].args.includes("--testTimeout=30000"));
  assert(phases[2].args.includes("--hookTimeout=30000"));
});

for (const [phase, label] of ["ordinary", "IndexedDB", "heavy work"].entries()) {
  test(`serial release mode stops and fails when its ${label} process fails`, () => {
    const { result, phases } = runSerial(phase);
    assert.equal(result.status, 17, result.stderr);
    assert.equal(phases.length, phase + 1, "A failed phase cannot start later work or retry");
  });
}
