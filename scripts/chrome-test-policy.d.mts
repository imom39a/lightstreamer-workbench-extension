export declare const REQUIRED_CHROME_TEST_ARGUMENTS: readonly string[];
export declare const CHROME_TEST_ONBOARDING_FEATURES: readonly string[];

export type ChromeTestArgumentsOptions = Readonly<{
  profile?: string | null;
  headless?: boolean;
  platform?: string;
  noProxyServer?: boolean;
  disableNativeOcclusion?: boolean;
  allowFileAccess?: boolean;
  exposeGc?: boolean;
  activateOnLaunch?: boolean;
  additional?: readonly string[];
}>;

export declare function chromeTestArguments(options?: ChromeTestArgumentsOptions): readonly string[];
