export type LocalInjectionOutcome = Readonly<{
  disposition: "delivered" | "blocked" | "failed" | "partial" | "acknowledgement-unknown";
  headline: "DELIVERED LOCALLY" | "NOT RUN" | "DELIVERY FAILED" | "PARTIALLY DELIVERED" | "DELIVERY UNKNOWN";
  status: "success" | "stale-target" | "listener-error" | "wire-error" | "bridge-error" | "acknowledgement-unknown" | "review-blocked";
  executionId: string;
  requestId: string | null;
  timestamp: number;
  detail: string;
  attemptedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
}>;
