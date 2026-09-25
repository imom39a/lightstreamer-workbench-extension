# ADR 0016: Keep agent access inside the owning Panel Session

Use a local stdio MCP companion with Chrome Native Messaging to expose the
Workbench's existing Evidence queries and Local Injection coordinator. This
reaches the user's actual inspected browser runtime without depending on an
experimental WebMCP discovery path or creating a second capture/state engine.
The trade-off is an explicitly installed native host and a local Node process;
the first installer supports macOS and Linux, not Windows.

Each mounted Panel Session owns its grant, connection, query cursors, prepared
document and bounded operation ledger. Agent access starts off; the user grants
inspection or inspection plus Local Injection. The broker routes exact sessions
and never retains Evidence. It trusts the local OS-user boundary, not a claimed
agent name. Requested application data may reach the configured model provider,
so the permission UI and privacy policy disclose that transfer.

Agent mutations reuse the protected Draft/Scenario, exact page and target
validation, immutable Run, serial delivery, Evidence commitment, drift and
hidden-panel pause rules. A human edit invalidates the prepared agent version.
Duplicate request ids retrieve an existing receipt rather than redelivering;
lost outcomes remain unknown after panel loss. No arbitrary page evaluation,
History clearing, Server Injection or backend stream mutation is exposed.
Browser automation separately verifies the downstream app: Local delivery is
not proof of application behavior or server state.

The generic core retains its Lightstreamer vocabulary. Agent access is an
integration boundary, not a new domain aggregate or permanent workspace pane.
