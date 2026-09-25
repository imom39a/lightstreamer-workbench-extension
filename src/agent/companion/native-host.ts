import { AGENT_MAX_BYTES } from "../protocol";
import { connectBroker, messages, send, type Message } from "./ipc";

export function nativeDecoder(receive: (message: Message) => void) {
  let buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length === 0 || length > AGENT_MAX_BYTES + 4096) throw new Error("Native message exceeds capacity.");
      if (buffer.length < length + 4) return;
      const value: unknown = JSON.parse(buffer.subarray(4, length + 4).toString("utf8"));
      buffer = buffer.subarray(length + 4);
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid native message.");
      receive(value as Message);
    }
  };
}
export function nativeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  if (body.length > AGENT_MAX_BYTES + 4096) throw new Error("Native response exceeds capacity.");
  const frame = Buffer.alloc(body.length + 4); frame.writeUInt32LE(body.length); body.copy(frame, 4); return frame;
}
export async function runNativeHost(cli: string, origin: string, directory?: string) {
  if (!/^chrome-extension:\/\/[a-p]{32}\/$/.test(origin)) throw new Error("Native host requires Chrome's extension origin.");
  const { socket, token } = await connectBroker(cli, directory);
  let hello = false;
  messages(socket, message => {
    if (process.stdout.writableLength > 2 * AGENT_MAX_BYTES) { socket.destroy(); return; }
    process.stdout.write(nativeFrame(message));
  });
  socket.on("close", () => process.exit(0));
  const decode = nativeDecoder(message => {
    if (!hello) {
      if (message.type !== "hello") throw new Error("Expected Panel Session registration.");
      hello = true;
      send(socket, { ...message, role: "panel", token, extensionOrigin: origin });
    } else send(socket, message);
  });
  process.stdin.on("data", (chunk: Buffer) => { try { decode(chunk); } catch { socket.destroy(); } });
  process.stdin.on("end", () => socket.end());
}
