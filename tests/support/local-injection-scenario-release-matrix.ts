export const LOCAL_INJECTION_SCENARIO_RELEASE_REQUIREMENTS = Object.freeze([
  "SCN-MANUAL",
  "SCN-TIMED",
  "SCN-MEMBERSHIP-EMPTY",
  "SCN-MEMBERSHIP-INCOMPATIBLE",
  "SCN-REVIEW-INVALID",
  "SCN-TARGET-STALE",
  "SCN-DRIFT-LISTENER",
  "SCN-DRIFT-SERVER",
  "SCN-OUTCOME-PARTIAL",
  "SCN-OUTCOME-FAILED",
  "SCN-OUTCOME-UNKNOWN",
  "SCN-EVIDENCE-INCOMPLETE",
  "SCN-PAUSE-INFLIGHT",
  "SCN-STOP-INFLIGHT",
  "SCN-HIDDEN-PAUSE",
  "SCN-CHECKPOINT",
  "SCN-CLEAR",
  "SCN-CLOSE",
  "SCN-RUN-AGAIN",
  "SCN-PRESSURE-100",
  "SCN-PRESSURE-8MIB",
  "SCN-PRESSURE-500F",
  "SCN-OFFICIAL-E2E"
] as const);

type ReleaseRequirementId = (typeof LOCAL_INJECTION_SCENARIO_RELEASE_REQUIREMENTS)[number];

export const LOCAL_INJECTION_SCENARIO_RELEASE_MATRIX: readonly Readonly<{
  id: ReleaseRequirementId;
  file: string;
  proof: string;
}>[] = Object.freeze([
  { id: "SCN-MANUAL", file: "tests/local-injection-scenario-runner.test.ts", proof: "Step next dispatches exactly one Step and returns Paused" },
  { id: "SCN-TIMED", file: "tests/local-injection-scenario-runner.test.ts", proof: "Play uses ordered relative active-time delays" },
  { id: "SCN-MEMBERSHIP-EMPTY", file: "tests/local-injection-scenario.test.ts", proof: "Scenario admission requires at least one explicit Step" },
  { id: "SCN-MEMBERSHIP-INCOMPATIBLE", file: "tests/local-injection-scenario.test.ts", proof: "same-target membership rejects incompatible Evidence" },
  { id: "SCN-REVIEW-INVALID", file: "tests/local-injection-scenario.test.ts", proof: "invalid Draft blocks Review before any Injection" },
  { id: "SCN-TARGET-STALE", file: "tests/local-injection-execution-coordinator.test.ts", proof: "just-in-time stale target stops before dispatch" },
  { id: "SCN-DRIFT-LISTENER", file: "tests/local-injection-scenario-runner.test.ts", proof: "listener drift pauses for explicit immutable-plan re-review" },
  { id: "SCN-DRIFT-SERVER", file: "tests/workbench-local-injection-runtime.test.ts", proof: "committed Server interleave pauses before the next Step" },
  { id: "SCN-OUTCOME-PARTIAL", file: "tests/local-injection-scenario-runner.test.ts", proof: "partial delivery stops with untouched remainder NOT RUN" },
  { id: "SCN-OUTCOME-FAILED", file: "tests/local-injection-execution-coordinator.test.ts", proof: "bridge and delivery failures retain truthful terminal outcomes" },
  { id: "SCN-OUTCOME-UNKNOWN", file: "tests/local-injection-execution-coordinator.test.ts", proof: "acknowledgement loss stays unknown without retry" },
  { id: "SCN-EVIDENCE-INCOMPLETE", file: "tests/workbench-local-injection-runtime.test.ts", proof: "delivered-unretained stops before later Steps and projections" },
  { id: "SCN-PAUSE-INFLIGHT", file: "tests/local-injection-scenario-runner.test.ts", proof: "Pause waits for the current request and blocks the next dispatch" },
  { id: "SCN-STOP-INFLIGHT", file: "tests/local-injection-scenario-runner.test.ts", proof: "Stop settles the current request and terminalizes the remainder" },
  { id: "SCN-HIDDEN-PAUSE", file: "tests/workbench-local-injection-runtime.test.ts", proof: "hidden panel freezes active time and requires explicit Resume" },
  { id: "SCN-CHECKPOINT", file: "tests/local-injection-scenario-assertions.test.ts", proof: "zero-Injection Checkpoints evaluate six Workbench-owned assertion families, including normalized Diagnostic Observations" },
  { id: "SCN-CLEAR", file: "tests/workbench-local-injection-runtime.test.ts", proof: "Clear is unavailable during a Run and later marks references unavailable" },
  { id: "SCN-CLOSE", file: "tests/workbench-local-injection-runtime.test.ts", proof: "Panel close stops scheduling and discards Scenario state" },
  { id: "SCN-RUN-AGAIN", file: "tests/workbench-local-injection-runtime.test.ts", proof: "Run again allocates a fresh Run and Injection identities" },
  { id: "SCN-PRESSURE-100", file: "tests/local-injection-scenario.test.ts", proof: "the 100-Step admission limit refuses the crossing Step" },
  { id: "SCN-PRESSURE-8MIB", file: "tests/local-injection-scenario.test.ts", proof: "8 MiB accounting refuses the crossing document or retained Run" },
  { id: "SCN-PRESSURE-500F", file: "tests/local-injection-scenario-runner.test.ts", proof: "100 representative 500-field Steps remain bounded and ordered" },
  { id: "SCN-OFFICIAL-E2E", file: "tests/extension-ui/lightstreamer-capture.spec.ts", proof: "official client ADD UPDATE DELETE uses three ordinary requests and exactly-once callbacks" }
]);
