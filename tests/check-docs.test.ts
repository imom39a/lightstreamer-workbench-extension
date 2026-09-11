import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { findMissingMarkdownLinks } from "../scripts/check-docs-links.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "lsew-check-docs-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "docs", "nested"), { recursive: true });
  await writeFile(join(directory, "README.md"), "# Root\n", "utf8");
  await writeFile(join(directory, "docs", "target file.md"), "# Target\n", "utf8");
  return directory;
}

describe("documentation link check", () => {
  it("accepts existing files, directories, fragments, templates, and external links", async () => {
    const directory = await fixture();
    await writeFile(join(directory, "docs", "links.md"), [
      "[root](../README.md)",
      "[repository root](/README.md)",
      "[encoded](target%20file.md#section)",
      "[directory](nested/)",
      "[same-page](#heading)",
      "[site template]({{site}}docs/)",
      "[web](https://example.com/)",
      "![data](data:image/png;base64,abc)"
    ].join("\n"), "utf8");

    await expect(findMissingMarkdownLinks(directory, ["docs/links.md"])).resolves.toEqual([]);
  });

  it("reports every missing local target with its document and line", async () => {
    const directory = await fixture();
    await writeFile(join(directory, "docs", "links.md"), [
      "Existing [target](target%20file.md).",
      "Missing [guide](missing.md).",
      "",
      "![Missing image](images/missing.png)",
      "[Repository escape](../../outside.md)"
    ].join("\n"), "utf8");

    await expect(findMissingMarkdownLinks(directory, ["docs/links.md"])).resolves.toEqual([
      { document: "docs/links.md", line: 2, target: "missing.md" },
      { document: "docs/links.md", line: 4, target: "images/missing.png" },
      { document: "docs/links.md", line: 5, target: "../../outside.md" }
    ]);
  });

  it("checks reference-style Markdown links", async () => {
    const directory = await fixture();
    await writeFile(join(directory, "docs", "links.md"), [
      "Read the [missing guide][guide].",
      "",
      "[guide]: nested/missing.md"
    ].join("\n"), "utf8");

    await expect(findMissingMarkdownLinks(directory, ["docs/links.md"])).resolves.toEqual([
      { document: "docs/links.md", line: 1, target: "nested/missing.md" }
    ]);
  });
});
