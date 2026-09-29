import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

import { SITE_GA_MEASUREMENT_ID } from "../../site/site.config.mjs";

const script = await readFile(resolve(import.meta.dirname, "../../site-dist/assets/site-analytics.js"), "utf8");
const official = "https://imom39a.github.io/lightstreamer-workbench-extension/docs/evidence/?token=private#details";
const referrer = "https://example.org/private?token=secret";

function load(url, disabled = false) {
  const dom = new JSDOM(`<!doctype html><title>Ordered Evidence</title><button data-site-analytics-toggle hidden></button><span data-site-analytics-status></span>`, {
    url,
    referrer,
    runScripts: "outside-only"
  });
  if (disabled) dom.window.localStorage.setItem("lightstreamer-workbench.website-analytics.disabled", "1");
  dom.window.eval(script);
  return dom.window;
}

test("the official site sends one page view with only a public path", () => {
  const window = load(official);
  const calls = window.dataLayer.map((entry) => Array.from(entry));
  const views = calls.filter(([command, name]) => command === "event" && name === "page_view");
  assert.equal(views.length, 1);
  assert.equal(views[0][2].page_location, "https://imom39a.github.io/lightstreamer-workbench-extension/docs/evidence/");
  assert.equal(views[0][2].page_referrer, "");
  assert.equal(views[0][2].app_surface, "website");
  const config = calls.find(([command]) => command === "config");
  assert.equal(config[1], SITE_GA_MEASUREMENT_ID);
  assert.equal(config[2].send_page_view, false);
  assert.equal(config[2].allow_google_signals, false);
  assert.equal(config[2].allow_ad_personalization_signals, false);
  assert.equal(config[2].app_surface, "website");
  assert.equal(config[2].cookie_domain, "none");
  assert.equal(window.document.querySelector("[data-site-analytics-toggle]").hidden, false);
  assert.doesNotMatch(JSON.stringify(calls), /private|secret|token=|#details/);
  assert.equal(window.document.querySelectorAll('script[src^="https://www.googletagmanager.com/"]').length, 1);
  window.close();
});

test("local previews and other GitHub Pages paths never load the Google tag", () => {
  for (const url of [
    "http://127.0.0.1:4173/lightstreamer-workbench-extension/",
    "https://other.github.io/lightstreamer-workbench-extension/",
    "https://imom39a.github.io/other-project/"
  ]) {
    const window = load(url);
    assert.equal(window.dataLayer, undefined, url);
    assert.equal(window.document.querySelectorAll("script").length, 0, url);
    window.close();
  }
});

test("a saved opt-out blocks collection and the control stops later requests", () => {
  const optedOut = load(official, true);
  assert.equal(optedOut.dataLayer, undefined);
  assert.equal(optedOut.document.querySelectorAll("script").length, 0);
  assert.equal(optedOut[`ga-disable-${SITE_GA_MEASUREMENT_ID}`], true);
  optedOut.close();

  const window = load(official);
  window.document.cookie = "lsew_site_ga=example; Path=/lightstreamer-workbench-extension/";
  window.document.querySelector("[data-site-analytics-toggle]").click();
  assert.equal(window.localStorage.getItem("lightstreamer-workbench.website-analytics.disabled"), "1");
  assert.equal(window[`ga-disable-${SITE_GA_MEASUREMENT_ID}`], true);
  assert.doesNotMatch(window.document.cookie, /lsew_site_ga/);
  window.close();
});

test("an opt-out in another tab stops an already-open page", () => {
  const window = load(official);
  window.dispatchEvent(new window.StorageEvent("storage", {
    key: "lightstreamer-workbench.website-analytics.disabled",
    newValue: "1"
  }));
  assert.equal(window[`ga-disable-${SITE_GA_MEASUREMENT_ID}`], true);
  assert.equal(window.document.querySelector("[data-site-analytics-status]").textContent, "Website analytics is off in this browser.");
  window.close();
});
