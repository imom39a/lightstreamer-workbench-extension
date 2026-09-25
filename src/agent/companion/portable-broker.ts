import { createServer } from "node:http";
import { createConnection } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { AGENT_MAX_BYTES } from "../protocol";
import { parsePairingCode, pairingProof, proofText, randomNonce, verifyPairingProof, createPairingKey, derivePairingSecret, pairingCommitment, pairingTranscript, comparisonCode, PAIRING_LIFETIME_MS } from "../pairing";
import { connectPortable } from "../portable-channel";
import { createBrokerRouter } from "./router";
import type { Message } from "./ipc";

/** Loopback only. No HTTP tool endpoint, remote address, filesystem credential or native host. */
export async function startPortableBroker(code: string, extensionId: string) {
  const { port, secret } = parsePairingCode(code);
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Expected the exact 32-character Chrome extension id.");
  const origin = `chrome-extension://${extensionId}`;
  type PendingPairing = { requestId: string; code: string; expiresAt: number; panelApproved: boolean; confirm(): Promise<void> };
  const pairingRequests = new Map<string, PendingPairing>();
  const router = createBrokerRouter({
    list: () => [...pairingRequests.values()].filter(value => value.expiresAt > Date.now()).map(({ confirm: _confirm, ...value }) => value),
    async confirm(args) {
      const request = pairingRequests.get(String(args.requestId));
      if (!request || request.expiresAt <= Date.now()) throw new Error("Pairing request expired or disconnected. Start a new connection in Workbench.");
      if (args.code !== request.code) throw new Error("Comparison code does not match this request.");
      if (!request.panelApproved) throw new Error("The user must compare the code and click Approve in Workbench first.");
      pairingRequests.delete(request.requestId); await request.confirm();
      return { confirmed: true, requestId: request.requestId };
    }
  });
  const server = createServer((_request, response) => { response.writeHead(404, { Connection: "close" }); response.end(); });
  server.headersTimeout = 5000; server.requestTimeout = 5000;
  server.maxConnections = 64;
  const wss = new WebSocketServer({ noServer: true, maxPayload: AGENT_MAX_BYTES + 4096, perMessageDeflate: false });
  let idle: NodeJS.Timeout | undefined;
  let stopping = false;
  function close() {
    if (stopping) return;
    stopping = true; clearTimeout(idle); router.dispose();
    for (const socket of wss.clients) socket.terminate();
    wss.close(); server.close(); server.closeAllConnections();
  }
  const armIdle = () => { clearTimeout(idle); if (!wss.clients.size && !stopping) idle = setTimeout(close, 30000); };
  server.on("upgrade", (request, socket, head) => {
    // Exact Host prevents DNS rebinding; ordinary website origins never get a handshake.
    if (request.url !== "/workbench" || request.headers.host !== `127.0.0.1:${port}` || (request.headers.origin !== undefined && request.headers.origin !== origin) || wss.clients.size >= 32) {
      socket.destroy(); return;
    }
    wss.handleUpgrade(request, socket, head, peer => wss.emit("connection", peer, request));
  });
  wss.on("connection", (socket, request) => {
    clearTimeout(idle);
    let phase: "challenge" | "authenticate" | "pairing-reveal" | "pairing-approve" | "hello" | "ready" | "closed" = "challenge";
    let role: "agent" | "panel";
    let clientNonce = "";
    const serverNonce = randomNonce();
    let serverKey: Awaited<ReturnType<typeof createPairingKey>> | undefined;
    let commitment = "", panelSecret = "", transcript = "", pairingId: string | undefined;
    let joined: ReturnType<typeof router.join> | undefined;
    let deadline = setTimeout(() => socket.terminate(), 5000);
    const send = (value: Message) => sendPacket(socket, value);
    let chain = Promise.resolve();
    let queuedBytes = 0;
    let queuedMessages = 0;
    socket.on("message", (data, isBinary) => {
      const raw = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
      queuedBytes += raw.length; queuedMessages++;
      if (isBinary || queuedBytes > 2 * (AGENT_MAX_BYTES + 4096) || queuedMessages > 64) { socket.terminate(); return; }
      const text = raw.toString();
      chain = chain.then(async () => {
        queuedBytes -= raw.length; queuedMessages--;
        if (phase === "closed") return;
        const message: unknown = JSON.parse(text);
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid packet.");
        const value = message as Message;
        if (phase === "challenge") {
          role = request.headers.origin === origin ? "panel" : "agent";
          if (role === "panel") {
            if (value.type !== "pairing-start" || typeof value.commitment !== "string" || !/^[a-f0-9]{64}$/.test(value.commitment) || pairingRequests.size >= 8) throw new Error("Invalid or busy pairing request.");
            commitment = value.commitment;
            serverKey = await createPairingKey();
            if ((phase as string) === "closed") return;
            phase = "pairing-reveal"; send({ type: "pairing-key", publicKey: serverKey.publicKey, nonce: serverNonce }); return;
          }
          if (value.type !== "challenge" || value.role !== role || typeof value.nonce !== "string" || !/^[a-f0-9]{64}$/.test(value.nonce)) throw new Error("Invalid challenge.");
          clientNonce = value.nonce;
          const proof = await pairingProof(secret, proofText("server", role, clientNonce, serverNonce));
          if ((phase as string) === "closed") return;
          phase = "authenticate"; send({ type: "challenge", nonce: serverNonce, proof });
        } else if (phase === "pairing-reveal") {
          if (value.type !== "pairing-reveal" || typeof value.publicKey !== "string" || typeof value.nonce !== "string" || await pairingCommitment(value.publicKey, value.nonce) !== commitment || pairingRequests.size >= 8) throw new Error("Pairing commitment changed.");
          panelSecret = await derivePairingSecret(serverKey!.privateKey, value.publicKey);
          transcript = pairingTranscript(port, origin, value.publicKey, value.nonce, serverKey!.publicKey, serverNonce);
          const code = await comparisonCode(panelSecret, transcript);
          const requestId = randomUUID(), expiresAt = Date.now() + PAIRING_LIFETIME_MS;
          const proof = await pairingProof(panelSecret, `pairing-code\n${requestId}\n${expiresAt}\n${transcript}`);
          if ((phase as string) === "closed") return;
          if ([...pairingRequests.values()].some(request => request.code === code)) throw new Error("Comparison code collision. Start a fresh connection.");
          pairingId = requestId;
          pairingRequests.set(requestId, { requestId, code, expiresAt, panelApproved: false, async confirm() {
            const confirmation = await pairingProof(panelSecret, `broker-confirmed\n${transcript}`);
            if (phase !== "pairing-approve" || Date.now() >= expiresAt) throw new Error("Pairing request no longer active.");
            phase = "hello"; clearTimeout(deadline); deadline = setTimeout(() => socket.terminate(), 5000);
            send({ type: "authenticated", proof: confirmation });
          } });
          phase = "pairing-approve"; clearTimeout(deadline); deadline = setTimeout(() => socket.terminate(), PAIRING_LIFETIME_MS);
          send({ type: "pairing-code", requestId, expiresAt, proof });
        } else if (phase === "pairing-approve") {
          if (value.type !== "pairing-approve" || !await verifyPairingProof(panelSecret, `panel-approved\n${transcript}`, value.proof)) throw new Error("Invalid panel approval.");
          const pairing = pairingRequests.get(pairingId!);
          if ((phase as string) === "closed" || !pairing || pairing.expiresAt <= Date.now()) return;
          pairing.panelApproved = true;
          send({ type: "pairing-approved" });
        } else if (phase === "authenticate") {
          if (value.type !== "authenticate" || !await verifyPairingProof(secret, proofText("client", role, clientNonce, serverNonce), value.proof)) throw new Error("Pairing rejected.");
          if ((phase as string) === "closed") return;
          phase = "hello"; send({ type: "authenticated" });
        } else if (phase === "hello") {
          if (value.role !== role) throw new Error("Invalid role.");
          joined = router.join({ send, close: () => socket.terminate() }, { ...value, extensionOrigin: role === "panel" ? origin : undefined });
          phase = "ready"; clearTimeout(deadline);
        } else joined!.receive(value);
      }).catch(() => socket.terminate());
    });
    socket.on("error", () => {});
    socket.on("close", () => { phase = "closed"; clearTimeout(deadline); if (pairingId) pairingRequests.delete(pairingId); joined?.close(); armIdle(); });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve); });
  } catch (error) { close(); throw error; }
  armIdle();
  return { close };
}

