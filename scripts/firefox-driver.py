"""Developer-only Marionette bridge for a fresh Firefox test profile.

Frame scripts inspect the real extension/browser documents. Product Capture and
Injection still cross the shipped extension and official-client APIs.
Never use this driver with a personal Firefox profile or publisher account.
"""
import argparse
import contextlib
import json
import pathlib
import socket
import sys
import traceback
import time

from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons
from marionette_driver.keys import Keys

ADDON_ID = "lightstreamer-workbench@imom39a"

FRAME_QUERY = """
const target = arguments[0], source = arguments[1], done = arguments[arguments.length - 1];
try {
  const extension = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
    .ExtensionParent.GlobalManager.getExtension("lightstreamer-workbench@imom39a");
  const owner = Services.wm.getMostRecentWindow("navigator:browser");
  const windows = [...Services.wm.getEnumerator("navigator:browser")];
  const browser = target === "page" ? windows.find(win => win.__lsewTestPrimary).gBrowser.selectedBrowser
    : target === "consent" ? windows.flatMap(win => [...win.gBrowser.browsers]).find(browser => browser.currentURI.spec.includes("/extension/analytics-consent/index.html"))
    : [...extension.views].find(view => view.viewType === target)?.xulBrowser;
  if (!browser) throw new Error("Missing Firefox test view: " + target);
  const mm = browser.messageManager;
  const topic = "LSEWTest:" + Services.uuid.generateUUID().toString();
  const reply = ({data}) => { mm.removeMessageListener(topic, reply); done(data); };
  mm.addMessageListener(topic, reply);
  const expression = '(async () => { const win = window; return (' + source + '); })()';
  const script = '(async () => { try {'
    + 'const sandbox = new Cu.Sandbox(content, {sandboxPrototype: content, wantXrays: false});'
    + 'const value = await Cu.waiveXrays(Cu.evalInSandbox(' + JSON.stringify(expression) + ', sandbox));'
    + 'sendAsyncMessage(' + JSON.stringify(topic) + ', {value: value === undefined ? null : value});'
    + '} catch(error) { sendAsyncMessage(' + JSON.stringify(topic)
    + ', {error: String(error), stack: error.stack}); } })();';
  mm.loadFrameScript("data:application/javascript;charset=utf-8," + encodeURIComponent(script), false);
} catch(error) { done({error: String(error), stack: error.stack}); }
"""

