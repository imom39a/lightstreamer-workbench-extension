import { stat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { marked } from "marked";

function isExternalOrGeneratedTarget(target) {
  return target.startsWith("#")
    || target.startsWith("//")
    || target.startsWith("{{")
    || /^[a-z][a-z0-9+.-]*:/i.test(target);
}

function targetPath(target) {
  const withoutFragmentOrQuery = target.split(/[?#]/, 1)[0];
  if (!withoutFragmentOrQuery) return null;
  try {
    return decodeURIComponent(withoutFragmentOrQuery);
  } catch {
    return withoutFragmentOrQuery;
  }
}

function markdownLinks(source) {
  const links = [];
  let searchFrom = 0;
  marked.walkTokens(marked.lexer(source), (token) => {
    if (token.type !== "link" && token.type !== "image") return;
    const index = source.indexOf(token.raw, searchFrom);
    links.push({
      target: token.href,
      line: index < 0 ? 1 : source.slice(0, index).split("\n").length
    });
    if (index >= 0) searchFrom = index + token.raw.length;
  });
  return links;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

export async function findMissingMarkdownLinks(rootDirectory, documents) {
  const root = resolve(rootDirectory);
  const missing = [];

  for (const document of documents) {
    const absoluteDocument = resolve(root, document);
    const source = await readFile(absoluteDocument, "utf8");
    const displayDocument = relative(root, absoluteDocument).split(sep).join("/");

    for (const link of markdownLinks(source)) {
      if (isExternalOrGeneratedTarget(link.target)) continue;
      const decodedTarget = targetPath(link.target);
      if (decodedTarget === null) continue;
      const absoluteTarget = decodedTarget.startsWith("/")
        ? resolve(root, `.${decodedTarget}`)
        : resolve(dirname(absoluteDocument), decodedTarget);
      const relativeTarget = relative(root, absoluteTarget);
      const escapesRepository = relativeTarget === ".."
        || relativeTarget.startsWith(`..${sep}`)
        || isAbsolute(relativeTarget);
      if (escapesRepository || !(await exists(absoluteTarget))) {
        missing.push({
          document: displayDocument,
          line: link.line,
          target: link.target
        });
      }
    }
  }

  return missing;
}
