# ADR 0016: Keep agent access inside the owning Panel Session

Use a local stdio MCP companion to expose the
Workbench's existing Evidence queries and Local Injection coordinator. This
reaches the user's actual inspected browser runtime without depending on an
experimental WebMCP discovery path or creating a second capture/state engine.
The initial native-host-only implementation required installation and excluded
Windows. The maintainer subsequently requested installer-free Windows support.
The default connection is now an authenticated loopback WebSocket to a standalone
Node companion on Windows, macOS and Linux. Native Messaging remains optional
on macOS/Linux. No domain or execution semantics change with transport.

Each mounted Panel Session owns its grant, connection, query cursors, prepared
document and bounded operation ledger. Agent access starts off; the user grants
inspection or inspection plus Local Injection. The broker routes exact sessions
and never retains Evidence. Standalone access trusts possession of a private
MCP credential plus local access, not a claimed agent name. Native access trusts
the local OS-user boundary. Requested application data may reach the configured model provider,
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

The standalone transport binds only literal IPv4 loopback and checks exact Host,
path and extension Origin. Agent connections use mutual, role-bound nonce/HMAC
proofs with a generated credential in MCP configuration. Panel connections use
fresh P-256 ECDH keys: the panel commits its public key and nonce before the
broker reveals its key. Both derive a short comparison code from the shared
secret and a transcript bound to the port, extension Origin, keys and nonces.
The user compares the two displays and clicks Approve in Workbench. An
authenticated agent must then confirm that exact pending request and code.
Approval and broker confirmation carry connection-bound proofs; cancellation,
disconnection or two-minute expiry removes the pending request without a grant.
No page identity or Evidence is sent before connection completes.

This replaces the interim copy/paste credential form at the maintainer's request.
It preserves deliberate approval without requiring the user to enter a code.
Agents must not automate the human approval click. The private MCP credential
stays out of Workbench, URLs and socket messages. This trades native registration
and OS socket permissions for local authentication and a short-code comparison;
it is not an individual-agent identity or protection from a compromised host.
Local WebSocket traffic
is not encrypted; remote hosts and arbitrary website origins are not supported.
Setup only prints configuration. Runtime startup passes the secret to its local
broker through an anonymous pipe; no installer or registry entries are involved.
