#!/usr/bin/env node
// Validate synthetic events; live DebugView probes require an explicit flag.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { loadEnv } from "vite";

const env = { ...loadEnv("production", process.cwd(), "VITE_LSEW_GA_"), ...process.env };
const collectDebug = process.argv.includes("--collect-debug");
if (process.argv.slice(2).some(argument => argument !== "--collect-debug")) throw new Error("Usage: npm run analytics:validate [-- --collect-debug]");
const measurementId = env.VITE_LSEW_GA_MEASUREMENT_ID?.trim();
const apiSecret = env.VITE_LSEW_GA_API_SECRET?.trim();
if (!measurementId || !/^G-[A-Z0-9]+$/.test(measurementId) || !apiSecret) throw new Error("Set the GA4 measurement ID and Measurement Protocol API secret in .env.local first.");
const temporary = await mkdtemp(join(tmpdir(), "lsew-analytics-validation-"));
try {
  const outfile = join(temporary, "analytics.mjs");
  await build({ stdin: { contents: 'export * from "./src/extension/analytics/service.ts"; export * from "./src/extension/analytics/events.ts";', resolveDir: process.cwd() }, outfile, bundle: true, platform: "node", format: "esm", logLevel: "silent" });
  const { createAnalyticsService, analyticsValidationEvents } = await import(pathToFileURL(outfile).href);
  const memory = () => {
    const values = {};
    return {
      async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, values[key]])); },
      async set(next) { Object.assign(values, next); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }
    };
  };
  let validated = 0;
  const service = createAnalyticsService({
    config: { measurementId, apiSecret, debug: true }, version: "validation", local: memory(), session: memory(),
    async fetch(url, init) {
      const body = JSON.parse(init.body);
      const response = await fetch(String(url).replace("/mp/collect", "/debug/mp/collect"), { ...init, body: JSON.stringify({ ...body, validation_behavior: "ENFORCE_RECOMMENDATIONS" }) });
      if (!response.ok) throw new Error(`Google validation returned HTTP ${response.status}`);
      const result = await response.json();
      if (result.validationMessages?.length) {
        // Deliberately never log request URLs, client IDs, or credentials.
        console.error(JSON.stringify({ event: body.events[0].name, validationMessages: result.validationMessages.map(({ fieldPath, validationCode }) => ({ fieldPath, validationCode })) }, null, 2));
        return new Response(null, { status: 400 });
      }
      validated += 1;
      return new Response(null, { status: 204 });
    }
  });
  const samples = analyticsValidationEvents();
  for (const sample of samples) await service.track(sample);
  if (validated !== samples.length) throw new Error(`GA4 validation failed: ${validated}/${samples.length} event types accepted.`);
  console.log(`GA4 validation passed for ${validated} event types. Validation requests do not enter reports or DebugView.`);
  if (collectDebug) {
    const probe = createAnalyticsService({
      config: { measurementId, apiSecret, debug: true }, version: "analytics-qa", local: memory(), session: memory()
    });
    for (const sample of [
      { name: "panel_opened", params: {}, engagement_time_msec: 1 },
      { name: "page_view", params: { screen: "evidence" }, engagement_time_msec: 100 },
      { name: "feature_used", params: { feature: "evidence", action: "select" }, engagement_time_msec: 100 }
    ]) {
      if (!await probe.track(sample)) throw new Error("A live DebugView probe failed. Credentials and request URLs are deliberately omitted.");
    }
    console.log("Sent 3 synthetic DebugView probes with extension_version=analytics-qa. Confirm receipt in GA4 DebugView; HTTP success alone does not prove ingestion.");
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
