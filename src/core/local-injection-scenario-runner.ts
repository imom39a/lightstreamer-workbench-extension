import {
  appendScenarioAuthorization,
  appendScenarioDrift,
  stepScenarioRun,
  terminalizeScenarioRun,
  SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD,
  type ReviewedScenarioStep,
  type ReviewedScenarioMember,
  type ReviewedScenarioCheckpoint,
  type ScenarioControlRecord,
  type ScenarioRun,
  type ScenarioTraceEntry,
  type ScenarioTraceTiming,
  type ScenarioDriftRecord
} from "./local-injection-scenario";
import {
  evaluateScenarioCheckpoint,
  type ScenarioAssertionObservation,
  type ScenarioCheckpointEvaluation,
  type ScenarioCommittedBoundaryFeed
} from "./local-injection-scenario-checkpoint";
import { isBoundedEvidenceRef, type EvidenceRef } from "./event-history-authoritative";
import type { LocalInjectionDocument } from "./local-injection-document";
import type { LocalInjectionOutcome } from "./local-injection-outcome";
import type { DiagnosticObservationBoundary } from "./diagnostic-observation";
import type {
  DiagnosticObservationFeedPublication,
  DiagnosticObservationJournal,
  DiagnosticObservationRead
} from "./diagnostic-observation";

