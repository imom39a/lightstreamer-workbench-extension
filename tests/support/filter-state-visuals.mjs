export const FILTER_STATE_VISUALS = ["context", "editor", "notifications"].flatMap(flow => [
  { geometry: "compact-dark", width: 563, height: 700, theme: "dark", forcedColors: false },
  { geometry: "normal-dark", width: 900, height: 700, theme: "dark", forcedColors: false },
  { geometry: "shallow-forced-dark", width: 900, height: 320, theme: "dark", forcedColors: true },
  { geometry: "wide-dark", width: 1440, height: 900, theme: "dark", forcedColors: false }
].map(view => ({ ...view, flow, id: `filter-state-${flow}-${view.geometry}` })));

/** Shared setup also runs against the pre-change checkout for visual review. */
export async function prepareFilterStateVisual(page, scene) {
  await page.setViewportSize({ width: scene.width, height: scene.height });
  await page.emulateMedia({ colorScheme: scene.theme, forcedColors: scene.forcedColors ? "active" : "none" });
  const scenario = scene.flow === "context" ? "filter-find" : scene.flow === "editor" ? "filter-high-cardinality" : "diagnostic-subscription-context";
  await page.goto(`/?scenario=${scenario}&theme=${scene.theme}`);
  await page.locator('html[data-react-scene-ready="true"]').waitFor();
  if (scene.flow === "context") {
    await page.getByRole("button", { name: /^(Open|Focus|Restore) selected Context$/ }).click();
    const disclosure = page.locator('details[aria-label="Filter selected Evidence"]');
    await disclosure.locator(":scope > summary").click();
    await disclosure.locator(":scope > summary").focus();
  } else if (scene.flow === "editor") {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByRole("button", { name: "Add structured criterion", exact: true }).click();
    await page.getByRole("option", { name: "Add Item criterion", exact: true }).click();
    await page.getByRole("dialog", { name: "Item exact values", exact: true }).waitFor();
    await page.getByLabel("Search exact values", { exact: true }).focus();
  } else {
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByText("Filter notifications", { exact: true }).click();
    await page.getByText("Filter notifications", { exact: true }).focus();
  }
}
