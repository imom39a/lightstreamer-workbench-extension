export const AGENT_READ_CONTRACT_RESOURCE_URI = "workbench://agent/read-contract";

/** Bounded static contract and workflow text, intentionally independent of a Panel Session. */
export const AGENT_READ_GUIDANCE = `# Lightstreamer Workbench agent read contract

Use the tools against one deliberate Panel Session. First call list_panel_sessions, choose the exact inspected tab, then call get_status and check readContract.version and capabilities. Ask the user which tab when the target is ambiguous. A connected panel does not prove the page is ready or that an application event will occur.

Find exact targets with search_scope; pass the returned scopeId to summarize_evidence, query_evidence, or search_evidence. Reads use the panel's retained Evidence and do not change the human's selection. Read coverage, evaluation, the readPoint and explicit omissions before interpreting absence. Counts are retained Evidence records, not unique updates or active COMMAND rows. Use query_command_state only with an exact live COMMAND target, item, key, pageEpoch and explicit projection.

Keep reads scoped and bounded. Results default to 8192 serialized MCP bytes; maxBytes is bounded at 65536. Use limit and selected fields to fit useful pages. Continue an opaque cursor using only panelSessionId and cursor; its options and read boundary are frozen. For expensive projections, set workBudget only when its bounded default is insufficient; projection reads, payload hydration and elapsed work each have an independent cap.

For local reproduction, ground a candidate in exact retained Evidence or a live supported Scope, validate and prepare it, then review the visible Draft in Workbench. Local Injection is separate from Capture. Execution occurs only through an explicit execution call and application listeners may run; it does not prove server behavior. Preserve each requestId and inspect its existing receipt after an error or lost reply. Never retry an uncertain effect with a new requestId. Server Injection sends a Client Message through the inspected client's normal sendMessage path; it does not inject an inbound server update. An agent may prepare a Server Injection, but only a separate visible human click can approve the exact current Client, Session, message and options. No Local Injection grant implies Server Injection approval. Application-supported attribution metadata is required to link a later Server Update to that message.

This resource contains static guidance only. It does not expose live Evidence, grant access, wake a host or promise application behavior. Read agent/READS.md in the installed package for the extended contract.`;

export const AGENT_MCP_INITIALIZATION_INSTRUCTIONS = "Start with list_panel_sessions, select the exact inspected tab, then check get_status.readContract and capabilities. Use search_scope before scoped Evidence reads; keep reads bounded and inspect coverage/omissions. For reproduction, review the prepared Draft in Workbench and inspect the same requestId after uncertain outcomes. Read the static workbench://agent/read-contract resource for the workflow and limitations.";

export function investigationPrompt(question?: string) {
  const subject = question?.trim() ? question.trim().slice(0, 2000) : "the user's Lightstreamer investigation question";
  return `Investigate ${subject} using Lightstreamer Workbench. Select the intended Panel Session explicitly and inspect its status/capabilities first. Discover exact Subscription or item scopes, then use bounded, scoped Evidence summaries and examples. Inspect coverage, read points, value certainty and omissions before making claims. If a local reproduction would help, propose a source-grounded candidate, validate and prepare it, and ask the user to review the visible Draft before execution. Inspect existing receipts by requestId after uncertain outcomes; never repeat delivery with a new id. State what Evidence supports and what remains unknown. Do not infer DOM, application or server behavior from Workbench Evidence, and do not claim that a host will wake or resume automatically.`;
}
