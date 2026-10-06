import type { CommandRowsInput, CommandRowsRead, CommandStateProjection } from "../../core/command-state";
import { readAgentCommandState, type AgentCommandStateContext, type AgentCommandStateInput, type AgentCommandStateResult } from "./agent-command-state";

export type AgentCommandRowsInput = Omit<AgentCommandStateInput, "key"> & Readonly<{ limit?: number; afterKey?: string; revision?: number }>;
export type AgentCommandRowsContext = AgentCommandStateContext & Readonly<{ readRows(projection: CommandStateProjection, input: CommandRowsInput): CommandRowsRead }>;
type KeyRead = Extract<AgentCommandStateResult, { status: "ok" }>;
export type AgentCommandRowsResult = Readonly<{
  status: "error"; problem: Readonly<{ code: Extract<AgentCommandStateResult, { status: "error" }>["problem"]["code"] | "PROJECTION_CHANGED" | "CURSOR_UNAVAILABLE"; message: string }>;
}> | Readonly<{
  status: "ok"; revision: number; total: number; nextKey: string | null; projection: CommandStateProjection;
  target: Omit<KeyRead["target"], "key">; readPoint: KeyRead["readPoint"]; rows: readonly KeyRead[];
}>;

/** Share exact-target validation, certainty and provenance with the key read. */
export function readAgentCommandRows(input: AgentCommandRowsInput, context: AgentCommandRowsContext): AgentCommandRowsResult {
  const limit = input.limit ?? 25;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) return { status: "error", problem: { code: "INVALID_ARGUMENT", message: "Choose a row page limit between 1 and 100." } };
  const validation = readAgentCommandState({ ...input, key: "\u0000workbench:row-discovery", fields: input.fields ?? ["key"] }, context);
  if (validation.status === "error") return validation;
  const { key: _key, ...target } = validation.target;
  const page = context.readRows(input.projection, { subscriptionId: target.subscriptionId, item: target.item, limit,
    ...(input.afterKey === undefined ? {} : { afterKey: input.afterKey }), ...(input.revision === undefined ? {} : { revision: input.revision }) });
  if (page.status === "error") return { status: "error", problem: { code: page.code, message: page.code === "PROJECTION_CHANGED"
    ? "The COMMAND projection changed; restart row discovery at its current revision."
    : page.code === "CURSOR_UNAVAILABLE" ? "The row continuation anchor is unavailable; restart row discovery."
    : "Choose valid exact row pagination arguments." } };
  const rows: KeyRead[] = [];
  for (const key of page.keys) {
    const read = readAgentCommandState({ ...input, key }, context);
    if (read.status === "error") return read;
    rows.push(read);
  }
  return { status: "ok", revision: page.revision, total: page.total, nextKey: page.nextKey, projection: input.projection,
    target, readPoint: validation.readPoint, rows };
}
