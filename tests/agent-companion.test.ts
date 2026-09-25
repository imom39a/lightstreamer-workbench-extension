// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import { nativeDecoder, nativeFrame } from "../src/agent/companion/native-host";
import { startBroker } from "../src/agent/companion/broker";
import { endpoint, messages, send, type Message } from "../src/agent/companion/ipc";
import { install } from "../src/agent/companion/installer";
import { build } from "esbuild";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const cleanups: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function temporary() { const path = await mkdtemp(join(tmpdir(), "lsew-agent-test-")); cleanups.push(() => rm(path, { recursive: true, force: true })); return path; }
async function client(path: string) {
  const socket = createConnection(path); cleanups.push(() => { socket.destroy(); });
  await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
  const queue: Message[] = []; const readers: Array<(message: Message) => void> = [];
  messages(socket, message => { const reader = readers.shift(); if (reader) reader(message); else queue.push(message); });
  return { socket, next: () => queue.length ? Promise.resolve(queue.shift()!) : new Promise<Message>(resolve => readers.push(resolve)) };
}
describe("local companion", () => {
  it.skipIf(process.platform === "win32")("initializes a real stdio MCP client and routes a tool through the companion", async () => {
    const directory = await temporary(); const cli = join(directory, "cli.mjs");
    await build({ entryPoints: [new URL("../src/agent/companion/cli.ts", import.meta.url).pathname], outfile: cli, bundle: true, platform: "node", format: "esm", target: "node22", banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
    const location = await endpoint(directory);
    const broker = await startBroker(directory); cleanups.push(() => broker.close());
    const panel = await client(location.path);
    send(panel.socket, { role: "panel", token: location.token, protocolVersion: 1, panelSessionId: "stdio-panel", permission: "read" }); await panel.next();
    const mcp = new Client({ name: "agent-test", version: "1" });
    await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [cli, "mcp", "--transport", "native", "--directory", directory], stderr: "pipe" }));
    cleanups.push(() => mcp.close());
    expect((await mcp.listTools()).tools.map(tool => tool.name)).toContain("prepare_scenario");
    const listed = await mcp.callTool({ name: "list_panel_sessions", arguments: {} });
    expect(JSON.stringify(listed)).toContain("stdio-panel");
    const reply = mcp.callTool({ name: "get_status", arguments: { panelSessionId: "stdio-panel" } });
    const request = await panel.next(); send(panel.socket, { id: request.id, result: { pageEpoch: "test-page" } });
    expect(JSON.stringify(await reply)).toContain("test-page");
    expect((await mcp.callTool({ name: "get_status", arguments: { panelSessionId: "missing" } })).isError).toBe(true);
  });
  it("decodes split/multiple native frames and refuses oversized frames", () => {
    const received: Message[] = []; const decode = nativeDecoder(value => received.push(value));
    const frames = Buffer.concat([nativeFrame({ unicode: "こんにちは" }), nativeFrame({ id: "two" })]);
    for (const byte of frames) decode(Buffer.from([byte]));
    expect(received).toEqual([{ unicode: "こんにちは" }, { id: "two" }]);
    const length = Buffer.alloc(4); length.writeUInt32LE(2 ** 30);
    expect(() => decode(length)).toThrow("capacity");
  });
  it.skipIf(process.platform === "win32")("routes concurrent agents to exact panels and rejects spoofed replies", async () => {
    const directory = await temporary(); const location = await endpoint(directory);
    const broker = await startBroker(directory); cleanups.push(() => broker.close());
    const a = await client(location.path), b = await client(location.path), panel = await client(location.path), other = await client(location.path);
    const intruder = await client(location.path);
    const rejected = once(intruder.socket, "close");
    send(intruder.socket, { role: "agent", token: "not-authorized" }); await rejected;
    for (const agent of [a, b]) { send(agent.socket, { role: "agent", token: location.token }); await agent.next(); }
    for (const [peer, id] of [[panel, "panel-1"], [other, "panel-2"]] as const) { send(peer.socket, { role: "panel", token: location.token, protocolVersion: 1, panelSessionId: id, permission: "read" }); await peer.next(); }
    send(a.socket, { id: "list", name: "list_panel_sessions", args: {} });
    expect((await a.next()).result).toHaveLength(2);
    send(a.socket, { id: "same-id", name: "get_status", args: { panelSessionId: "panel-1" } });
    send(b.socket, { id: "same-id", name: "get_status", args: { panelSessionId: "panel-2" } });
    const first = await panel.next(), second = await other.next();
    expect(first.id).not.toBe(second.id);
    send(other.socket, { id: first.id, result: "spoof" });
    send(panel.socket, { id: first.id, result: "one" });
    send(other.socket, { id: second.id, result: "two" });
    expect((await a.next()).result).toBe("one"); expect((await b.next()).result).toBe("two");
    send(a.socket, { id: "bad", name: "execute_server_injection", args: { panelSessionId: "panel-1" } });
    expect((await a.next()).error).toMatch("Unknown");
  });
  it.skipIf(process.platform === "win32")("installs a correctly quoted host launcher for a chosen extension id", async () => {
    const home = await temporary();
    const paths = await install("/a path/with ' quote/cli.mjs", "a".repeat(32), "chrome", home);
    expect(JSON.parse(await readFile(paths.manifest, "utf8")).allowed_origins).toEqual([`chrome-extension://${"a".repeat(32)}/`]);
    expect(await readFile(paths.launcher, "utf8")).toContain("'\\''");
    expect(await readFile(paths.launcher, "utf8")).toContain('host "$@"');
    const untouched = join(home, "untouched"); await writeFile(untouched, "do not overwrite");
    await unlink(paths.launcher); await symlink(untouched, paths.launcher);
    await expect(install("/new/cli.mjs", "a".repeat(32), "chrome", home)).rejects.toThrow("non-regular");
    expect(await readFile(untouched, "utf8")).toBe("do not overwrite");
  });
});
