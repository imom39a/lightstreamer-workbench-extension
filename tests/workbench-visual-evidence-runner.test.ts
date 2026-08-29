import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = basename(process.cwd()) === "src" ? resolve(process.cwd(), "..") : process.cwd();
const runner = join(rootDir, "scripts", "generate-workbench-visual-evidence.mjs");
const runnerSource = readFileSync(runner, "utf8");
const matrix = JSON.parse(readFileSync(join(rootDir, "tests", "ui", "visual-matrix.json"), "utf8"));

describe("Workbench visual-evidence runner", () => {
  it("documents bounded inspection commands without starting browsers", () => {
    const result = spawnSync(process.execPath, [runner, "--help"], {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 8 * 1_024
    });

    expect(result.status, result.stderr).toBe(0);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(8 * 1_024);
    expect(result.stdout).toContain("--print-review-scope");
    expect(matrix).toHaveLength(80);
  });

  it("records the diagnostic-footer baseline intent and stress matrix in the generated packet metadata", () => {
    expect(runnerSource).toContain(
      'baselineIntent: "Update tracked baselines that render diagnostics and add Darwin/Linux baselines for the four mixed-severity stress geometries. Five Darwin-only native-scrollbar snapshots are normalized to the current release-prep rendering; their semantic content is unchanged."'
    );
    expect(matrix.filter((scenario: { production?: { scenario?: string } }) =>
      scenario.production?.scenario === "diagnostics-stress"
    ).map((scenario: { id: string }) => scenario.id)).toEqual([
      "wide-diagnostics-stress-light",
      "normal-diagnostics-stress-dark",
      "shallow-diagnostics-stress-light",
      "compact-diagnostics-stress-dark"
    ]);
  });

  it("describes the selected integrated matrix without stale batch-only baseline proof", () => {
    expect(runnerSource).toContain('changedWorkflow: "The integrated Workbench matrix covers the main Evidence timeline and scoped Context Activity summary, Local Injection Scenario');
    expect(runnerSource).toContain('result: "Run separately and record the exact Playwright result with this packet."');
    expect(runnerSource).not.toContain('visual baseline: scenario-checkpoint');
    expect(runnerSource).not.toContain('result: "8/8 passed"');
  });

  it("prepares every integrated diagnostic matrix setup and records its review scope", () => {
    for (const setup of ["diagnostic-server", "diagnostic-subscription", "diagnostic-anomaly", "notifications-volume", "notifications-empty"]) {
      expect(runnerSource).toContain(`setup === "${setup}"`);
    }
    expect(runnerSource).toContain("Notifications owns active Workbench conditions and recent Lightstreamer diagnostics");
    expect(runnerSource).toContain("filters remain independent of Evidence");
    expect(runnerSource).toContain("snapshot, COMMAND, and lost-update anomalies");
  });

  it("includes diagnostic and Notifications states in contact sheets, axe, and focus proof", () => {
    const result = spawnSync(process.execPath, [runner, "--print-review-scope"], {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 8 * 1_024
    });
    const diagnosticIds = matrix
      .filter((scenario: { production?: { setup?: string } }) =>
        scenario.production?.setup?.startsWith("diagnostic-")
      )
      .map((scenario: { id: string }) => scenario.id);
    const storageIds = matrix
      .filter((scenario: { production?: { setup?: string } }) =>
        scenario.production?.setup === "storage-headroom"
      )
      .map((scenario: { id: string }) => scenario.id);
    const notificationIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup?.startsWith("notifications-"))
      .map((scenario: { id: string }) => scenario.id);
    const activityIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup?.startsWith("activity"))
      .map((scenario: { id: string }) => scenario.id);
    const footerDiagnosticIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup === "diagnostics")
      .map((scenario: { id: string }) => scenario.id);

    expect(result.status, result.stderr).toBe(0);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(8 * 1_024);
    expect(diagnosticIds).toHaveLength(12);
    expect(notificationIds).toHaveLength(5);
    expect(storageIds).toHaveLength(5);
    expect(activityIds).toHaveLength(9);
    expect(footerDiagnosticIds).toHaveLength(4);
    expect(JSON.parse(result.stdout)).toMatchObject({
      contactSheetScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...storageIds, ...activityIds, ...footerDiagnosticIds]),
      accessibilityScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...storageIds, ...activityIds, ...footerDiagnosticIds]),
      focusScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...storageIds, ...activityIds, ...footerDiagnosticIds])
    });
  });

  it("keeps reviewed D screenshots as static design references for the production Activity states", () => {
    const activityReferences = matrix.filter((scenario: { reference?: { source?: string } }) => scenario.reference?.source === "asset");
    expect(activityReferences).toHaveLength(3);
    for (const scenario of activityReferences) {
      const jpeg = readFileSync(join(rootDir, scenario.reference.path));
      expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      expect(scenario.reference.path).toMatch(/\.jpg$/);
    }
  });

  it("defines isolated clean-base and low-headroom production references", () => {
    const storageScenarios = matrix.filter((scenario: { production?: { setup?: string }; reference?: { source?: string; storageMode?: string }; visualEvidenceOnly?: boolean }) =>
      scenario.production?.setup === "storage-headroom"
    );
    expect(storageScenarios).toHaveLength(5);
    expect(storageScenarios.every((scenario: { reference?: { source?: string; storageMode?: string }; visualEvidenceOnly?: boolean }) =>
      scenario.reference?.source === "production" && scenario.reference.storageMode === "clean" && scenario.visualEvidenceOnly === true
    )).toBe(true);
  });
});
