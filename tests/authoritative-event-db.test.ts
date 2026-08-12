import { afterEach, describe, expect, it, vi } from "vitest";

import { authoritativeEventDatabaseRuntime } from "../src/core/indexeddb/authoritative-event-db";

const originalNavigatorLocks = navigator.locks;

afterEach(() => {
  Reflect.set(navigator, "locks", originalNavigatorLocks);
  vi.restoreAllMocks();
});

function installBrowserLockRequest(
  implementation: (
    callback: (lock: Lock | null) => Promise<unknown> | unknown,
    name: string,
    options: LockOptions
  ) => Promise<unknown> | unknown
) {
  const request = vi.fn(
    (name: string, options: LockOptions, callback: (lock: Lock | null) => Promise<unknown> | unknown) =>
      Promise.resolve(implementation(callback, name, options))
  );
  Reflect.set(navigator, "locks", { request });
  return request;
}

describe("authoritative browser lock adapter", () => {
  it("invokes the protected callback only after acquiring a Lock", async () => {
    const acquiredLock = { name: "journal-owner", mode: "exclusive" } as Lock;
    const request = installBrowserLockRequest(async (callback, name, options) => {
      expect(name).toBe("journal-owner");
      expect(options).toMatchObject({ mode: "exclusive", ifAvailable: true });
      return callback(acquiredLock);
    });
    const callback = vi.fn(() => "acquired");
    const runtime = authoritativeEventDatabaseRuntime();

    await expect(runtime.requestLock("journal-owner", { mode: "exclusive", ifAvailable: true }, callback))
      .resolves.toBe("acquired");
    expect(callback).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns null and does not invoke the protected callback when no Lock is available", async () => {
    const request = installBrowserLockRequest((callback) => callback(null));
    const callback = vi.fn(() => "must-not-run");
    const runtime = authoritativeEventDatabaseRuntime();

    await expect(runtime.requestLock("journal-owner", { mode: "exclusive", ifAvailable: true }, callback))
      .resolves.toBeNull();
    expect(callback).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
  });

  it("preserves callback failure semantics for an acquired browser Lock", async () => {
    const failure = new Error("protected callback failed");
    installBrowserLockRequest((callback) => callback({ name: "journal-owner", mode: "exclusive" } as Lock));
    const runtime = authoritativeEventDatabaseRuntime();

    await expect(
      runtime.requestLock("journal-owner", { mode: "exclusive", ifAvailable: true }, () => Promise.reject(failure))
    ).rejects.toBe(failure);
  });
});
