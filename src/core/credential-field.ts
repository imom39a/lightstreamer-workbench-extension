/** Shared export/agent vocabulary; recognized names cannot expose raw values. */
export function isCredentialFieldName(key: string): boolean {
  return key !== "credentialsExcluded" && /(?:password|passwd|authorization|credential|secret|token|cookie|api[-_]?key)/i.test(key);
}
export function containsCredentialJson(value: string): boolean {
  if (!/^[\s]*[\[{]/.test(value)) return false;
  const inspect = (entry: unknown, depth: number): boolean => {
    if (depth > 16) return true;
    // Encoded JSON fields can contain further encoded JSON strings. Apply the
    // same credential boundary at every level before predicates or grouping
    // inspect values, rather than only sanitizing the returned envelope.
    if (typeof entry === "string" && /^[\s]*[\[{]/.test(entry)) {
      try { return inspect(JSON.parse(entry), depth + 1); } catch { return false; }
    }
    if (!entry || typeof entry !== "object") return false;
    if (Array.isArray(entry)) return entry.some(value => inspect(value, depth + 1));
    return Object.entries(entry).some(([key, value]) => isCredentialFieldName(key) || inspect(value, depth + 1));
  };
  try { return inspect(JSON.parse(value), 0); } catch { return false; }
}
