import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const renderer = args.renderer;
const dist = resolve(process.cwd(), args.dist ?? "dist");

if (renderer !== "legacy" && renderer !== "react") {
  fail('Expected --renderer "legacy" or "react".');
}

const markers = await findRendererMarkers(dist);
const inactiveRenderer = renderer === "legacy" ? "react" : "legacy";

if (!markers.has(renderer)) {
  fail(`Panel build is missing ${renderer} renderer marker.`);
}

if (markers.has(inactiveRenderer)) {
  fail(`Panel build contains inactive ${inactiveRenderer} renderer marker.`);
}

for (const locations of markers.values()) {
  for (const location of locations) {
    if (!location.startsWith("extension/panel/")) {
      fail(`Panel renderer marker escaped the panel bundle: ${location}`);
    }
  }
}

console.log(`Verified ${renderer === "react" ? "React-only" : "legacy-only"} panel renderer build.`);

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith("--")) {
      fail(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

async function findRendererMarkers(directory, root = directory) {
  const markers = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [marker, locations] of await findRendererMarkers(path, root)) {
        const existing = markers.get(marker) ?? [];
        markers.set(marker, [...existing, ...locations]);
      }
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(/LSEW_PANEL_RENDERER:(legacy|react)/g)) {
        const existing = markers.get(match[1]) ?? [];
        markers.set(match[1], [...existing, relative(root, path)]);
      }
    }
  }
  return markers;
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
  throw new Error(message);
}
