# Workbench agent companion

The local companion exposes MCP tools for explicitly connected Lightstreamer
Workbench Panel Sessions. It includes a Chrome Native Messaging host and a
per-user local broker. Chrome starts native hosts; agent clients start MCP stdio
processes. The broker routes multiple clients and panels over a private Unix
socket without persisting Evidence. No remote debugging port is needed for this
connection. Browser automation for observing the app is configured separately.

Requires Node 22.12+ and macOS or Linux. Windows installation is not implemented.

## Build and connect

From the repository root:

```sh
npm ci
npm run build
npm run agent:build
npm run agent:install -- --extension-id YOUR_ACTUAL_EXTENSION_ID
```

Load `dist/` as an unpacked Chrome extension and obtain its exact id from
`chrome://extensions`. Installation defaults to the official store extension id;
an older store build without Agent access cannot use the companion. For Chrome
for Testing, append `--browser chrome-for-testing`.
For a browser launched with a custom `--user-data-dir`, also pass that absolute
directory to the installer as `--user-data-dir /absolute/profile-root` (not its
`Default` child). Chrome looks up per-user hosts inside that directory.

The installer registers a per-user native host and prints an MCP configuration
with absolute Node and companion paths. Use its printed command and arguments in
your agent's MCP server settings, adapting to that client's configuration format.
Keep Node and the companion at those paths; run installation again
after moving them. Installation does not edit agent settings.

Open Workbench in the inspected tab, then **More actions → Agent access**. Choose
inspection or inspection plus Local Injection, and connect. Permissions are
temporary and apply to local agent clients running as your OS user. Disconnect
revokes access and pauses an agent Scenario; an already sent update can still settle.

Install the bundled `skills/lightstreamer-workbench` directory into your agent's
skill directory. The source skill is `.agents/skills/lightstreamer-workbench` in
the repository. `npm pack ./agent` packages the built companion and skill.

## Tool contract

Start with `list_panel_sessions`, `get_status`, `list_scope` and `get_scope`.
Tool schemas describe all supported inputs. Queries use bounded output and
stable read-point cursors. Returned application text is untrusted data.
`prepare_local_injection` and `prepare_scenario` create visible documents;
execution requires their current target and reviewed version. Duplicate request
ids never dispatch another operation during that Panel Session. A remount loses
the ledger: an unknown old request is not proof that no delivery occurred.

The first interface exposes Local Injection only. It keeps one protected Draft
or Scenario, existing retention and Coverage semantics, and hidden-panel pause.
Use browser automation on the same application tab to verify the downstream UI.

The query interface excludes Client Message bodies/outcome text and credential
fields. Item Update payloads may still contain application data. Enabling access
allows requested data to reach the agent and its configured model provider.

## Troubleshooting and removal

Run `node agent/dist/cli.mjs doctor` from the repository to inspect registration.
An unpacked extension id change requires reinstallation for that exact id.
After a companion disconnect, reconnect in Workbench and inspect any outstanding
operation before starting another experiment.

The installer prints its exact manifest and launcher paths. To remove the
integration, disconnect panels, remove its MCP entry from the agent configuration,
and remove only those two installed files. The broker exits after 30 idle seconds.
The private temporary broker directory contains only a local access token and
socket/startup lock, not captured Evidence. Startup recovers an abandoned socket
under a per-user startup lock without replacing a connected broker.

## Verification

`npm run agent:test:browser` builds the companion and runs the official-client
fixture with a real stdio MCP client and Native Messaging connection. Registration
is isolated to the disposable test Chrome profile. It checks read-only denial,
queried Evidence, Local Injection, ordered Scenario Steps, duplicate suppression,
the app's displayed response and disconnect. Requires the fixture prerequisites
in the repository's [contributor guide](https://github.com/imom39a/lightstreamer-workbench-extension/blob/main/CONTRIBUTING.md).