OPEN_PANEL = """
const done = arguments[arguments.length - 1];
const {DevToolsShim} = ChromeUtils.importESModule("chrome://devtools-startup/content/DevToolsShim.sys.mjs");
const win = Services.wm.getMostRecentWindow("navigator:browser");
(async () => {
  const toolbox = await DevToolsShim.showToolboxForTab(win.gBrowser.selectedTab, {hostType: "bottom"});
  win.__lsewTestToolbox = toolbox;
  for (let attempt = 0; attempt < 150; attempt++) {
    const tool = toolbox.getAdditionalTools().find(tool => tool.label === "Lightstreamer Workbench");
    if (tool) {
      await toolbox.selectTool(tool.id);
      for (let ready = 0; ready < 150; ready++) {
        const extension = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
          .ExtensionParent.GlobalManager.getExtension("lightstreamer-workbench@imom39a");
        if ([...extension.views].some(view => view.viewType === "devtools_panel")) { done(true); return; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Firefox did not register the Workbench DevTools panel");
})().catch(error => done({error: String(error), stack: error.stack}));
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--dist", required=True)
    parser.add_argument("--artifacts", required=True)
    parser.add_argument("--profile-registry", required=True)
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    artifacts = pathlib.Path(args.artifacts)
    artifacts.mkdir(parents=True, exist_ok=True)
    downloads = artifacts.resolve() / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    # Keep the owned browser test offline except for its loopback fixture/companion.
    prefs = {"network.proxy.type": 1, "network.proxy.http": "127.0.0.1",
             "network.proxy.http_port": 9, "network.proxy.ssl": "127.0.0.1",
             "network.proxy.ssl_port": 9, "network.proxy.no_proxies_on": "localhost,127.0.0.1",
             "devtools.toolbox.footer.height": 700,
             "browser.aboutwelcome.enabled": False, "browser.startup.homepage_override.mstone": "ignore",
             "browser.download.folderList": 2, "browser.download.dir": str(downloads),
             "browser.download.useDownloadDir": True, "browser.download.alwaysOpenPanel": False,
             "browser.helperApps.neverAsk.saveToDisk": "application/json,text/html,application/octet-stream"}
    with socket.socket() as reserved:
        reserved.bind(("127.0.0.1", 0))
        port = reserved.getsockname()[1]
    m = Marionette(bin=args.binary, port=port, headless=not args.headed, prefs=prefs,
                   app_args=["--remote-allow-system-access"],
                   gecko_log=str(artifacts / "firefox.log"))
    profile = None
    primary_handle = None

    def query(target, source):
        m.set_context("chrome")
        value = m.execute_async_script(FRAME_QUERY, script_args=[target, source])
        if "error" in value:
            raise RuntimeError(value["error"])
        return value["value"]

    def select_surface(target, focus=False):
        if target == "consent":
            for handle in m.window_handles:
                m.switch_to_window(handle, focus=focus)
                m.set_context("content")
                if "/extension/analytics-consent/index.html" in m.get_url():
                    return
            raise RuntimeError("Missing Firefox consent window")
        m.switch_to_window(primary_handle, focus=focus)

    def dispatch(request):
        nonlocal profile, primary_handle
        command = request["command"]
        if command == "start":
            m.start_session()
            m.timeout.script = 35
            profile = m.instance.profile
            primary_handle = m.current_window_handle
            m.set_context("chrome")
            m.set_window_rect(width=1100, height=1000)
            m.execute_script('Services.wm.getMostRecentWindow("navigator:browser").__lsewTestPrimary = true;')
            installed = Addons(m).install(args.dist, temp=True)
            assert installed == ADDON_ID, installed
            registry = pathlib.Path(args.profile_registry)
            registry.mkdir(parents=True, exist_ok=True)
            (registry / "profiles.ini").write_text("[Profile0]\nIsRelative=0\nPath=" + m.profile_path + "\n")
            m.execute_script("Services.prefs.savePrefFile(null);")
            return {"version": m.session_capabilities["browserVersion"], "addonId": installed,
                    "profile": m.profile_path}
        if command == "navigate":
            m.set_context("content")
            m.navigate(request["url"])
            m.set_context("chrome")
            return True
        if command == "open-panel":
            select_surface(None)
            m.set_context("chrome")
            result = m.execute_async_script(OPEN_PANEL)
            if result is not True:
                raise RuntimeError(str(result))
            return query("devtools_panel", "({origin: location.origin, version: chrome.runtime.getManifest().version})")
        if command == "evaluate":
            if request.get("target", "devtools_panel") != "consent":
                m.switch_to_window(primary_handle, focus=False)
            return query(request.get("target", "devtools_panel"), request["expression"])
        if command == "mouse":
            select_surface(request.get("target"))
            m.set_context("chrome")
            offset = m.execute_script("""
                const e = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs")
                  .ExtensionParent.GlobalManager.getExtension("lightstreamer-workbench@imom39a");
                const target = arguments[0];
                const browser = target === "consent"
                  ? [...Services.wm.getEnumerator("navigator:browser")].flatMap(win => [...win.gBrowser.browsers]).find(browser => browser.currentURI.spec.includes("/extension/analytics-consent/index.html"))
                  : [...e.views].find(v => v.viewType === "devtools_panel").xulBrowser;
                const r = browser.getBoundingClientRect();
                const root = Services.wm.getMostRecentWindow("navigator:browser");
                const owner = browser.ownerDocument.defaultView;
                return {x: r.x + owner.mozInnerScreenX - root.mozInnerScreenX,
                        y: r.y + owner.mozInnerScreenY - root.mozInnerScreenY};
            """, script_args=[request.get("target")])
            action = {"type": "pointerDown" if request["type"] == "mousePressed" else "pointerUp", "button": 0}
            m.actions.perform([{"type": "pointer", "id": "workbench-test-mouse", "parameters": {"pointerType": "mouse"},
                                "actions": [{"type": "pointerMove", "x": round(offset["x"] + request["x"]),
                                             "y": round(offset["y"] + request["y"]), "origin": "viewport"}, action]}])
            return True
        if command == "key":
            select_surface(request.get("target"), focus=request.get("target") == "consent")
            m.set_context("chrome")
            key = getattr(Keys, request["key"])
            actions = [{"type": "keyDown", "value": key}, {"type": "keyUp", "value": key}]
            if request.get("shift"):
                actions = [{"type": "keyDown", "value": Keys.SHIFT}] + actions + [{"type": "keyUp", "value": Keys.SHIFT}]
            m.actions.perform([{"type": "key", "id": "workbench-test-keyboard", "actions": actions}])
            return True
        if command == "resize":
            target = request.get("target", "devtools_panel")
            select_surface(target)
            m.set_context("chrome")
            before = query(target, "({width:innerWidth,height:innerHeight})")
            rect = m.window_rect
            if target == "consent":
                m.set_window_rect(width=rect["width"] + request["width"] - before["width"],
                                  height=rect["height"] + request["height"] - before["height"])
            else:
                m.set_window_rect(width=rect["width"] + request["width"] - before["width"],
                                  height=max(700, request["height"] + 320))
                m.execute_script("""
                    const win = [...Services.wm.getEnumerator("navigator:browser")].find(win => win.__lsewTestPrimary);
                    const frame = win.__lsewTestToolbox.win.browsingContext.embedderElement;
                    const host = frame.closest(".devtools-toolbox-bottom-host") ?? frame.parentElement;
                    host.style.height = arguments[0] + "px";
                    host.style.minHeight = arguments[0] + "px";
                    host.style.maxHeight = arguments[0] + "px";
                    frame.style.height = arguments[0] + "px";
                    frame.style.minHeight = arguments[0] + "px";
                    frame.style.maxHeight = arguments[0] + "px";
                """, script_args=[request["height"] + 30])
            for _ in range(40):
                geometry = query(target, "({width:innerWidth,height:innerHeight})")
                if geometry["width"] == request["width"] and abs(geometry["height"] - request["height"]) <= 4:
                    return geometry
                time.sleep(.05)
            return geometry
        if command == "forced-colors":
            m.set_context("chrome")
            m.execute_script('Services.prefs.setIntPref("browser.display.document_color_use", arguments[0] ? 2 : 0);',
                             script_args=[request["enabled"]])
            return True
        if command == "chrome":
            select_surface(None)
            m.set_context("chrome")
            return m.execute_script(request["expression"])
        if command == "downloads":
            m.set_context("chrome")
            return m.execute_async_script("""
                const done = arguments[arguments.length - 1];
                const {Downloads} = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
                Downloads.getList(Downloads.PUBLIC).then(list=>list.getAll()).then(values=>done(values.map(value=>({path:value.target.path,succeeded:value.succeeded,error:Boolean(value.error)}))),error=>done({error:String(error)}));
            """)
        if command == "native-prompt":
            try:
                select_surface("consent")
            except RuntimeError:
                select_surface(None)
                return {"state": "closed", "children": []}
            m.set_context("chrome")
            return m.execute_script("""
                const win = Services.wm.getMostRecentWindow("navigator:browser");
                const panel = win.PopupNotifications.panel;
                return {state: panel.state, text: panel.textContent,
                  children: [...panel.children].map(node => ({id: node.id, text: node.textContent,
                    buttons: [...node.querySelectorAll(".popup-notification-primary-button, .popup-notification-secondary-button")].map(button => ({label: button.getAttribute("label"), text: button.textContent, className: button.className}))}))};
            """)
        if command == "native-action":
            select_surface("consent")
            m.set_context("chrome")
            # Headless popup widgets sit outside WebDriver's hit-test viewport.
            # Activate the real native dialog's button in this disposable test
            # profile; never inject a grant or use this on a personal profile.
            return m.execute_script("""
                const win = Services.wm.getMostRecentWindow("navigator:browser");
                const node = win.document.getElementById("addon-webext-permissions-notification");
                if (win.PopupNotifications.panel.state !== "open" || node.getAttribute("name") !== "Lightstreamer Workbench") throw new Error("Unexpected native permission dialog");
                const button = arguments[0] ? node.button : node.secondaryButton;
                if (button.disabled) throw new Error("Native permission button is disabled");
                button.click(); return true;
            """, script_args=[request["allow"]])
        if command == "native-key":
            select_surface("consent")
            m.set_context("chrome")
            focus = m.execute_script("""
                const win = Services.wm.getMostRecentWindow("navigator:browser");
                const node = win.document.getElementById("addon-webext-permissions-notification");
                if (win.PopupNotifications.panel.state !== "open" || node.getAttribute("name") !== "Lightstreamer Workbench") throw new Error("Unexpected native permission dialog");
                const button = arguments[0] ? node.button : node.secondaryButton;
                button.focus();
                return {label:button.getAttribute("label"),focused:win.document.activeElement===button};
            """, script_args=[request["allow"]])
            m.actions.perform([{"type":"key","id":"native-consent-test-keyboard","actions":[
                {"type":"keyDown","value":Keys.ENTER},{"type":"keyUp","value":Keys.ENTER}]}])
            return focus
        if command == "close-panel":
            select_surface(None)
            m.set_context("chrome")
            return m.execute_async_script("""
                const done = arguments[arguments.length - 1];
                [...Services.wm.getEnumerator("navigator:browser")].find(win => win.__lsewTestPrimary).__lsewTestToolbox.destroy()
                  .then(() => done(true), error => done({error: String(error)}));
            """)
        if command == "screenshot":
            select_surface(request.get("target"))
            m.set_context("chrome")
            image = m.screenshot()
            import base64
            (artifacts / request["name"]).write_bytes(base64.b64decode(image))
            return request["name"]
        if command == "quit":
            return True
        raise ValueError("Unknown Firefox test command: " + command)

    try:
        for line in sys.stdin:
            request = json.loads(line)
            try:
                with contextlib.redirect_stdout(sys.stderr):
                    value = dispatch(request)
                result = {"id": request["id"], "value": value}
            except Exception as error:
                traceback.print_exc(file=sys.stderr)
                result = {"id": request["id"], "error": str(error)}
            print(json.dumps(result), flush=True)
            if request["command"] == "quit":
                break
    finally:
        with contextlib.redirect_stdout(sys.stderr):
            if m.session:
                m.quit()
            m.cleanup()
            if profile:
                profile.cleanup()


if __name__ == "__main__":
    main()
