import { createConnection, type Socket } from "node:net";
import { mkdir, lstat, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { lstatSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { AGENT_MAX_BYTES } from "../protocol";

export type Message = Record<string, unknown>;
export async function endpoint(directory?: string) {
  if (process.platform === "win32") throw new Error("The native companion currently supports macOS and Linux.");
  const root = directory ?? join(tmpdir(), `lightstreamer-workbench-agent-${process.getuid!()}`);
  await mkdir(root, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) throw new Error("Companion directory must be a private, user-owned directory.");
  const tokenPath = join(root, "access-token");
  try { await writeFile(tokenPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const tokenStat = await lstat(tokenPath);
  if (!tokenStat.isFile() || tokenStat.isSymbolicLink() || tokenStat.uid !== process.getuid!() || (tokenStat.mode & 0o077)) throw new Error("Companion token is not private.");
  let token = await readFile(tokenPath, "utf8");
  // Another process can observe the exclusive file between creation and write.
  for (let attempt = 0; token.length === 0 && attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 20)); token = await readFile(tokenPath, "utf8");
  }
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid companion access token.");
  return { root, path: join(root, "broker.sock"), token };
}

export function messages(socket: Socket, receive: (message: Message) => void) {
  let buffer = Buffer.alloc(0);
  socket.on("data", (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);
    let index: number;
    while ((index = buffer.indexOf(10)) >= 0) {
      if (index > AGENT_MAX_BYTES + 4096) { socket.destroy(); return; }
      const line = buffer.subarray(0, index); buffer = buffer.subarray(index + 1);
      try {
        const value: unknown = JSON.parse(line.toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid packet.");
        receive(value as Message);
      } catch { socket.destroy(); return; }
    }
    if (buffer.length > AGENT_MAX_BYTES + 4096) socket.destroy();
  });
}
export function send(socket: Socket, value: unknown) {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > AGENT_MAX_BYTES + 4096 || socket.writableLength > 2 * AGENT_MAX_BYTES) throw new Error("Companion message capacity exceeded.");
  socket.write(encoded + "\n");
}
export async function connectBroker(cliPath: string, directory?: string): Promise<{ socket: Socket; token: string }> {
  const location = await endpoint(directory);
  const connect = () => new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(location.path);
    socket.once("connect", () => { socket.removeListener("error", reject); socket.on("error", () => {}); resolve(socket); });
    socket.once("error", reject);
  });
  try { return { socket: await connect(), token: location.token }; } catch (error) {
    if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
  const lockPath = join(location.root, "startup.lock");
  for (let attempt = 0; attempt < 60; attempt++) {
    const release = acquireStartupLock(lockPath);
    if (release) {
      try {
        try { return { socket: await connect(), token: location.token }; } catch (error) {
          if (!["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
        // Only the serialized startup owner removes an unconnectable, user-owned socket.
        try {
          const stat = lstatSync(location.path);
          if (!stat.isSocket() || stat.uid !== process.getuid!()) throw new Error("Companion endpoint is not a user-owned socket.");
          unlinkSync(location.path);
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        const child = spawn(process.execPath, [cliPath, "broker", ...(directory ? ["--directory", directory] : [])], { detached: true, stdio: "ignore" });
        let startupError: Error | undefined;
        child.on("error", error => { startupError = error; }); child.unref();
        for (let startup = 0; startup < 50; startup++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (startupError) throw startupError;
          try { return { socket: await connect(), token: location.token }; } catch { /* startup in progress */ }
        }
        throw new Error("Local companion could not start. Verify this package's Node executable and installed path.");
      } finally { release(); }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    try { return { socket: await connect(), token: location.token }; } catch { /* another starter holds the lock */ }
  }
  throw new Error("Local companion startup is busy. Try again after the existing startup settles.");
}
export async function privateSocket(path: string) { await chmod(path, 0o600); }

function acquireStartupLock(path: string): (() => void) | null {
  try {
    writeFileSync(path, String(process.pid), { flag: "wx", mode: 0o600 });
    const identity = lstatSync(path);
    return () => { try { if (lstatSync(path).ino === identity.ino) unlinkSync(path); } catch { /* already removed */ } };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) throw new Error("Companion startup lock is not private.");
      const pid = Number(readFileSync(path, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0); }
        catch (failure) { if ((failure as NodeJS.ErrnoException).code === "ESRCH" && lstatSync(path).ino === stat.ino) unlinkSync(path); }
      } else if (Date.now() - stat.mtimeMs > 30_000 && lstatSync(path).ino === stat.ino) unlinkSync(path);
    } catch (failure) { if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure; }
    return null;
  }
}
