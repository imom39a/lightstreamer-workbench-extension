export declare const REQUIRED_CHROME_TEST_ARGUMENTS: readonly string[];
export declare const CHROME_TEST_ONBOARDING_FEATURES: readonly string[];
export declare const VISIBLE_CFT151_OVERRIDE_PURPOSE: "history-100k-activation";

export type ChromeTestArgumentsOptions = Readonly<{
  profile?: string | null;
  headless?: boolean;
  visibleCft151Override?: boolean;
  purpose?: string | null;
  platform?: string;
  noProxyServer?: boolean;
  disableNativeOcclusion?: boolean;
  allowFileAccess?: boolean;
  exposeGc?: boolean;
  activateOnLaunch?: boolean;
  additional?: readonly string[];
}>;

export declare function chromeTestArguments(options?: ChromeTestArgumentsOptions): readonly string[];
