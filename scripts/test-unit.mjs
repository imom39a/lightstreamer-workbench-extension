import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(import.meta.dirname, "..");
const testsRoot = join(projectRoot, "tests");
const vitestCli = join(projectRoot, "node_modules", "vitest", "vitest.mjs");

// fake-indexeddb is process-local, but its event-loop callbacks and the
// deadline used by the journal can be starved when these large suites share
// the host with every other Vitest worker. Keep this allowlist deliberately
// explicit and validate it against discovery below so a new IDB suite cannot
// silently escape the isolation boundary.
const indexedDbFiles = Object.freeze([
  "tests/authoritative-event-history-contract.test.ts",
  "tests/authoritative-event-history-indexeddb.test.ts",
  "tests/event-history-admission-performance.test.ts",
  "tests/history-impl-05-capacity.test.ts",
  "tests/history-impl-08-lifecycle.test.ts",
  "tests/history-impl-09-lifecycle-blockers.test.ts"
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
  const duplicateAllowlistEntries = indexedDbFiles.filter((file, index) => indexedDbFiles.indexOf(file) !== index);
  const missingIsolatedFiles = indexedDbFiles.filter((file) => !discoveredSet.has(file));
  const unclassifiedFiles = discovered.filter((file) => !isolatedSet.has(file));
  const classifiedCount = unclassifiedFiles.length + isolatedSet.size;
  if (duplicateAllowlistEntries.length > 0 || missingIsolatedFiles.length > 0 || classifiedCount !== discovered.length) {
    const details = [
      duplicateAllowlistEntries.length > 0 ? `duplicate isolated entries: ${duplicateAllowlistEntries.join(", ")}` : "",
      missingIsolatedFiles.length > 0 ? `missing isolated files: ${missingIsolatedFiles.join(", ")}` : "",
      classifiedCount !== discovered.length ? `discovery/classification mismatch (${discovered.length} discovered, ${classifiedCount} classified)` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`Refusing to run an incomplete Vitest plan: ${details}`);
  }
  return { ordinary: unclassifiedFiles, isolated: [...isolatedSet] };
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
  const ordinaryStatus = runPhase("parallel ordinary suite", plan.ordinary, forwardedArgs);
  if (ordinaryStatus !== 0) process.exit(ordinaryStatus);
  const isolatedStatus = runPhase(
    "serialized IndexedDB suite",
    plan.isolated,
    forwardedArgs,
    ["--no-file-parallelism", "--maxWorkers=1"]
  );
  process.exit(isolatedStatus);
} catch (error) {
  console.error(`[test-unit] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
