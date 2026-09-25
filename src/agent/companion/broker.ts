import { createServer, type Socket } from "node:net";
import { unlink, lstat } from "node:fs/promises";
import { endpoint, messages, privateSocket, send } from "./ipc";
import { createBrokerRouter } from "./router";

export async function startBroker(directory?: string) {
  const location = await endpoint(directory);
  const router = createBrokerRouter();
  const connections = new Set<Socket>();
  let idle: NodeJS.Timeout | undefined;
  const server = createServer(socket => {
    clearTimeout(idle); connections.add(socket);
    let joined: ReturnType<typeof router.join> | undefined;
    const helloTimeout = setTimeout(() => socket.destroy(), 5000);
    socket.on("error", () => {});
    messages(socket, message => {
      if (!joined) {
        if (message.token !== location.token) { socket.destroy(); return; }
        joined = router.join({ send: value => send(socket, value), close: () => socket.destroy() }, message);
        clearTimeout(helloTimeout);
      } else joined.receive(message);
    });
    socket.on("close", () => {
      clearTimeout(helloTimeout); connections.delete(socket); joined?.close();
      if (!connections.size) idle = setTimeout(() => server.close(), 30000);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(location.path, resolve); });
  await privateSocket(location.path);
  const socketIdentity = await lstat(location.path);
  server.on("close", () => {
    router.dispose();
    void lstat(location.path).then(stat => { if (stat.ino === socketIdentity.ino) return unlink(location.path); }).catch(() => {});
  });
  idle = setTimeout(() => { if (!connections.size) server.close(); }, 30000);
  return { close: () => { clearTimeout(idle); router.dispose(); for (const socket of connections) socket.destroy(); server.close(); } };
}
