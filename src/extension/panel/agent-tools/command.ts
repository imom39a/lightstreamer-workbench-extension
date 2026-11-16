import { AGENT_RESPONSE_CONTRACT } from "../../../agent/protocol";
import type { AgentCommandStateResult } from "../agent-command-state";
import type { AgentCommandRowsInput } from "../agent-command-rows";
import type { AgentServiceContext, AgentToolHandlers } from "./context";
import { fitAgentPrefix } from "./query";
import { safeCommandState } from "./redaction";

/** Derived COMMAND key/row reads at an applied Evidence boundary. */
export function createCommandHandlers({ runtime, state }: AgentServiceContext): AgentToolHandlers {
  const { commandRowCursors } = state;
  return {
    query_command_state(args) {
      if (!runtime.commandState) throw new Error("UNSUPPORTED_CAPABILITY: This panel build does not support derived COMMAND state reads.");
      const { panelSessionId: _panelSessionId, ...input } = args;
      const result = runtime.commandState(input);
      if (result.status === "error") throw new Error(`${result.problem.code}: ${result.problem.message}`);
      return safeCommandState(result, args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes);
    },
    query_command_rows(args) {
      if (!runtime.commandRows) throw new Error("UNSUPPORTED_CAPABILITY: This panel build cannot page derived COMMAND rows.");
      const saved = args.cursor ? commandRowCursors.get(args.cursor) : undefined;
      if (args.cursor && !saved) throw new Error("CURSOR_EXPIRED: COMMAND row cursor expired. Start a current row read.");
      if (saved && saved.pageEpoch !== runtime.status().pageEpoch) throw new Error("TARGET_CHANGED: The inspected page changed; restart row discovery.");
      const { panelSessionId: _panel, cursor: _cursor, ...options } = args;
      // Without a cursor, validateAgentCall requires the exact target fields.
      const input = saved?.input ?? options as AgentCommandRowsInput;
      const budget = saved?.maxBytes ?? args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      const result = runtime.commandRows(input);
      if (result.status === "error") throw new Error(`${result.problem.code}: ${result.problem.message}`);
      const { nextKey: _nextKey, rows: _rows, ...metadata } = result;
      const rows = result.rows.map(row => safeCommandState(row, budget));
      const response = (count: number) => ({ ...metadata, rows: rows.slice(0, count), nextCursor: count < rows.length || result.nextKey ? "00000000-0000-0000-0000-000000000000" : null });
      const count = fitAgentPrefix(rows.length, budget, response, "One COMMAND row exceeds maxBytes. Request fewer fields or a larger budget.");
      let nextCursor: string | null = null;
      if ((count < rows.length || result.nextKey) && count > 0) {
        nextCursor = crypto.randomUUID();
        commandRowCursors.set(nextCursor, { input: { ...input, revision: result.revision, afterKey: result.rows[count - 1]!.target.key }, pageEpoch: input.pageEpoch, maxBytes: budget });
      }
      return { ...response(count), nextCursor };
    },
    query_command_keys(args) {
      if (!runtime.commandState) throw new Error("UNSUPPORTED_CAPABILITY: This panel build cannot compare exact COMMAND keys.");
      const { panelSessionId: _panel, keys: _keys, ...input } = args;
      const budget = args.maxBytes ?? AGENT_RESPONSE_CONTRACT.defaultMaxBytes;
      const rows = args.keys.map(key => runtime.commandState!({ ...input, key }));
      const first = rows[0]!;
      for (const row of rows) if (row.status === "error") throw new Error(`${row.problem.code}: ${row.problem.message}`);
      if (first.status !== "ok") throw new Error("PROJECTION_UNAVAILABLE: COMMAND comparison is unavailable.");
      const boundary = JSON.stringify([first.readPoint.interval, first.readPoint.committedEvidenceBoundary]);
      if (rows.some(row => row.status !== "ok" || JSON.stringify([row.readPoint.interval, row.readPoint.committedEvidenceBoundary]) !== boundary)) throw new Error("READ_BOUNDARY_UNALIGNED: COMMAND keys did not share one applied Evidence boundary.");
      return { status: "ok", projection: first.projection, readPoint: first.readPoint,
        rows: rows.map(row => safeCommandState(row as Extract<AgentCommandStateResult, { status: "ok" }>, budget)),
        limitations: ["All requested exact keys are compared at one applied boundary. Derived presence is not authoritative server or application state."] };
    }
  };
}
