type LegacyPanelStorage = Pick<Storage, "length" | "key" | "removeItem">;

/** Removes identifiers and consent left by the retired 0.1.x telemetry feature. */
export function clearLegacyPanelStorage(storage: LegacyPanelStorage): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (
        key?.startsWith("lsew.") &&
        (key.endsWith(".consent.v1") || key.endsWith(".client-id.v1"))
      ) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Legacy cleanup must never prevent the DevTools panel from mounting.
  }
}
