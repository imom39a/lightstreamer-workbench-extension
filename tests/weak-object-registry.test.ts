import { describe, expect, it, vi } from "vitest";
import { createWeakObjectRegistry } from "../src/injected/weak-object-registry";
import { installControlledWeakLifetimes } from "./helpers/controlled-weak-lifetimes";

describe("weak page-object ownership", () => {
  it("prunes collected metadata even before a finalizer runs", () => {
    const lifetimes = installControlledWeakLifetimes();
    try {
      const collected = vi.fn();
      const registry = createWeakObjectRegistry(collected);
      const first = {};
      const live = {};
      registry.register("first", first);
      registry.register("live", live);
      lifetimes.collect(first, false);
      registry.prune();
      expect(collected).toHaveBeenCalledExactlyOnceWith("first");
      expect(registry.get("live")).toBe(live);
      lifetimes.collect(first);
      expect(collected).toHaveBeenCalledTimes(1);
    } finally { lifetimes.restore(); }
  });

  it("does not retire a replacement registered under the same identity", () => {
    const lifetimes = installControlledWeakLifetimes();
    try {
      const collected = vi.fn();
      const registry = createWeakObjectRegistry(collected);
      const first = {};
      const replacement = {};
      registry.register("same", first);
      registry.register("same", replacement);
      lifetimes.collect(first);
      expect(registry.get("same")).toBe(replacement);
      expect(collected).not.toHaveBeenCalled();
    } finally { lifetimes.restore(); }
  });
});
