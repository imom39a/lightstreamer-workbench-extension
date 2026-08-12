import assert from "node:assert/strict";

import {
  type CdpRequestClient,
  findWorkbenchServiceWorkerTarget,
  waitForNewLoadedDocument,
  type ExtensionManifest
} from "./chrome-extension-cdp";

const workbenchManifest: ExtensionManifest = {
  manifest_version: 3,
  name: "Lightstreamer Workbench",
  version: "2.0.0",
  devtools_page: "devtools.html",
  background: { service_worker: "extension/background.js", type: "module" },
  content_scripts: [
    { matches: ["<all_urls>"], js: ["injected/lightstreamer-instrumentation.js"] },
    { matches: ["<all_urls>"], js: ["content/content-script.js"] }
  ]
};

test("discovers Workbench when Chrome reports the generic service_worker.js target", async () => {
  const workbenchTarget = {
    type: "service_worker",
    url: "chrome-extension://workbench/service_worker.js",
    webSocketDebuggerUrl: "ws://workbench"
  };
  const unrelatedTarget = {
    type: "service_worker",
    url: "chrome-extension://unrelated/background.html",
    webSocketDebuggerUrl: "ws://unrelated"
  };
  const connectedTargets: string[] = [];

  const discovered = await findWorkbenchServiceWorkerTarget(
    [unrelatedTarget, workbenchTarget],
    workbenchManifest,
    {
      connect: async (url) => {
        connectedTargets.push(url);
        return { targetUrl: url, request: async () => ({}), close: () => undefined };
      },
      evaluateByValue: async <T>(_cdp: CdpRequestClient, expression: string): Promise<T> => {
        assert.match(expression, /chrome\.runtime\.getManifest/);
        const targetUrl = (_cdp as unknown as { targetUrl: string }).targetUrl;
        return (targetUrl === "ws://unrelated"
          ? { name: "Unrelated extension", version: "1.0.0" }
          : {
              ...workbenchManifest,
              background: { service_worker: "service_worker.js", type: "module" },
              content_scripts: [
                { js: ["injected/lightstreamer-instrumentation.js"], matches: ["<all_urls>"] },
                { js: ["content/content-script.js"], matches: ["<all_urls>"] }
              ]
            }) as T;
      }
    }
  );

  assert.deepEqual(discovered, workbenchTarget);
  assert.deepEqual(connectedTargets, ["ws://unrelated", "ws://workbench"]);
});

test("does not treat an unrelated extension service worker as Workbench", async () => {
  const unrelatedTarget = {
    type: "service_worker",
    url: "chrome-extension://unrelated/service_worker.js",
    webSocketDebuggerUrl: "ws://unrelated"
  };

  const discovered = await findWorkbenchServiceWorkerTarget(
    [unrelatedTarget],
    workbenchManifest,
    {
      connect: async () => ({ request: async () => ({}), close: () => undefined }),
      evaluateByValue: async <T>(): Promise<T> =>
        ({
          manifest_version: 3,
          name: "Unrelated extension",
          version: "1.0.0",
          devtools_page: "devtools.html",
          background: { service_worker: "service_worker.js" }
        }) as T
    }
  );

  assert.equal(discovered, null);
});

test("waits for a new main-frame document before accepting page readiness", async () => {
  const listeners = new Map<string, (params: unknown) => void>();
  const requests: string[] = [];
  let newDocumentObserved = false;
  const cdp = {
    on(method: string, listener: (params: unknown) => void) {
      listeners.set(method, listener);
      return () => listeners.delete(method);
    },
    async request(method: string) {
      requests.push(method);
      if (method === "Page.reload") {
        setTimeout(() => {
          newDocumentObserved = true;
          listeners.get("Page.frameNavigated")?.({
            frame: { id: "main", url: "http://fixture.test/", loaderId: "new-loader" }
          });
        }, 20);
      }
      return method === "Runtime.evaluate" ? { result: { value: true } } : {};
    }
  } as unknown as CdpRequestClient & {
    on(method: string, listener: (params: unknown) => void): () => void;
  };

  await waitForNewLoadedDocument(cdp, {
    url: "http://fixture.test/",
    readyExpression: "document.readyState === 'complete'"
  });

  assert.equal(newDocumentObserved, true);
  assert.deepEqual(requests.slice(0, 3), ["Page.enable", "Runtime.enable", "Page.reload"]);
});
