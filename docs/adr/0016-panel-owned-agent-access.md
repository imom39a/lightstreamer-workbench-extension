# ADR 0016: Keep agent access inside the owning Panel Session

Use a local stdio MCP companion to expose the
Workbench's existing Evidence queries and Local Injection coordinator. This
reaches the user's actual inspected browser runtime without depending on an
experimental WebMCP discovery path or creating a second capture/state engine.
The initial native-host-only implementation required installation and excluded
Windows. The maintainer subsequently requested installer-free Windows support.
The default connection is now a loopback WebSocket to a standalone
Node companion on Windows, macOS and Linux. Authentication is retained but off
by default following the maintainer's request to remove mandatory Windows pairing.
Native Messaging remains optional
on macOS/Linux. No domain or execution semantics change with transport.

Each mounted Panel Session owns its grant, connection, query cursors, prepared
document and bounded operation ledger. Following the maintainer's explicit
friction-free access decision, opening a panel automatically enables inspection
and Local Injection. A compact On/Off control beside View in the header revokes
access and cancels retries; On denotes enabled access, not connected-agent presence.
Setup guidance and optional settings live under More actions. They apply to the
current Panel Session; a new panel uses the defaults. The broker routes exact sessions
and never retains Evidence. Default standalone access trusts local processes:
any process with loopback access can use a connected panel's grant or impersonate
the companion. Optional authenticated access additionally requires possession
of the private MCP credential, not a claimed agent name. Native access trusts
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
path and extension Origin in both modes. These checks reject ordinary websites
but are not local-process authentication or per-OS-user isolation. Default
connections use an explicit auth-off handshake and no comparison/approval step;
the panel connects automatically at port 24817 and waits/retries if the companion
starts later or restarts. Backoff is capped at 15 seconds. Loss revokes the active
grant and pauses agent Scenarios; reconnecting never repeats an operation or
resumes a Run. Optional authenticated/native failures require deliberate re-enabling,
and neither mode silently falls back to auth off. Optional authenticated
agent connections use mutual, role-bound nonce/HMAC
proofs with a generated credential in MCP configuration. Panel connections use
fresh P-256 ECDH keys: the panel commits its public key and nonce before the
broker reveals its key. Both derive a short comparison code from the shared
secret and a transcript bound to the port, extension Origin, keys and nonces.
The user compares the two displays and clicks Approve in Workbench. An
authenticated agent must then confirm that exact pending request and code.
Approval and broker confirmation carry connection-bound proofs; cancellation,
disconnection or two-minute expiry removes the pending request without a grant.
No page identity or Evidence is sent before connection completes in either mode.

The optional authenticated flow replaces the interim copy/paste credential form.
Agents must not automate its human approval click. The private MCP credential
stays out of Workbench, URLs and socket messages. This trades native registration
and OS socket permissions for optional authentication and a short-code comparison;
it is not an individual-agent identity or protection from a compromised host.
Local WebSocket traffic
is not encrypted; remote hosts and arbitrary website origins are not supported.
Setup only prints configuration. Default setup emits command/arguments without
a credential. `setup --auth required` enables the retained authenticated mode;
the panel exposes it under Advanced connection settings. Existing credential-bearing MCP
entries continue to require authentication. Neither side falls back across
modes, and switching requires disconnecting/restarting matching clients or a
separate port. Runtime startup passes configuration to its local broker through
an anonymous pipe; no installer or registry entries are involved. The accepted
tradeoff removes connection friction on trusted development machines at the cost
of local-process authentication, not the Panel Session or Local Injection boundary.
