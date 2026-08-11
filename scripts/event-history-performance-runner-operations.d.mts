export type PerformanceOperationState = "pending" | "resolved" | "rejected" | "missing";

export type PerformanceOperationStatus = Readonly<{
  operationId: string | null;
  state: PerformanceOperationState;
  elapsedMs: number;
  heartbeat: number;
  lastHeartbeatAt: number | null;
  result?: unknown;
  error?: Readonly<{ name: string; message: string; stack: string | null }>;
}>;

export const PERFORMANCE_OPERATION_KEY: string;

export class PerformanceOperationTimeout extends Error {
  readonly status: PerformanceOperationStatus;
}

export function runPageOperation(
  cdp: { request(method: string, params?: Record<string, unknown>): Promise<unknown> },
  expression: string,
  options?: {
    deadlineMs?: number;
    pollIntervalMs?: number;
    requestCeilingMs?: number;
    operationId?: string;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    onHeartbeat?: (status: PerformanceOperationStatus) => void;
  }
): Promise<unknown>;

export function createTimeoutDiagnostic(input: {
  generatedAt: string;
  source: Readonly<{ revision: string; dirty: boolean }>;
  runner: Readonly<Record<string, unknown>>;
  environment: Readonly<Record<string, unknown>>;
  referencePath: string;
  deadlineMs: number;
  operation: PerformanceOperationStatus;
}): Readonly<Record<string, unknown>>;
