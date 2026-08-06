# Event History workload evidence

Real-Chrome harness run: Chrome/150.0.7871.187. The existing `benchmark:event-history` fake-indexeddb Vitest benchmark is intentionally excluded from this report.

## Interpretation

- Shapes: small-lifecycle (315 UTF-8 bytes, 25 indexed writes/event); ordinary-item-update (807 UTF-8 bytes, 52 indexed writes/event); large-json-rich (13125 UTF-8 bytes, 143 indexed writes/event)
- Workloads: 12; maximum retained session tested: 10000 events.
- At 50 offered events/sec, large JSON IndexedDB publication p95 was 14.40 ms with 113.00 ms maximum pending age.
- The 1,692-event immediate large JSON burst reached 14649.40 ms publication p95, 22376598 peak pending bytes, and 7 write transactions.
- At 1000 retained large JSON events, memory Find p95 was 23.20 ms and the measured window recorded 1 Long Task(s). At 10000 mixed events, memory used a signed 48269544-byte JS-heap delta and Find p95 was 108.40 ms.
- The 10000-event IndexedDB checkpoint took 87374.10 ms to append and had Find p95 390.40 ms.
- Storage-harness long tasks >50 ms: 4 workload or retained-session sample(s) observed one or more. This is not a panel responsiveness claim.
- `commitToHistoryPublication` ends at EventHistory subscriber publication, not DOM visibility or paint. A query queued behind pending appends is reported separately from settled query samples.
- The run proved accepted, published, retained, and fully ordered IDs for every workload before writing this report.

## Workload facts

Adapter | Workload | Shape | Retained | Offered events/s | Publication p95 ms | Oldest pending ms | Peak pending bytes | Query behind backlog ms | Find p95 ms | Write tx | Long tasks
--- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---:
indexeddb | sustained | small-lifecycle | 1000 | 50.05 | 12.30 | 20.10 | 704 | 10.60 | 18.10 | 1000 | 0
indexeddb | sustained | ordinary-item-update | 1000 | 50.05 | 11.80 | 29.10 | 1688 | 6.00 | 19.30 | 1000 | 0
indexeddb | sustained | large-json-rich | 1000 | 50.05 | 14.40 | 113.00 | 78630 | 12.50 | 51.10 | 995 | 1
indexeddb | burst | small-lifecycle | 1692 | 1128000.00 | 2914.60 | 2914.60 | 591090 | 2915.90 | 34.40 | 7 | 0
indexeddb | burst | ordinary-item-update | 1692 | 995294.23 | 5224.60 | 5224.60 | 1426874 | 5226.10 | 37.20 | 7 | 0
indexeddb | burst | large-json-rich | 1692 | 846000.00 | 14649.40 | 14649.50 | 22376598 | 14656.50 | 91.30 | 7 | 1
memory | sustained | small-lifecycle | 1000 | 50.05 | 0.10 | 0.30 | 0 | 0.70 | 3.60 | 0 | 0
memory | sustained | ordinary-item-update | 1000 | 50.04 | 0.10 | 0.20 | 0 | 0.00 | 4.80 | 0 | 0
memory | sustained | large-json-rich | 1000 | 50.05 | 0.10 | 0.20 | 0 | 0.10 | 23.20 | 0 | 1
memory | burst | small-lifecycle | 1692 | 1692000.00 | 0.90 | 0.90 | 585670 | 0.20 | 1.90 | 0 | 0
memory | burst | ordinary-item-update | 1692 | 1692000.00 | 0.90 | 0.90 | 1420964 | 0.20 | 4.80 | 0 | 0
memory | burst | large-json-rich | 1692 | 1409999.10 | 1.10 | 1.10 | 22360116 | 0.10 | 33.80 | 0 | 0

## Retained session and JS heap

- indexeddb: 10000 mixed events, signed JS-heap delta -5664 bytes from its pre-sample baseline; append 87374.10 ms; 6 Long Task(s); Find p95 390.40 ms; full-history p95 273.60 ms.
- memory: 10000 mixed events, signed JS-heap delta 48269544 bytes from its pre-sample baseline; append 2.10 ms; 0 Long Task(s); Find p95 108.40 ms; full-history p95 0.00 ms.

A small negative IndexedDB JS-heap delta can occur after GC because retained envelopes live in IndexedDB rather than the page heap; treat it as measurement noise, not negative usage. JS heap excludes browser-process memory, IndexedDB disk files, DevTools panel rendering, and extension IPC. Origin-usage samples are whole-profile observations and may include Chrome's delayed accounting for deleted session databases; do not attribute them to one adapter or checkpoint. The JSON companion records raw timing samples, transaction distributions, environment details, and all limitations.
