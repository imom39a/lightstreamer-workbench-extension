---
status: accepted
---

# Generate privacy-safe exports from one versioned snapshot

Every Topology export is generated from one immutable, versioned structured snapshot created after an explicit privacy review. JSON serializes that canonical snapshot, and the self-contained HTML report renders the same approved data; compact exports bound high-cardinality evidence and describe every omission, complete evidence is opt-in, sensitive categories are redacted by default, and credential-like values are excluded unconditionally. This gives tools and people a consistent Capture description without turning export into an unreviewed data-exfiltration path.

## Considered Options

- Generate each export format independently from live Topology state.
- Export complete raw Topology data by default and rely on recipients to remove sensitive values.
- Approve one privacy-safe structured snapshot and derive every export format from it.

## Consequences

- The schema identifier and version form a compatibility contract; incompatible schema changes require a new version.
- Bounded collections declare total, included, omitted, truncation, and sampling metadata so consumers cannot mistake a sample for complete evidence.
- Server addresses, client IPs, item names, COMMAND keys, configured fields or schemas, and captured identifiers are independently reviewable and redactable.
- Password-, authorization-, URL-credential-, and other credential-like values never enter an exported snapshot.
- Including complete establishment or COMMAND generation evidence requires an explicit user choice.
- Export reads one immutable Topology state and neither pauses nor mutates Capture while the download is prepared.
- Offline HTML contains no remote runtime or asset dependency and must escape every application-controlled value.
