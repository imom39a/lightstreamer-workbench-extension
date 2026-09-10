# History write throughput regression

The September 10 report showed IndexedDB active with about 2,225 retained events,
4 MiB awaiting commit, and an 18-second pending age. The displayed 32 MiB bound
applies to the pending RAM queue. IndexedDB retention remains 100,000 records or
256 MiB of canonical accounted bytes. Memory fallback retains 25,000 records or
128 MiB. Count and byte bounds are alternatives: large payloads reach the byte
bound sooner.

The bottleneck was derived-index write amplification. Every event created
separate facet postings with repeated owner identities, plus hundreds of native
multi-entry word/trigram index entries for JSON-rich payloads. A real Chromium
reproduction at `ce39895` took 107.4 seconds to commit 2,500 events carrying 40
JSON fields. Offers took only 48 ms. Disabling panel reads did not eliminate the
storage-only stall; instrumented transactions localized it to the derived indexes.

Schema 7 groups exact facet observations into blocks of at most 256 sequences.
Each text block uses a fixed 2 KiB trigram Bloom filter instead of a native index
entry for each word in each event. A filter can admit extra candidates; Find
always checks the original normalized text, preserving exact substring results.
Block checksums and coverage checks reject missing or damaged filters. All
derived writes share the Evidence/control commit transaction. Schema upgrades
rebuild the derived blocks from retained Evidence. A durable migration marker
remains until population commits, so an interrupted upgrade can resume.

Rolling retention trims only the expired blocks and removes catalog identities
whose last observation expired. It no longer rereads all surviving replay
payloads to rebuild metadata. The 100k browser proof also exposed a separate
fallback trigger: the old retention planner opened a payload cursor over the
expired prefix with a two-second transaction deadline. Crossing that deadline
switched healthy storage to memory. Planning now uses the exact retention
metadata already populated by successful commits or validated recovery; the
subsequent deletion and control/index updates still commit atomically before
that metadata advances. A regression asserts that planning and trimming open
no Evidence payload cursors.

The pending queue remains bounded; increasing its size would postpone overload
without increasing write throughput.

## Verified measurements

Measured September 10, 2026, in Chrome for Testing 151.0.7922.71 on macOS
arm64, with the production panel mounted and a fresh IndexedDB database for each
scenario. These are local headless measurements, not a hardware-independent SLA.

| Scenario | Accepted / refused | Capture time | Peak pending age | Final retained records | Persistence |
| --- | --- | --- | --- | --- | --- |
| 2,500 JSON-rich updates, offered in a burst | 2,500 / 0 | 2.46 s | 1.99 s | 2,500 | IndexedDB, healthy |
| 2,500 JSON-rich updates, 10 offered every 50 ms | 2,500 / 0 | 13.38 s | 0.15 s | 2,500 | IndexedDB, healthy |
| 6,000 ordinary updates, 2,500-record rolling window | 6,000 / 0 | 6.91 s | 0.25 s | 2,362 | IndexedDB, healthy |
| 100,500 ordinary updates, drained batches of 512 | 100,500 / 0 | 488.15 s | 6.71 s | 90,404 | IndexedDB, healthy |

All four scenarios reported zero failed commits, zero retries, no page errors,
and exact results for the final event's Find query. The 100k run crossed the
retention boundary and kept the newest 90,404 records (74,127,428 canonical
accounted bytes); the pending queue drained completely. Its final Find query
took 1.70 seconds. The burst's baseline at `ce39895` was 107.4 seconds, using the
same 2,500-event/40-field workload and mounted panel.

## Reproduce in a real browser

Install the repository's Chrome for Testing build, then run:

```sh
npx playwright test --config playwright.extension.config.ts tests/extension-ui/history-throughput.spec.ts
```

The ordinary regression runs a 2,500-event JSON-rich snapshot, paced input of
10 events every 50 ms, and rolling capture with a smaller retention window. It
mounts the production panel with real IndexedDB in an isolated browser profile,
checks committed receipts, pending age, storage health, retention, and exact Find
results, and attaches JSON measurements to the Playwright report. This is a
headless storage/panel integration proof, not foreground compositor measurement.

The larger capacity proof is deliberate and has a 15-minute deadline:

```sh
LSEW_HISTORY_THROUGHPUT_100K=1 npx playwright test --config playwright.extension.config.ts tests/extension-ui/history-throughput.spec.ts
```

It feeds 100,500 ordinary COMMAND updates in drained batches of 512 to verify
100k retention and continued rolling capture. This measures capacity, not a
claim of a fixed 100k-event ingest rate. The separate burst and paced-live tests
measure backlog behavior. `LSEW_BROWSER_CACHE_DIR` can select an existing Chrome
for Testing cache, and `TMPDIR` can select a clean temporary directory.
