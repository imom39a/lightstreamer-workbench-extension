---
status: accepted
---

# Generate credential-safe exports with opt-in redaction

Every Topology download is generated from one immutable, versioned structured snapshot. JSON serializes that canonical snapshot, and the self-contained HTML report renders the same data. The primary flow offers direct JSON and HTML downloads without redaction so captured Lightstreamer context remains useful; advanced options let the developer opt into redaction category by category. Compact exports bound high-cardinality evidence and describe every omission, complete evidence is opt-in, and credential-like values are excluded unconditionally.

## Considered Options

- Generate each export format independently from live Topology state.
- Redact every sensitive category by default and require a JSON preview before downloading.
- Download an unredacted bounded snapshot directly, with category-specific redaction available as an advanced option.

## Consequences

- The schema identifier and version form a compatibility contract; incompatible schema changes require a new version.
- Bounded collections declare total, included, omitted, truncation, and sampling metadata so consumers cannot mistake a sample for complete evidence.
- Server addresses, client IPs, item names, COMMAND keys, configured fields or schemas, and captured identifiers are unredacted by default and independently redactable through advanced options.
- Password-, authorization-, URL-credential-, and other credential-like values never enter an exported snapshot.
- Including complete establishment or COMMAND generation evidence requires an explicit user choice.
- Each download reads one immutable Topology state and neither pauses nor mutates Capture while the file is prepared.
- Offline HTML contains no remote runtime or asset dependency and must escape every application-controlled value.
