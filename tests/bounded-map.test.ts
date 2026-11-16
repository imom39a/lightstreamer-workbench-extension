import { describe, expect, it } from "vitest";
import { BoundedMap, BoundedSet, evictOldest } from "../src/core/bounded-map";

describe("BoundedMap", () => {
  it("evicts the oldest inserted key only after an insertion exceeds capacity", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1).set("b", 2);
    expect([...map.keys()]).toEqual(["a", "b"]);
    map.set("c", 3);
    expect([...map.entries()]).toEqual([["b", 2], ["c", 3]]);
  });

  it("keeps an updated key at its original position", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1).set("b", 2).set("a", 10);
    expect([...map.entries()]).toEqual([["a", 10], ["b", 2]]);
    map.set("c", 3);
    expect([...map.keys()]).toEqual(["b", "c"]);
  });

  it("does not refresh recency on reads", () => {
    const map = new BoundedMap<string, number>(2);
    map.set("a", 1).set("b", 2);
    expect(map.get("a")).toBe(1);
    expect(map.has("a")).toBe(true);
    map.set("c", 3);
    expect(map.has("a")).toBe(false);
  });

  it("behaves as an ordinary Map for delete, clear and iteration", () => {
    const map = new BoundedMap<string, number>(3);
    map.set("a", 1).set("b", 2).set("c", 3);
    map.delete("b");
    map.set("d", 4);
    expect([...map.keys()]).toEqual(["a", "c", "d"]);
    map.clear();
    expect(map.size).toBe(0);
    expect(map).toBeInstanceOf(Map);
    expect(map.capacity).toBe(3);
  });

  it("rejects invalid capacities", () => {
    expect(() => new BoundedMap(-1)).toThrow(RangeError);
    expect(() => new BoundedMap(1.5)).toThrow(RangeError);
    expect(new BoundedMap<string, number>(0).set("a", 1).size).toBe(0);
  });
});

describe("BoundedSet", () => {
  it("evicts the oldest inserted value after an insertion exceeds capacity", () => {
    const set = new BoundedSet<string>(2);
    set.add("a").add("b").add("a").add("c");
    expect([...set]).toEqual(["b", "c"]);
  });
});

describe("evictOldest", () => {
  it("trims plain maps and sets in insertion order", () => {
    const map = new Map([["a", 1], ["b", 2], ["c", 3]]);
    evictOldest(map, 1);
    expect([...map.keys()]).toEqual(["c"]);
    const set = new Set([1, 2, 3]);
    evictOldest(set, 2);
    expect([...set]).toEqual([2, 3]);
    evictOldest(set, 5);
    expect([...set]).toEqual([2, 3]);
  });
});
