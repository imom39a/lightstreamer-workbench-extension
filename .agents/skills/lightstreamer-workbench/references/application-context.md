# Application key and payload meaning

Workbench reports Lightstreamer primitives. Resolve application meaning when a
question uses business entities or operations that the observed fields do not
establish, and before selecting a Local Injection source:

1. Find the application's existing Workbench guide or agent instructions. If
   absent, inspect the Subscription setup, COMMAND key parser, model identifiers
   and listener that updates the relevant UI.
2. Map the question's entity, metric or operation to a Subscription, item, key and
   declared field using those definitions and observed Evidence. Select the model
   for the requested change from those definitions and observed
   Evidence. Customer initialization and seat assignment may use different keys.
   Copy the exact complete observed key; preserve its suffix and whitespace.
3. Confirm the intended entity from available fields and application context.
   Text search is case-insensitive substring search. Zero results can reflect
   a spelling mismatch; verify the supplied name before changing the search.
   A single name-search match and a missing excerpt do not establish identity.
4. For a read, use [query-planning.md](query-planning.md) to choose counts, field
   predicates, historical examples or derived COMMAND state. If the mapping
   remains unclear, ask for the missing field/model meaning or stable entity
   identifier; do not infer it from a suffix or one search hit.
5. For reproduction, prepare from the matching Item Update without a replacement document, then
   edit its complete expanded template as described in [local-injection.md](local-injection.md).
   Verify the expected UI change in the same inspected tab after delivery.

An application-owned guide can cache what code and Evidence established:

```markdown
# Workbench application context
- Subscription and declared fields: <verified names>
- Key shape and parser: <format, source-file pointer, exact observed example>
- Models for each operation: <model identifiers and source-file pointers>
- Field meaning and units: <verified names, numeric/string encoding and source pointers>
- Payload edit for removal: <exact property/change and listener behavior>
- Identity confirmation: <available fields/context>
- Expected result: <UI element/state to observe after local delivery>
```

Keep this guide in the application repository and point to it from that
repository's agent instructions or Kiro steering. Cache verified application
rules there; use the installed Workbench skill for the generic MCP workflow.
