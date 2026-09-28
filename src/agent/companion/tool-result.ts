/** Keep the original JSON text for clients that do not consume structuredContent. */
export function agentToolResult(result: unknown) {
  const structuredContent: Record<string, unknown> = Array.isArray(result) ? { items: result }
    : result && typeof result === "object" ? result as Record<string, unknown> : { value: result ?? null };
  return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }], structuredContent };
}

export function agentToolFailure(error: unknown, fallbackCode = "WORKBENCH_OPERATION_FAILED") {
  const message = error instanceof Error ? error.message : "Workbench operation failed.";
  // Recognize explicit canonical codes only; arbitrary application prose is not a code.
  const code = /^(HISTORY_INTERVAL_UNAVAILABLE|READ_POINT_UNAVAILABLE|QUERY_FAILED|QUERY_CANCELLED|HISTORY_TERMINAL|AROUND_ANCHOR_UNAVAILABLE|INVALID_ARGUMENT|COMPANION_UNAVAILABLE|REQUEST_CAPACITY|DELIVERY_UNKNOWN):/.exec(message)?.[1] ?? fallbackCode;
  const detail = { code, message, automaticRetry: false };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: detail }) }], structuredContent: { error: detail } };
}
