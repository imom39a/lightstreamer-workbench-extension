import { AGENT_MAX_BYTES } from "./protocol";
import { pairingProof, proofText, randomNonce, verifyPairingProof } from "./pairing";
import { portableConfig, type PortableConfig } from "./portable-config";
import { assertCompanionIdentity, type CompanionIdentity } from "./companion-identity";

export interface CompanionChannel {
  readonly identity?: CompanionIdentity;
  send(value: Record<string, unknown>): void;
  onMessage(callback: (value: Record<string, unknown>) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

/** Direct loopback connection, or agent authentication when explicitly configured. */
export async function connectPortable(config: PortableConfig, role: "agent" | "panel", expected?: { extensionId: string }): Promise<CompanionChannel> {
  const pairing = portableConfig(config);
  if (role === "panel" && pairing.auth === "required") throw new Error("Authenticated panels must use comparison-code approval.");
  if (expected && !/^[a-p]{32}$/.test(expected.extensionId)) throw new Error("Expected the exact 32-character Chrome extension id.");
  if (role === "panel" && expected) {
    // Preflight keeps the strict WebSocket Origin boundary while explaining a mismatch.
    const response = await fetch(`http://127.0.0.1:${pairing.port}/identity`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!response.ok) assertCompanionIdentity(null, expected.extensionId);
    const reader = response.body?.getReader();
    if (!reader) assertCompanionIdentity(null, expected.extensionId);
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader!.read();
        if (done) break;
        length += value.length;
        if (length > 1024) { await reader!.cancel(); assertCompanionIdentity(null, expected.extensionId); }
        chunks.push(value);
      }
    } finally { reader!.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const content = new TextDecoder().decode(bytes);
    let identity: unknown;
    try { identity = JSON.parse(content); } catch { assertCompanionIdentity(null, expected.extensionId); }
    assertCompanionIdentity(identity, expected.extensionId);
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${pairing.port}/workbench`);
    const clientNonce = randomNonce();
    const readers = new Set<(message: Record<string, unknown>) => void>();
    const closed = new Set<() => void>();
    let phase: "direct" | "challenge" | "authenticate" | "ready" | "closed" = pairing.auth === "off" ? "direct" : "challenge";
    let identity: CompanionIdentity | undefined;
    const channel = (): CompanionChannel => ({ identity, send, onMessage: callback => { readers.add(callback); },
      onClose: callback => { closed.add(callback); }, close: () => fail() });
    const send = (value: Record<string, unknown>) => {
      const text = JSON.stringify(value);
      if (socket.readyState !== WebSocket.OPEN || new TextEncoder().encode(text).length > AGENT_MAX_BYTES + 4096 || socket.bufferedAmount > 2 * AGENT_MAX_BYTES) throw new Error("Companion connection unavailable or at capacity.");
      socket.send(text);
    };
    function fail(message = "Portable companion unavailable. Start the MCP server and check its connection configuration.") {
      if (phase === "closed") return;
      phase = "closed"; clearTimeout(timer); reject(new Error(message));
      socket.close(); closed.forEach(callback => callback());
    }
    const timer = setTimeout(() => fail("Companion connection timed out. Check the running MCP server and its authentication mode."), 5000);
    socket.addEventListener("open", () => {
      if (phase !== "closed") send(pairing.auth === "off" ? { type: "connect", auth: "off", role } : { type: "challenge", role, nonce: clientNonce });
    });
    let chain = Promise.resolve();
    let queuedBytes = 0;
    let queuedMessages = 0;
    socket.addEventListener("message", event => {
      // Serialize asynchronous proof verification before accepting any application message.
      if (typeof event.data !== "string") { fail(); return; }
      const bytes = new TextEncoder().encode(event.data).length;
      queuedBytes += bytes; queuedMessages++;
      if (bytes > AGENT_MAX_BYTES + 4096 || queuedBytes > 2 * (AGENT_MAX_BYTES + 4096) || queuedMessages > 64) { fail(); return; }
      const data: string = event.data;
      chain = chain.then(async () => {
        queuedBytes -= bytes; queuedMessages--;
        if (phase === "closed") return;
        const message: unknown = JSON.parse(data);
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid companion packet.");
        const value = message as Record<string, unknown>;
        if (phase === "direct") {
          if (value.type !== "connected" || value.auth !== "off") throw new Error("Companion authentication mode does not match.");
          if (expected) identity = assertCompanionIdentity(value.identity, expected.extensionId);
          clearTimeout(timer); phase = "ready";
          resolve(channel());
        } else if (phase === "challenge") {
          if (value.type !== "challenge" || typeof value.nonce !== "string" || !/^[a-f0-9]{64}$/.test(value.nonce) || !await verifyPairingProof(pairing.secret!, proofText("server", role, clientNonce, value.nonce), value.proof)) throw new Error("Companion identity could not be verified. Check the MCP connection configuration.");
          const proof = await pairingProof(pairing.secret!, proofText("client", role, clientNonce, value.nonce));
          if ((phase as string) === "closed") return;
          phase = "authenticate"; send({ type: "authenticate", proof });
        } else if (phase === "authenticate") {
          if (value.type !== "authenticated") throw new Error("Companion authentication was rejected.");
          if (expected) identity = assertCompanionIdentity(value.identity, expected.extensionId);
          clearTimeout(timer); phase = "ready";
          resolve(channel());
        } else readers.forEach(callback => callback(value));
      }).catch(error => fail(error instanceof Error && error.message.startsWith("COMPANION_INCOMPATIBLE:")
        ? error.message : "Companion authentication or protocol failed. Check the MCP connection configuration; no connection was retained."));
    });
    socket.addEventListener("error", () => fail());
    socket.addEventListener("close", () => fail());
  });
}
