import { describe, expect, it } from "vitest";

import {
  CHROME_TEST_ONBOARDING_FEATURES,
  REQUIRED_CHROME_TEST_ARGUMENTS,
  VISIBLE_CFT151_OVERRIDE_PURPOSE,
  chromeTestArguments
} from "../scripts/chrome-test-policy.mjs";

describe("central unattended Chrome policy", () => {
  it("is headless by default and ignores a legacy visible-mode request", () => {
    expect(chromeTestArguments()).toContain("--headless=new");
    expect(chromeTestArguments({ headless: false })).toContain("--headless=new");
  });

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

  it("cannot activate a process under the headless-only policy", () => {
    expect(() => chromeTestArguments({ platform: "darwin", activateOnLaunch: true })).toThrow(/headless|activation/u);
    expect(() => chromeTestArguments({ platform: "linux", activateOnLaunch: true })).toThrow(/headless|activation/u);
  });

  it("keeps visible mode restricted to the explicit history-100k CFT151 override", () => {
    const args = chromeTestArguments({
      profile: "/tmp/lsew-visible-policy-profile",
      headless: false,
      visibleCft151Override: true,
      purpose: VISIBLE_CFT151_OVERRIDE_PURPOSE,
      disableNativeOcclusion: true,
      additional: ["--remote-debugging-port=0"]
    });

    expect(args).not.toContain("--headless=new");
    expect(args).toContain("--user-data-dir=/tmp/lsew-visible-policy-profile");
    expect(args).toContain("--remote-debugging-port=0");
    for (const required of REQUIRED_CHROME_TEST_ARGUMENTS) expect(args).toContain(required);
  });

  it("rejects visible mode without its explicit purpose and headless opt-out", () => {
    expect(() => chromeTestArguments({
      headless: false,
      visibleCft151Override: true
    })).toThrow(/history-100k|purpose/u);
    expect(() => chromeTestArguments({
      headless: true,
      visibleCft151Override: true,
      purpose: VISIBLE_CFT151_OVERRIDE_PURPOSE
    })).toThrow(/headless:false/u);
  });
});
