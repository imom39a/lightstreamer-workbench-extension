# Filter panel scenario support

The nine maintained filter scenarios own their deterministic contract records and query/lifecycle configuration in `panel-scenarios.ts`. Their `capturedEvents` are projections of those records, so semantic results cannot drift away from the capture source. Expected outcomes stay in the acceptance test table and are intentionally not encoded in the runner.

## Real-browser failure evidence

`browser-failure-diagnostics.mjs` records failed production-extension and official-client fixture journeys before owned browser teardown. Each journey and retry gets a new `test-results/browser-diagnostics/<journey>/attempt-NN/` directory. It contains the original failure/step and browser identity, a Playwright `trace.zip`, per-target PNGs and structural panel diagnostics, and the latest 200 console/page-error/browser log entries. Collection is best effort, with a three-second deadline per browser operation, and leaves the original assertion in control of the exit status.

These are disposable fixture profiles. Traces omit DOM snapshots, network bodies, sources and storage; trace events and JSON logs are bounded and redact named credentials, connection tokens, URL queries, and known secret environment values. Screenshots mask password fields and known credentials before capture. Do not reuse the collector against a personal browser profile or production application data.

Run `npm run fixture:browser:install` then `npm run test:browser-diagnostics` to deliberately fail a synthetic real-browser child process and verify that its trace, screenshot, console/page errors and panel state survive teardown while it exits 1. The outer proof command succeeds only when those conditions hold. Fixture and companion workflows upload failure directories with `always()` so a successful internal retry retains its earlier evidence. Open the saved trace with `npx playwright show-trace <path-to-trace.zip>`.
