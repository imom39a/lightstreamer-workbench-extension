import {
  stepScenarioRun,
  terminalizeScenarioRun,
  SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD,
  SCENARIO_MAX_CONTROL_RECORDS,
  type ReviewedScenarioStep,
  type ScenarioControlRecord,
  type ScenarioRun,
  type ScenarioTraceEntry,
  type ScenarioTraceTiming
} from "./local-injection-scenario";
import type { EvidenceRef } from "./event-history-authoritative";
import type { LocalInjectionDocument } from "./local-injection-document";
import type { LocalInjectionOutcome } from "./local-injection-outcome";

export interface ScenarioClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export type ScenarioPauseReason = "USER" | "HIDDEN" | "DRIFT";
export type ScenarioRunnerPhase = "paused" | "waiting" | "in-flight" | "pause-pending" | "stop-pending" | "complete" | "stopped" | "disposed";
export type ReviewedScenarioMember = ReviewedScenarioStep;
export type ReviewedScenarioMemberCursor = Readonly<{ members: readonly ReviewedScenarioMember[]; index: number }>;

type ExecutionTerminal = Readonly<{
  kind: "attempted";
  outcome: LocalInjectionOutcome;
  evidence: EvidenceRef | null;
}> | Readonly<{
  kind: "not-run";
  reason: "REVIEW INVALIDATED" | "TARGET NOT RUN";
  timestamp: number;
  detail: string;
}>;

export type ScenarioDispatchInput = Readonly<{
  scenarioId: string;
  runId: string;
  stepId: string;
  ordinal: number;
  injectionId: string;
  target: ScenarioRun["target"];
  document: Readonly<LocalInjectionDocument>;
  sourceEventId: string | null;
}>;

export type ScenarioRunnerSnapshot = Readonly<{
  phase: ScenarioRunnerPhase;
  run: ScenarioRun;
  cursor: ReviewedScenarioMemberCursor;
  nextOrdinal: number;
  activeOffsetMs: number;
  remainingDelayMs: number;
  pauseReason: ScenarioPauseReason | null;
  controlCapacityReached: boolean;
  visible: boolean;
}>;

export type ScenarioRunner = Readonly<{
  snapshot(): ScenarioRunnerSnapshot;
  play(): void;
  pause(reason?: "USER" | "DRIFT", detail?: string): void;
  stepNext(): void;
  stop(detail?: string): void;
  setVisible(visible: boolean): void;
  activeDeadlineAfter(durationMs: number): number;
  remainingUntilActiveDeadline(deadlineActiveOffsetMs: number): number;
  dispose(): void;
}>;

