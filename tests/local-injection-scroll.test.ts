import { describe, expect, it, vi } from "vitest";

import { scrollLocalInjectionOwnerByPage } from "../src/extension/panel/react/local-injection-document";

describe("Local Injection document scrolling", () => {
  it("moves the shared outer owner by a viewport in either page direction", () => {
    const owner = document.createElement("div");
    Object.defineProperty(owner, "clientHeight", { value: 500 });
    const scrollBy = vi.fn();
    owner.scrollBy = scrollBy;

    scrollLocalInjectionOwnerByPage(owner, "PageDown");
    scrollLocalInjectionOwnerByPage(owner, "PageUp");

    expect(scrollBy).toHaveBeenNthCalledWith(1, { top: 400 });
    expect(scrollBy).toHaveBeenNthCalledWith(2, { top: -400 });
  });

  it("uses a useful minimum step when the document viewport is tiny", () => {
    const owner = document.createElement("div");
    Object.defineProperty(owner, "clientHeight", { value: 10 });
    const scrollBy = vi.fn();
    owner.scrollBy = scrollBy;

    scrollLocalInjectionOwnerByPage(owner, "PageDown");

    expect(scrollBy).toHaveBeenCalledWith({ top: 24 });
  });
});