function sendPacket(socket: WebSocket, value: Message) {
  const text = JSON.stringify(value);
  if (socket.readyState !== socket.OPEN || Buffer.byteLength(text) > AGENT_MAX_BYTES + 4096 || socket.bufferedAmount > 2 * AGENT_MAX_BYTES) throw new Error("Companion message capacity exceeded.");
  socket.send(text);
}

async function portOccupied(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    const done = (occupied: boolean) => { socket.destroy(); resolve(occupied); };
    socket.once("connect", () => done(true)); socket.once("error", () => done(false)); socket.once("timeout", () => done(true));
  });
}

export async function connectPortableBroker(cli: string, code: string, extensionId: string) {
  const pairing = parsePairingCode(code);
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Expected the exact 32-character Chrome extension id.");
  if (await portOccupied(pairing.port)) return connectPortable(code, "agent");
  // Atomic TCP bind chooses the winner when several MCP clients start concurrently.
  // Credentials use an anonymous pipe, not command arguments or a persistent token file.
  const child = spawn(process.execPath, [cli, "portable-broker", "--extension-id", extensionId], { detached: true, windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  let startupError: Error | undefined;
  child.on("error", error => { startupError = error; });
  child.stdin.on("error", () => {}); child.stdin.end(code); child.unref();
  for (let attempt = 0; attempt < 50; attempt++) {
    if (startupError) throw new Error("The portable companion could not start. Check the Node executable and package path.");
    if (await portOccupied(pairing.port)) return connectPortable(code, "agent");
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("The portable companion could not start. Choose a free setup port and check local security policy.");
}
