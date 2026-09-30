// @vitest-environment node
import { describe, expect, it } from "vitest";
import { once } from "node:events";
import { WebSocketServer } from "ws";
import { beginPanelPairing, type PanelPairing } from "../src/agent/panel-pairing";
import { createPairingKey, derivePairingSecret, pairingProof, pairingTranscript, randomNonce } from "../src/agent/pairing";
import { AGENT_PROTOCOL_VERSION, AGENT_READ_CONTRACT } from "../src/agent/protocol";

const extensionId = "a".repeat(32), origin = `chrome-extension://${extensionId}`;
const compatible = { identityVersion: 1, extensionId, companionVersion: "0.3.0", protocolVersion: AGENT_PROTOCOL_VERSION, readContractVersion: AGENT_READ_CONTRACT.version };

async function pairingPeer(identity: unknown, validProof = true) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const keys = await createPairingKey(), nonce = randomNonce();
  const packets: any[] = [];
  server.on("connection", socket => {
    let secret = "", transcript = "", chain = Promise.resolve();
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    socket.on("message", raw => {
      chain = chain.then(async () => {
        const packet = JSON.parse(raw.toString()); packets.push(packet);
        if (packet.type === "pairing-start") send({ type: "pairing-key", publicKey: keys.publicKey, nonce });
        else if (packet.type === "pairing-reveal") {
          secret = await derivePairingSecret(keys.privateKey, packet.publicKey);
          transcript = pairingTranscript(port, origin, packet.publicKey, packet.nonce, keys.publicKey, nonce);
          const expiresAt = Date.now() + 120000;
          send({ type: "pairing-code", requestId: "pair", expiresAt, proof: await pairingProof(secret, `pairing-code\npair\n${expiresAt}\n${transcript}`) });
        } else if (packet.type === "pairing-approve") send({ type: "authenticated", ...(identity === undefined ? {} : { identity }), proof: validProof ? await pairingProof(secret, `broker-confirmed\n${transcript}`) : "0".repeat(64) });
      });
    });
  });
  let attempt: PanelPairing;
  attempt = beginPanelPairing(port, origin, () => attempt.approve());
  return { attempt, packets, async close() { attempt.close(); for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}

describe("required panel pairing compatibility before access", () => {
  it("retains verified compatible identity after authentic proof and approval", async () => {
    const peer = await pairingPeer(compatible);
    try {
      const channel = await peer.attempt.ready;
      expect(channel.identity).toEqual(compatible);
      expect(peer.packets.map(packet => packet.type)).toEqual(["pairing-start", "pairing-reveal", "pairing-approve"]);
      expect(peer.packets.every(packet => packet.panelSessionId === undefined && packet.permission === undefined)).toBe(true);
    } finally { await peer.close(); }
  });

  it.each([
    ["absent", undefined],
    ["read contract", { ...compatible, readContractVersion: 999 }],
    ["protocol", { ...compatible, protocolVersion: 999 }],
    ["different extension", { ...compatible, extensionId: "b".repeat(32) }]
  ])("rejects %s metadata with actionable mismatch before exposing a channel", async (_label, identity) => {
    const peer = await pairingPeer(identity);
    try {
      await expect(peer.attempt.ready).rejects.toThrow(/^COMPANION_INCOMPATIBLE:/);
      expect(peer.packets.every(packet => packet.panelSessionId === undefined && packet.permission === undefined)).toBe(true);
    } finally { await peer.close(); }
  });

  it("continues rejecting an unverified proof even when metadata is compatible", async () => {
    const peer = await pairingPeer(compatible, false);
    try { await expect(peer.attempt.ready).rejects.toThrow("Pairing expired"); }
    finally { await peer.close(); }
  });
});
