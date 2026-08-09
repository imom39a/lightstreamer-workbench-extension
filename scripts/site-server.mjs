#!/usr/bin/env node

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";

import { SITE_BASE_PATH } from "../site/site.config.mjs";

const outputRoot = resolve(import.meta.dirname, "../site-dist");
const port = Number(process.env.LSEW_SITE_PORT ?? 4181);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith(SITE_BASE_PATH)) pathname = pathname.slice(SITE_BASE_PATH.length - 1);
  let requested = resolve(outputRoot, `.${pathname}`);
  if (existsSync(requested) && statSync(requested).isDirectory()) requested = resolve(requested, "index.html");
  if (!requested.startsWith(`${outputRoot}/`) || !existsSync(requested) || !statSync(requested).isFile()) {
    requested = resolve(outputRoot, "404.html");
    response.statusCode = 404;
  }
  response.setHeader("Content-Type", contentType(requested));
  createReadStream(requested).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Lightstreamer Workbench site available at http://127.0.0.1:${port}${SITE_BASE_PATH}`);
});

function contentType(path) {
  switch (extname(path)) {
    case ".css": return "text/css; charset=utf-8";
    case ".html": return "text/html; charset=utf-8";
    case ".png": return "image/png";
    case ".svg": return "image/svg+xml";
    case ".xml": return "application/xml; charset=utf-8";
    default: return "text/plain; charset=utf-8";
  }
}
