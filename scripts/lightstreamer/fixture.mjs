#!/usr/bin/env node

import { spawn } from "cross-spawn";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "../..");
const adapterDir = join(rootDir, "fixtures", "lightstreamer", "adapter");
const deployLibDir = join(
  rootDir,
  "fixtures",
  "lightstreamer",
  "adapters",
  "LSEW_FIXTURE",
  "lib"
);
const adapterJar = join(adapterDir, "target", "lsew-fixture-adapter-0.1.0.jar");
const deployedAdapterJar = join(deployLibDir, "lsew-fixture-adapter.jar");
const fixtureSmokeSource = join(rootDir, "tests", "lightstreamer-fixture-capture.spec.ts");
const fixtureBrowserSource = join(
  rootDir,
  "tests",
  "lightstreamer-mutate-reinject.browser.spec.ts"
);
const fixtureClientSource = join(
  rootDir,
  "fixtures",
  "lightstreamer",
  "client",
  "mutate-reinject-client.ts"
);
const fixtureClientOutput = join(
  rootDir,
  "fixtures",
  "lightstreamer",
  "pages",
  "mutate-reinject-client.js"
);

const usage = `Usage: fixture.mjs <build|start|wait|stop|test|browser-test> [--dry-run]

Commands:
  build  Build and deploy the Java fixture adapter
  start  Replace and start the fixture Docker container
  wait   Wait until the fixture HTTP endpoint is ready
  stop   Remove the fixture Docker container
  test   Build everything, run smoke and real-browser reinjection tests, then stop
  browser-test  Build everything, run the real-browser reinjection test, then stop

The same commands are available through npm run fixture:<command>.`;

const command = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!command || command === "--help" || command === "-h" || command === "help") {
  console.log(usage);
  process.exit(0);
}

try {
  switch (command) {
    case "build":
      await buildFixtureClient();
      await buildAdapter();
      break;
    case "start":
      await buildFixtureClient();
      await startFixture();
      break;
    case "wait":
      await waitForFixture();
      break;
    case "stop":
      await stopFixture();
      break;
    case "test":
      await testFixture();
      break;
    case "browser-test":
      await testFixture({ browserOnly: true });
      break;
    default:
      throw new Error(`Unknown fixture command: ${command}\n\n${usage}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function buildAdapter() {
  await runProcess("mvn", ["-q", "-f", join(adapterDir, "pom.xml"), "package"]);
  if (dryRun) {
    console.log(`[dry-run] mkdir ${formatArgument(deployLibDir)}`);
    console.log(
      `[dry-run] copy ${formatArgument(adapterJar)} ${formatArgument(deployedAdapterJar)}`
    );
    return;
  }
  await mkdir(deployLibDir, { recursive: true });
  await copyFile(adapterJar, deployedAdapterJar);
}

async function buildFixtureClient() {
  if (dryRun) {
    console.log(
      `[dry-run] bundle ${formatArgument(fixtureClientSource)} to ${formatArgument(fixtureClientOutput)}`
    );
    return;
  }
  const { build } = await import("esbuild");
  await build({
    entryPoints: [fixtureClientSource],
    outfile: fixtureClientOutput,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "chrome114",
    logLevel: "silent"
  });
}

async function startFixture() {
  const config = fixtureConfig();
  await runProcess("docker", ["rm", "-f", config.containerName], {
    allowFailure: true,
    stdio: "ignore"
  });
  await runProcess(
    "docker",
    [
      "run",
      "--detach",
      "--name",
      config.containerName,
      "--publish",
      `${config.port}:8080`,
      "--volume",
      `${join(rootDir, "fixtures", "lightstreamer", "adapters")}:/lightstreamer/adapters:ro`,
      "--volume",
      `${join(rootDir, "fixtures", "lightstreamer", "pages")}:/lightstreamer/pages:ro`,
      config.image
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
  console.log(`Lightstreamer fixture started at http://localhost:${config.port}/`);
}

async function stopFixture({ quiet = false } = {}) {
  const { containerName } = fixtureConfig();
  await runProcess("docker", ["rm", "-f", containerName], {
    allowFailure: true,
    stdio: "ignore",
    quietDryRun: quiet
  });
  if (!quiet) {
    console.log(`Lightstreamer fixture stopped: ${containerName}`);
  }
}

async function waitForFixture() {
  const config = fixtureConfig();
  if (dryRun) {
    console.log(`[dry-run] wait ${config.waitSeconds}s for ${config.url}`);
    return;
  }
  if (typeof fetch !== "function") {
    throw new Error("Fixture readiness requires Node.js 18 or newer (global fetch is unavailable). ");
  }

  const deadline = Date.now() + config.waitSeconds * 1_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(config.url, 3_000);
      if (response.ok) {
        await response.body?.cancel();
        console.log(`Lightstreamer fixture ready at ${config.url}`);
        return;
      }
      await response.body?.cancel();
    } catch {
      // The fixture is expected to reject connections while Docker initializes it.
    }
    await delay(1_000);
  }

  throw new Error(`Timed out waiting for Lightstreamer fixture at ${config.url}`);
}

