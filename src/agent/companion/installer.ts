import { mkdir, readFile, writeFile, chmod, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { NATIVE_HOST_NAME } from "../protocol";

export const OFFICIAL_EXTENSION_ID = "kfpgbhfphbhkebglopimjhfnnmbifocf";
export function installationPaths(browser: string, home = homedir(), platform = process.platform) {
  const directories: Record<string, string> = platform === "darwin"
    ? { chrome: "Library/Application Support/Google/Chrome", chromium: "Library/Application Support/Chromium", "chrome-for-testing": "Library/Application Support/Google/ChromeForTesting" }
    : platform === "linux" ? { chrome: ".config/google-chrome", chromium: ".config/chromium", "chrome-for-testing": ".config/google-chrome-for-testing" } : {};
  if (!directories[browser]) throw new Error("Supported browsers: chrome, chromium, chrome-for-testing on macOS or Linux.");
  return { manifest: join(home, directories[browser]!, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`), launcher: join(home, ".local", "share", "lightstreamer-workbench", "native-host") };
}
export async function install(cli: string, extensionId: string, browser: string, home?: string, userDataDir?: string) {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("Expected the exact 32-character Chrome extension id.");
  const paths = installationPaths(browser, home);
  if (userDataDir) {
    if (!isAbsolute(userDataDir)) throw new Error("--user-data-dir must be an absolute Chrome user-data directory.");
    paths.manifest = join(userDataDir, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`);
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const launcher = `#!/bin/sh\n# Managed by Lightstreamer Workbench agent companion\nexec ${quote(process.execPath)} ${quote(cli)} host "$@"\n`;
  const manifest = JSON.stringify({ name: NATIVE_HOST_NAME, description: "Lightstreamer Workbench local agent bridge", path: paths.launcher, type: "stdio", allowed_origins: [`chrome-extension://${extensionId}/`] }, null, 2) + "\n";
  for (const path of [paths.manifest, paths.launcher]) {
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid!()) throw new Error(`Refusing to overwrite a non-regular or unowned file: ${path}`);
      const existing = await readFile(path, "utf8");
      if (path === paths.launcher ? !existing.includes("# Managed by Lightstreamer Workbench agent companion") : JSON.parse(existing).name !== NATIVE_HOST_NAME) throw new Error(`Refusing to overwrite an unrelated file: ${path}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await mkdir(dirname(paths.launcher), { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.manifest), { recursive: true });
  await writeFile(paths.launcher, launcher, { mode: 0o700 }); await chmod(paths.launcher, 0o700);
  await writeFile(paths.manifest, manifest, { mode: 0o600 });
  return paths;
}
