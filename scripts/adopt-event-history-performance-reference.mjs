#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REFERENCE = resolve(projectRoot, "docs/reference/event-history-performance-reference.json");
const NON_INTERACTIVE_MODE = "non-interactive-layout-commit";

export function createNonInteractiveReference(candidate) {
  if (!candidate || typeof candidate !== "object") throw new Error("Candidate report is missing or malformed.");
  if (candidate.decision?.verdict !== "NOT_CLASSIFIED") throw new Error("Only a capture-only NOT_CLASSIFIED candidate may be adopted.");
  if ((candidate.decision?.failures ?? []).length !== 0) throw new Error("A candidate with absolute gate failures cannot be adopted.");
  if (candidate.source?.dirty !== false) throw new Error("Only a clean-source candidate may be adopted.");
  if (candidate.proofMode !== NON_INTERACTIVE_MODE) throw new Error("Only the non-interactive layout-commit proof can be adopted by this closure script.");
  if (candidate.runner?.kind !== "real-chrome" || candidate.runner?.headless !== true || candidate.runner?.fakeIndexedDbUsed !== false) {
    throw new Error("Candidate must explicitly prove real headless Chrome with native IndexedDB.");
  }
  if (candidate.runner?.proofMode !== NON_INTERACTIVE_MODE || candidate.environment?.headless !== true) {
    throw new Error("Candidate mode/headless metadata is not coherent.");
  }
  if (candidate.frameProof?.publicationBoundary !== "react-layout-commit-dom-publication"
    || candidate.frameProof.compositorFrameMeasured !== false
    || candidate.frameProof.coherent !== true
    || candidate.frameProof.missingBoundaryCount !== 0) {
    throw new Error("Candidate does not contain a coherent non-compositor publication proof.");
  }
  if (!Array.isArray(candidate.cells) || candidate.cells.length !== 36) throw new Error("Candidate must contain all 36 matrix cells.");
  if (!Array.isArray(candidate.queryCells) || candidate.queryCells.length !== 6) throw new Error("Candidate must contain all six query cells.");
  return {
    schemaVersion: candidate.schemaVersion,
    referenceVersion: `filter-impl-08-${NON_INTERACTIVE_MODE}-chrome151`,
    disposition: "ACCEPTED_INITIAL_CLEAN_REFERENCE",
    rationale: "Explicitly adopted from a clean real Chrome for Testing 151 non-interactive capture. Native IndexedDB, production React DOM publication, exact workloads, absolute thresholds, and headed-proof limitation were independently recorded before adoption.",
    environment: {
      chromeMajor: candidate.environment.chromeMajor,
      platformClass: candidate.environment.platformClass,
      architectureClass: candidate.environment.architectureClass,
      headless: true
    },
    proofMode: NON_INTERACTIVE_MODE,
    cells: candidate.cells,
    queryCells: candidate.queryCells
  };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function main() {
  const candidatePath = resolve(option("--candidate", "/tmp/filter-impl-08-noninteractive-capture.json"));
  const referencePath = resolve(option("--reference", DEFAULT_REFERENCE));
  const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
  const reference = createNonInteractiveReference(candidate);
  await writeFile(referencePath, `${JSON.stringify(reference, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ candidate: candidatePath, reference: referencePath, proofMode: reference.proofMode, cells: reference.cells.length, queryCells: reference.queryCells.length }, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
