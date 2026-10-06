import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { inflateRawSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const outputDir = join(root, "test-results", "browser-diagnostics-proof");
const temporary = await mkdtemp(join(root, "tests", ".lsew-diagnostics-proof-"));
const executable = join(temporary, "failure.mjs");
const secret = "synthetic-only-credential-123456789";
try {
  await build({ entryPoints: [join(root, "tests/support/browser-diagnostics-failure.ts")], outfile: executable, bundle: true, packages: "external", format: "esm", platform: "node", target: "node20", logLevel: "silent" });
  const before = await readdir(join(outputDir, "synthetic-failure")).catch(() => []);
  const result = await new Promise((done, reject) => {
    const child = spawn(process.execPath, [executable], { cwd: root, shell: false, env: { ...process.env, LSEW_PROJECT_ROOT: root, LSEW_BROWSER_DIAGNOSTICS_DIR: outputDir, LSEW_DIAGNOSTICS_PROOF_TOKEN: secret }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output = (output + String(chunk)).slice(-8192); });
    child.stderr.on("data", chunk => { output = (output + String(chunk)).slice(-8192); });
    child.once("error", reject);
    child.once("close", code => done({ code, output }));
  });
  assert.equal(result.code, 1, "The deliberately failing journey must remain failed");
  assert.match(result.output, /Deliberate synthetic browser assertion/, "Evidence collection must preserve the original assertion");
  const after = await readdir(join(outputDir, "synthetic-failure"));
  const attempts = after.filter(name => !before.includes(name));
  assert.equal(attempts.length, 1, "The failed attempt should have one durable diagnostic directory");
  const directory = join(outputDir, "synthetic-failure", attempts[0]);
  const metadata = JSON.parse(await readFile(join(directory, "failure.json"), "utf8"));
  assert.match(metadata.browser.version, /^151\./);
  assert.equal(metadata.failure.code, "ERR_ASSERTION");
  assert.equal(metadata.step, "assert the synthetic panel is ready");
  const trace = await readFile(join(directory, "trace.zip"));
  assert.ok(trace.length > 22, "A Playwright trace must survive teardown");
  assert.ok(!archiveText(trace).includes(secret), "The Playwright trace must redact credentials as well as the separate logs");
  const screenshot = await readFile(join(directory, "synthetic-panel.png"));
  assert.equal(screenshot.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const logs = JSON.parse(await readFile(join(directory, "browser-logs.json"), "utf8"));
  assert.match(JSON.stringify(logs), /synthetic console evidence/);
  assert.match(JSON.stringify(logs), /synthetic page error evidence/);
  assert.ok(!JSON.stringify(logs).includes(secret));
  const panel = JSON.parse(await readFile(join(directory, "synthetic-panel.json"), "utf8"));
  assert.equal(panel.panel.status.lsewPanelBridgeStatus, "synthetic ready");
  console.log(`Synthetic failure diagnostics survived Chrome teardown: ${directory}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function archiveText(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "The trace must be a readable ZIP");
  let central = bytes.readUInt32LE(end + 16);
  const text = [];
  for (let index = 0; index < bytes.readUInt16LE(end + 10); index++) {
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    const local = bytes.readUInt32LE(central + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const packed = bytes.subarray(start, start + bytes.readUInt32LE(central + 20));
    const unpacked = bytes.readUInt16LE(central + 10) === 8 ? inflateRawSync(packed) : packed;
    text.push(unpacked.toString("utf8"));
    central += 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  return text.join("\n");
}
