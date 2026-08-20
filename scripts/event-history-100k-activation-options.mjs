export const HISTORY_100K_VISIBLE_CFT151_OVERRIDE_ARG = "--visible-cft151-override";

export function parseHistory100kActivationArguments(argumentsList = process.argv.slice(2)) {
  if (!Array.isArray(argumentsList) || argumentsList.some((argument) => typeof argument !== "string")) {
    throw new Error("History 100k activation arguments must be strings.");
  }
  const unknown = argumentsList.filter((argument) => argument !== HISTORY_100K_VISIBLE_CFT151_OVERRIDE_ARG);
  if (unknown.length > 0) {
    throw new Error(`Unknown history 100k activation argument: ${unknown[0]}`);
  }
  return Object.freeze({
    visibleCft151Override: argumentsList.includes(HISTORY_100K_VISIBLE_CFT151_OVERRIDE_ARG)
  });
}