export interface ScenarioClock {
  now(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export type ScenarioPauseReason = "USER" | "HIDDEN" | "DRIFT" | "DRIFT_REVIEW_REQUIRED";
export type ScenarioRunnerPhase = "paused" | "waiting" | "checkpoint-waiting" | "in-flight" | "pause-pending" | "stop-pending" | "complete" | "stopped" | "disposed";
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
  activeCheckpoint: Readonly<{
    checkpointId: string;
    checkpointName: string;
    startedActiveOffsetMs: number;
    deadlineActiveOffsetMs: number;
    boundary: EvidenceRef | null;
    status: "waiting";
    assertions: ScenarioCheckpointEvaluation["assertions"];
  }> | null;
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
  reReview(input: Readonly<{
    targetFingerprint: string;
    listenerIds: readonly string[];
    committedEvidenceBoundary: EvidenceRef | null;
    diagnosticObservationBoundary?: DiagnosticObservationBoundary | null;
  }>): Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
}>;

type ScenarioDriftInput = Readonly<{
  kind: ScenarioDriftRecord["kind"];
  addedListenerIds: readonly string[];
  removedListenerIds: readonly string[];
  evidence: EvidenceRef | null;
}>;

export function createLocalInjectionScenarioRunner(
  initialRun: ScenarioRun,
  adapter: Readonly<{
    clock: ScenarioClock;
    allocateInjectionId(member: ReviewedScenarioStep): string;
    execute(input: ScenarioDispatchInput): Promise<ExecutionTerminal>;
    beforeDispatch?(input: Readonly<{ run: ScenarioRun; member: ReviewedScenarioMember; activeOffsetMs: number }>):
      | Readonly<{ allow: true }>
      | Readonly<{ allow: false; reason: "DRIFT"; detail: string; drift?: ScenarioDriftInput }>
      | Readonly<{ allow: false; reason: "TARGET_RETIRED"; detail: string }>;
    afterSettlement?(input: Readonly<{ run: ScenarioRun; member: ReviewedScenarioMember; trace: ScenarioTraceEntry }>): Promise<
      void | Readonly<{ continue: true }> | Readonly<{ continue: false; reason: "DRIFT"; detail: string; drift?: ScenarioDriftInput }>
    >;
    onChange?(snapshot: ScenarioRunnerSnapshot): void;
    checkpoint?: Readonly<{
      feed: ScenarioCommittedBoundaryFeed;
      observations(run: ScenarioRun): ScenarioAssertionObservation;
      diagnostics?: Pick<DiagnosticObservationJournal, "currentBoundary" | "query" | "subscribe">;
    }>;
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
  let remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
  let manualOverride = false;
  let checkpointUnsubscribe: (() => void) | null = null;
  let diagnosticCheckpointUnsubscribe: (() => void) | null = null;
  let checkpointDiagnosticRefresh: (() => void) | null = null;
  let activeCheckpoint: ScenarioRunnerSnapshot["activeCheckpoint"] = null;
  let checkpointWasPlaying = false;
  let resumeCheckpoint: (() => void) | null = null;
  const admittedControlRecords = Math.floor(run.controlReservationBytes / SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD);

  function cursor(): ReviewedScenarioMemberCursor {
    return Object.freeze({ members: run.members, index: Math.max(0, run.nextMemberIndex) });
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

  function stopCheckpointObservation(): void {
    checkpointUnsubscribe?.();
    checkpointUnsubscribe = null;
    diagnosticCheckpointUnsubscribe?.();
    diagnosticCheckpointUnsubscribe = null;
    checkpointDiagnosticRefresh = null;
    if (timer !== null) adapter.clock.clearTimer(timer);
    timer = null;
    resumeCheckpoint = null;
  }

  function checkpointTrace(
    member: ReviewedScenarioCheckpoint,
    evaluation: ScenarioCheckpointEvaluation,
    startedActiveOffsetMs: number,
    startedBoundary: EvidenceRef | null
  ): ScenarioTraceEntry {
    return Object.freeze({
      checkpointId: member.id,
      checkpointName: member.name,
      memberOrdinal: member.memberOrdinal,
      kind: "checkpoint" as const,
      status: evaluation.status as Exclude<ScenarioCheckpointEvaluation["status"], "waiting">,
      startedActiveOffsetMs,
      settledActiveOffsetMs: evaluation.activeOffsetMs,
      startedBoundary,
      resultBoundary: evaluation.boundary,
      evidenceAvailability: evaluation.boundary ? "RETAINED" as const : "NOT_APPLICABLE" as const,
      assertions: evaluation.assertions
    });
  }

  function stopAfterCheckpoint(trace: ScenarioTraceEntry, detail: string): void {
    const remainingSteps = run.members.slice(run.nextMemberIndex + 1).filter((member): member is ReviewedScenarioStep => member.kind === "step");
    run = Object.freeze({
      ...run,
      status: "stopped" as const,
      trace: Object.freeze([...run.trace, trace, ...remainingSteps.map((step) => Object.freeze({
        stepId: step.id,
        ordinal: step.ordinal,
        kind: "not-run" as const,
        reason: "RUN STOPPED" as const,
        timestamp: adapter.clock.now(),
        detail,
        evidence: null,
        assertion: "NOT_EVALUATED" as const
      }))])
    });
    freezeActive();
    phase = "stopped";
    remainingDelayMs = 0;
  }

  function dispatchCheckpoint(member: ReviewedScenarioCheckpoint): void {
    const startedActiveOffsetMs = activeNow();
    const wasPlaying = phase === "waiting";
    const diagnosticAssertions = member.assertions.filter((assertion) => assertion.kind === "diagnostic-observation-exists");
    if (diagnosticAssertions.length === 0) {
      beginCheckpoint(member, startedActiveOffsetMs, new Map(), wasPlaying);
      return;
    }
    const diagnostics = adapter.checkpoint?.diagnostics;
    const authorization = run.authorizations.at(-1)?.diagnosticObservationBoundary ?? null;
    if (!diagnostics || !authorization) {
      beginCheckpoint(member, startedActiveOffsetMs, new Map(), wasPlaying);
      return;
    }
    phase = "checkpoint-waiting";
    checkpointWasPlaying = true;
    const reads = new Map<string, DiagnosticObservationRead>();
    let latest = diagnostics.currentBoundary();
    let loading = true;
    let refreshRequested = false;
    let generation = 0;
    const load = async (through: DiagnosticObservationBoundary): Promise<void> => {
      const loadGeneration = ++generation;
      const results = await Promise.all(diagnosticAssertions.map(async (assertion) => {
        try {
          const read = await diagnostics.query({
            after: authorization,
            through,
            codes: [assertion.ruleCode],
            lifecycle: assertion.lifecycle,
            minimumSeverity: assertion.minimumSeverity,
            affected: assertion.affected
          });
          return [assertion.id, read] as const;
        } catch {
          return [assertion.id, unavailableDiagnosticRead(through)] as const;
        }
      }));
      if (loadGeneration !== generation || phase === "disposed" || run.members[run.nextMemberIndex]?.id !== member.id) return;
      for (const [assertionId, read] of results) reads.set(assertionId, read);
      if (refreshRequested) {
        refreshRequested = false;
        await load(latest);
        return;
      }
      if (loading) {
        loading = false;
        beginCheckpoint(member, startedActiveOffsetMs, reads, wasPlaying);
      } else {
        checkpointDiagnosticRefresh?.();
      }
    };
    const onPublication = (publication: DiagnosticObservationFeedPublication): void => {
      latest = publication.type === "observation" ? publication.observation.observationBoundary : publication.boundary;
      if (loading) refreshRequested = true;
      else void load(latest);
    };
    // Anchor the subscription before querying (authorization, current] so a
    // commit racing the bounded read is replayed or delivered by the feed.
    diagnosticCheckpointUnsubscribe = diagnostics.subscribe(latest, onPublication);
    void load(latest);
    publish();
  }

  function beginCheckpoint(member: ReviewedScenarioCheckpoint, startedActiveOffsetMs: number, diagnosticReads: ReadonlyMap<string, DiagnosticObservationRead>, wasPlaying: boolean): void {
    const checkpointAdapter = adapter.checkpoint;
    if (!checkpointAdapter) {
      const unavailable = evaluateScenarioCheckpoint(member, {
        boundary: null, intervalId: null, retainedRange: null, history: "unavailable", projection: "failed"
      }, { priorOutcomes: new Map(), correlatedLocalEvidence: new Map(), inspectCommand: () => ({ state: "unavailable", certainty: "unavailable", provenance: "history", evidence: null }) }, startedActiveOffsetMs);
      stopAfterCheckpoint(checkpointTrace(member, unavailable, startedActiveOffsetMs, null), "RUN STOPPED because Checkpoint evaluation is unavailable; this Step was not attempted.");
      publish();
      return;
    }
    checkpointWasPlaying = wasPlaying;
    const withinDurations = member.assertions.flatMap((assertion) => "withinActiveMs" in assertion && assertion.withinActiveMs !== undefined ? [assertion.withinActiveMs] : []);
    const deadlineActiveOffsetMs = startedActiveOffsetMs + (withinDurations.length > 0 ? Math.min(...withinDurations) : 0);
    let startedBoundary: EvidenceRef | null = null;
    let settled = false;

    const evaluate = (snapshot: ReturnType<ScenarioCommittedBoundaryFeed["snapshot"]>): void => {
      if (settled || phase === "disposed" || run.members[run.nextMemberIndex]?.id !== member.id) return;
      const evaluation = evaluateScenarioCheckpoint(member, snapshot, { ...checkpointAdapter.observations(run), diagnosticReads }, activeNow(), startedActiveOffsetMs);
      if (evaluation.status === "waiting") {
        activeCheckpoint = Object.freeze({ checkpointId: member.id, checkpointName: member.name, startedActiveOffsetMs, deadlineActiveOffsetMs, boundary: evaluation.boundary, status: "waiting", assertions: evaluation.assertions });
        if (phase !== "paused") phase = "checkpoint-waiting";
        publish();
        return;
      }
      settled = true;
      stopCheckpointObservation();
      activeCheckpoint = null;
      const trace = checkpointTrace(member, evaluation, startedActiveOffsetMs, startedBoundary);
      if (evaluation.status !== "pass") {
        stopAfterCheckpoint(trace, `RUN STOPPED after Checkpoint “${member.name}” ${evaluation.status}; this Step was not attempted.`);
        publish();
        return;
      }
      run = Object.freeze({
        ...run,
        nextMemberIndex: run.nextMemberIndex + 1,
        status: run.nextMemberIndex + 1 >= run.members.length ? "complete" as const : "paused" as const,
        trace: Object.freeze([...run.trace, trace])
      });
      if (run.status === "complete") {
        freezeActive();
        phase = "complete";
        remainingDelayMs = 0;
      } else if (phase === "paused" || !checkpointWasPlaying || !visible) {
        const preservedPauseReason = phase === "paused" ? pauseReason : !visible ? "HIDDEN" as const : "USER" as const;
        freezeActive();
        phase = "paused";
        pauseReason = preservedPauseReason ?? "USER";
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
      } else {
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
        schedule(remainingDelayMs);
        return;
      }
      publish();
    };
    checkpointDiagnosticRefresh = () => evaluate(checkpointAdapter.feed.snapshot());

    // Subscribe first, then read a snapshot, so a commit cannot be lost between
    // the initial boundary and the live subscription.
    checkpointUnsubscribe = checkpointAdapter.feed.subscribe(null, (snapshot) => evaluate(snapshot));
    const initialBoundary = checkpointAdapter.feed.snapshot();
    startedBoundary = isBoundedEvidenceRef(initialBoundary.boundary) ? initialBoundary.boundary : null;
    const initial = evaluateScenarioCheckpoint(member, initialBoundary, { ...checkpointAdapter.observations(run), diagnosticReads }, activeNow(), startedActiveOffsetMs);
    if (initial.status === "waiting" && withinDurations.length > 0) {
      phase = "checkpoint-waiting";
      activeCheckpoint = Object.freeze({ checkpointId: member.id, checkpointName: member.name, startedActiveOffsetMs, deadlineActiveOffsetMs, boundary: initial.boundary, status: "waiting", assertions: initial.assertions });
      const generation = ++scheduleGeneration;
      timer = adapter.clock.setTimer(() => {
        if (generation !== scheduleGeneration || settled) return;
        timer = null;
        evaluate(checkpointAdapter.feed.snapshot());
      }, Math.max(0, deadlineActiveOffsetMs - activeNow()));
      resumeCheckpoint = () => {
        checkpointWasPlaying = true;
        startActive();
        phase = "checkpoint-waiting";
        evaluate(checkpointAdapter.feed.snapshot());
        if (settled || phase !== "checkpoint-waiting") return;
        const generation = ++scheduleGeneration;
        timer = adapter.clock.setTimer(() => {
          if (generation !== scheduleGeneration || settled) return;
          timer = null;
          evaluate(checkpointAdapter.feed.snapshot());
        }, Math.max(0, deadlineActiveOffsetMs - activeNow()));
      };
      publish();
      return;
    }
    evaluate(initialBoundary);
  }

  function dispatch(member: ReviewedScenarioMember): void {
    const guard = adapter.beforeDispatch?.({ run, member, activeOffsetMs: activeNow() }) ?? { allow: true as const };
    if (!guard.allow) {
      manualOverride = false;
      freezeActive();
      if (guard.reason === "TARGET_RETIRED") {
        run = terminalizeScenarioRun(run, activeNow(), guard.detail);
        phase = "stopped";
        pauseReason = null;
        remainingDelayMs = 0;
        publish();
        return;
      }
      phase = "paused";
      pauseReason = "DRIFT_REVIEW_REQUIRED";
      remainingDelayMs = 0;
      const driftedRun = appendScenarioDrift(run, {
        kind: guard.drift?.kind ?? "MIXED",
        activeOffsetMs: activeNow(),
        addedListenerIds: guard.drift?.addedListenerIds ?? [],
        removedListenerIds: guard.drift?.removedListenerIds ?? [],
        evidence: guard.drift?.evidence ?? null,
        detail: guard.detail
      });
      if (driftedRun === run) {
        run = terminalizeScenarioRun(run, activeNow(), "Scenario stopped before dispatch because its bounded drift ledger could not retain the exact record.");
        phase = "stopped";
        pauseReason = null;
        publish();
        return;
      }
      run = driftedRun;
      appendControl("PAUSE", "DRIFT", guard.detail);
      publish();
      return;
    }
    if (member.kind === "checkpoint") {
      manualOverride = false;
      dispatchCheckpoint(member);
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
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
      } else if (settlementGuard && !settlementGuard.continue) {
        freezeActive();
        phase = "paused";
        pauseReason = "DRIFT_REVIEW_REQUIRED";
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
        const driftedRun = appendScenarioDrift(run, {
          kind: settlementGuard.drift?.kind ?? "MIXED",
          activeOffsetMs: activeNow(),
          addedListenerIds: settlementGuard.drift?.addedListenerIds ?? [],
          removedListenerIds: settlementGuard.drift?.removedListenerIds ?? [],
          evidence: settlementGuard.drift?.evidence ?? null,
          detail: settlementGuard.detail
        });
        if (driftedRun === run) {
          run = terminalizeScenarioRun(run, activeNow(), "Scenario stopped because its bounded drift ledger could not retain the exact record.");
          phase = "stopped";
          pauseReason = null;
          remainingDelayMs = 0;
        } else {
          run = driftedRun;
        }
        appendControl("PAUSE", "DRIFT", settlementGuard.detail);
      } else if (steppedManually) {
        freezeActive();
        phase = "paused";
        pauseReason = "USER";
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
      } else if (pendingPhase === "in-flight") {
        remainingDelayMs = scaledDelay(memberDelay(nextMember()), run.speed);
        schedule(remainingDelayMs);
        return;
      }
      publish();
    });
  }

  function pause(requestedReason: "USER" | "DRIFT" = "USER", detail = "Scenario timing paused by the developer."): void {
    if (phase === "waiting" || phase === "checkpoint-waiting") {
      remainingDelayMs = phase === "checkpoint-waiting" && activeCheckpoint
        ? Math.max(0, activeCheckpoint.deadlineActiveOffsetMs - activeNow())
        : Math.max(0, plannedDispatchActiveOffsetMs - activeNow());
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
    if (phase === "waiting" || phase === "checkpoint-waiting" || phase === "paused") {
      clearScheduledTimer();
      stopCheckpointObservation();
      activeCheckpoint = null;
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
    return Object.freeze({ phase, run, cursor: cursor(), nextOrdinal: run.nextOrdinal, activeOffsetMs: activeNow(), remainingDelayMs, pauseReason, controlCapacityReached: run.controls.length >= admittedControlRecords - 2, visible, activeCheckpoint });
  }

  return Object.freeze({
    snapshot,
    play() {
      if (phase !== "paused" || !visible || run.status !== "paused" || pauseReason === "DRIFT" || pauseReason === "DRIFT_REVIEW_REQUIRED") return;
      if (run.controls.length >= admittedControlRecords - 2) return;
      if (!appendControl(run.controls.some(({ kind }) => kind === "PLAY") ? "RESUME" : "PLAY", null, run.controls.length === 0 ? "Timed Scenario execution started." : "Timed Scenario execution resumed.")) return;
      if (activeCheckpoint && resumeCheckpoint) {
        resumeCheckpoint();
        publish();
        return;
      }
      schedule(remainingDelayMs);
    },
    pause,
    stepNext() {
      const member = nextMember();
      if (phase !== "paused" || !member || activeCheckpoint || !visible || run.status !== "paused" || pauseReason === "DRIFT" || pauseReason === "DRIFT_REVIEW_REQUIRED") return;
      if (run.controls.length >= admittedControlRecords - 2) return;
      if (!appendControl("STEP NEXT", pauseReason, `${member.kind === "step" ? `Step ${member.ordinal}` : `Checkpoint “${member.name}”`} started immediately; its remaining member delay was bypassed.`)) return;
      manualOverride = true;
      startActive();
      plannedDispatchActiveOffsetMs = activeNow();
      dispatch(member);
    },
    stop,
    setVisible(nextVisible: boolean) {
      if (visible === nextVisible) return;
      visible = nextVisible;
      if (!visible && (phase === "waiting" || phase === "checkpoint-waiting" || phase === "in-flight")) {
        const priorPhase = phase;
        if (priorPhase === "waiting" || priorPhase === "checkpoint-waiting") {
          remainingDelayMs = priorPhase === "checkpoint-waiting" && activeCheckpoint
            ? Math.max(0, activeCheckpoint.deadlineActiveOffsetMs - activeNow())
            : Math.max(0, plannedDispatchActiveOffsetMs - activeNow());
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
    reReview(input) {
      if (phase !== "paused" || pauseReason !== "DRIFT_REVIEW_REQUIRED" || run.status !== "paused") {
        return Object.freeze({ ok: false as const, reason: "Scenario Run is not awaiting drift re-review." });
      }
      const authorizedRun = appendScenarioAuthorization(run, { ...input, activeOffsetMs: activeNow() });
      if (authorizedRun === run) {
        stop("Drift re-review failed because the bounded authorization ledger could not retain the exact boundary.");
        return Object.freeze({ ok: false as const, reason: "Bounded authorization ledger capacity reached." });
      }
      run = authorizedRun;
      pauseReason = "USER";
      publish();
      return Object.freeze({ ok: true as const });
    },
    dispose() {
      if (phase === "disposed") return;
      clearScheduledTimer();
      stopCheckpointObservation();
      activeCheckpoint = null;
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

function unavailableDiagnosticRead(through: DiagnosticObservationBoundary): DiagnosticObservationRead {
  return Object.freeze({
    status: "unavailable" as const,
    coverage: "unavailable" as const,
    retention: "unavailable" as const,
    through: Object.freeze({ ...through }),
    observations: Object.freeze([])
  });
}

function memberDelay(member: ReviewedScenarioMember | undefined): number {
  return member?.kind === "step" ? member.relativeDelayMs : 0;
}

function boundedControlRecord(record: ScenarioControlRecord): ScenarioControlRecord {
  const encoder = new TextEncoder();
  const originalBytes = encoder.encode(record.detail).byteLength;
  let detail = record.detail.slice(0, SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD);
  let candidate = Object.freeze({ ...record, detail });
  while (encoder.encode(JSON.stringify(candidate)).byteLength > SCENARIO_CONTROL_RESERVATION_BYTES_PER_RECORD && detail.length > 0) {
    detail = detail.slice(0, Math.max(0, detail.length - 16));
    candidate = Object.freeze({
      ...record,
      detail,
      ...(encoder.encode(detail).byteLength < originalBytes
        ? { detailLimited: Object.freeze({ originalBytes, retainedBytes: encoder.encode(detail).byteLength }) }
        : {})
    });
  }
  return candidate;
}
