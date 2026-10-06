/** The same compact data is available to structured and text-only MCP clients. */
export function agentToolResult(result: unknown) {
  const structuredContent: Record<string, unknown> = Array.isArray(result) ? { items: result }
    : result && typeof result === "object" ? result as Record<string, unknown> : { value: result ?? null };
  return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }], structuredContent };
}

/** Budget both representations, including JSON escaping, before leaving the panel. */
export function agentToolResultBytes(result: unknown): number {
  return new TextEncoder().encode(JSON.stringify(agentToolResult(result))).byteLength;
}

export function agentToolFailure(error: unknown, fallbackCode = "WORKBENCH_OPERATION_FAILED") {
  const message = error instanceof Error ? error.message : "Workbench operation failed.";
  // Application prose cannot invent error codes or authorize automatic retries.
  const code = /^(HISTORY_INTERVAL_UNAVAILABLE|READ_POINT_UNAVAILABLE|SEQUENCE_WINDOW_UNAVAILABLE|READ_BOUNDARY_UNALIGNED|PROJECTION_CHANGED|CURSOR_UNAVAILABLE|QUERY_FAILED|QUERY_CANCELLED|QUERY_WORK_BUDGET_EXCEEDED|HISTORY_TERMINAL|AROUND_ANCHOR_UNAVAILABLE|INVALID_ARGUMENT|INVALID_CANDIDATE_MATRIX|COMPANION_UNAVAILABLE|REQUEST_CAPACITY|DELIVERY_UNKNOWN|CONTROL_OUTCOME_UNKNOWN|DOCUMENT_PUBLICATION_UNKNOWN|REQUEST_ID_CONFLICT|DOCUMENT_UNKNOWN|DOCUMENT_BUDGET_EXCEEDED|SCOPE_REQUIRED|QUERY_OPTIONS_CHANGED|RESULT_BUDGET_EXCEEDED|UNSUPPORTED_FILTER|UNSUPPORTED_CAPABILITY|CURSOR_EXPIRED|TARGET_CHANGED|TARGET_RETIRED|ACCESS_REVOKED|OPERATION_BUDGET_EXCEEDED|COMPANION_INCOMPATIBLE|OPERATION_UNKNOWN|INVALID_TARGET|PROJECTION_UNAVAILABLE|CREDENTIAL_IDENTITY_UNAVAILABLE|HUMAN_APPROVAL_REQUIRED):/.exec(message)?.[1] ?? fallbackCode;
  // Error text can include application-controlled values. Keep both MCP copies
  // small even when an old panel or transport supplies an enormous message.
  // A control character can expand to six escaped bytes in each copy. 256
  // UTF-16 units keep even that worst case under a 4 KiB failure envelope.
  const detail = { code, message: message.length > 256 ? `${message.slice(0, 256)}… [details omitted]` : message, automaticRetry: false };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: detail }) }], structuredContent: { error: detail } };
}
