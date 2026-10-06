import { expect, it } from "vitest";
import { extensionManifest, firefoxRequiredData } from "../scripts/extension-manifest.mjs";
import manifest from "../public/manifest.json";
import metadata from "../package.json";
it("generates same-version Firefox and Chrome manifests without mutating shared source", () => {
  const firefox = extensionManifest(manifest, "firefox"), chrome = extensionManifest(manifest, "chrome");
  expect(firefox.version).toBe(chrome.version); expect(firefox.version).toBe(metadata.version);
  expect(firefox.background).toEqual({ scripts: [manifest.background.service_worker], type: "module" });
  expect(chrome).toEqual(manifest); expect(chrome.browser_specific_settings).toBeUndefined();
  expect(firefox.incognito).toBe("not_allowed");
  expect(firefox.browser_specific_settings).toEqual({ gecko: { id: "lightstreamer-workbench@imom39a", strict_min_version: "140.0", data_collection_permissions: { required: firefoxRequiredData, optional: ["technicalAndInteraction"] } } });
  expect(firefox.content_scripts).toEqual(manifest.content_scripts);
  expect(firefox.content_security_policy).toEqual({ extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* https://www.google-analytics.com" });
  expect(firefoxRequiredData).not.toContain("technicalAndInteraction");
  expect(() => extensionManifest(manifest, "safari")).toThrow();
});
