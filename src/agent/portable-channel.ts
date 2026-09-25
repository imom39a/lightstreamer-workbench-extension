import { AGENT_MAX_BYTES } from "./protocol";
import { parsePairingCode, pairingProof, proofText, randomNonce, verifyPairingProof } from "./pairing";

export interface CompanionChannel {
  send(value: Record<string, unknown>): void;
  onMessage(callback: (value: Record<string, unknown>) => void): void;
  onClose(callback: () => void): void;
  close(): void;
}

/** Agent credential authentication. Panels use the separate comparison/approval handshake. */
export function connectPortable(code: string, role: "agent"): Promise<CompanionChannel> {
  const pairing = parsePairingCode(code);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${pairing.port}/workbench`);
    const clientNonce = randomNonce();
    const readers = new Set<(message: Record<string, unknown>) => void>();
    const closed = new Set<() => void>();
    let phase: "challenge" | "authenticate" | "ready" | "closed" = "challenge";
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
    const timer = setTimeout(() => fail("Companion authentication timed out. Check the running MCP server and its connection configuration."), 5000);
    socket.addEventListener("open", () => {
      if (phase !== "closed") send({ type: "challenge", role, nonce: clientNonce });
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
        if (phase === "challenge") {
          if (value.type !== "challenge" || typeof value.nonce !== "string" || !/^[a-f0-9]{64}$/.test(value.nonce) || !await verifyPairingProof(pairing.secret, proofText("server", role, clientNonce, value.nonce), value.proof)) throw new Error("Companion identity could not be verified. Check the MCP connection configuration.");
          const proof = await pairingProof(pairing.secret, proofText("client", role, clientNonce, value.nonce));
          if ((phase as string) === "closed") return;
          phase = "authenticate"; send({ type: "authenticate", proof });
        } else if (phase === "authenticate") {
          if (value.type !== "authenticated") throw new Error("Companion authentication was rejected.");
          clearTimeout(timer); phase = "ready";
          resolve({ send, onMessage: callback => { readers.add(callback); }, onClose: callback => { closed.add(callback); }, close: () => fail() });
        } else readers.forEach(callback => callback(value));
      }).catch(() => fail("Companion authentication or protocol failed. Check the MCP connection configuration; no connection was retained."));
    });
    socket.addEventListener("error", () => fail());
    socket.addEventListener("close", () => fail());
  });
}
