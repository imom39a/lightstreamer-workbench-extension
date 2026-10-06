import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, basename, dirname } from "node:path";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { proveAgentFixture, provePortableInspection, click as clickText } from "../support/workbench-agent-proof";
import { createFirefoxOriginResolver } from "../../src/agent/companion/firefox-origins";
import { type CdpRequestClient, evaluateRequestByValue as evaluate, waitForCondition } from "../support/chrome-extension-cdp";
import { ANALYTICS_CLIENT_KEY, ANALYTICS_SESSION_KEY, ANALYTICS_PREFERENCE_KEY, ANALYTICS_MESSAGE } from "../../src/extension/analytics/events";

const root = process.cwd();
const artifacts = resolve(root, process.env.LSEW_FIREFOX_ARTIFACTS ?? "test-results/firefox");
const registry = resolve(artifacts, "profile-registry");
await mkdir(artifacts, { recursive: true });
const python = process.env.LSEW_FIREFOX_PYTHON ?? resolve(root, ".cache/firefox-tools", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const binary = process.env.LSEW_FIREFOX_BINARY ?? (process.platform === "darwin" ? "/Applications/Firefox.app/Contents/MacOS/firefox" : process.platform === "win32" ? "C:/Program Files/Mozilla Firefox/firefox.exe" : "/usr/bin/firefox");
const driver = spawn(python, [resolve(root, "scripts/firefox-driver.py"), "--binary", binary, "--dist", resolve(root, process.env.LSEW_FIREFOX_DIST ?? "dist-firefox"),
  "--artifacts", artifacts, "--profile-registry", registry, ...(process.env.LSEW_FIREFOX_HEADED === "1" ? ["--headed"] : [])], { stdio: ["pipe", "pipe", "inherit"] });
let sequence = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
createInterface({ input: driver.stdout }).on("line", line => {
  const result = JSON.parse(line), request = pending.get(result.id);
  if (!request) return;
  pending.delete(result.id); clearTimeout(request.timer);
  if (result.error) request.reject(new Error(result.error)); else request.resolve(result.value);
});
driver.on("error", error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); });
driver.on("exit", code => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(`Firefox driver exited (${code})`)); } pending.clear(); });
function command(command: string, values: Record<string, unknown> = {}) {
  const id = ++sequence;
  return new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Firefox test command timed out: ${command}`)); }, 60000);
    pending.set(id, { resolve, reject, timer }); driver.stdin.write(JSON.stringify({ id, command, ...values }) + "\n");
  });
}
function surface(target: string): CdpRequestClient {
  return { async request(method, values = {}) {
    if (method === "Runtime.evaluate") {
      try { return { result: { value: await command("evaluate", { target, expression: values.expression }) } }; }
      catch (error) { return { exceptionDetails: { text: String(error) } }; }
    }
    if (method === "Input.dispatchMouseEvent") return command("mouse", values);
    throw new Error(`Unsupported Firefox proof operation: ${method}`);
  } };
}
async function click(selector: string, target = "devtools_panel") {
  await waitForCondition(surface(target), `Boolean(document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect().width)`, `visible Firefox control ${selector}`);
  const point = await evaluate<{x: number; y: number}>(surface(target), `(async () => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error(${JSON.stringify("Missing control: " + selector)});
    element.scrollIntoView({block:"center",behavior:"instant"});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("Hidden control");
    return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
  })()`);
  await command("mouse", {type: "mousePressed", target, ...point});
  await command("mouse", {type: "mouseReleased", target, ...point});
}
let fixtureServer: ReturnType<typeof createServer> | undefined;
try {
  const started = await command("start");
  console.log(`Testing Firefox ${started.version} in an owned temporary profile.`);
  const extensionOnly = process.env.LSEW_FIREFOX_EXTENSION_ONLY === "1";
  let fixtureUrl = process.env.LSEW_FIREFOX_FIXTURE_URL ?? "http://localhost:8080/mutate-reinject.html?capture=listener&server-injection=1";
  assert.ok(["localhost","127.0.0.1"].includes(new URL(fixtureUrl).hostname),"Firefox automation only operates an owned loopback fixture.");
  if (extensionOnly) {
    fixtureServer = createServer((_request, response) => { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end("<!doctype html><title>Owned Firefox extension fixture</title><h1>Workbench browser proof</h1>"); });
    await new Promise<void>(resolve => fixtureServer!.listen(0, "127.0.0.1", resolve));
    const address = fixtureServer.address();
    assert.ok(address && typeof address === "object");
    fixtureUrl = `http://127.0.0.1:${address.port}/fixture.html`;
  }
  await command("navigate", { url: fixtureUrl });
  const panel = await command("open-panel");
  await command("chrome", { expression: "Services.prefs.savePrefFile(null); return JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'))['lightstreamer-workbench@imom39a'];" }).then(uuid => console.log("Registered Firefox UUID:", uuid));
  assert.match(panel.origin, /^moz-extension:\/\/[a-f0-9-]{36}$/);
  console.log(`Shipped Firefox Workbench ${panel.version}: ${panel.origin}`);
  try {
    if (extensionOnly) {
      // A registered DevTools view can precede the panel's background-port
      // registration. The real topology checkpoint proves that round trip is
      // complete before this fixture emits its one-shot synthetic updates.
      await waitForCondition(surface("devtools_panel"), "document.body.innerText.includes('Coverage USEFUL') && Number((document.querySelector('[data-history-status]')?.textContent ?? '0').split('/')[0].replaceAll(',', '')) > 0", "the owned fixture Panel Session capture handshake and retained checkpoint");
    }
    if (process.env.LSEW_FIREFOX_CONSENT_PROOF === "1") {
      const panelSurface = surface("devtools_panel");
      const permission = () => command("evaluate", {target: "background", expression: "browser.permissions.getAll()"});
      const flags = () => command("evaluate", {target: "background", expression: `(async () => { const local = await chrome.storage.local.get(${JSON.stringify([ANALYTICS_CLIENT_KEY,ANALYTICS_PREFERENCE_KEY])}); const session = await chrome.storage.session.get(${JSON.stringify(ANALYTICS_SESSION_KEY)}); return {client:Boolean(local[${JSON.stringify(ANALYTICS_CLIENT_KEY)}]), session:Boolean(session[${JSON.stringify(ANALYTICS_SESSION_KEY)}]), preference:local[${JSON.stringify(ANALYTICS_PREFERENCE_KEY)}] ?? null}; })()`});
      const settled = (enabled: boolean) => waitForCondition(panelSurface, `(() => { const input=document.querySelector('[aria-label="Share usage analytics"]'); return input && !input.disabled && input.checked === ${enabled} && !input.getAttribute('aria-disabled'); })()`, `loaded and settled analytics ${enabled ? "On" : "Off"}`);
      const toggleSavedAnalytics = async () => {
        // Reopening DevTools replaces its embedded browser. Exercise the real
        // checkbox with trusted Space instead of reusing a pointer source from
        // the destroyed view, whose viewport mapping differs on Windows.
        await command("chrome", {expression:"const e=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.GlobalManager.getExtension('lightstreamer-workbench@imom39a'); [...e.views].find(view=>view.viewType==='devtools_panel').xulBrowser.focus(); return true;"});
        assert.equal(await evaluate(panelSurface,"(() => { const input=document.querySelector('[aria-label=\"Share usage analytics\"]'); input.focus(); return document.activeElement===input; })()"),true);
        await command("key",{key:"SPACE"});
      };
      const reopenWithSavedChoice = async (enabled: boolean) => {
        await command("close-panel"); await command("open-panel");
        await click("button.workbench-react__agent-access");
        await click("details.workbench-react__usage-analytics:not(#workbench-agent-access) summary");
        await settled(enabled);
        const helperOpen=await command("chrome",{expression:"return [...Services.wm.getEnumerator('navigator:browser')].flatMap(win=>[...win.gBrowser.browsers]).some(browser=>browser.currentURI.spec.includes('/extension/analytics-consent/index.html'));"});
        assert.equal(helperOpen,false,"Reopening Workbench preserves the saved choice without a permission prompt.");
        await command("screenshot",{name:enabled?"reopened-analytics-on.png":"reopened-analytics-denied.png"});
      };
      const openConsent = async () => {
        await settled(false);
        await click('[aria-label="Share usage analytics"]');
        let exists = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          exists = await command("chrome", {expression: "return [...Services.wm.getEnumerator('navigator:browser')].flatMap(win => [...win.gBrowser.browsers]).some(browser => browser.currentURI.spec.includes('/extension/analytics-consent/index.html'));"});
          if (exists) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(exists,true,"The existing analytics control opens its consent window.");
        await waitForCondition(surface("consent"), "document.querySelector('#request') !== null", "the Firefox permission window");
      };
      const requestNative = async () => {
        await click("#request", "consent");
        let prompt;
        for (let attempt = 0; attempt < 100; attempt++) {
          prompt = await command("native-prompt");
          if (prompt.state === "open") break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(prompt.state,"open");
        assert.ok(prompt.text.includes("technical and interaction data"));
        assert.deepEqual(prompt.children[0].buttons.map((button: any) => button.label).sort(),["Allow","Deny"]);
        await writeFile(resolve(artifacts,"native-prompt.json"),JSON.stringify(prompt,null,2)+"\n");
      };
      assert.ok(!(await permission()).data_collection.includes("technicalAndInteraction"));
      assert.equal(await command("evaluate",{target:"background",expression:"browser.extension.isAllowedIncognitoAccess()"}),false);
      await click("button.workbench-react__agent-access");
      await click("details.workbench-react__usage-analytics:not(#workbench-agent-access) summary");
      await waitForCondition(surface("devtools_panel"), "!document.querySelector('[aria-label=\"Share usage analytics\"]').disabled", "configured Firefox analytics");
      assert.equal(await evaluate(surface("devtools_panel"), "document.querySelector('[aria-label=\"Share usage analytics\"]').checked"), false);
      if (extensionOnly) {
        await clickText(panelSurface,"button","Clear retained Evidence…");
        await clickText(panelSurface,"button","Clear retained events");
        await waitForCondition(panelSurface,"document.body.innerText.includes('No Evidence in the current Scope.')","cleared empty-history consent fixture");
        await click("button.workbench-react__agent-access");
        await click("details.workbench-react__usage-analytics:not(#workbench-agent-access) summary");
        await command("screenshot",{name:"empty-consent-off.png"});
        await openConsent();
        await command("screenshot",{name:"empty-panel-pending.png"});
        await click("#cancel","consent"); await settled(false);
        await evaluate(surface("page"),`window.postMessage(${JSON.stringify({namespace:"__LSEW_CAPTURE__",version:1,kind:"item-update",timestamp:19000,payload:{client:{id:"consent-client"},subscription:{id:"consent-subscription",mode:"MERGE"},item:{name:"consent-proof",position:1},update:{fields:{value:"sample"},changedFields:{value:"sample"}}}})},"*")`);
        await waitForCondition(panelSurface,"document.body.innerText.includes('Capture RUNNING')","Capture resumes on deterministic fixture evidence");
      }
      if (process.env.LSEW_FIREFOX_VISUAL_PROOF === "1") {
        const matrix: any[] = [];
        const axeSource = await readFile(resolve(root,"node_modules/axe-core/axe.min.js"),"utf8");
        for (const [name,width,height] of [["compact",563,700],["normal",900,700],["shallow",900,320],["wide",1440,900]] as const) {
          const geometry = await command("resize",{width,height});
          assert.equal(geometry.width,width);
          assert.ok(Math.abs(geometry.height-height) <= 4,JSON.stringify(geometry));
          await openConsent();
          if(name === "normal"){
            // Deterministic UI load through the shipped page/content bridge.
            await evaluate(surface("page"),`(() => { for(let index=0;index<500;index++)window.postMessage({namespace:"__LSEW_CAPTURE__",version:1,kind:"item-update",timestamp:20000+index,payload:{client:{id:"consent-volume-client"},subscription:{id:"consent-volume-subscription",mode:"MERGE"},item:{name:"consent-volume-"+index,position:1},update:{fields:{value:"sample-"+index},changedFields:{value:"sample-"+index}}}},"*");return true;})()`);
            await waitForCondition(panelSurface,"(() => { const m=document.body.innerText.match(/(\\d[\\d,]*)\\/(\\d[\\d,]*) Evidence/); return Boolean(m && Number(m[2].replaceAll(',',''))>=500); })()","Capture accepts 500 UI fixture updates while consent is pending");
          }
          await command("screenshot",{name:`${name}-panel-pending.png`});
          const panelA11y=await evaluate<any[]>(panelSurface,`(() => { ${axeSource}\n return axe.run(document).then(result=>result.violations.filter(value=>["serious","critical"].includes(value.impact)).map(value=>({id:value.id,impact:value.impact}))); })()`);
          assert.deepEqual(panelA11y,[]);
          const popup = await command("resize",{target:"consent",width:name === "compact" ? 340 : 520,height:name === "shallow" ? 260 : 390});
          await command("key",{target:"consent",key:"TAB"});
          await waitForCondition(surface("consent"),"(() => { const r=document.activeElement.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()","unobscured native keyboard focus");
          const focus = await evaluate<any>(surface("consent"),`(() => { const element = document.activeElement; const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return {id:element.id,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,outline:s.outlineStyle,overflow:document.documentElement.scrollWidth>innerWidth}; })()`);
          assert.equal(focus.id,"request"); assert.equal(focus.visible,true); assert.equal(focus.outline,"solid"); assert.equal(focus.overflow,false);
          await command("screenshot",{name:`${name}-permission-window.png`,target:"consent"});
          const a11y = await evaluate<any[]>(surface("consent"),`(() => { ${axeSource}\n return axe.run(document).then(result=>result.violations.filter(value=>["serious","critical"].includes(value.impact)).map(value=>({id:value.id,impact:value.impact}))); })()`);
          assert.deepEqual(a11y,[]);
          await command("key",{target:"consent",key:"TAB"});
          assert.equal(await evaluate(surface("consent"),"document.activeElement.id"),"cancel");
          await waitForCondition(surface("consent"),"(() => { const r=document.activeElement.getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight; })()","unobscured cancellation keyboard focus");
          const cancelFocus = await evaluate<any>(surface("consent"),"(() => { const element=document.activeElement; const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return {id:element.id,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth,outline:s.outlineStyle}; })()");
          assert.equal(cancelFocus.visible,true); assert.equal(cancelFocus.outline,"solid");
          await command("screenshot",{name:`${name}-cancel-focus.png`,target:"consent"});
          await command("key",{target:"consent",key:"ENTER"});
          await settled(false);
          assert.equal(await evaluate(panelSurface,"document.activeElement?.getAttribute('aria-label')"),"Share usage analytics");
          matrix.push({name,panel:geometry,popup,focus,cancelFocus,axeSeriousCritical:a11y,panelAxeSeriousCritical:panelA11y,keyboard:"Tab request → Tab cancel → Enter; focus returns to analytics checkbox",...(name==="normal"?{highVolume:"500 deterministic page messages accepted during pending consent"}:{})});
        }
        await command("resize",{width:900,height:700});
        await openConsent();
        await command("forced-colors",{enabled:true});
        await waitForCondition(surface("consent"),"matchMedia('(forced-colors: active)').matches","Firefox forced colors");
        await command("key",{target:"consent",key:"TAB"});
        await command("screenshot",{name:"forced-colors-permission-window.png",target:"consent"});
        await click("#cancel","consent"); await settled(false);
        await waitForCondition(panelSurface,"matchMedia('(forced-colors: active)').matches","Firefox panel forced colors");
        await command("chrome",{expression:"const e=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.GlobalManager.getExtension('lightstreamer-workbench@imom39a'); [...e.views].find(view=>view.viewType==='devtools_panel').xulBrowser.focus(); return true;"});
        await command("key",{key:"TAB"});
        await command("key",{key:"TAB",shift:true});
        const forcedPanelFocus = await evaluate<any>(panelSurface,"(() => { const element=document.activeElement; const r=element.getBoundingClientRect(); const s=getComputedStyle(element); return {forcedColors:matchMedia('(forced-colors: active)').matches,label:element.getAttribute('aria-label'),focusVisible:element.matches(':focus-visible'),outline:s.outlineStyle,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}; })()");
        assert.equal(forcedPanelFocus.label,"Share usage analytics"); assert.equal(forcedPanelFocus.focusVisible,true); assert.equal(forcedPanelFocus.outline,"solid"); assert.equal(forcedPanelFocus.visible,true);
        await command("screenshot",{name:"forced-colors-panel-off.png"});
        await command("forced-colors",{enabled:false});
        await openConsent();
        // Deliberately simulate the API rejecting in this owned fixture only.
        await evaluate(surface("consent"),"(() => { browser.permissions.request = () => Promise.reject(new Error('owned consent failure fixture')); return true; })()");
        await click("#request","consent");
        await waitForCondition(surface("consent"),"document.querySelector('#status').textContent.includes('could not open') && !document.querySelector('#request').disabled","reachable native-consent retry");
        await command("screenshot",{name:"permission-failure.png",target:"consent"});
        await click("#cancel","consent"); await settled(false);
        await writeFile(resolve(artifacts,"visual-matrix.json"),JSON.stringify({matrix,forcedColors:true,forcedPanelFocus,failure:"simulated permissions.request rejection in disposable helper document",visualBaselinesChanged:false},null,2)+"\n");
      }
      await command("screenshot", {name: "consent-off.png"});
      await openConsent();
      await command("screenshot", {name: "permission-window.png",target:"consent"});
      assert.deepEqual(await flags(),{client:false,session:false,preference:extensionOnly || process.env.LSEW_FIREFOX_VISUAL_PROOF === "1" ? false : null});
      await click("#cancel","consent");
      await settled(false);
      assert.ok(!(await permission()).data_collection.includes("technicalAndInteraction"));
      assert.deepEqual(await flags(),{client:false,session:false,preference:false});
      await openConsent(); await requestNative();
      const waitForNativeUi = async (choice: string) => {
        console.log(`NATIVE_UI_${choice}_READY`);
        for(let attempt=0;attempt<600;attempt++){
          // Leave native focus untouched while the visible browser is operated.
          // The UI operator writes a receipt after the real keyboard choice;
          // native permission and storage assertions still verify its effect.
          try {
            const receipt=JSON.parse(await readFile(resolve(artifacts,`native-choice-${choice}.json`),"utf8"));
            if(receipt.choice===choice && receipt.keyboard===true) return;
          } catch { /* Wait for this run's native UI receipt. */ }
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
        throw new Error("The owned native UI prompt was not completed.");
      };
      if(process.env.LSEW_FIREFOX_NATIVE_UI_PROOF === "1") await waitForNativeUi("DENY");
      else if(process.env.LSEW_FIREFOX_NATIVE_KEY_PROOF === "1") {
        assert.deepEqual(await command("native-key",{allow:false}),{label:"Deny",focused:true});
      } else await command("native-action",{allow:false});
      await settled(false);
      assert.deepEqual(await flags(),{client:false,session:false,preference:false});
      await reopenWithSavedChoice(false);
      await openConsent();
      const axeSource = await readFile(resolve(root,"node_modules/axe-core/axe.min.js"),"utf8");
      const violations = await evaluate<any[]>(surface("consent"), `(() => { ${axeSource}\n return axe.run(document).then(result => result.violations.filter(value => ["serious","critical"].includes(value.impact)).map(value => ({id:value.id,impact:value.impact}))); })()`);
      assert.deepEqual(violations,[]);
      await requestNative();
      if(process.env.LSEW_FIREFOX_NATIVE_UI_PROOF === "1") await waitForNativeUi("ALLOW");
      else if(process.env.LSEW_FIREFOX_NATIVE_KEY_PROOF === "1") {
        assert.deepEqual(await command("native-key",{allow:true}),{label:"Allow",focused:true});
      } else await command("native-action", {allow:true});
      await settled(true);
      assert.ok((await permission()).data_collection.includes("technicalAndInteraction"));
      assert.equal(await evaluate(panelSurface,"document.activeElement?.getAttribute('aria-label')"),"Share usage analytics");
      const restoredFocus=await evaluate<any>(panelSurface,"(() => { const e=document.activeElement; const r=e.getBoundingClientRect(); const s=getComputedStyle(e); return {label:e.getAttribute('aria-label'),outline:s.outlineStyle,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth}; })()");
      assert.equal(restoredFocus.outline,"solid"); assert.equal(restoredFocus.visible,true);
      await evaluate(panelSurface,`chrome.runtime.sendMessage({type:${JSON.stringify(ANALYTICS_MESSAGE)},action:'event',event:{name:'panel_opened',params:{}}})`);
      assert.deepEqual(await flags(),{client:true,session:true,preference:true});
      await command("screenshot",{name:"analytics-on.png"});
      await reopenWithSavedChoice(true);
      assert.ok((await permission()).data_collection.includes("technicalAndInteraction"));
      assert.deepEqual(await flags(),{client:true,session:true,preference:true});
      await toggleSavedAnalytics(); await settled(false);
      assert.deepEqual(await flags(),{client:false,session:false,preference:false});
      assert.ok((await permission()).data_collection.includes("technicalAndInteraction"));
      await toggleSavedAnalytics(); await settled(true);
      await evaluate(panelSurface,`chrome.runtime.sendMessage({type:${JSON.stringify(ANALYTICS_MESSAGE)},action:'event',event:{name:'panel_opened',params:{}}})`);
      assert.equal(await command("evaluate",{target:"background",expression:"browser.permissions.remove({data_collection:['technicalAndInteraction']})"}),true);
      await settled(false);
      assert.deepEqual(await flags(),{client:false,session:false,preference:true});
      if(extensionOnly){
        await evaluate(surface("page"),`window.postMessage(${JSON.stringify({namespace:"__LSEW_CAPTURE__",version:1,kind:"item-update",timestamp:29000,payload:{client:{id:"consent-client"},subscription:{id:"consent-subscription",mode:"MERGE"},item:{name:"after-native-revocation",position:1},update:{fields:{value:"still-captured"},changedFields:{value:"still-captured"}}}})},"*")`);
        await waitForCondition(panelSurface,"document.body.innerText.includes('Capture RUNNING')","Capture continues after native analytics revocation");
      }
      assert.ok((await evaluate<string>(panelSurface,"document.body.innerText")).includes("Capture RUNNING"));
      await command("screenshot",{name:"native-revoked.png"});
      await writeFile(resolve(artifacts,"consent-checks.json"),JSON.stringify({cancel:true,deny:true,allow:true,savedDenial:true,reopenedDenyWithoutPrompt:true,reopenedAllowWithoutPrompt:true,workbenchOff:true,nativeRemoval:true,identifierErasure:true,captureRemainsRunning:true,privateBrowsingDisabled:true,focusRestored:true,restoredFocus,axeSeriousCritical:violations,nativeChoice:process.env.LSEW_FIREFOX_NATIVE_UI_PROOF === "1" ? "native keyboard choice in isolated headed profile" : process.env.LSEW_FIREFOX_NATIVE_KEY_PROOF === "1" ? "native button focus plus trusted Enter in isolated headless profile" : "real Firefox dialog button activation in isolated headless profile"},null,2)+"\n");
      console.log("Firefox native analytics consent passed: Cancel, Deny, Allow, both gates, erasure, revocation and focus restoration.");
    } else if (extensionOnly) {
      const page = surface("page");
      await waitForCondition(page, "document.documentElement.dataset.lsewContentBridgeReady === 'true'", "the Firefox isolated content bridge");
      for (const [index, suffix] of ["one", "two", "three", "four"].entries()) {
        await evaluate(page, `window.postMessage(${JSON.stringify({ namespace: "__LSEW_CAPTURE__", version: 1, kind: "item-update", timestamp: 10000 + index,
          payload: { client: { id: "cdp-same-tab-client" }, subscription: { id: "cdp-same-tab-subscription", mode: "MERGE" },
            item: { name: `cdp-same-tab-${suffix}`, position: 1 }, update: { fields: { value: `cdp-live-${suffix}` }, changedFields: { value: `cdp-live-${suffix}` } } } })}, "*")`);
      }
      await waitForCondition(surface("devtools_panel"), "document.body.innerText.includes('cdp-same-tab-four')", "Firefox IndexedDB Evidence");
      await provePortableInspection(root, surface("devtools_panel"), fixtureUrl, { browser: "firefox", env: { LSEW_FIREFOX_PROFILES_DIR: registry }, firefoxOrigins: createFirefoxOriginResolver([registry]) });
    } else {
      const serverInjection = new URL(fixtureUrl).searchParams.has("server-injection");
      await proveAgentFixture(root, surface("devtools_panel"), surface("page"), { browser: "firefox", env: { LSEW_FIREFOX_PROFILES_DIR: registry }, ...(serverInjection ? {fixtureItem:"scenario.server-injection",serverInjection:true} : {}) });
      const panelSurface=surface("devtools_panel");
      await click("button.workbench-react__agent-access");
      await clickText(panelSurface,"button","Export Scope…");
      await waitForCondition(panelSurface,"[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Download JSON' && !button.disabled)","prepared Firefox scoped export");
      const exports: any[]=[];
      for(const format of ["JSON","HTML"]){
        await clickText(panelSurface,"button",`Download ${format}`);
        let download;
        for(let attempt=0;attempt<100;attempt++){
          const values=await command("downloads");
          download=values.find((value:any)=>value.succeeded && value.path.endsWith(format==="JSON"?".json":".html"));
          if(download)break;
          await new Promise(resolve=>setTimeout(resolve,100));
        }
        assert.ok(download,`Firefox saved the ${format} scoped export`);
        assert.equal(dirname(download.path),resolve(artifacts,"downloads"));
        const content=await readFile(download.path,"utf8");
        if(format==="JSON"){ const value=JSON.parse(content); assert.equal(value.schema.version,1); assert.equal(value.privacy.credentialsExcluded,true); }
        else {assert.ok(content.includes("<!doctype html>"));assert.ok(!/googletagmanager\.com|google-analytics\.com/.test(content));}
        exports.push({format,file:basename(download.path),bytes:Buffer.byteLength(content),saved:true});
      }
      await writeFile(resolve(artifacts,"exports.json"),JSON.stringify(exports,null,2)+"\n");
      console.log("Firefox JSON and offline HTML export downloads passed.");
    }
  } catch (error) {
    await command("screenshot",{name:"failure-consent.png",target:"consent"}).catch(()=>undefined);
    await command("screenshot", { name: "failure.png" }).catch(() => undefined);
    console.error("Panel failure state:", await command("evaluate", { expression: "document.body.innerText" }));
    console.error("Identity fetch:", await command("evaluate", { expression: "(async () => { try { const response = await win.fetch('http://127.0.0.1:24817/identity'); return {status: response.status, text: await response.text()}; } catch(error) { return String(error); } })()" }).catch(error => String(error)));
    console.error("Browser diagnostics:", await command("chrome", { expression: "return Services.console.getMessageArray().map(message => message.message).filter(message => /WebSocket|127.0.0.1|moz-extension|Security|CORS|permission/i.test(message)).slice(-30);" }));
    throw error;
  }
  await command("screenshot", { name: "fixture-proof.png" });
  const beforeClose=await command("evaluate",{target:"background",expression:"indexedDB.databases().then(values=>values.map(value=>value.name).filter(name=>name?.startsWith('lsew-events-panel-v')))"});
  assert.ok(beforeClose.length>0,"Firefox uses a Panel Session IndexedDB history.");
  await command("close-panel");
  let afterClose:string[]=[];
  for(let attempt=0;attempt<100;attempt++){
    afterClose=await command("evaluate",{target:"background",expression:"indexedDB.databases().then(values=>values.map(value=>value.name).filter(name=>name?.startsWith('lsew-events-panel-v')))"});
    if(afterClose.length===0)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  let guardedSweep: {oldHistoriesErased: boolean; freshHistoryOnly: boolean} | undefined;
  if(afterClose.length>0){
    // DevTools destruction can interrupt asynchronous erasure. The storage
    // contract retains ownership guards until the 30-second live lease expires.
    // Verify the real startup sweep; never delete test databases ourselves.
    console.log("Close left temporary history; verifying ownership-safe startup cleanup after lease expiry.");
    await new Promise(resolve=>setTimeout(resolve,31000));
    await command("open-panel");
    await waitForCondition(surface("devtools_panel"),"document.body.innerText.includes('Capture RUNNING')","fresh Firefox Panel Session");
    const afterRecovery:string[]=await command("evaluate",{target:"background",expression:"indexedDB.databases().then(values=>values.map(value=>value.name).filter(name=>name?.startsWith('lsew-events-panel-v')))"});
    guardedSweep={oldHistoriesErased:beforeClose.every((name:string)=>!afterRecovery.includes(name)),freshHistoryOnly:afterRecovery.length===1};
    assert.equal(guardedSweep.oldHistoriesErased,true,"Startup cleanup erases interrupted-close residue under ownership guards.");
    assert.equal(guardedSweep.freshHistoryOnly,true,"A reopened panel owns only its new temporary history.");
    await command("close-panel");
  }
  await writeFile(resolve(artifacts,"close-history.json"),JSON.stringify({before:beforeClose.length,after:afterClose.length,erasureConfirmed:afterClose.length===0,...(guardedSweep?{guardedSweep}:{})},null,2)+"\n");
  await writeFile(resolve(artifacts, "result.json"), JSON.stringify({ browser: "firefox", browserVersion: started.version, extensionVersion: panel.version,
    result: "PASS",
    mode: process.env.LSEW_FIREFOX_CONSENT_PROOF === "1" ? "analytics-consent" : extensionOnly ? "portable-mcp" : "official-client-mcp",
    capture: extensionOnly ? "deterministic content bridge fixture" : "official Lightstreamer listener", storage: "IndexedDB",
    ...(process.env.LSEW_FIREFOX_CONSENT_PROOF !== "1" ? {mcp: "stdio"} : {}), origin: panel.origin }, null, 2) + "\n");
} finally {
  await command("quit").catch(() => undefined);
  driver.stdin.end();
  fixtureServer?.close();
}
