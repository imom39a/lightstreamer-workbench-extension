import { vi } from "vitest";

/** Drives collection deterministically; it does not measure a runtime GC. */
export function installControlledWeakLifetimes() {
  const references: Array<{ value: object | undefined }> = [];
  const registrations: Array<{
    target: object; token: object | undefined; held: unknown; active: boolean;
    callback: (held: unknown) => void;
  }> = [];
  vi.stubGlobal("WeakRef", class {
    value: object | undefined;
    constructor(target: object) { this.value = target; references.push(this); }
    deref() { return this.value; }
  });
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(readonly callback: (held: unknown) => void) {}
    register(target: object, held: unknown, token?: object) {
      registrations.push({ target, held, token, callback: this.callback, active: true });
    }
    unregister(token: object) {
      const matches = registrations.filter((entry) => entry.token === token && entry.active);
      for (const entry of matches) entry.active = false;
      return matches.length > 0;
    }
  });
  return {
    collect(target: object, finalize = true) {
      for (const reference of references) if (reference.value === target) reference.value = undefined;
      if (finalize) {
        for (const entry of registrations) {
          if (entry.target === target && entry.active) {
            entry.active = false;
            entry.callback(entry.held);
          }
        }
      }
    },
    restore: () => vi.unstubAllGlobals()
  };
}
