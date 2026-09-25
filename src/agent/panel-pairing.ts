import { AGENT_MAX_BYTES } from "./protocol";
import { createPairingKey, derivePairingSecret, pairingCommitment, pairingTranscript, comparisonCode, pairingProof, randomNonce, verifyPairingProof, PAIRING_LIFETIME_MS } from "./pairing";
import type { CompanionChannel } from "./portable-channel";

export type PairingDisplay = Readonly<{ requestId: string; code: string; expiresAt: number }>;
export interface PanelPairing {
  ready: Promise<CompanionChannel>;
  approve(): void;
  close(): void;
}

/** Fresh committed ECDH keys bind the comparison code to this exact socket attempt. */
export function beginPanelPairing(port: number, origin: string, showCode: (value: PairingDisplay) => void): PanelPairing {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) throw new Error("Invalid standalone companion connection.");
  const socket = new WebSocket(`ws://127.0.0.1:${port}/workbench`);
  const readers = new Set<(message: Record<string, unknown>) => void>();
  const closed = new Set<() => void>();
  let resolve!: (channel: CompanionChannel) => void, reject!: (error: Error) => void;
  const ready = new Promise<CompanionChannel>((done, failed) => { resolve = done; reject = failed; });
  let phase: "key" | "code" | "approval" | "confirmed" | "ready" | "closed" = "key";
  let secret = "", transcript = "";
  const nonce = randomNonce(), keys = createPairingKey();
  let timer = setTimeout(close, 5000);
  function send(value: Record<string, unknown>) {
    const text = JSON.stringify(value);
    if (socket.readyState !== WebSocket.OPEN || new TextEncoder().encode(text).length > AGENT_MAX_BYTES + 4096 || socket.bufferedAmount > 2 * AGENT_MAX_BYTES) throw new Error("Companion unavailable or at capacity.");
    socket.send(text);
  }
  function close() {
    if (phase === "closed") return;
    phase = "closed"; clearTimeout(timer); socket.close();
    reject(new Error("Pairing expired, was cancelled, or the companion disconnected.")); closed.forEach(callback => callback());
  }
  socket.addEventListener("open", () => {
    void keys.then(async key => {
      const commitment = await pairingCommitment(key.publicKey, nonce);
      if (phase === "key") send({ type: "pairing-start", commitment });
    }).catch(close);
  });
  let chain = Promise.resolve(), queuedBytes = 0, queuedMessages = 0;
  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") { close(); return; }
    const text = event.data, bytes = new TextEncoder().encode(text).length;
    queuedBytes += bytes; queuedMessages++;
    if (bytes > AGENT_MAX_BYTES + 4096 || queuedBytes > 2 * (AGENT_MAX_BYTES + 4096) || queuedMessages > 64) { close(); return; }
    chain = chain.then(async () => {
      queuedBytes -= bytes; queuedMessages--;
      if (phase === "closed") return;
      const value = JSON.parse(text) as Record<string, unknown>;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid packet.");
      if (phase === "key") {
        if (value.type !== "pairing-key" || typeof value.publicKey !== "string" || typeof value.nonce !== "string" || !/^[a-f0-9]{64}$/.test(value.nonce)) throw new Error("Invalid pairing key.");
        const key = await keys;
        secret = await derivePairingSecret(key.privateKey, value.publicKey);
        transcript = pairingTranscript(port, origin, key.publicKey, nonce, value.publicKey, value.nonce);
        if ((phase as string) === "closed") return;
        phase = "code"; send({ type: "pairing-reveal", publicKey: key.publicKey, nonce });
      } else if (phase === "code") {
        const { requestId, expiresAt } = value;
        if (value.type !== "pairing-code" || typeof requestId !== "string" || requestId.length > 64 || typeof expiresAt !== "number" || expiresAt <= Date.now() || expiresAt > Date.now() + PAIRING_LIFETIME_MS + 5000 || !await verifyPairingProof(secret, `pairing-code\n${requestId}\n${expiresAt}\n${transcript}`, value.proof)) throw new Error("Invalid pairing request.");
        const code = await comparisonCode(secret, transcript);
        if ((phase as string) === "closed") return;
        phase = "approval"; clearTimeout(timer); timer = setTimeout(close, Math.min(PAIRING_LIFETIME_MS, expiresAt - Date.now()));
        showCode({ requestId, code, expiresAt });
      } else if (phase === "confirmed") {
        if (value.type === "pairing-approved") return;
        if (value.type !== "authenticated" || !await verifyPairingProof(secret, `broker-confirmed\n${transcript}`, value.proof)) throw new Error("Pairing confirmation failed.");
        if ((phase as string) === "closed") return;
        phase = "ready"; clearTimeout(timer);
        resolve({ send, onMessage: callback => { readers.add(callback); }, onClose: callback => { closed.add(callback); }, close });
      } else if (phase === "ready") readers.forEach(callback => callback(value));
      else throw new Error("Pairing requires explicit approval.");
    }).catch(close);
  });
  socket.addEventListener("error", close); socket.addEventListener("close", close);
  return { ready, close, approve() {
    if (phase !== "approval") return;
    phase = "confirmed";
    void pairingProof(secret, `panel-approved\n${transcript}`).then(proof => { if (phase === "confirmed") send({ type: "pairing-approve", proof }); }).catch(close);
  } };
}
