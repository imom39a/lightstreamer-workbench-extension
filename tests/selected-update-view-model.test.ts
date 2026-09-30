import { describe, expect, it } from "vitest";

import { selectedUpdateSnapshot } from "../src/extension/panel/selected-update-view-model";

describe("selectedUpdateSnapshot", () => {
  it("does not mistake inherited object properties for declared field value states", () => {
    const fields = JSON.parse('{"constructor":"ctor","__proto__":"proto","toString":"text"}');
    expect(selectedUpdateSnapshot({ fields, fieldValueStates: {} })?.fields).toEqual([
      { name: "constructor", display: "ctor", jsonString: false },
      { name: "__proto__", display: "proto", jsonString: false },
      { name: "toString", display: "text", jsonString: false }
    ]);
  });

  it("preserves numeric literals and duplicate properties in encoded JSON presentation", () => {
    const snapshot = selectedUpdateSnapshot({ fields: { details: ' { "id":9007199254740993, "amount":1.2300, "a":1,"a":2 } ' } });
    expect(snapshot?.fields[0]?.display).toContain("9007199254740993");
    expect(snapshot?.fields[0]?.display).toContain("1.2300");
    expect(snapshot?.fields[0]?.display.match(/"a"/g)).toHaveLength(2);
    expect(snapshot?.fields[0]?.jsonString).toBe(true);
  });

  it("labels uncertain and unavailable fields instead of displaying null placeholders as captured values", () => {
    const snapshot = selectedUpdateSnapshot({ fields: { current: null, unknown: null, redacted: "hidden" },
      fieldValueStates: { current: "concrete", unknown: "ambiguous-null", redacted: "redacted", missing: "unavailable" } });
    expect(snapshot?.fields.find(entry => entry.name === "current")?.display).toBe("null");
    expect(snapshot?.fields.find(entry => entry.name === "unknown")?.display).toMatch(/ambiguous.*not proven/i);
    expect(snapshot?.fields.find(entry => entry.name === "unknown")?.display).not.toBe("null");
    expect(snapshot?.fields.find(entry => entry.name === "redacted")?.display).not.toContain("hidden");
    expect(snapshot?.fields.find(entry => entry.name === "missing")?.display).toMatch(/unavailable/i);
  });

  it("expands complete JSON object and array strings while keeping malformed and scalar strings truthful", () => {
    const snapshot = selectedUpdateSnapshot({
      fields: {
        object: '{"flight":{"number":"DL42"}}',
        list: '["ATL","JFK"]',
        scalar: "42",
        malformed: "{not-json",
        ordinary: "DL42"
      },
      changedFields: { object: '{"flight":{"number":"DL42"}}' },
      jsonPatches: { object: { op: "replace", path: "/flight/number", value: "DL43" } }
    });

    expect(snapshot?.fields).toEqual([
      { name: "object", display: '{\n  "flight": {\n    "number": "DL42"\n  }\n}', jsonString: true },
      { name: "list", display: '[\n  "ATL",\n  "JFK"\n]', jsonString: true },
      { name: "scalar", display: "42", jsonString: false },
      { name: "malformed", display: "{not-json", jsonString: false },
      { name: "ordinary", display: "DL42", jsonString: false }
    ]);
    expect(snapshot?.changedFields[0]?.jsonString).toBe(true);
    expect(snapshot?.jsonPatches[0]).toEqual({
      name: "object",
      display: '{\n  "op": "replace",\n  "path": "/flight/number",\n  "value": "DL43"\n}',
      jsonString: false
    });
  });
});
