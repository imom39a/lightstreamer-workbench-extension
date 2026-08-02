---
status: accepted
---

# Keep Topology structural and bound raw evidence

Topology represents the page, client, Session, Subscription, item, and listener structure; high-cardinality COMMAND generation identities and keys are evidence attached to that structure, not peer topology nodes. Topology presents aggregate summaries and bounded, deliberately expanded raw evidence, while COMMAND State remains the complete key-level investigation surface. This keeps structural navigation stable even when a Subscription produces thousands of COMMAND generations.

## Considered Options

- Render every COMMAND generation and key as a node in the Topology tree.
- Omit raw COMMAND generation evidence from Topology entirely.
- Keep the tree structural and expose COMMAND evidence through summaries, bounded expansion, complete copy, and a route to COMMAND State.

## Consequences

- Expanding structural item branches never implicitly expands high-cardinality evidence collections.
- Raw evidence initially renders a bounded recent subset and may be expanded incrementally without rebuilding the complete collection.
- Developers may copy complete raw evidence without first rendering every identity into the document.
- Aggregate generation, active-key, deleted-key, and latest-generation summaries remain available in Subscription details.
- Complete key lifecycle and row-state investigation belongs in COMMAND State rather than Topology.
