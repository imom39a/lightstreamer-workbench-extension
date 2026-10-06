// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createFirefoxOriginResolver, firefoxOriginFromPreferences } from "../src/agent/companion/firefox-origins";
import { startPortableBroker } from "../src/agent/companion/portable-broker";
import { FIREFOX_EXTENSION_ID } from "../src/agent/browser-identity";
import { assertCompanionIdentity } from "../src/agent/companion-identity";
import { AGENT_READ_CONTRACT, AGENT_PROTOCOL_VERSION } from "../src/agent/protocol";

const chromeId = "a".repeat(32), chromeOrigin = `chrome-extension://${chromeId}`;
const uuidA = "11111111-2222-4333-8444-555555555555", uuidB = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const firefoxA = `moz-extension://${uuidA}`, firefoxB = `moz-extension://${uuidB}`;
const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanups.reverse()) await fn(); cleanups.length = 0; });
const prefs = (id: string, uuid: string) => `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [id]: uuid }))});\n`;
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lsew-firefox-origin-")); cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "Profiles", "a"), { recursive: true }); await mkdir(join(root, "Profiles", "b"), { recursive: true });
  await writeFile(join(root, "profiles.ini"), "[Profile0]\r\nIsRelative=1\r\nPath=Profiles/a\r\n[Profile1]\nIsRelative=1\nPath=Profiles/b\n");
  await writeFile(join(root, "Profiles", "a", "prefs.js"), prefs(FIREFOX_EXTENSION_ID, uuidA));
  await writeFile(join(root, "Profiles", "b", "prefs.js"), prefs(FIREFOX_EXTENSION_ID, uuidB));
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const port = (server.address() as { port: number }).port; await new Promise<void>(r => server.close(() => r()));
  const resolver = createFirefoxOriginResolver([root]);
  const broker = await startPortableBroker({ auth: "off", port }, chromeId, resolver); cleanups.push(() => broker.close());
  return { root, port, resolver };
}
async function peer(port: number, origin?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: origin ? { Origin: origin } : {} }); cleanups.push(() => socket.terminate());
  const queue: Record<string, any>[] = [], readers: Array<(v: Record<string, any>) => void> = [];
  socket.on("message", data => { const v = JSON.parse(data.toString()), r = readers.shift(); if (r) r(v); else queue.push(v); });
  await once(socket, "open");
  const next = () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Record<string, any>>(r => readers.push(r));
  const send = (v: object) => socket.send(JSON.stringify(v));
  send({ type: "connect", auth: "off", role: origin ? "panel" : "agent" }); await next();
  return { socket, send, next };
}
it("derives only the permanent add-on's exact UUID without evaluating preference code", () => {
  expect(firefoxOriginFromPreferences(prefs(FIREFOX_EXTENSION_ID, uuidA))).toBe(firefoxA);
  for (const source of [prefs("impostor@example", uuidA), prefs(FIREFOX_EXTENSION_ID, "https://example.org"), prefs(FIREFOX_EXTENSION_ID, uuidA) + prefs(FIREFOX_EXTENSION_ID, uuidB), 'user_pref("extensions.webextensions.uuids", runUntrustedCode());', prefs(FIREFOX_EXTENSION_ID, uuidB.toUpperCase())]) expect(firefoxOriginFromPreferences(source)).toBeNull();
});
it("routes Chrome and two registered Firefox profiles independently when tab IDs collide", async () => {
  const { port, resolver } = await fixture();
  expect(await resolver()).toEqual(new Set([firefoxA, firefoxB]));
  const a = await peer(port, chromeOrigin), b = await peer(port, firefoxA), c = await peer(port, firefoxB), agent = await peer(port);
  for (const [panel, id] of [[a, "chrome"], [b, "firefox-a"], [c, "firefox-b"]] as const) { panel.send({ role: "panel", panelSessionId: id, tabId: 42, permission: "local", protocolVersion: 1 }); expect((await panel.next()).type).toBe("ready"); }
  agent.send({ role: "agent" }); await agent.next();
  agent.send({ id: "list", name: "list_panel_sessions", args: {} });
  expect((await agent.next()).result).toEqual(expect.arrayContaining([expect.objectContaining({ panelSessionId: "chrome", tabId: 42, extensionOrigin: chromeOrigin }), expect.objectContaining({ panelSessionId: "firefox-a", tabId: 42, extensionOrigin: firefoxA }), expect.objectContaining({ panelSessionId: "firefox-b", tabId: 42, extensionOrigin: firefoxB })]));
  agent.send({ id: "target-b", name: "get_status", args: { panelSessionId: "firefox-a" } });
  const call = await b.next(); expect(call.name).toBe("get_status");
  b.send({ id: call.id, result: { owner: "firefox-a" } }); expect((await agent.next()).result).toEqual({ owner: "firefox-a" });
  const closed = once(b.socket, "close"); b.socket.close(); await closed;
  await expect.poll(async () => { agent.send({ id: "revoked", name: "list_panel_sessions", args: {} }); return (await agent.next()).result.length; }).toBe(2);
});
it("rejects websites, unregistered Firefox UUIDs and permanent-ID claims at the socket boundary", async () => {
  const { port } = await fixture();
  for (const origin of ["https://example.org", "null", "moz-extension://lightstreamer-workbench@imom39a", "moz-extension://aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", firefoxA + "/", chromeOrigin + ".evil"]) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/workbench`, { headers: { Origin: origin } }); cleanups.push(() => socket.terminate());
    const opened = vi.fn(); socket.on("open", opened); socket.on("error", () => undefined); await new Promise<void>(r => socket.once("close", () => r())); expect(opened).not.toHaveBeenCalled();
  }
});
it("bounds profile files and rejects removed or corrupt mappings after cache expiry", async () => {
  const { root, resolver } = await fixture(); await resolver();
  await writeFile(join(root, "Profiles", "a", "prefs.js"), " ".repeat(2 * 1024 * 1024 + 1));
  await writeFile(join(root, "Profiles", "b", "prefs.js"), "invalid");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 2000);
  expect(await resolver()).toEqual(new Set());
});
it("preserves old Chrome identity compatibility while requiring explicit Firefox companion support", () => {
  const old = { identityVersion: 1, extensionId: chromeId, companionVersion: "0.1.7", protocolVersion: AGENT_PROTOCOL_VERSION, readContractVersion: AGENT_READ_CONTRACT.version };
  expect(assertCompanionIdentity(old, chromeId)).toEqual(old);
  expect(() => assertCompanionIdentity(old, FIREFOX_EXTENSION_ID)).toThrow("does not support this Firefox");
  expect(assertCompanionIdentity({ ...old, firefoxExtensionId: FIREFOX_EXTENSION_ID }, FIREFOX_EXTENSION_ID).firefoxExtensionId).toBe(FIREFOX_EXTENSION_ID);
});
