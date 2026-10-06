// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { cooperateEvidenceQuery } from "../src/core/evidence-query-work";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("yields through a real port task without waiting for a timer tick", async () => {
  vi.stubGlobal("setImmediate", undefined);
  const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(() => {
    throw new Error("A throttled timer must not delay a supported port yield");
  });
  let interveningWork = false;
  const pending = cooperateEvidenceQuery(256);
  queueMicrotask(() => { interveningWork = true; });
  await pending;
  expect(interveningWork).toBe(true);
  expect(timer).not.toHaveBeenCalled();
});

it("observes cancellation while a port yield is pending", async () => {
  const controller = new AbortController();
  const pending = cooperateEvidenceQuery(256, controller.signal);
  queueMicrotask(() => controller.abort());
  await expect(pending).rejects.toThrow("EVIDENCE_QUERY_CANCELLED");
});
