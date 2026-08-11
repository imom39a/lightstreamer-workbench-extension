import assert from "node:assert/strict";

import {
  type CdpRequestClient,
  findWorkbenchServiceWorkerTarget,
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
