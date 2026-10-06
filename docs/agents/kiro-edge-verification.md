# Verify combined Workbench setup in Kiro on Windows and Edge

Use this procedure for the host reported in the seat-removal retrospective.
The portable CI matrix exercises one npm artifact on Windows, macOS and Linux,
including combined skill installation/update for Codex, Claude Code and Kiro
through the upstream installer, plus the real Chrome connection. That does
not establish skill activation or task behavior in Kiro Auto on Edge.

Kiro is the reported host, not a restriction on setup. Other apps use the same
native upstream picker and bundled skill. For each host being evaluated, verify
the selected target's installed files, MCP configuration, skill activation and
fresh-context query behavior below. A successful file installation alone does
not establish that the host loads the skill or chooses the right queries.

## Setup and update

Use native Windows Node 22.12 or later. Install the extension from the matching
release bundle in Edge, and copy its ID from `edge://extensions`. From the
application repository run the companion's combined setup. After publication:

```powershell
npx.cmd --yes lightstreamer-workbench-agent@latest setup --extension-id YOUR_EXTENSION_ID
```

For an unpublished tarball, install it into a stable directory and invoke its
`dist/cli.mjs` with `setup --local --extension-id YOUR_EXTENSION_ID`; this keeps
MCP pointed at the local build rather than a published package of the same
source version. See [Windows launcher notes](../../agent/WINDOWS.md).

Accept the skill offer, choose **Kiro CLI** (also used by Kiro IDE), and choose
project scope. Confirm `.kiro/skills/lightstreamer-workbench/SKILL.md` and every
bundled reference were copied. Add the printed MCP entry to Kiro and restart
its MCP/skill discovery. Select Claude Auto mode, open the intended app in Edge,
and keep its Workbench DevTools panel visible.

Repeat using `update` from a newer matching companion artifact. Confirm the
printed MCP version and installed skill contents match that artifact. A
configuration-only `setup --json` must return without a skill prompt; starting
the MCP server must not launch an installer or write skill files.

## Reproduce the original task

Start a fresh conversation with the original task and a known test entity.
Record whether the agent activates the installed skill. Capture the tool trace,
versions, inspected tab, and application state before and after the experiment.

Check these outcomes:

- The agent checks spelling after an empty name search and confirms the intended
  entity from available application context. A missing excerpt is explained by
  returned-field policy or scan limits, without assuming PII redaction.
- It resolves the observed key/model for seats from application code or an
  application-owned guide, rather than guessing an initialization-model suffix.
- If a Subscription cannot author directly, it follows the returned recovery
  query to a matching retained update or live item and checks target diagnostics.
- A wide exact read uses selected fields or the measured retry budget. A wide
  prepared preview uses `recover_agent_document` rather than publishing another
  Draft. No unchanged oversized request is repeated.
- Preparation without a replacement document returns the complete expanded
  template. The edit preserves every declared field, mirrors command/key and
  keeps encoded `modelValues` as an object or array. Readiness is checked before
  execution.
- One deliberate execution uses one stable request ID. The settled receipt and
  Local Evidence establish delivery; the application DOM independently shows
  the expected seat change and preserves unrelated values.

Compare error/dead-end counts with the original trace, including any manual
user corrections. Record unsupported host versions, unactivated skills, unknown
delivery or unavailable browser observation explicitly. Passing SDK or Chrome
tests alone cannot close this host verification.

## Questions about unfamiliar sources

Repeat in a fresh context against different official Web Client fixtures or
test applications, rather than reusing the seat-model mapping:

| Source | Question | Observable success |
| --- | --- | --- |
| COMMAND with multiple listeners | How many updates exceeded a declared numeric threshold, and which rows remain? | Discovers fields/types; separates logical updates from delivery records and current COMMAND projection. |
| MERGE with numeric strings and encoded JSON | Which updates changed the metric, and what does the nested property mean? | Uses declared-field predicates with explicit conversion; resolves application meaning and explains nested-path query limits. |
| DISTINCT | How many events met a condition in this retained interval? | Uses an explicit count unit/read boundary without presenting history as current rows. |
| RAW | Show matching examples from this source. | Uses read context and bounded Evidence queries even though Local Injection is unavailable. |
| Named field schema, wide schema, or no updates | What fields can I query? | Distinguishes unresolved names from declarations, follows field-name pages, and explains absent samples without inventing a mapping. |

Record skill activation, the material clarification questions, selected Scope,
typed predicates, read points, byte/work-budget recoveries, answer correctness
and unnecessary calls. Compare fresh conversations with the skill installed and
with MCP initialization/tool guidance alone. The automated MCP runtime tests
prove these query paths, but the host evaluation must also show that Claude Auto
chooses them correctly.
