import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Browser, Cache } from "@puppeteer/browsers";
import axe from "axe-core";
import { chromeTestArguments } from "./chrome-test-policy.mjs";

// Review evidence only: never updates the committed visual baselines.
const root = resolve(import.meta.dirname, "..");
const base = execFileSync("git", ["rev-parse", "--verify", "--end-of-options", `${process.argv[2] ?? "HEAD"}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
const reference = await mkdtemp(join(tmpdir(), "lsew-agent-reference-"));
const output = join(root, "test-results/agent-readiness-visual");
const servers = [];
let browser;
const scenes = [];
for (const [geometry, width, height] of [["compact", 563, 700], ["normal", 900, 700], ["shallow", 900, 320], ["wide", 1440, 900]]) {
  for (const theme of ["dark", "light"]) {
    for (const view of ["header", "instructions"]) scenes.push({ id: `${geometry}-${theme}-waiting-${view}`, width, height, theme, view, agent: "error" });
  }
}
scenes.push(
  { id: "normal-dark-ready", width: 900, height: 700, theme: "dark", agent: "ready" },
  { id: "normal-light-off", width: 900, height: 700, theme: "light", agent: "ready", off: true },
  { id: "compact-light-empty", width: 563, height: 700, theme: "light", agent: "error", scenario: "empty-scope" },
  { id: "wide-dark-high-volume", width: 1440, height: 900, theme: "dark", agent: "error", scenario: "frozen-high-volume" },
  { id: "normal-dark-forced", width: 900, height: 700, theme: "dark", agent: "error", forced: true },
  { id: "dock-761-normal", width: 761, height: 700, theme: "dark", agent: "error" },
  { id: "dock-761-shallow", width: 761, height: 320, theme: "light", agent: "error" }
);
try {
  execFileSync("tar", ["-x", "-C", reference], { input: execFileSync("git", ["archive", base], { cwd: root, maxBuffer: 128 * 1024 * 1024 }) });
  await symlink(join(root, "node_modules"), join(reference, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  for (const folder of ["base", "current", "diff", "contact-sheets"]) await mkdir(join(output, folder), { recursive: true });
  for (const [directory, port] of [[reference, 4259], [root, 4260]]) {
    const child = spawn(process.execPath, [join(directory, "scripts/ui-panel-server.mjs")], { cwd: directory, env: { ...process.env, LSEW_UI_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
    servers.push(child);
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error("Scenario server startup timed out")), 30000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Scenario server exited ${code}`)); });
      child.stderr.on("data", bytes => process.stderr.write(bytes));
      child.stdout.on("data", bytes => { if (String(bytes).includes("listening on")) { clearTimeout(timer); resolveReady(); } });
    });
  }
  const cached = new Cache(join(root, ".cache/lsew-browsers")).getInstalledBrowsers().filter(entry => entry.browser === Browser.CHROME).sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || cached[0]?.executablePath, args: chromeTestArguments() });
  const results = [];
  for (const scene of scenes) {
    const images = [];
    const diagnostics = [];
    for (const [variant, port] of [["base", 4259], ["current", 4260]]) {
      const page = await browser.newPage({ viewport: { width: scene.width, height: scene.height }, colorScheme: scene.theme, timezoneId: "America/New_York" });
      const errors = []; page.on("pageerror", error => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${port}/?scenario=${scene.scenario ?? "live-selected"}&theme=${scene.theme}&agent=${scene.agent}`);
      await page.locator('html[data-react-scene-ready="true"]').waitFor();
      const toggle = page.locator(".workbench-react__agent-access");
      if (scene.off) await toggle.click();
      if (scene.forced) await page.emulateMedia({ forcedColors: "active" });
      if (scene.view === "instructions") {
        await page.getByRole("button", { name: "More actions", exact: true }).click();
        const summary = page.locator("summary").filter({ hasText: "Agent setup instructions" });
        await summary.focus(); await page.keyboard.press("Enter");
      } else await toggle.focus();
      const png = await page.screenshot({ animations: "disabled", caret: "hide" });
      images.push(`data:image/png;base64,${png.toString("base64")}`);
      await writeFile(join(output, variant, `${scene.id}.png`), png);
      if (variant === "current") {
        await page.addScriptTag({ content: axe.source });
        diagnostics.push(await page.evaluate(async () => ({
          violations: (await window.axe.run()).violations.filter(v => ["serious", "critical"].includes(v.impact)).map(v => v.id),
          overflow: document.documentElement.scrollWidth > innerWidth,
          focusVisible: (() => { const e = document.activeElement, b = e.getBoundingClientRect(); return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); })()
        })));
        if (errors.length || diagnostics[0].violations.length || diagnostics[0].overflow || !diagnostics[0].focusVisible) throw new Error(`${scene.id}: ${JSON.stringify({ errors, diagnostics })}`);
      }
      await page.close();
    }
    const sheet = await browser.newPage({ viewport: { width: 1200, height: Math.ceil(scene.height * 400 / scene.width) + 36 } });
    const diff = await sheet.evaluate(async ({ images, width, height }) => {
      const load = async src => { const image = new Image(); image.src = src; await image.decode(); return image; };
      const [a, b] = await Promise.all(images.map(load));
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(a, 0, 0); const before = ctx.getImageData(0, 0, width, height);
      ctx.drawImage(b, 0, 0); const after = ctx.getImageData(0, 0, width, height);
      for (let i = 0; i < after.data.length; i += 4) for (let c = 0; c < 3; c++) after.data[i + c] = Math.min(255, Math.abs(after.data[i + c] - before.data[i + c]) * 3);
      ctx.putImageData(after, 0, 0); return canvas.toDataURL("image/png");
    }, { images, width: scene.width, height: scene.height });
    await writeFile(join(output, "diff", `${scene.id}.png`), Buffer.from(diff.split(",")[1], "base64"));
    await sheet.setContent(`<body style="margin:0;background:#ddd;font:12px sans-serif"><div style="height:36px">${scene.id} — BASE (left), CURRENT (middle), DIFF (right)</div><div style="display:flex">${[...images, diff].map(src => `<img style="width:400px" src="${src}">`).join("")}</div></body>`);
    await sheet.screenshot({ path: join(output, "contact-sheets", `${scene.id}.png`) });
    await sheet.close(); results.push({ ...scene, diagnostics });
  }
  await writeFile(join(output, "manifest.json"), JSON.stringify({ base, browser: browser.version(), results }, null, 2));
  console.log(`Agent visual packet: ${results.length} base/current/diff triplets, no serious/critical axe findings, overflow or obscured focus. ${output}`);
} finally {
  await browser?.close();
  for (const child of servers) child.kill();
  // Only the temporary source export created by this invocation is removed.
  await rm(reference, { recursive: true, force: true });
}
