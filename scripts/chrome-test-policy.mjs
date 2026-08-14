/**
 * Central launch policy for every unattended, headless Chrome process used by
 * the repository's browser, UI, visual, fixture, and performance proofs.
 *
 * Callers own the profile lifecycle. Direct launchers must pass a fresh
 * temporary profile; Playwright owns an equivalent fresh profile when no
 * profile argument is supplied.
 */

export const REQUIRED_CHROME_TEST_ARGUMENTS = Object.freeze([
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-signin-promo"
]);

export const CHROME_TEST_ONBOARDING_FEATURES = Object.freeze([
  "PasswordManagerOnboarding",
  "SigninInterception",
  "ProfilePickerOnStartup"
]);

export function chromeTestArguments({
  profile = null,
  // Retained for compatibility with older callers. The repository policy is
  // unconditionally headless and never honors a visible-mode request.
  headless: _requestedHeadless = true,
  platform: _platform = process.platform,
  noProxyServer = false,
  disableNativeOcclusion = false,
  allowFileAccess = false,
  exposeGc = false,
  activateOnLaunch = false,
  additional = []
} = {}) {
  if (profile !== null && (typeof profile !== "string" || profile.length === 0)) {
    throw new Error("Chrome test policy profile must be a non-empty path when supplied.");
  }
  if (!Array.isArray(additional) || additional.some((argument) => typeof argument !== "string" || argument.length === 0)) {
    throw new Error("Chrome test policy additional arguments must be non-empty strings.");
  }
  if (activateOnLaunch) {
    throw new Error("Chrome test policy is headless-only; activateOnLaunch is unavailable.");
  }

  const features = [
    ...(disableNativeOcclusion ? ["CalculateNativeWinOcclusion"] : []),
    ...CHROME_TEST_ONBOARDING_FEATURES
  ];
  const argumentsList = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    ...(noProxyServer ? ["--no-proxy-server"] : []),
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    `--disable-features=${features.join(",")}`,
    ...(allowFileAccess ? ["--allow-file-access-from-files"] : []),
    ...(exposeGc ? ["--js-flags=--expose-gc"] : []),
    ...REQUIRED_CHROME_TEST_ARGUMENTS,
    ...(profile === null ? [] : [`--user-data-dir=${profile}`]),
    ...(activateOnLaunch ? ["--activate-on-launch"] : []),
    ...additional
  ];
  return Object.freeze(argumentsList);
}
