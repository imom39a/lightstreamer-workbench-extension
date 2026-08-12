import { describe, expect, it } from "vitest";

import { waitForStableVisualLayout, type VisualLayoutSample } from "./ui/visual-readiness";

const sample = (width: number): VisualLayoutSample => ({
  left: 0,
  top: 0,
  width,
  height: 700,
  viewportWidth: 900,
  viewportHeight: 700
});

describe("visual readiness", () => {
  it("waits for fonts and late async layout publication before accepting two stable samples", async () => {
    const events: string[] = [];
    const samples = [sample(900), sample(901), sample(900), sample(900)];
    let index = 0;

    const result = await waitForStableVisualLayout(
      async () => {
        events.push("fonts");
      },
      async () => {
        events.push(`sample:${index}`);
        return samples[Math.min(index++, samples.length - 1)];
      },
      async () => {
        events.push("frame");
      }
    );

    expect(result).toEqual(sample(900));
    expect(events).toEqual([
      "fonts",
      "sample:0",
      "frame",
      "sample:1",
      "frame",
      "sample:2",
      "frame",
      "sample:3"
    ]);
  });
});
