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
    expect(matrix).toHaveLength(115);
  });

  it("retains the diagnostic stress matrix and requires reviewed baseline updates", () => {
    expect(runnerSource).toContain(
      'const baselineReviewIntent = "Compare committed platform baselines with current production. Update images only for an intentional, reviewed UI change and record the exact platform results.";'
    );
    expect(matrix.filter((scenario: { production?: { scenario?: string } }) =>
      scenario.production?.scenario === "diagnostics-stress"
    ).map((scenario: { id: string }) => scenario.id)).toEqual([
      "wide-diagnostics-stress-dark",
      "normal-diagnostics-stress-dark",
      "shallow-diagnostics-stress-dark",
      "compact-diagnostics-stress-dark"
    ]);
  });

  it("describes the selected integrated matrix without stale batch-only baseline proof", () => {
    expect(runnerSource).toContain('changedWorkflow: "The integrated Workbench matrix covers the approved Scope priority blocks and full-key JSON Evidence stream, the main Evidence timeline');
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

  it("classifies every accepted continuous-history visual scenario by review category", () => {
    const continuousHistoryScenarios = matrix
      .filter((scenario: { production?: { scenario?: string } }) =>
        scenario.production?.scenario?.startsWith("history-")
      )
      .map((scenario: { id: string; production: { scenario: string; setup: string } }) => ({
        id: scenario.id,
        category: scenario.production.setup.startsWith("notifications-history-")
          ? "integrated-notification"
          : "history-footer",
        productionScenario: scenario.production.scenario,
        setup: scenario.production.setup
      }));

    expect(continuousHistoryScenarios).toEqual([
      {
        id: "wide-history-rollover-notifications-dark",
        category: "integrated-notification",
        productionScenario: "history-rolling-high-volume",
        setup: "notifications-history-rollover"
      },
      {
        id: "normal-history-recovered-notifications-dark",
        category: "integrated-notification",
        productionScenario: "history-journal-recovered",
        setup: "notifications-history-recovered"
      },
      {
        id: "compact-history-journal-memory-dark",
        category: "history-footer",
        productionScenario: "history-journal-memory-fallback",
        setup: "history-memory"
      },
      {
        id: "shallow-history-gap-forced-dark",
        category: "history-footer",
        productionScenario: "history-evidence-gap",
        setup: "history-gap"
      }
    ]);
  });

  it("includes diagnostic and Notifications states in contact sheets, axe, and focus proof", () => {
    const result = spawnSync(process.execPath, [runner, "--print-review-scope"], {
      cwd: rootDir,
      encoding: "utf8",
      maxBuffer: 16 * 1_024
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
    const historyNotificationIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup?.startsWith("notifications-history-"))
      .map((scenario: { id: string }) => scenario.id);
    const historyFooterIds = matrix
      .filter((scenario: { production?: { setup?: string } }) =>
        scenario.production?.setup === "history-memory" || scenario.production?.setup === "history-gap"
      )
      .map((scenario: { id: string }) => scenario.id);
    const activityIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup?.startsWith("activity"))
      .map((scenario: { id: string }) => scenario.id);
    const footerDiagnosticIds = matrix
      .filter((scenario: { production?: { setup?: string } }) => scenario.production?.setup === "diagnostics")
      .map((scenario: { id: string }) => scenario.id);
    const readabilityIds = matrix
      .filter((scenario: { id: string }) => scenario.id.startsWith("readability-c-"))
      .map((scenario: { id: string }) => scenario.id);
    const localInjectionIds = matrix
      .filter((scenario: { id: string }) => scenario.id.startsWith("local-injection-"))
      .map((scenario: { id: string }) => scenario.id);
    const serverInjectionIds = matrix
      .filter((scenario: { id: string }) => scenario.id.startsWith("server-injection-"))
      .map((scenario: { id: string }) => scenario.id);
    const captureIds = matrix.filter((scenario: { id: string }) => scenario.id.startsWith("scenario-capture-")).map((scenario: { id: string }) => scenario.id);
    const scenarioIds = matrix.filter((scenario: { id: string }) => scenario.id.startsWith("scenario-")).map((scenario: { id: string }) => scenario.id);

    expect(result.status, result.stderr).toBe(0);
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(16 * 1_024);
    expect(diagnosticIds).toHaveLength(12);
    expect(notificationIds).toHaveLength(7);
    expect(historyNotificationIds).toEqual([
      "wide-history-rollover-notifications-dark",
      "normal-history-recovered-notifications-dark"
    ]);
    expect(historyFooterIds).toEqual([
      "compact-history-journal-memory-dark",
      "shallow-history-gap-forced-dark"
    ]);
    expect(storageIds).toHaveLength(5);
    expect(activityIds).toHaveLength(9);
    expect(footerDiagnosticIds).toHaveLength(4);
    expect(readabilityIds).toHaveLength(2);
    const reviewScope = JSON.parse(result.stdout);
    expect(reviewScope).toMatchObject({
      contactSheetScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...historyFooterIds, ...storageIds, ...activityIds, ...footerDiagnosticIds, ...readabilityIds, ...localInjectionIds, ...serverInjectionIds, ...captureIds]),
      accessibilityScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...storageIds, ...activityIds, ...footerDiagnosticIds, ...readabilityIds, ...localInjectionIds, ...serverInjectionIds, ...scenarioIds]),
      focusScenarioIds: expect.arrayContaining([...diagnosticIds, ...notificationIds, ...storageIds, ...activityIds, ...footerDiagnosticIds, ...readabilityIds, ...localInjectionIds, ...serverInjectionIds, ...captureIds])
    });
    expect(captureIds).toHaveLength(8);
    expect(scenarioIds).toHaveLength(40);
    expect(localInjectionIds).toHaveLength(5);
    expect(serverInjectionIds).toHaveLength(6);
    for (const id of historyFooterIds) {
      expect(reviewScope.accessibilityScenarioIds).not.toContain(id);
      expect(reviewScope.focusScenarioIds).not.toContain(id);
    }
  });

  it("has a matching production PNG reference for every committed-baseline comparison on both platforms", () => {
    for (const scenario of matrix.filter((entry: { reference?: { source?: string } }) => entry.reference?.source !== "production")) {
      for (const platform of ["darwin", "linux"]) {
        const png = readFileSync(join(rootDir, "tests/ui/visual-regression.spec.ts-snapshots", `${scenario.reference?.id ?? scenario.id}-${platform}.png`));
        expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual(scenario.viewport);
      }
    }
  });

  it("bounds filtered Scenario capture inspection without starting a browser", () => {
    const result = spawnSync(process.execPath, [runner, "--print-review-scope", "--grep", "scenario-capture-"], {
      cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1_024
    });
    expect(result.status, result.stderr).toBe(0);
    const scope = JSON.parse(result.stdout);
    const ids = matrix.filter((scenario: { id: string }) => scenario.id.startsWith("scenario-capture-")).map((scenario: { id: string }) => scenario.id);
    expect(scope).toEqual({ contactSheetScenarioIds: ids, accessibilityScenarioIds: ids, focusScenarioIds: ids });
    expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(16 * 1_024);
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