async function testFixture({ browserOnly = false } = {}) {
  try {
    await runProcess("npm", ["run", "build"]);
    await buildFixtureClient();
    await buildAdapter();
    await startFixture();
    await waitForFixture();
    if (!browserOnly) {
      await runFixtureSmokeTest();
    }
    await runFixtureBrowserTest();
  } finally {
    await stopFixture({ quiet: true });
  }
}

async function runFixtureBrowserTest() {
  const generatedBrowserTest = join(
    rootDir,
    "tests",
    `.lightstreamer-mutate-reinject-${process.pid}-${Date.now()}.mjs`
  );
  if (dryRun) {
    console.log(
      `[dry-run] transpile ${formatArgument(fixtureBrowserSource)} and run with ${formatArgument(process.execPath)}`
    );
    return;
  }

  const { build } = await import("esbuild");
  try {
    await build({
      entryPoints: [fixtureBrowserSource],
      outfile: generatedBrowserTest,
      bundle: false,
      format: "esm",
      platform: "node",
      target: "node20",
      logLevel: "silent"
    });
    await runProcess(process.execPath, [generatedBrowserTest]);
  } finally {
    await rm(generatedBrowserTest, { force: true });
  }
}

async function runFixtureSmokeTest() {
  const generatedSmokeTest = join(
    rootDir,
    "tests",
    `.lightstreamer-fixture-capture-${process.pid}-${Date.now()}.mjs`
  );
  if (dryRun) {
    console.log(
      `[dry-run] transpile ${formatArgument(fixtureSmokeSource)} and run with ${formatArgument(process.execPath)}`
    );
    return;
  }

  const { build } = await import("esbuild");
  try {
    await build({
      entryPoints: [fixtureSmokeSource],
      outfile: generatedSmokeTest,
      bundle: false,
      format: "esm",
      platform: "node",
      target: "node18",
      logLevel: "silent"
    });
    await runProcess(process.execPath, [generatedSmokeTest]);
  } finally {
    await rm(generatedSmokeTest, { force: true });
  }
}

function fixtureConfig() {
  const port = positiveInteger("LIGHTSTREAMER_PORT", 8080);
  return {
    containerName: process.env.LSEW_LIGHTSTREAMER_CONTAINER || "lsew-lightstreamer-fixture",
    image: process.env.LIGHTSTREAMER_IMAGE || "lightstreamer:7.4.7-jdk21-temurin",
    port,
    url: process.env.LSEW_FIXTURE_URL || `http://localhost:${port}/`,
    waitSeconds: positiveInteger("LSEW_FIXTURE_WAIT_SECONDS", 45)
  };
}

function positiveInteger(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue.trim() === "") {
    return fallback;
  }
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${rawValue}.`);
  }
  return value;
}

function runProcess(
  executable,
  args,
  { allowFailure = false, stdio = "inherit", quietDryRun = false } = {}
) {
  if (dryRun) {
    if (!quietDryRun) {
      console.log(`[dry-run] ${formatCommand(executable, args)}`);
    }
    return Promise.resolve();
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: rootDir,
      env: process.env,
      shell: false,
      stdio,
      windowsHide: true
    });

    child.once("error", (error) => {
      rejectPromise(
        new Error(
          `Unable to run ${executable}. Confirm it is installed and available on PATH. ${error.message}`
        )
      );
    });
    child.once("close", (code, signal) => {
      if (code === 0 || allowFailure) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${formatCommand(executable, args)} failed${
            signal ? ` with signal ${signal}` : ` with exit code ${code ?? "unknown"}`
          }.`
        )
      );
    });
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function formatCommand(executable, args) {
  return [executable, ...args].map(formatArgument).join(" ");
}

function formatArgument(value) {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}
