import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const testsRoot = join(projectRoot, "tests");
const vitestCli = join(projectRoot, "node_modules", "vitest", "vitest.mjs");

// fake-indexeddb is process-local, but its event-loop callbacks and the
// deadline used by the journal can be starved when these large suites share
// the host with every other Vitest worker. Keep this allowlist deliberately
// explicit and validate it against discovery below so a listed suite cannot
// silently disappear from the isolation boundary.
const indexedDbFiles = Object.freeze([
  "tests/authoritative-event-history-contract.test.ts",
  "tests/authoritative-event-history-indexeddb.test.ts",
  "tests/event-history-admission-performance.test.ts",
  "tests/history-impl-05-capacity.test.ts",
  "tests/history-impl-08-lifecycle.test.ts",
  "tests/history-impl-09-lifecycle-blockers.test.ts",
  "tests/filter-impl-07-failure-cleanup.test.ts",
  "tests/filter-impl-07-postings.test.ts",
  "tests/filter-impl-07-schema.test.ts",
  "tests/filter-impl-08-indexeddb-query.test.ts",
  "tests/filter-impl-09-indexeddb-discovery.test.ts",
  "tests/filter-impl-09-indexeddb-parity.test.ts",
  "tests/filter-impl-09-indexeddb-workload.test.ts",
  "tests/find-exact-index.test.ts",
  "tests/find-query-coverage.test.ts",
  "tests/history-100k-02-indexeddb.test.ts",
  "tests/history-100k-04-indexeddb.test.ts",
  "tests/history-index-block-query.test.ts",
  "tests/history-index-write-amplification.test.ts",
  "tests/workbench-find.test.ts"
]);

// Real wall-clock assertions and expensive build/React fixtures need a quiet
// host. Their latency assertions remain in the tests; the phase timeout only
// gives setup, teardown and full integration workloads a separate budget.
const heavyWorkFiles = Object.freeze([
  "tests/activity-timeline-projection.test.ts",
  "tests/command-state.test.ts",
  "tests/event-history-performance-harness.test.ts",
  "tests/event-history-performance-runner.test.ts",
  "tests/event-history-performance-script.test.ts",
  "tests/filter-impl-04-memory-performance.test.ts",
  "tests/filter-impl-05-memory.test.ts",
  "tests/filter-impl-06-memory-performance.test.ts",
  "tests/local-injection-scenario-assertions.test.ts",
  "tests/production-extension-build.test.ts",
  "tests/release-package-script.test.ts",
  "tests/workbench-runtime-performance.test.ts",
  "tests/workbench-runtime.test.ts"
]);

function discoverTestFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverTestFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(relative(projectRoot, path).replaceAll("\\", "/"));
    }
  }
  return files;
}

function validatePlan(discovered) {
  const discoveredSet = new Set(discovered);
  const isolatedSet = new Set(indexedDbFiles);
  const heavyWorkSet = new Set(heavyWorkFiles);
  const serializedFiles = [...indexedDbFiles, ...heavyWorkFiles];
  const duplicateAllowlistEntries = serializedFiles.filter((file, index) => serializedFiles.indexOf(file) !== index);
  const missingSerializedFiles = serializedFiles.filter((file) => !discoveredSet.has(file));
  const ordinaryFiles = discovered.filter((file) => !isolatedSet.has(file) && !heavyWorkSet.has(file));
  const classifiedCount = ordinaryFiles.length + isolatedSet.size + heavyWorkSet.size;
  if (duplicateAllowlistEntries.length > 0 || missingSerializedFiles.length > 0 || classifiedCount !== discovered.length) {
    const details = [
      duplicateAllowlistEntries.length > 0 ? `duplicate serialized entries: ${duplicateAllowlistEntries.join(", ")}` : "",
      missingSerializedFiles.length > 0 ? `missing serialized files: ${missingSerializedFiles.join(", ")}` : "",
      classifiedCount !== discovered.length ? `discovery/classification mismatch (${discovered.length} discovered, ${classifiedCount} classified)` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`Refusing to run an incomplete Vitest plan: ${details}`);
  }
  return { ordinary: ordinaryFiles, isolated: [...isolatedSet], heavyWork: [...heavyWorkSet] };
}

function runPhase(label, files, forwardedArgs, isolationArgs = []) {
  console.log(`[test-unit] ${label}: ${files.length} test files`);
  const result = spawnSync(process.execPath, [vitestCli, "run", ...forwardedArgs, ...isolationArgs, ...files], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`[test-unit] ${label} could not start: ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    console.error(`[test-unit] ${label} failed with status ${result.status ?? "signal"}; stopping.`);
    return result.status ?? 1;
  }
  return 0;
}

try {
  const discovered = discoverTestFiles(testsRoot).sort();
  const plan = validatePlan(discovered);
  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs.includes("--print-plan")) {
    console.log(JSON.stringify(plan));
    process.exit(0);
  }
  // Keep ordinary tests parallel without letting host-wide worker fan-out starve
  // their intentionally bounded browserless build and publication checks.
  const ordinaryStatus = runPhase(
    "parallel ordinary suite",
    plan.ordinary,
    forwardedArgs,
    ["--maxWorkers=2"]
  );
  if (ordinaryStatus !== 0) process.exit(ordinaryStatus);
  const isolatedStatus = runPhase(
    "serialized IndexedDB suite",
    plan.isolated,
    forwardedArgs,
    ["--no-file-parallelism", "--maxWorkers=1"]
  );
  if (isolatedStatus !== 0) process.exit(isolatedStatus);
  const heavyWorkStatus = runPhase(
    "serialized heavy-work suite",
    plan.heavyWork,
    forwardedArgs,
    ["--no-file-parallelism", "--maxWorkers=1", "--testTimeout=30000"]
  );
  process.exit(heavyWorkStatus);
} catch (error) {
  console.error(`[test-unit] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
