import type { ActivityTimeRange } from "../../../core/activity-projection";

export function activityElapsed(timestamp: number, origin: number): string {
  const seconds = (timestamp - origin) / 1_000;
  return `${seconds < 0 ? "−" : "+"}${Math.abs(seconds).toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0")}s`;
}

export function activityRangeLabel(range: ActivityTimeRange, origin: number): string {
  return `${activityElapsed(range.start, origin)}–${activityElapsed(range.end, origin)}`;
}
