import { chromium } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

// Caller-facing boundary: a failed synthetic browser journey becomes files.
// Collection never replaces the assertion that caused the journey to fail.
export function createBrowserFailureDiagnostics({ outputDir, rootDir = process.cwd(), journey, attempt = 1, redactValues = [], operationTimeoutMs = 3000 }) {
  outputDir ??= process.env.LSEW_BROWSER_DIAGNOSTICS_DIR || join(rootDir, "test-results", "browser-diagnostics");
  outputDir = resolve(outputDir);
  journey = safeName(journey);
  const secrets = [...redactValues, ...Object.entries(process.env)
    .filter(([key, value]) => /TOKEN|SECRET|PASSWORD|AUTHORIZATION|API_KEY|CONNECTION/i.test(key) && value?.length >= 8)
    .map(([, value]) => value)].filter(Boolean);
  const redact = value => redactText(value, secrets);
  const sanitize = (value, depth = 0) => {
    if (typeof value === "string") return redact(value).slice(0, 2048);
    if (!value || typeof value !== "object") return value;
    if (depth >= 8) return "[bounded]";
    if (Array.isArray(value)) return value.slice(0, 100).map(entry => sanitize(entry, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, entry]) => [key, /^(password|token|secret|api[_-]?(key|secret)|authorization|cookie)$/i.test(key) ? "[REDACTED]" : sanitize(entry, depth + 1)]));
  };
  let currentStep = "browser startup";
  let browser;
  let browserIdentity = null;
  let context;
  let tracing = false;
  const targets = [];
  const detach = [];
  const listeners = [];
  const logs = [];
  const collectorErrors = [];
  const capture = async (label, action) => {
    let timeout;
    try {
      return await Promise.race([
        Promise.resolve().then(action),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out collecting ${label}.`)), operationTimeoutMs); })
      ]);
    } catch (error) {
      collectorErrors.push({ label, message: redact(String(error)).slice(0, 2048) });
      if (collectorErrors.length > 32) collectorErrors.shift();
    } finally { clearTimeout(timeout); }
  };
  const log = record => {
    logs.push({ ...record, text: redact(record.text ?? "").slice(0, 2048) });
    if (logs.length > 200) logs.splice(0, logs.length - 200);
  };
  const observePage = async page => {
    const session = await context.newCDPSession(page);
    detach.push(() => session.detach());
    await api.observeCdp(`page-${detach.length}`, {
      request: (method, params) => session.send(method, params),
      on: (method, listener) => { session.on(method, listener); return () => session.off(method, listener); }
    });
  };
  const api = {
    async connect(endpoint) {
      await capture("connect Playwright diagnostics", async () => {
        browser = await chromium.connectOverCDP(endpoint, { timeout: operationTimeoutMs });
        browserIdentity = { name: "Chrome for Testing", version: browser.version() };
        context = browser.contexts()[0];
        await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
        tracing = true;
      });
    },
    async observeContext(ownedContext) {
      await capture("start owned-context diagnostics", async () => {
        context = ownedContext;
        browserIdentity = { name: "Chrome for Testing", version: context.browser()?.version() ?? "unavailable" };
        await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
        tracing = true;
        for (const page of context.pages()) await observePage(page);
        const onPage = page => { void capture("observe new fixture page", () => observePage(page)); };
        context.on("page", onPage);
        listeners.push(() => context.off("page", onPage));
      });
    },
    async observeCdp(label, cdp) {
      label = safeName(label);
      targets.push({ label, cdp });
      listeners.push(cdp.on("Runtime.consoleAPICalled", event => log({ target: label, type: "console", level: event.type, text: event.args?.map(argument => argument.value ?? argument.description ?? "").join(" ") })));
      listeners.push(cdp.on("Runtime.exceptionThrown", event => log({ target: label, type: "pageerror", text: event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text })));
      await capture(`enable ${label} logging`, () => cdp.request("Runtime.enable"));
    },
    browserLog(text) { log({ type: "browser", text }); },
    async step(name) {
      currentStep = name;
      if (tracing) await capture("trace journey step", async () => {
        await context.tracing.groupEnd();
        await context.tracing.group(name);
      });
    },
    async captureFailure(error, details) {
      try {
        const parent = join(outputDir, journey);
        await mkdir(parent, { recursive: true });
        let directory;
        for (let number = attempt; ; number++) {
          directory = join(parent, `attempt-${String(number).padStart(2, "0")}`);
          try { await mkdir(directory); break; }
          catch (failure) { if (failure.code !== "EEXIST") throw failure; }
        }
        for (const { label, cdp } of targets) {
          await capture(`panel diagnostics ${label}`, async () => {
            const evaluation = await cdp.request("Runtime.evaluate", {
              expression: `({
                url: location.href, title: document.title, readyState: document.readyState,
                viewport: { width: innerWidth, height: innerHeight },
                panel: {
                  status: Object.fromEntries(Object.entries(document.documentElement.dataset).filter(([key]) => /^lsew.*(status|ready|state|health)$/i.test(key))),
                  evidenceRows: document.querySelectorAll('[data-evidence-id]').length,
                  statusMessages: Array.from(document.querySelectorAll('[role="status"], .workbench-react__footer')).slice(-16).map(element => (element.textContent ?? '').slice(0, 640)),
                  diagnosticEntries: Array.from(document.querySelectorAll('[aria-label="Workbench diagnostic entries"] li')).slice(-16).map(element => (element.textContent ?? '').slice(0, 640))
                }
              })`,
              returnByValue: true
            });
            await writeFile(join(directory, `${label}.json`), JSON.stringify(sanitize(evaluation.result?.value), null, 2) + "\n");
          });
          await capture(`screenshot ${label}`, async () => {
            // The profile is disposable and the assertion has already failed.
            // Mask known credentials before pixels become a durable artifact.
            await cdp.request("Runtime.evaluate", {
              expression: `(() => {
                const secrets = ${JSON.stringify(secrets)};
                const mask = value => { for (const secret of secrets) value = value.split(secret).join('[REDACTED]'); return value.replace(/wb1:\\d+:[a-f\\d]{64}/gi, '[REDACTED]'); };
                const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
                for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.parentElement?.tagName !== 'SCRIPT' && node.parentElement?.tagName !== 'STYLE') node.textContent = mask(node.textContent ?? '');
                for (const input of document.querySelectorAll('input, textarea')) input.value = input.type === 'password' ? '[REDACTED]' : mask(input.value);
              })()`
            });
            const screenshot = await cdp.request("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            await writeFile(join(directory, `${label}.png`), Buffer.from(screenshot.data, "base64"));
          });
        }
        if (tracing) {
          await capture("save Playwright trace", async () => {
            const temporary = await mkdtemp(join(tmpdir(), "lsew-failure-trace-"));
            try {
              const rawPath = join(temporary, "raw.zip");
              await context.tracing.stop({ path: rawPath });
              tracing = false;
              // Keep the existing ZIP writer's CLI entry guard outside esbuild's
              // browser-spec bundle; runtime import preserves its module URL.
              const { writeDeterministicZip } = await import(pathToFileURL(join(rootDir, "scripts/package-mcp-release.mjs")).href);
              await sanitizeTrace(await readFile(rawPath), join(directory, "trace.zip"), sanitize, writeDeterministicZip);
            } finally { await rm(temporary, { recursive: true, force: true }); }
          });
        }
        await writeFile(join(directory, "browser-logs.json"), JSON.stringify(logs, null, 2) + "\n");
        await writeFile(join(directory, "failure.json"), JSON.stringify({
          journey,
          step: redact(currentStep).slice(0, 2048),
          browser: browserIdentity,
          collectorErrors,
          details: sanitize(details),
          failure: { name: error?.name, message: redact(error?.message ?? String(error)).slice(0, 8192), code: error?.code, stack: error?.stack ? redact(error.stack).slice(0, 16384) : undefined }
        }, null, 2) + "\n");
        console.error(`Browser failure evidence: ${directory}`);
        return directory;
      } catch {
        return undefined;
      }
    },
    async dispose() {
      for (const removeListener of listeners.splice(0)) await capture("remove diagnostic listener", removeListener);
      if (tracing) await capture("discard successful trace", () => context.tracing.stop());
      for (const disconnect of detach.splice(0)) await capture("detach owned-context diagnostics", disconnect);
      if (browser) await capture("disconnect Playwright diagnostics", () => browser.close());
    }
  };
  return api;
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 160) || "browser-journey";
}

function redactText(value, secrets) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join("[REDACTED]");
  return text
    .replace(/\bwb1:\d+:[a-f\d]{64}\b/gi, "[REDACTED]")
    .replace(/\b(Bearer\s+)\S+/gi, "$1[REDACTED]")
    .replace(/\b((?:api[-_]?key|api[-_]?secret|access[-_]?token|refresh[-_]?token|token|password|authorization|cookie|secret)\s*[:=]\s*)["']?[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/(?:https?|wss?):\/\/[^\s"<>]+/g, value => {
      try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href; }
      catch { return value; }
    });
}

// No DOM snapshots, network bodies, source files, cookies or storage are exported.
// Playwright still records console arguments with snapshots disabled, so sanitize
// the trace itself, not just the companion JSON log. Keep its format/viewer intact.
async function sanitizeTrace(archive, output, sanitize, writeZip) {
  const entries = [];
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("Playwright returned an invalid trace ZIP.");
  let central = archive.readUInt32LE(end + 16);
  for (let index = 0; index < archive.readUInt16LE(end + 10); index++) {
    if (archive.readUInt32LE(central) !== 0x02014b50) throw new Error("Invalid trace ZIP entry.");
    const nameLength = archive.readUInt16LE(central + 28);
    const name = archive.subarray(central + 46, central + 46 + nameLength).toString("utf8");
    if (/^[\w-]+\.network$/.test(name)) {
      entries.push({ name, bytes: Buffer.alloc(0) });
      central += 46 + nameLength + archive.readUInt16LE(central + 30) + archive.readUInt16LE(central + 32);
      continue;
    }
    if (/^[\w-]+\.(trace|network)$/.test(name)) {
      const local = archive.readUInt32LE(central + 42);
      const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
      const packed = archive.subarray(start, start + archive.readUInt32LE(central + 20));
      const method = archive.readUInt16LE(central + 10);
      const bytes = method === 8 ? inflateRawSync(packed, { maxOutputLength: 64 * 1024 * 1024 }) : method === 0 ? packed : undefined;
      if (!bytes) throw new Error("Unsupported trace ZIP compression.");
      const events = bytes.toString("utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
      const consoles = events.map((event, i) => event.type === "console" || event.type === "event" && event.method === "pageError" ? i : -1).filter(i => i >= 0).slice(-200);
      const other = events.map((event, i) => event.type !== "console" && !(event.type === "event" && event.method === "pageError") ? i : -1).filter(i => i >= 0).slice(-2000);
      const selected = new Set([...consoles, ...other]);
      const text = events.filter((event, i) => event.type === "context-options" || selected.has(i)).map(event => JSON.stringify(sanitize(event))).join("\n");
      entries.push({ name, bytes: Buffer.from(text + (text ? "\n" : "")) });
    }
    central += 46 + nameLength + archive.readUInt16LE(central + 30) + archive.readUInt16LE(central + 32);
  }
  if (!entries.some(entry => entry.name.endsWith(".trace"))) throw new Error("Playwright trace events are missing.");
  await writeZip(entries, output);
}
