// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { createServer } from "node:net";
import { once } from "node:events";
import { request } from "node:http";
import { WebSocketServer } from "ws";
import { startPortableBroker, connectPortableBroker } from "../src/agent/companion/portable-broker";
import { connectPortable } from "../src/agent/portable-channel";

const extensionId = "a".repeat(32);
const otherExtensionId = "b".repeat(32);
const cleanups: Array<() => unknown> = [];
afterEach(() => { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0; });
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve())); return port;
}
async function broker() {
  const port = await freePort();
  const server = await startPortableBroker({ auth: "off", port }, extensionId);
  cleanups.push(() => server.close()); return port;
}

it("rejects an occupied broker configured for another extension before attaching the MCP agent", async () => {
  const port = await broker();
  const attempt = connectPortableBroker("unused-cli", { auth: "off", port }, otherExtensionId)
    .then(channel => { cleanups.push(() => channel.close()); return channel; });
  await expect(attempt).rejects.toThrow(/COMPANION_INCOMPATIBLE:.*extension/i);
});

it("reports an extension mismatch to the panel before attempting its rejected WebSocket", async () => {
  const port = await broker();
  const attempt = connectPortable({ auth: "off", port }, "panel", { extensionId: otherExtensionId });
  await expect(attempt).rejects.toThrow(/COMPANION_INCOMPATIBLE:.*extension/i);
});

it("rejects an older companion without a verifiable identity handshake", async () => {
  const port = await freePort();
  const fake = new WebSocketServer({ host: "127.0.0.1", port });
  cleanups.push(() => { for (const client of fake.clients) client.terminate(); fake.close(); });
  fake.on("connection", socket => socket.on("message", () => socket.send(JSON.stringify({ type: "connected", auth: "off" }))));
  const attempt = connectPortableBroker("unused-cli", { auth: "off", port }, extensionId)
    .then(channel => { cleanups.push(() => channel.close()); return channel; });
  await expect(attempt).rejects.toThrow(/COMPANION_INCOMPATIBLE:.*matching/i);
});

it("reuses a compatible broker and exposes its bounded public identity", async () => {
  const port = await broker();
  const channel = await connectPortableBroker("unused-cli", { auth: "off", port }, extensionId);
  cleanups.push(() => channel.close());
  expect(channel.identity).toMatchObject({ extensionId, protocolVersion: 1, readContractVersion: 2, identityVersion: 1 });
  expect(channel.identity?.companionVersion).toMatch(/^\d+\.\d+\.\d+/);
});

it("limits HTTP diagnostics to public identity with exact Host and extension origins", async () => {
  const port = await broker();
  const response = await fetch(`http://127.0.0.1:${port}/identity`, { headers: { Origin: `chrome-extension://${otherExtensionId}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(`chrome-extension://${otherExtensionId}`);
  expect(await response.json()).toMatchObject({ extensionId, identityVersion: 1 });
  expect((await fetch(`http://127.0.0.1:${port}/identity`, { headers: { Origin: "https://hostile.test" } })).status).toBe(404);
  const wrongHostStatus = await new Promise<number>(resolve => {
    const probe = request(`http://127.0.0.1:${port}/identity`, { headers: { Host: `attacker.test:${port}` } }, reply => { reply.resume(); resolve(reply.statusCode!); });
    probe.end();
  });
  expect(wrongHostStatus).toBe(404);
  expect((await fetch(`http://127.0.0.1:${port}/identity?token=secret`)).status).toBe(404);
});
