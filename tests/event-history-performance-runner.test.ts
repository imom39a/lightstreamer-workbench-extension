import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Event History performance runner reference preflight", () => {
  it("rejects a pending reference before looking for or launching Chrome", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lsew-reference-preflight-test-"));
    const referencePath = join(temporaryRoot, "pending-reference.json");
    writeFileSync(referencePath, JSON.stringify({
      schemaVersion: 2,
      referenceVersion: "history-impl-11-initial",
      disposition: "PENDING_MAINTAINER_BASELINE",
      rationale: "pending",
      environment: { chromeMajor: 151, platformClass: "darwin", architectureClass: "arm64" },
      cells: []
    }));

    try {
      expect(() => execFileSync(process.execPath, ["scripts/event-history-performance.mjs"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          LSEW_BROWSER_HEADLESS: "false",
          LSEW_UI_HEADLESS: "false",
          LSEW_BROWSER_CACHE_DIR: join(temporaryRoot, "missing-cache"),
          LSEW_EVENT_HISTORY_PERF_REFERENCE: referencePath
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      })).toThrow(/Pinned reference preflight failed/u);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