export function createLocalInjectionScenarioRunner(
  initialRun: ScenarioRun,
  adapter: Readonly<{
    clock: ScenarioClock;
    allocateInjectionId(member: ReviewedScenarioMember): string;
    execute(input: ScenarioDispatchInput): Promise<ExecutionTerminal>;
    beforeDispatch?(input: Readonly<{ run: ScenarioRun; member: ReviewedScenarioMember; activeOffsetMs: number }>):
      | Readonly<{ allow: true }>
      | Readonly<{ allow: false; reason: "DRIFT"; detail: string }>;
    afterSettlement?(input: Readonly<{ run: ScenarioRun; member: ReviewedScenarioMember; trace: ScenarioTraceEntry }>): Promise<
      void | Readonly<{ continue: true }> | Readonly<{ continue: false; reason: "DRIFT"; detail: string }>
    >;
    onChange?(snapshot: ScenarioRunnerSnapshot): void;
  }>
): ScenarioRunner {
  let run = initialRun;
  let phase: ScenarioRunnerPhase = initialRun.status === "complete" ? "complete" : initialRun.status === "stopped" ? "stopped" : "paused";
  let pauseReason: ScenarioPauseReason | null = phase === "paused" ? "USER" : null;
  let visible = true;
  let accumulatedActiveMs = 0;
  let activeSegmentStartedAt: number | null = null;
  let timer: unknown = null;
  let scheduleGeneration = 0;
  let disposedGeneration = 0;
  let plannedDispatchActiveOffsetMs = 0;
  let remainingDelayMs = scaledDelay(nextMember()?.relativeDelayMs ?? 0, run.speed);
  let manualOverride = false;
  const admittedControlRecords = Math.min(SCENARIO_MAX_CONTROL_RECORDS, Math.floor(run.controlReservationBytes / SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD));

  function cursor(): ReviewedScenarioMemberCursor {
    return Object.freeze({ members: run.steps, index: Math.max(0, run.nextOrdinal - 1) });
  }

  function nextMember(): ReviewedScenarioMember | undefined {
    return cursor().members[cursor().index];
  }

  function activeNow(): number {
    return accumulatedActiveMs + (activeSegmentStartedAt === null ? 0 : Math.max(0, adapter.clock.now() - activeSegmentStartedAt));
  }

  function startActive(): void {
    if (activeSegmentStartedAt === null) activeSegmentStartedAt = adapter.clock.now();
  }

  function freezeActive(): void {
    accumulatedActiveMs = activeNow();
    activeSegmentStartedAt = null;
  }

  function clearScheduledTimer(): void {
    scheduleGeneration += 1;
    if (timer !== null) adapter.clock.clearTimer(timer);
    timer = null;
  }

  function publish(): void {
    adapter.onChange?.(snapshot());
  }

  function appendControl(kind: ScenarioControlRecord["kind"], reason: ScenarioControlRecord["reason"], detail: string): boolean {
    if (run.controls.length >= admittedControlRecords) return false;
    const record = boundedControlRecord({ sequence: run.controls.length + 1, kind, activeOffsetMs: activeNow(), reason, detail });
    run = Object.freeze({
      ...run,
      controls: Object.freeze([...run.controls, record])
    });
    return true;
  }

  function schedule(delayMs: number): void {
    const member = nextMember();
    if (!member) {
      freezeActive();
      phase = "complete";
      run = Object.freeze({ ...run, status: "complete" });
      remainingDelayMs = 0;
      publish();
      return;
    }
    startActive();
    phase = "waiting";
    pauseReason = null;
    remainingDelayMs = Math.max(0, delayMs);
    plannedDispatchActiveOffsetMs = activeNow() + remainingDelayMs;
    const generation = ++scheduleGeneration;
    timer = adapter.clock.setTimer(() => {
      if (generation !== scheduleGeneration || phase !== "waiting") return;
      timer = null;
      remainingDelayMs = 0;
      dispatch(member);
    }, remainingDelayMs);
    publish();
  }

  function dispatch(member: ReviewedScenarioMember): void {
    const guard = adapter.beforeDispatch?.({ run, member, activeOffsetMs: activeNow() }) ?? { allow: true as const };
    if (!guard.allow) {
      manualOverride = false;
      freezeActive();
      phase = "paused";
      pauseReason = "DRIFT";
      remainingDelayMs = 0;
      appendControl("PAUSE", "DRIFT", guard.detail);
      publish();
      return;
    }
    const actualDispatchActiveOffsetMs = activeNow();
    const originalDelayMs = member.relativeDelayMs;
    const scaledDelayMs = scaledDelay(originalDelayMs, run.speed);
    const bypassedDelayMs = manualOverride ? remainingDelayMs || scaledDelayMs : 0;
    const timingBase = { originalDelayMs, scaledDelayMs, plannedDispatchActiveOffsetMs: manualOverride ? actualDispatchActiveOffsetMs : plannedDispatchActiveOffsetMs, actualDispatchActiveOffsetMs };
    const injectionId = adapter.allocateInjectionId(member);
    const generation = disposedGeneration;
    phase = "in-flight";
    publish();
    void stepScenarioRun(run, {
      injectionId,
      execute: (input) => adapter.execute(input)
    }).then(async (nextRun) => {
      if (generation !== disposedGeneration || phase === "disposed") return;
      const settlementActiveOffsetMs = activeNow();
      const timing: ScenarioTraceTiming = Object.freeze({
        ...timingBase,
        settlementActiveOffsetMs,
        latenessMs: Math.max(0, actualDispatchActiveOffsetMs - timingBase.plannedDispatchActiveOffsetMs),
        manualOverride,
        bypassedDelayMs
      });
      let lastAttemptedIndex = -1;
      for (let index = nextRun.trace.length - 1; index >= 0; index -= 1) {
        const entry = nextRun.trace[index];
        if (entry?.kind === "attempted" && entry.stepId === member.id) {
          lastAttemptedIndex = index;
          break;
        }
      }
      const trace = [...nextRun.trace];
      if (lastAttemptedIndex >= 0) trace[lastAttemptedIndex] = Object.freeze({ ...trace[lastAttemptedIndex]!, timing });
      run = Object.freeze({ ...nextRun, controls: run.controls, trace: Object.freeze(trace) });
      const settledTrace = run.trace[lastAttemptedIndex] ?? run.trace.at(-1);
      const settlementGuard = settledTrace ? await adapter.afterSettlement?.({ run, member, trace: settledTrace }) : undefined;
      if (generation !== disposedGeneration) return;
      const pendingPhase = phase;
      const steppedManually = manualOverride;
      manualOverride = false;
      if (run.status === "stopped") {
        freezeActive();
        phase = "stopped";
        remainingDelayMs = 0;
      } else if (run.status === "complete") {
        freezeActive();
        phase = "complete";
        remainingDelayMs = 0;
      } else if (pendingPhase === "stop-pending") {
        freezeActive();
        run = terminalizeScenarioRun(run, activeNow(), "RUN STOPPED by the developer before this Step was attempted.");
        phase = "stopped";
        remainingDelayMs = 0;
      } else if (pendingPhase === "pause-pending") {
        freezeActive();
        phase = "paused";
        remainingDelayMs = scaledDelay(nextMember()?.relativeDelayMs ?? 0, run.speed);
      } else if (settlementGuard && !settlementGuard.continue) {
        freezeActive();
        phase = "paused";
        pauseReason = "DRIFT";
        remainingDelayMs = scaledDelay(nextMember()?.relativeDelayMs ?? 0, run.speed);
        appendControl("PAUSE", "DRIFT", settlementGuard.detail);
      } else if (steppedManually) {
        freezeActive();
        phase = "paused";
        pauseReason = "USER";
        remainingDelayMs = scaledDelay(nextMember()?.relativeDelayMs ?? 0, run.speed);
      } else if (pendingPhase === "in-flight") {
        remainingDelayMs = scaledDelay(nextMember()?.relativeDelayMs ?? 0, run.speed);
        schedule(remainingDelayMs);
        return;
      }
      publish();
    });
  }

  function pause(requestedReason: "USER" | "DRIFT" = "USER", detail = "Scenario timing paused by the developer."): void {
    if (phase === "waiting") {
      remainingDelayMs = Math.max(0, plannedDispatchActiveOffsetMs - activeNow());
      clearScheduledTimer();
      freezeActive();
      phase = "paused";
    } else if (phase === "in-flight") {
      freezeActive();
      phase = "pause-pending";
    } else return;
    pauseReason = requestedReason;
    appendControl("PAUSE", requestedReason, detail);
    publish();
  }

  function stop(detail = "Scenario stopped by the developer."): void {
    if (phase === "waiting" || phase === "paused") {
      clearScheduledTimer();
      freezeActive();
      appendControl("STOP", null, detail);
      run = terminalizeScenarioRun(run, activeNow(), detail);
      phase = "stopped";
      remainingDelayMs = 0;
    } else if (phase === "in-flight" || phase === "pause-pending") {
      freezeActive();
      phase = "stop-pending";
      appendControl("STOP", null, detail);
    } else return;
    publish();
  }

  function snapshot(): ScenarioRunnerSnapshot {
    return Object.freeze({ phase, run, cursor: cursor(), nextOrdinal: run.nextOrdinal, activeOffsetMs: activeNow(), remainingDelayMs, pauseReason, controlCapacityReached: run.controls.length >= admittedControlRecords - 2, visible });
  }

  return Object.freeze({
    snapshot,
    play() {
      if (phase !== "paused" || !visible || run.status !== "paused" || pauseReason === "DRIFT") return;
      if (run.controls.length >= admittedControlRecords - 2) return;
      if (!appendControl(run.controls.some(({ kind }) => kind === "PLAY") ? "RESUME" : "PLAY", null, run.controls.length === 0 ? "Timed Scenario execution started." : "Timed Scenario execution resumed.")) return;
      schedule(remainingDelayMs);
    },
    pause,
    stepNext() {
      const member = nextMember();
      if (phase !== "paused" || !member || !visible || run.status !== "paused" || pauseReason === "DRIFT") return;
      if (run.controls.length >= admittedControlRecords - 2) return;
      if (!appendControl("STEP NEXT", pauseReason, `Step ${member.ordinal} dispatched immediately; its remaining delay was bypassed.`)) return;
      manualOverride = true;
      startActive();
      plannedDispatchActiveOffsetMs = activeNow();
      dispatch(member);
    },
    stop,
    setVisible(nextVisible: boolean) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible && (phase === "waiting" || phase === "in-flight")) {
        const priorPhase = phase;
        if (priorPhase === "waiting") {
          remainingDelayMs = Math.max(0, plannedDispatchActiveOffsetMs - activeNow());
          clearScheduledTimer();
          freezeActive();
          phase = "paused";
        } else {
          freezeActive();
          phase = "pause-pending";
        }
        pauseReason = "HIDDEN";
        appendControl("HIDDEN AUTO-PAUSE", "HIDDEN", "Panel hidden; Scenario paused before another dispatch.");
      }
      publish();
    },
    activeDeadlineAfter(durationMs: number) { return activeNow() + Math.max(0, durationMs); },
    remainingUntilActiveDeadline(deadlineActiveOffsetMs: number) { return Math.max(0, deadlineActiveOffsetMs - activeNow()); },
    dispose() {
      if (phase === "disposed") return;
      clearScheduledTimer();
      freezeActive();
      disposedGeneration += 1;
      phase = "disposed";
      publish();
    }
  });
}

function scaledDelay(delayMs: number, speed: ScenarioRun["speed"]): number {
  return Math.ceil(Math.max(0, delayMs) / speed);
}

function boundedControlRecord(record: ScenarioControlRecord): ScenarioControlRecord {
  let detail = record.detail.slice(0, SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD);
  let candidate = Object.freeze({ ...record, detail });
  while (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD && detail.length > 0) {
    detail = detail.slice(0, Math.max(0, detail.length - 16));
    candidate = Object.freeze({ ...record, detail });
  }
  return candidate;
}
