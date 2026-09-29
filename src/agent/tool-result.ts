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
  const code = /^(HISTORY_INTERVAL_UNAVAILABLE|READ_POINT_UNAVAILABLE|QUERY_FAILED|QUERY_CANCELLED|HISTORY_TERMINAL|AROUND_ANCHOR_UNAVAILABLE|INVALID_ARGUMENT|COMPANION_UNAVAILABLE|REQUEST_CAPACITY|DELIVERY_UNKNOWN|SCOPE_REQUIRED|QUERY_OPTIONS_CHANGED|RESULT_BUDGET_EXCEEDED|UNSUPPORTED_FILTER|UNSUPPORTED_CAPABILITY):/.exec(message)?.[1] ?? fallbackCode;
  // Error text can include application-controlled values. Keep both MCP copies
  // small even when an old panel or transport supplies an enormous message.
  // A control character can expand to six escaped bytes in each copy. 256
  // UTF-16 units keep even that worst case under a 4 KiB failure envelope.
  const detail = { code, message: message.length > 256 ? `${message.slice(0, 256)}… [details omitted]` : message, automaticRetry: false };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: detail }) }], structuredContent: { error: detail } };
}
