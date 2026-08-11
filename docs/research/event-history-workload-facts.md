# Event History workload facts

Status: benchmark tooling, 2026-08-05. Change class: **Non-UI**. This adds no panel code, DOM, accessibility state, or rendered behavior.

`npm run measure:event-history` runs the authoritative `EventHistory.offer` → `follow` → `read` seam through the production React panel in visible Chrome for Testing 151 and writes a machine-readable JSON report plus a concise Markdown interpretation to `test-results/event-history-performance.{json,md}`. The ignored report is evidence for the machine and Chrome version that ran it; it is not a portable performance promise.

The benchmark derives three deterministic, application-neutral shapes from existing evidence:

| Shape | Provenance | Persisted UTF-8 JSON | Current IndexedDB logical writes/event |
| --- | --- | ---: | ---: |
| `small-lifecycle` | Official fixture topology lifecycle/status capture | Reported by runner | One evidence record, one unique event-identity index entry, and the measured multi-entry facet entries |
| `ordinary-item-update` | Official Lightstreamer fixture COMMAND `ItemUpdate` fields and item identity | Reported by runner | One evidence record, one unique event-identity index entry, and the measured multi-entry facet entries |
| `large-json-rich` | Expanded from the canonical deterministic Workbench JSON-patch scenario | Reported by runner | One evidence record, one unique event-identity index entry, and the measured multi-entry facet entries |

Sizes and token counts are calculated from the exact factory event in the report. Payload bytes alone are not storage amplification: the current IndexedDB authority stores one replay-complete evidence record and updates the unique `eventIdentity` plus multi-entry `facets` indexes. The report measures evidence records, facet entries, index entries, control-record writes, and read/write transactions directly by observing the production IndexedDB calls; it does not infer them from token counts.

The deliberate real-Chrome run measures, for every shape and for IndexedDB plus the lower-capacity in-memory fallback:

- open-loop sustained capture (1,000 events at the deterministic Timeline scenario's 50 events/sec) and the fixture-derived immediate issue-16 burst (1,692 events);
- enqueue and drain elapsed time, peak pending serialized bytes, maximum oldest pending age, EventHistory subscriber publication latency, and production React boundary-to-visible-frame latency;
- open-loop offered rate and emitter lateness, a query deliberately queued behind pending appends, actual `readwrite` transaction/event-add distributions, settled query p50/p95/max, and Long Task API support/count/max;
- 10,000-event mixed retained-session append, query, Long Task, post-CDP-GC JS heap, and origin-storage facts for both adapters.

Each shape's envelopes and serialized byte sizes are prepared before its timed workload. Long Task observation covers Event History enqueue, backlog drain, publication, and query work; fixture generation and report serialization are excluded. The runner refuses to publish a report unless accepted, published, and retained counts match and every published and retained identifier remains in Capture order.

The gate always records three independent samples per adapter/workload/shape cell and three post-GC heap samples per checkpoint tier. It fails closed unless `LSEW_BROWSER_HEADLESS=false` and `LSEW_UI_HEADLESS=false` are set, and it refuses a system-Chrome fallback. Do not use a reduced or incomplete output as baseline evidence.

The authoritative classifier emits one `PASS`, `REVIEW`, or `FAIL` judgment. It applies the absolute limits per sample and never averages away a correctness, boundary, Long Task, query, or heap failure. JS heap data excludes browser-process memory, IndexedDB disk files, and extension IPC.

`npm run benchmark:event-history` is intentionally separate. It runs under Vitest with `fake-indexeddb`, which is useful for deterministic adapter behavior but not a real-browser IndexedDB, memory, or scheduler measurement; its figures must not be compared to the real-Chrome report.

The 2026-08-05 headless storage-harness run remains historical evidence in [`event-history-workload-evidence.json`](event-history-workload-evidence.json) and [`event-history-workload-evidence.md`](event-history-workload-evidence.md); it is not the release reference. The separately pinned gate reference and operator procedure live in [`docs/reference/event-history-performance-reference.json`](../reference/event-history-performance-reference.json) and [`docs/reference/event-history-performance-manual-workflow.md`](../reference/event-history-performance-manual-workflow.md). The release gate also runs two exact pressure/terminal pairs per adapter: 17 two-MiB topology checkpoints to cross the 32 MiB pending-byte stop, and one blocked candidate held through the existing NORMAL (30 s) or LOWER (5 s) pending-age stop.
