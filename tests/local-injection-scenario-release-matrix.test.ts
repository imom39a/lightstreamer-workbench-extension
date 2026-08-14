import { describe, expect, it } from "vitest";
import {
  LOCAL_INJECTION_SCENARIO_RELEASE_MATRIX,
  LOCAL_INJECTION_SCENARIO_RELEASE_REQUIREMENTS
} from "./support/local-injection-scenario-release-matrix";

describe("Local Injection Scenario release matrix", () => {
  it("maps every required deterministic release proof to one stable unique ID", () => {
    const ids = LOCAL_INJECTION_SCENARIO_RELEASE_MATRIX.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...LOCAL_INJECTION_SCENARIO_RELEASE_REQUIREMENTS].sort());
    expect(LOCAL_INJECTION_SCENARIO_RELEASE_MATRIX.every(({ file, proof }) =>
      file.length > 0 && proof.length > 0
    )).toBe(true);
  });
});
