import { useRef, useState } from "react";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Structural equality for frozen snapshot data: arrays and plain records are
 * compared by value, everything else (Maps, functions, class instances) only
 * by identity. Reference-equal branches short-circuit, so large immutable
 * sub-objects the runtime reuses (for example a prepared export document)
 * cost one comparison.
 */
export function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (!structurallyEqual(left[index], right[index])) return false;
    }
    return true;
  }
  if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!structurallyEqual(left[key], right[key])) return false;
  }
  return true;
}

/**
 * Returns the previously returned value while the new one is structurally
 * equal. `WorkbenchRuntime` rebuilds most snapshot sub-objects on every
 * publication, so this restores identity for memoized presentation props
 * without changing what is rendered.
 */
export function useStructurallyStable<T>(value: T): T {
  const stable = useRef(value);
  // Render-phase ref write is safe: the ref only ever holds a value
  // structurally equal to, or newer than, the committed one.
  if (!Object.is(stable.current, value) && !structurallyEqual(stable.current, value)) stable.current = value;
  return stable.current;
}

type Handlers = Record<string, (...args: never[]) => unknown>;

/**
 * Stable callbacks that always delegate to the latest render's handlers.
 * Matches the panel's existing `actionsRef` pattern so memoized children
 * receive identity-stable props while handlers keep current closures.
 */
export function useLatestHandlers<T extends Handlers>(handlers: T): T {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [stable] = useState(() => Object.fromEntries(Object.keys(handlers).map((key) => [
    key,
    (...args: never[]) => latest.current[key]!(...args)
  ])) as T);
  return stable;
}
