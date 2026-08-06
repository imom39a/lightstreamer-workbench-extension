# Event History workload facts

Status: benchmark tooling, 2026-08-05. Change class: **Non-UI**. This adds no panel code, DOM, accessibility state, or rendered behavior.

`npm run measure:event-history` runs the current `EventHistory` seam inside real headless Chrome and writes a machine-readable JSON report plus a concise Markdown interpretation to `test-results/event-history-performance.{json,md}`. The ignored report is evidence for the machine and Chrome version that ran it; it is not a portable performance promise.

The benchmark derives three deterministic, application-neutral shapes from existing evidence:

| Shape | Provenance | Persisted UTF-8 JSON | Current IndexedDB logical writes/event |
| --- | --- | ---: | ---: |
| `small-lifecycle` | Official fixture topology lifecycle/status capture | Reported by runner | Envelope + metadata + deduplicated search tokens |
| `ordinary-item-update` | Official Lightstreamer fixture COMMAND `ItemUpdate` fields and item identity | Reported by runner | Envelope + metadata + deduplicated search tokens |
| `large-json-rich` | Expanded from the canonical deterministic Workbench JSON-patch scenario | Reported by runner | Envelope + metadata + deduplicated search tokens |

Sizes and token counts are calculated from the exact factory event in the report. Payload bytes alone are not storage amplification: the current repository writes the envelope, one metadata record, and a record for every distinct search token.

The real-Chrome run measures, for every shape and for IndexedDB plus the in-memory fallback:

- open-loop sustained capture (1,000 events at the deterministic Timeline scenario's 50 events/sec) and the fixture-derived immediate issue-16 burst (1,692 events);
- enqueue and drain elapsed time, peak pending serialized bytes, maximum oldest pending age, and append intake to **EventHistory subscriber publication** latency (`commitToHistoryPublication`);
- open-loop offered rate and emitter lateness, a query deliberately queued behind pending appends, actual `readwrite` transaction/event-add distributions, settled query p50/p95/max, and Long Task API support/count/max;
- 10,000-event mixed retained-session append, query, Long Task, post-CDP-GC JS heap, and origin-storage facts for both adapters.

Each shape's envelopes and serialized byte sizes are prepared before its timed workload. Long Task observation covers Event History enqueue, backlog drain, publication, and query work; fixture generation and report serialization are excluded. The runner refuses to publish a report unless accepted, published, and retained counts match and every published and retained identifier remains in Capture order.

The test command can reduce the workload for an operational smoke test with `LSEW_EVENT_HISTORY_SUSTAINED_COUNT`, `LSEW_EVENT_HISTORY_BURST_COUNT`, and `LSEW_EVENT_HISTORY_HEAP_SAMPLE_COUNT`. Do not use reduced output as baseline evidence.

The only current responsiveness review trigger is a storage-harness Long Task over 50 ms. It is not a panel rendering claim. If that trigger is absent, the report states “not observed; max tested N”; it never infers a memory breakpoint or a support limit. JS heap data excludes browser-process memory, IndexedDB disk files, DevTools panel rendering, and extension IPC.

`npm run benchmark:event-history` is intentionally separate. It runs under Vitest with `fake-indexeddb`, which is useful for deterministic adapter behavior but not a real-browser IndexedDB, memory, or scheduler measurement; its figures must not be compared to the real-Chrome report.

The 2026-08-05 reference run and interpretation are saved beside this document as [`event-history-workload-evidence.json`](event-history-workload-evidence.json) and [`event-history-workload-evidence.md`](event-history-workload-evidence.md). In the same session, the one-iteration fake-IndexedDB benchmark retained 10,000 minimal events in 12,520.79 ms under Vitest 4.1.8; that synthetic timing is recorded only to characterize the old benchmark and is not compared with the Chrome data.
