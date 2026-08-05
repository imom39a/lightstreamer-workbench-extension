import { describe, expect, it } from "vitest";

import {
  expandJsonStringFields,
  isCompleteJsonContainerString,
  jsonStructurallyEqual,
  parseJsonContainerString,
  serializeJsonStringFields
} from "../src/core/json-string-fields";

describe("JSON string fields", () => {
  it("expands complete object and array strings without changing an untouched source", () => {
    const source = {
      modelValues: '  {"record":{"id":7,"enabled":true}}  ',
      tags: '["priority","international"]',
      status: "open"
    } as const;

    const expanded = expandJsonStringFields(source);

    expect(expanded.fields).toEqual({
      modelValues: { record: { id: 7, enabled: true } },
      tags: ["priority", "international"],
      status: "open"
    });
    expect(expanded.encodedFieldNames).toEqual(["modelValues", "tags"]);
    expect(Object.isFrozen(expanded.encodedFieldNames)).toBe(true);
    expect(serializeJsonStringFields(expanded)).toEqual(source);
    expect(source).toEqual({
      modelValues: '  {"record":{"id":7,"enabled":true}}  ',
      tags: '["priority","international"]',
      status: "open"
    });
  });

  it("serializes an edited expanded container as a delivery string", () => {
    const expanded = expandJsonStringFields({
      modelValues: '{"record":{"id":7,"enabled":true}}',
      command: "UPDATE"
    });

    const serialized = serializeJsonStringFields(expanded, {
      ...expanded.fields,
      modelValues: { record: { id: 7, enabled: false }, labels: ["review"] }
    });

    expect(serialized).toEqual({
      modelValues: '{"record":{"id":7,"enabled":false},"labels":["review"]}',
      command: "UPDATE"
    });
    expect(() => serializeJsonStringFields(expanded, {
      ...expanded.fields,
      modelValues: "plain text"
    })).toThrow('Encoded JSON field "modelValues" must remain a JSON object or array.');
  });

  it("keeps malformed, ordinary, and scalar JSON strings as strings", () => {
    const fields = {
      malformed: '{"record":',
      ordinary: "not JSON",
      quoted: '"still a string"',
      scalar: "42",
      boolean: "true",
      nullValue: "null",
      number: 4
    } as const;

    const expanded = expandJsonStringFields(fields);

    expect(expanded.fields).toEqual(fields);
    expect(expanded.encodedFieldNames).toEqual([]);
    expect(serializeJsonStringFields(expanded)).toEqual(fields);
    expect(parseJsonContainerString(fields.malformed)).toBeNull();
    expect(parseJsonContainerString(fields.quoted)).toBeNull();
    expect(parseJsonContainerString(fields.scalar)).toBeNull();
    expect(parseJsonContainerString(42)).toBeNull();
    expect(isCompleteJsonContainerString('{"record":[]}')).toBe(true);
    expect(isCompleteJsonContainerString("true")).toBe(false);
  });

  it("compares JSON structurally and never mutates source or expanded containers", () => {
    const source = { modelValues: '{ "b": 2, "a": { "rows": [1, 2] } }' } as const;
    const expanded = expandJsonStringFields(source);
    const original = expanded.fields.modelValues;

    expect(jsonStructurallyEqual(
      { a: { rows: [1, 2] }, b: 2 },
      { b: 2, a: { rows: [1, 2] } }
    )).toBe(true);
    expect(jsonStructurallyEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonStructurallyEqual({ id: 7 }, { id: "7" })).toBe(false);
    expect(Object.isFrozen(expanded.fields)).toBe(true);
    expect(Object.isFrozen(original)).toBe(true);
    expect(Object.isFrozen((original as { a: unknown }).a)).toBe(true);
    expect(serializeJsonStringFields(expanded, {
      modelValues: { a: { rows: [1, 2] }, b: 2 }
    })).toEqual(source);
    expect(source).toEqual({ modelValues: '{ "b": 2, "a": { "rows": [1, 2] } }' });
  });

  it("retains field names that overlap object prototype properties", () => {
    const source = Object.fromEntries([["__proto__", '{"safe":true}']]);
    const expanded = expandJsonStringFields(source);

    expect(Object.hasOwn(expanded.fields, "__proto__")).toBe(true);
    expect(expanded.fields.__proto__).toEqual({ safe: true });
    expect(serializeJsonStringFields(expanded)).toEqual(source);
  });
});
