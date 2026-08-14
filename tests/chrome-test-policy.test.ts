import { describe, expect, it } from "vitest";

import {
  CHROME_TEST_ONBOARDING_FEATURES,
  REQUIRED_CHROME_TEST_ARGUMENTS,
  chromeTestArguments
} from "../scripts/chrome-test-policy.mjs";

describe("central unattended Chrome policy", () => {
  it("requires every prompt-suppression and onboarding flag", () => {
    const args = chromeTestArguments({
      profile: "/tmp/lsew-policy-profile",
      headless: true,
      noProxyServer: true,
      disableNativeOcclusion: true,
      allowFileAccess: true,
      exposeGc: true,
      additional: ["--remote-debugging-port=0"]
    });

    for (const required of REQUIRED_CHROME_TEST_ARGUMENTS) expect(args).toContain(required);
    expect(args).toContain("--headless=new");
    expect(args).toContain("--disable-features=CalculateNativeWinOcclusion," + CHROME_TEST_ONBOARDING_FEATURES.join(","));
    expect(args).toContain("--user-data-dir=/tmp/lsew-policy-profile");
    expect(args).toContain("--remote-debugging-port=0");
    expect(args).not.toContain("--activate-on-launch");
  });

  it("cannot activate a headless or non-macOS process", () => {
    expect(() => chromeTestArguments({ headless: true, activateOnLaunch: true })).toThrow(/activation/u);
    expect(() => chromeTestArguments({ platform: "linux", activateOnLaunch: true })).toThrow(/activation/u);
  });
});
