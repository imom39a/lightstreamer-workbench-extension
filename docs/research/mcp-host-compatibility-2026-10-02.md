# MCP host compatibility and SDK decision

**Reviewed:** 2026-10-02
**Runtime under test:** `@modelcontextprotocol/sdk` 1.30.1, pinned by the repository lockfile; the installed agent artifact bundles the companion runtime.
**Scope:** The repository's supported integration is MCP over stdio into the local companion, which routes calls to the exact owning Workbench Panel Session. This is not a claim that every third-party host or SDK release is supported.

## Compatibility evidence

| Surface | Proof | Result |
| --- | --- | --- |
| Initialization and tool discovery | SDK `Client` through `InMemoryTransport` and `StdioClientTransport`; packaged integration launches two MCP clients | Initialize/list-tools and structured result schemas work |
| Resources and prompts | SDK client `listResources` / `readResource` / `listPrompts` / `getPrompt` round trips | One static read-contract resource and one bounded investigation prompt are discoverable without opening a Panel Session |
| Stdio EOF | Child-process test sends a real initialize frame, closes stdin and waits for exit | Companion exits with status 0 without a parent signal |
| Shared broker and Panel Session routing | Installed-package proof starts two stdio clients and one panel connection | Both clients discover the connected Panel Session; calls route to that panel |
| Cancellation / connection loss | Router cancellation and MCP companion-loss regressions | Cancellation releases routed panel work; link loss returns a structured non-retryable failure |
| Errors and byte budgets | MCP failure-envelope tests plus response and tool-list budgets | Errors keep `automaticRetry:false`; serialized tool responses default to 8 KiB. The user approved a 160 KiB complete-catalog discovery ceiling on 2026-10-02; all 37 tools currently measure 135,097 bytes. |
| Package integration | `npm run agent:test:package` | npm artifact is self-contained and its installed CLI speaks MCP over stdio |

The resource and prompt are optional MCP capabilities. Existing tools and their structured/text result copies remain the primary compatibility path. Hosts can ignore resources and prompts without changing tool use.

## Decision

Retain the currently locked SDK 1.30.1 integration. SDK clients and installed-companion/extension proofs cover initialization, stdio, routing, structured errors and bounded resource/prompt responses. After the user's explicit 160 KiB amendment, the complete 37-tool catalog measures 135,097 bytes against 163,840, leaving 28,743 bytes of headroom. Fresh installed-package verification completes the previously blocked discovery, resource/prompt, routing, query/wait, disconnect and admission assertions with cached SDK schema validation enabled. Earlier 80 KiB failures and package passes before explicit approval remain historical. The current repository does not identify a supported host that requires the newer protocol generation. The decision record (`.scratch/mcp-agent-audit/evidence/discovery-budget-decision.md`, local artifact) records approval and final evidence.

Defer an SDK major migration and MCP Tasks. Workbench operations belong to a temporary Panel Session, and the useful waits are explicitly bounded to 20 seconds. A longer-lived task handle would add lifecycle and cancellation states without a demonstrated supported-host requirement. Revisit either change only when a named supported host fails these proofs or requires a longer-lived operation interface that cannot be served by bounded Scenario/Evidence waits.

## Reproduction

```sh
npm run typecheck
npx vitest run tests/agent-mcp-budget.test.ts tests/agent-mcp-disconnect.test.ts tests/agent-router-cancellation.test.ts tests/agent-portable.test.ts --no-file-parallelism --maxWorkers=1
npm run agent:test:package
```
