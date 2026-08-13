/**
 * Arguments shared by every repository-owned Chrome launch.
 *
 * These flags keep unattended developer/test launches away from macOS
 * Keychain and browser sign-in/password onboarding. Callers still own the
 * browser mode, extension loading, and fresh profile they need for the test.
 */
export const CHROME_UNATTENDED_FLAGS = Object.freeze([
  "--use-mock-keychain",
  "--password-store=basic",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-signin-promo",
  "--disable-features=PasswordManagerOnboarding,SigninIntercept,AutofillServerCommunication,ProfilePickerOnboarding"
]);

export function chromeUnattendedArguments(extra = []) {
  const result = [];
  const seen = new Set();
  const disabledFeatures = new Set();
  let disabledFeaturesIndex = -1;
  for (const argument of [...CHROME_UNATTENDED_FLAGS, ...extra]) {
    if (argument.startsWith("--disable-features=")) {
      if (disabledFeaturesIndex === -1) {
        disabledFeaturesIndex = result.length;
        result.push(null);
      }
      for (const feature of argument.slice("--disable-features=".length).split(",")) {
        if (feature) disabledFeatures.add(feature);
      }
      continue;
    }
    if (seen.has(argument)) continue;
    seen.add(argument);
    result.push(argument);
  }
  if (disabledFeaturesIndex !== -1) result[disabledFeaturesIndex] = `--disable-features=${[...disabledFeatures].join(",")}`;
  return result;
}

/**
 * Playwright launch options keep the unattended flags even when no explicit
 * executable is selected. Omitting user-data-dir lets Playwright own a fresh
 * temporary profile for every browser context.
 */
export function createPlaywrightLaunchOptions(executablePath) {
  const options = { args: chromeUnattendedArguments() };
  if (executablePath) options.executablePath = executablePath;
  return options;
}
