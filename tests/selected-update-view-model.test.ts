import { describe, expect, it } from "vitest";

import { selectedUpdateSnapshot } from "../src/extension/panel/selected-update-view-model";

describe("selectedUpdateSnapshot", () => {
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
