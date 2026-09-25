// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { WebSocket, WebSocketServer } from "ws";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startPortableBroker } from "../src/agent/companion/portable-broker";
import { connectPortable } from "../src/agent/portable-channel";
import { beginPanelPairing } from "../src/agent/panel-pairing";
import { PAIRING_ENV, parsePairingCode, pairingProof, proofText, randomNonce, verifyPairingProof, createPairingKey, pairingCommitment, pairingTranscript, derivePairingSecret, comparisonCode } from "../src/agent/pairing";
import { AGENT_MAX_BYTES } from "../src/agent/protocol";

const extensionId = "a".repeat(32), origin = `chrome-extension://${extensionId}`;
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function start() {
  const port = await freePort(), code = `wb1:${port}:${randomNonce()}`;
  const broker = await startPortableBroker(code, extensionId); cleanups.push(() => broker.close());
  return { port, code };
}
async function peer(port: number, headers?: Record<string, string>) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers });
  cleanups.push(() => socket.terminate());
  const queue: Record<string, any>[] = [], readers: Array<(value: Record<string, any>) => void> = [];
  socket.on("message", data => { const value = JSON.parse(data.toString()), read = readers.shift(); if (read) read(value); else queue.push(value); });
  await once(socket, "open");
  return { socket, send: (value: unknown) => socket.send(JSON.stringify(value)), next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, any>>(resolve => readers.push(resolve)) };
}
async function authenticate(code: string, role: "agent" | "panel") {
  if (role === "panel") {
    const pending = await beginApproval(code);
    const agent = await authenticate(code, "agent"); agent.send({ role: "agent" }); await agent.next();
    await pending.approve();
    agent.send({ id: "confirm", name: "confirm_pairing", args: { requestId: pending.requestId, code: pending.code } });
    expect((await agent.next()).result).toEqual({ confirmed: true, requestId: pending.requestId });
    const confirmation = await pending.client.next();
    expect(await verifyPairingProof(pending.secret, `broker-confirmed\n${pending.transcript}`, confirmation.proof)).toBe(true);
    agent.socket.close(); return pending.client;
  }
  const { port, secret } = parsePairingCode(code);
  const client = await peer(port);
  const nonce = randomNonce(); client.send({ type: "challenge", role, nonce });
  const challenge = await client.next();
  expect(await verifyPairingProof(secret, proofText("server", role, nonce, challenge.nonce), challenge.proof)).toBe(true);
  client.send({ type: "authenticate", proof: await pairingProof(secret, proofText("client", role, nonce, challenge.nonce)) });
  expect(await client.next()).toEqual({ type: "authenticated" });
  return client;
}

async function beginApproval(code: string) {
  const { port } = parsePairingCode(code), keys = await createPairingKey(), nonce = randomNonce();
  const client = await peer(port, { Origin: origin });
  client.send({ type: "pairing-start", commitment: await pairingCommitment(keys.publicKey, nonce) });
  const server = await client.next();
  const secret = await derivePairingSecret(keys.privateKey, server.publicKey);
  const transcript = pairingTranscript(port, origin, keys.publicKey, nonce, server.publicKey, server.nonce);
  client.send({ type: "pairing-reveal", publicKey: keys.publicKey, nonce });
  const request = await client.next();
  expect(await verifyPairingProof(secret, `pairing-code\n${request.requestId}\n${request.expiresAt}\n${transcript}`, request.proof)).toBe(true);
  return { client, secret, transcript, requestId: request.requestId, code: await comparisonCode(secret, transcript), async approve() {
    client.send({ type: "pairing-approve", proof: await pairingProof(secret, `panel-approved\n${transcript}`) });
    expect(await client.next()).toEqual({ type: "pairing-approved" });
  } };
}

