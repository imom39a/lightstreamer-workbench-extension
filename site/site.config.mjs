export const SITE_ORIGIN = "https://imom39a.github.io";
export const SITE_BASE_PATH = "/lightstreamer-workbench-extension/";
export const SITE_URL = `${SITE_ORIGIN}${SITE_BASE_PATH}`;
export const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/lightstreamer-workbench/kfpgbhfphbhkebglopimjhfnnmbifocf";
export const GITHUB_REPOSITORY_URL = "https://github.com/imom39a/lightstreamer-workbench-extension";
// Dedicated GitHub Pages web stream in the Workbench GA4 property.
export const SITE_GA_MEASUREMENT_ID = "G-SY4DYL8WH5";

export function sitePath(path = "") {
  return `${SITE_BASE_PATH}${path.replace(/^\//, "")}`;
}

export function canonicalUrl(path = "") {
  return new URL(sitePath(path), SITE_ORIGIN).href;
}
