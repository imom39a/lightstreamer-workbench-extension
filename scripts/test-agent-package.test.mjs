import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import spawn from "cross-spawn";

const root = resolve(import.meta.dirname, "..");
const source = "e".repeat(40);

test("a frozen companion installs from a cold npm cache and runs its packaged MCP and skill setup", { timeout: 180000 }, async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "workbench-cold-package-")));
  let registry;
  try {
    execFileSync(process.execPath, ["scripts/build-agent.mjs"], { cwd: root, stdio: "pipe" });
    const packageDirectory = join(directory, "frozen companion with spaces");
    await cp(join(root, "agent"), packageDirectory, { recursive: true });
    const metadata = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));
    await writeFile(join(packageDirectory, "package.json"), JSON.stringify({ ...metadata, gitHead: source }));
    const pack = path => {
      const result = spawn.sync("npm", ["pack", path, "--ignore-scripts", "--json", "--pack-destination", directory], { cwd: root, encoding: "utf8", timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      return join(directory, JSON.parse(result.stdout)[0].filename);
    };
    const tarball = pack(packageDirectory);
    const frozenBytes = await readFile(tarball);
    const packages = new Map();
    for (const name of ["skills", "yaml"]) {
      const path = join(root, "node_modules", name);
      const metadata = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      const fixturePath = join(directory, `dependency-${name}`);
      await cp(path, fixturePath, { recursive: true });
      // npm 10 still runs prepare under --ignore-scripts when packing a directory.
      // These installed runtime copies must not run upstream build hooks.
      const fixtureMetadata = { ...metadata };
      delete fixtureMetadata.scripts;
      await writeFile(join(fixturePath, "package.json"), JSON.stringify(fixtureMetadata));
      packages.set(name, { metadata: fixtureMetadata, bytes: await readFile(pack(fixturePath)) });
    }
    assert.equal(packages.get("skills").metadata.version, "1.5.18");
    const requests = [];
    registry = createServer((request, response) => {
      requests.push(request.url);
      for (const [name, { metadata, bytes }] of packages) {
        const artifact = `/${name}/-/${name}-${metadata.version}.tgz`;
        if (request.url === artifact) {
          response.writeHead(200, { "Content-Type": "application/octet-stream" });
          response.end(bytes);
          return;
        }
        if (request.url === `/${name}`) {
          const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ name, "dist-tags": { latest: metadata.version }, versions: {
            [metadata.version]: { ...metadata, dist: { integrity, tarball: `http://127.0.0.1:${registry.address().port}${artifact}` } }
          } }));
          return;
        }
      }
      response.writeHead(404);
      response.end();
    });
    registry.listen(0, "127.0.0.1");
    await once(registry, "listening");
    const cache = join(directory, "empty npm cache");
    await mkdir(cache);
    assert.deepEqual(await readdir(cache), []);
    const userconfig = join(directory, "npmrc");
    await writeFile(userconfig, "");
    const registryUrl = `http://127.0.0.1:${registry.address().port}/`;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["scripts/test-agent-package.mjs"], {
        cwd: root, timeout: 150000, env: { ...process.env,
          LSEW_AGENT_PACKAGE_TARBALL: tarball,
          npm_config_cache: cache, NPM_CONFIG_CACHE: cache,
          npm_config_registry: registryUrl, NPM_CONFIG_REGISTRY: registryUrl,
          npm_config_userconfig: userconfig, NPM_CONFIG_USERCONFIG: userconfig
        }
      });
      let output = "";
      child.stdout.on("data", bytes => { output += bytes.toString(); });
      child.stderr.on("data", bytes => { output += bytes.toString(); });
      child.once("error", reject);
      child.once("close", code => resolve({ code, output }));
    });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Packaged MCP proof passed/);
    assert(requests.includes("/skills"), "Cold installation resolves the pinned installer dependency");
    assert(requests.includes("/skills/-/skills-1.5.18.tgz"), "Cold installation retrieves the pinned installer bytes");
    assert(!requests.some(path => path.startsWith("/lightstreamer-workbench-agent")), "The companion itself is installed from the frozen local tarball");
    assert.deepEqual(await readFile(tarball), frozenBytes);
    const installed = JSON.parse(await readFile(join(root, "test-results/agent-package/node_modules/lightstreamer-workbench-agent/package.json"), "utf8"));
    assert.equal(installed.gitHead, source, "The installed companion retains the supplied frozen artifact's provenance");
  } finally {
    if (registry) await new Promise(resolve => registry.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
