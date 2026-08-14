# Filter panel scenario support

The nine maintained filter scenarios own their deterministic contract records and query/lifecycle configuration in `panel-scenarios.ts`. Their `capturedEvents` are projections of those records, so semantic results cannot drift away from the capture source. Expected outcomes stay in the acceptance test table and are intentionally not encoded in the runner.
