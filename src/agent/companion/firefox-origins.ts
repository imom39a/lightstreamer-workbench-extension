import { open } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { FIREFOX_EXTENSION_ID, FIREFOX_UUID_PATTERN } from "../browser-identity";

const MAX_PROFILES = 64;
const UUID_PREF = /^user_pref\("extensions\.webextensions\.uuids",\s*("(?:[^"\\]|\\.)*")\);\s*$/m;

/** Read only the approved add-on's mapping; preference JavaScript is never executed. */
export function firefoxOriginFromPreferences(source: string): string | null {
  try {
    const matches = [...source.matchAll(new RegExp(UUID_PREF.source, "gm"))];
    if (matches.length !== 1) return null;
    const map: unknown = JSON.parse(JSON.parse(matches[0][1]));
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    const uuid = (map as Record<string, unknown>)[FIREFOX_EXTENSION_ID];
    return typeof uuid === "string" && FIREFOX_UUID_PATTERN.test(uuid) ? `moz-extension://${uuid}` : null;
  } catch { return null; }
}

export function firefoxProfileRoots(platform = process.platform, home = homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.LSEW_FIREFOX_PROFILES_DIR) return [resolve(env.LSEW_FIREFOX_PROFILES_DIR)];
  if (platform === "darwin") return [join(home, "Library", "Application Support", "Firefox")];
  if (platform === "win32") return env.APPDATA ? [join(env.APPDATA, "Mozilla", "Firefox")] : [];
  return [join(home, ".mozilla", "firefox"), join(home, "snap", "firefox", "common", ".mozilla", "firefox"), join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox")];
}

function profilePaths(source: string, root: string): string[] {
  const profiles: string[] = [];
  for (const section of source.split(/(?=^\[)/m)) {
    if (!/^\[Profile\d+\]\r?$/m.test(section)) continue;
    const path = /^Path=(.+)\r?$/m.exec(section)?.[1].trim();
    const relative = /^IsRelative=([01])\r?$/m.exec(section)?.[1];
    if (!path || !relative) continue;
    if (relative === "0" && !isAbsolute(path)) continue;
    profiles.push(relative === "1" ? resolve(root, path) : path);
    if (profiles.length >= MAX_PROFILES) break;
  }
  return profiles;
}

async function boundedText(path: string, limit: number): Promise<string | null> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, "r");
    const info = await file.stat();
    if (!info.isFile() || info.size > limit) return null;
    // Reading a fixed buffer also bounds a file that grows after stat.
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return bytesRead > limit ? null : buffer.subarray(0, bytesRead).toString("utf8");
  } catch { return null; }
  finally { await file?.close().catch(() => undefined); }
}

export function createFirefoxOriginResolver(roots: readonly string[] = firefoxProfileRoots()) {
  let cached: Promise<ReadonlySet<string>> | undefined;
  let expires = 0;
  let pending = false;
  async function discover(): Promise<ReadonlySet<string>> {
    const origins = new Set<string>();
    let count = 0;
    for (const root of roots.slice(0, 8)) {
      const ini = await boundedText(join(root, "profiles.ini"), 64 * 1024);
      if (!ini) continue;
      for (const profile of profilePaths(ini, root)) {
        if (++count > MAX_PROFILES) return origins;
        const prefs = await boundedText(join(profile, "prefs.js"), 2 * 1024 * 1024);
        const origin = prefs === null ? null : firefoxOriginFromPreferences(prefs);
        if (origin) origins.add(origin);
      }
    }
    return origins;
  }
  return () => {
    if (!cached || (!pending && Date.now() >= expires)) { pending = true; cached = discover().finally(() => { pending = false; expires = Date.now() + 1000; }); }
    return cached;
  };
}
