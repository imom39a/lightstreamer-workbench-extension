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
On 2026-09-27 the maintainer requested a single npm-distributed runtime and
removed Native Messaging. Windows, macOS and Linux now use the same Node source
and loopback connection. The extension no longer requests `nativeMessaging`.

Each mounted Panel Session owns its grant, connection, query cursors, prepared
document and bounded operation ledger. Following the maintainer's explicit
friction-free access decision, opening a panel automatically enables inspection
and Local Injection. A compact status shortcut beside View in the header opens
Agent access and setup under More actions. Following the 2026-09-28 correction, it shows
Waiting while enabled but not ready, On only after
the companion handshake grants access, and Off when disabled. On indicates a
usable companion connection, not connected-agent presence or activity. The
header is navigation, not a toggle: it never changes the grant. The on/off
control lives in More; turning access off revokes the grant and cancels retries.
Opening the shortcut focuses that control, and Back restores the originating shortcut.
The maintainer also removed the Advanced connection settings block on 2026-09-28.
More actions contains the on/off control and setup instructions. The current panel uses port 24817,
authentication off, and inspection plus Local Injection together; authentication
and read-only enforcement remain internal for future controls. Access belongs to
the current Panel Session; a new panel uses the defaults. The broker routes exact sessions
and never retains Evidence. Default standalone access trusts local processes:
any process with loopback access can use a connected panel's grant or impersonate
the companion. Optional authenticated access additionally requires possession
of the private MCP credential, not a claimed agent name. Requested application data may reach the configured model provider,
so the permission UI and privacy policy disclose that transfer.

Agent mutations reuse the protected Draft/Scenario, exact page and target
validation, immutable Run, serial delivery, Evidence commitment, drift and
hidden-panel pause rules. A human edit invalidates the prepared agent version.
Duplicate request ids retrieve an existing receipt rather than redelivering;
lost outcomes remain unknown after panel loss. No arbitrary page evaluation,
History clearing, backend stream mutation, or agent-callable approval is
exposed. Agent-assisted Server Injection is a separate reviewed capability:
the agent may prepare a Client Message in the existing Server Injection
document, but Local Injection access alone cannot authorize sending. Each
message requires a separate visible human approval bound to the exact current
page, Client, Session, body and send options. The panel consumes that approval
once; edits, retargeting, Session changes, or access revocation clear it.
Execution uses the inspected client's normal `sendMessage` path and the same
request ID for receipt recovery. An Unknown outcome is never resent
automatically. Browser automation separately verifies downstream behavior;
neither Local delivery nor successful Client Message handling proves an
application effect or Server Update attribution.

The generic core retains its Lightstreamer vocabulary. Agent access is an
integration boundary, not a new domain aggregate or permanent workspace pane.

The standalone transport binds only literal IPv4 loopback and checks exact Host,
path and extension Origin in both modes. These checks reject ordinary websites
but are not local-process authentication or per-OS-user isolation. Default
connections use an explicit auth-off handshake and no comparison/approval step;
the panel connects automatically at port 24817 and waits/retries if the companion
starts later or restarts. Backoff is capped at 15 seconds. Loss revokes the active
grant and pauses agent Scenarios; reconnecting never repeats an operation or
resumes a Run.

The following authentication protocol is retained for future controls, not a
current panel workflow. Authenticated failures require deliberate re-enabling,
and neither mode silently falls back to auth off. The retained protocol uses
mutual, role-bound nonce/HMAC
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
Setup prints MCP configuration for the user to add to their host. Default setup emits command/arguments without
a credential. The retained `setup --auth required` mode is for protocol compatibility/testing;
the current panel has no authentication or approval controls. Existing credential-bearing MCP
entries continue to require authentication. Neither side falls back across
modes, and switching requires disconnecting/restarting matching clients or a
separate port. Runtime startup passes configuration to its local broker through
an anonymous pipe; no installer or registry entries are involved. The accepted
tradeoff removes connection friction on trusted development machines at the cost
of local-process authentication, not the Panel Session or Local Injection boundary.

The npm package bundles the MCP runtime and matching skill. On 2026-10-06 the
maintainer requested one combined MCP/skill setup and update flow. Interactive
setup offers skill installation through the pinned upstream `skills` npm
dependency's public executable. It owns the full supported agent registry,
native selection/detection defaults, target directories and project/user scope;
Workbench does not maintain a Kiro-specific picker or registry. Explicit
`--agent` accepts several names or repeated flags and delegates their validation
to the same dependency. Workbench copies the complete bundled skill with `--copy`
so npx cache eviction cannot break installed references. `update` uses the same
flow. Unattended skill installation requires an explicit agent and `--yes`;
configuration-only output and stdio MCP startup never prompt. This does not
change the boundary for editing host MCP settings: setup still prints that
entry for the user to add. Runtime SDK dependencies remain bundled; the skill
installer is a separate, pinned npm dependency supporting Node 22.12.
The current pin is `skills` 1.5.18, the latest patch retaining the compatible
Node floor. Its native picker cancellation currently returns an upstream error;
setup documents configuration-only recovery rather than patching or copying
the dependency's private picker implementation.

Setup defaults to a
version-pinned `npx` entry on all platforms; `--local` supports an installed
artifact using absolute Node/package paths. The agent app starts this stdio MCP
entry, which automatically starts or reuses the loopback companion. There is no
separate terminal or service to manage; the process runs outside Chrome on the
same computer. Neither route requires a native
host or changes agent settings. Legacy native commands fail with migration
guidance rather than silently changing the connection boundary. Package tests
install the tarball and exercise the npm executable, MCP and loaded extension
on Windows, macOS and Linux before publication.

## Firefox coexistence amendment — October 6, 2026

The same companion accepts the existing exact Chrome Origin and exact Firefox Origins independently derived from Firefox's profile metadata for the approved permanent ID `lightstreamer-workbench@imom39a`. Firefox maps that ID to a separate runtime UUID in each profile's `extensions.webextensions.uuids` preference. The companion reads only this mapping in registered desktop profiles, with bounded file sizes, profile counts and a short cache. It never evaluates preference-file JavaScript or trusts a socket's claimed add-on ID. Missing or corrupt mappings reject Firefox connections. Custom profile registries can be supplied through `LSEW_FIREFOX_PROFILES_DIR`; ordinary setup is unchanged.

The permanent ID, actual `moz-extension://UUID` Origin and browser-local tab ID remain distinct. Each accepted socket retains its actual Origin, including in pairing transcripts and Panel Session discovery. Exact Panel Session routing handles simultaneous browsers and colliding tab IDs; there is still one Evidence owner. Existing Chrome identity fields and protocol remain compatible. Local-process trust is unchanged: profile metadata checks reject other extension and website Origins, but do not authenticate a local process or an OS user.

Firefox's required native installation consent covers MCP's inspected page identity and arbitrary Lightstreamer fields, Item Updates, Client Messages, Drafts and Scenario results. Those application-controlled values can contain personally identifying, health, financial/payment, authentication, communications or location information; recognized credential-field redaction cannot establish that arbitrary application values are free of these categories. Declare those personal categories along with `websiteContent` and `browsingActivity`. Workbench does not collect Firefox bookmarks, browser search terms or general page mouse/keyboard activity. Protocol compatibility, temporary routing IDs and requested debugging status are functional MCP traffic, not optional product analytics. The existing Agent access off control stops MCP transmission. The first Firefox release prohibits private browsing.