describe("installer-free companion", () => {
  it("grants no access before a matching code, panel approval and authenticated agent confirmation", async () => {
    const { code } = await start(), pending = await beginApproval(code);
    const agent = await authenticate(code, "agent"); agent.send({ role: "agent" }); await agent.next();
    agent.send({ id: "unapproved", name: "list_panel_sessions", args: {} }); expect((await agent.next()).result).toEqual([]);
    agent.send({ id: "pending", name: "get_pairing_requests", args: {} });
    expect((await agent.next()).result).toEqual([expect.objectContaining({ requestId: pending.requestId, code: pending.code, panelApproved: false })]);
    const args = { requestId: pending.requestId, code: pending.code };
    agent.send({ id: "early", name: "confirm_pairing", args }); expect((await agent.next()).error).toMatch("user must");
    await pending.approve();
    agent.send({ id: "wrong", name: "confirm_pairing", args: { ...args, code: pending.code === "0000 0000" ? "1111 1111" : "0000 0000" } }); expect((await agent.next()).error).toMatch("does not match");
    agent.send({ id: "confirm", name: "confirm_pairing", args }); expect((await agent.next()).result.confirmed).toBe(true);
    expect((await pending.client.next()).type).toBe("authenticated");
    pending.client.send({ role: "panel", protocolVersion: 1, panelSessionId: "approved", permission: "read" }); await pending.client.next();
    agent.send({ id: "approved", name: "list_panel_sessions", args: {} }); expect((await agent.next()).result).toHaveLength(1);
    agent.send({ id: "replay", name: "confirm_pairing", args }); expect((await agent.next()).error).toMatch("expired or disconnected");
  });
  it("removes cancelled requests and rejects expired approvals", async () => {
    const { code } = await start(), pending = await beginApproval(code);
    const agent = await authenticate(code, "agent"); agent.send({ role: "agent" }); await agent.next();
    const closed = once(pending.client.socket, "close"); pending.client.socket.close(); await closed;
    // The client close event does not establish that the server's close callback
    // has run: these are separate sockets, with different scheduling on Windows.
    await expect.poll(async () => {
      agent.send({ id: "cancelled", name: "get_pairing_requests", args: {} }); return (await agent.next()).result;
    }, { timeout: 2000 }).toEqual([]);
    agent.send({ id: "cancelled-confirmation", name: "confirm_pairing", args: { requestId: pending.requestId, code: pending.code } });
    expect((await agent.next()).error).toMatch("expired or disconnected");
    const expired = await beginApproval(code); await expired.approve();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120001);
    agent.send({ id: "expired", name: "confirm_pairing", args: { requestId: expired.requestId, code: expired.code } });
    expect((await agent.next()).error).toMatch("expired or disconnected");
    agent.send({ id: "hidden", name: "get_pairing_requests", args: {} }); expect((await agent.next()).result).toEqual([]);
    agent.send({ id: "no-access", name: "list_panel_sessions", args: {} }); expect((await agent.next()).result).toEqual([]);
  });
  it("rejects changed committed keys and forged panel approvals", async () => {
    const { code, port } = await start(), client = await peer(port, { Origin: origin });
    const keys = await createPairingKey(), nonce = randomNonce();
    client.send({ type: "pairing-start", commitment: await pairingCommitment(keys.publicKey, nonce) }); await client.next();
    const closed = once(client.socket, "close");
    client.send({ type: "pairing-reveal", publicKey: keys.publicKey, nonce: randomNonce() }); await closed;
    const pending = await beginApproval(code), rejected = once(pending.client.socket, "close");
    pending.client.send({ type: "pairing-approve", proof: "0".repeat(64) }); await rejected;
    const agent = await authenticate(code, "agent"); agent.send({ role: "agent" }); await agent.next();
    await expect.poll(async () => {
      agent.send({ id: "empty", name: "get_pairing_requests", args: {} }); return (await agent.next()).result;
    }, { timeout: 2000 }).toEqual([]);
    agent.send({ id: "no-access", name: "list_panel_sessions", args: {} }); expect((await agent.next()).result).toEqual([]);
  });
  it("accepts only loopback pairing codes and binds proofs to role and both fresh nonces", async () => {
    for (const code of ["", "ws://evil.test", `wb1:80:${"a".repeat(64)}`, `wb1:65536:${"a".repeat(64)}`, `wb1:24817:password`]) expect(() => parsePairingCode(code)).toThrow();
    const secret = randomNonce(), a = randomNonce(), b = randomNonce();
    const proof = await pairingProof(secret, proofText("server", "panel", a, b));
    expect(await verifyPairingProof(secret, proofText("server", "panel", a, b), proof)).toBe(true);
    for (const text of [proofText("client", "panel", a, b), proofText("server", "agent", a, b), proofText("server", "panel", randomNonce(), b)]) expect(await verifyPairingProof(secret, text, proof)).toBe(false);
  });

  it("routes multiple panels and clients without native registration and clears revoked sessions", async () => {
    const { code } = await start();
    const a = await authenticate(code, "agent"), b = await authenticate(code, "agent");
    const panel = await authenticate(code, "panel"), other = await authenticate(code, "panel");
    for (const agent of [a, b]) { agent.send({ role: "agent" }); await agent.next(); }
    for (const [client, id] of [[panel, "one"], [other, "two"]] as const) {
      client.send({ role: "panel", protocolVersion: 1, panelSessionId: id, permission: "read", tabId: 7 }); await client.next();
    }
    a.send({ id: "list", name: "list_panel_sessions", args: {} });
    expect((await a.next()).result).toEqual([expect.objectContaining({ panelSessionId: "one", extensionOrigin: origin }), expect.objectContaining({ panelSessionId: "two" })]);
    a.send({ id: "same", name: "get_status", args: { panelSessionId: "one" } });
    b.send({ id: "same", name: "get_status", args: { panelSessionId: "two" } });
    const first = await panel.next(), second = await other.next(); expect(first.id).not.toBe(second.id);
    other.send({ id: first.id, result: "spoof" });
    panel.send({ id: first.id, result: "first" }); other.send({ id: second.id, result: "second" });
    expect((await a.next()).result).toBe("first"); expect((await b.next()).result).toBe("second");
    a.send({ id: "pending", name: "get_status", args: { panelSessionId: "one" } }); await panel.next();
    panel.socket.close(); expect((await a.next()).error).toMatch("may be unknown");
    a.send({ id: "remaining", name: "list_panel_sessions", args: {} }); expect((await a.next()).result).toHaveLength(1);
  });

  it("rejects website origins, wrong extension origins, rebinding hosts and URL credentials", async () => {
    const { port } = await start();
    for (const [path, headers] of [["/workbench", { Origin: "https://hostile.test" }], ["/workbench", { Origin: "null" }], ["/workbench", { Origin: `chrome-extension://${"b".repeat(32)}` }], ["/workbench", { Host: `attacker.test:${port}` }], ["/workbench?token=secret", {}]] as const) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers }); socket.on("error", () => {});
      const closed = new Promise<void>(resolve => socket.once("close", () => resolve()));
      let opened = false; socket.on("open", () => { opened = true; }); await closed; expect(opened).toBe(false);
    }
  });

  it("rejects wrong secrets, replayed proofs, unauthenticated tools and role confusion", async () => {
    const { port, code } = await start();
    await expect(connectPortable(`wb1:${port}:${randomNonce()}`, "agent")).rejects.toThrow("authentication");
    for (const first of [{ id: "bad", name: "list_panel_sessions", args: {} }, { type: "challenge", role: "panel", nonce: randomNonce() }]) {
      const client = await peer(port); const closed = once(client.socket, "close"); client.send(first); await closed;
    }
    const client = await peer(port); const nonce = randomNonce(); client.send({ type: "challenge", role: "agent", nonce });
    const challenge = await client.next(); const closed = once(client.socket, "close");
    client.send({ type: "authenticate", proof: await pairingProof(parsePairingCode(code).secret, proofText("client", "agent", nonce, randomNonce())) });
    expect(challenge.nonce).toMatch(/^[a-f0-9]{64}$/); await closed;
  });

  it("refuses oversized packets without stopping another client", async () => {
    const { code } = await start();
    const bad = await authenticate(code, "agent"), good = await authenticate(code, "agent");
    bad.send({ role: "agent" }); await bad.next(); good.send({ role: "agent" }); await good.next();
    const closed = once(bad.socket, "close"); bad.socket.send("x".repeat(AGENT_MAX_BYTES + 4097)); await closed;
    good.send({ id: "still-alive", name: "list_panel_sessions", args: {} }); expect((await good.next()).result).toEqual([]);
  });

  it("checks the server identity before transmitting agent authentication", async () => {
    const port = await freePort(), fake = new WebSocketServer({ host: "127.0.0.1", port });
    cleanups.push(() => { for (const client of fake.clients) client.terminate(); fake.close(); });
    const received: any[] = [];
    fake.on("connection", socket => socket.on("message", data => {
      received.push(JSON.parse(data.toString())); socket.send(JSON.stringify({ type: "challenge", nonce: randomNonce(), proof: "0".repeat(64) }));
    }));
    await expect(connectPortable(`wb1:${port}:${randomNonce()}`, "agent")).rejects.toThrow("authentication");
    expect(received).toEqual([{ type: "challenge", role: "agent", nonce: expect.any(String) }]);
  });

  it("never displays an unverified comparison code or shares a panel identity", async () => {
    const port = await freePort(), fake = new WebSocketServer({ host: "127.0.0.1", port });
    cleanups.push(() => { for (const client of fake.clients) client.terminate(); fake.close(); });
    const keys = await createPairingKey(), received: any[] = [], show = vi.fn();
    fake.on("connection", socket => socket.on("message", data => {
      const value = JSON.parse(data.toString()); received.push(value);
      socket.send(JSON.stringify(value.type === "pairing-start"
        ? { type: "pairing-key", publicKey: keys.publicKey, nonce: randomNonce() }
        : { type: "pairing-code", requestId: "fake", expiresAt: Date.now() + 120000, proof: "0".repeat(64) }));
    }));
    const attempt = beginPanelPairing(port, origin, show);
    await expect(attempt.ready).rejects.toThrow();
    expect(show).not.toHaveBeenCalled();
    expect(received.map(value => value.type)).toEqual(["pairing-start", "pairing-reveal"]);
    expect(received.every(value => value.panelSessionId === undefined && value.permission === undefined)).toBe(true);
  });

  it("runs the bundled Node CLI with spaces in its path and starts a shared portable broker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lsew portable ")); cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const cli = join(directory, "companion cli.mjs");
    await build({ entryPoints: [fileURLToPath(new URL("../src/agent/companion/cli.ts", import.meta.url))], outfile: cli, bundle: true, platform: "node", format: "esm", target: "node22", banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
    const port = await freePort();
    const setup = JSON.parse(execFileSync(process.execPath, [cli, "setup", "--port", String(port), "--extension-id", extensionId], { encoding: "utf8" }));
    const config = setup.mcpServers["lightstreamer-workbench"];
    const credential = config.env[PAIRING_ENV];
    expect(parsePairingCode(credential).port).toBe(port); expect(setup.port).toBe(port);
    expect(setup.pairingCode).toBeUndefined();
    const clients = [new Client({ name: "portable-a", version: "1" }), new Client({ name: "portable-b", version: "1" })];
    for (const client of clients) cleanups.push(() => client.close());
    await Promise.all(clients.map(client => client.connect(new StdioClientTransport({ ...config, stderr: "pipe" }))));
    expect((await clients[0]!.listTools()).tools.map(tool => tool.name)).toContain("prepare_scenario");
    const panel = await authenticate(credential, "panel");
    panel.send({ role: "panel", protocolVersion: 1, panelSessionId: "portable-cli", permission: "local" }); await panel.next();
    for (const client of clients) expect(JSON.stringify(await client.callTool({ name: "list_panel_sessions", arguments: {} }))).toContain("portable-cli");
    const reply = clients[1]!.callTool({ name: "get_status", arguments: { panelSessionId: "portable-cli" } });
    const request = await panel.next(); panel.send({ id: request.id, result: { pageEpoch: "windows-compatible" } });
    expect(JSON.stringify(await reply)).toContain("windows-compatible");
  }, 15000);
});
