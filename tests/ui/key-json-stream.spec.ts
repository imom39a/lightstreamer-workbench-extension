import axe from "axe-core";
import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, scenario: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto(`/?scenario=${scenario}&theme=dark`);
  await expect(page.locator("html")).toHaveAttribute("data-react-scene-ready", "true");
}
async function accessible(page: Page) {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => (await window.axe.run()).violations.filter(v => v.impact === "serious" || v.impact === "critical").map(v => ({ id:v.id, nodes:v.nodes.map(n=>n.target) })));
  expect(violations).toEqual([]);
  expect(await page.locator(".workbench-react").evaluate(el => el.scrollWidth > el.clientWidth)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
}
for (const [frame,width,height] of [["compact",563,700],["normal",900,700],["shallow",900,320],["wide",1440,900]] as const) {
  test(`key/JSON stream keeps full single-line keys and only Op pinned · ${frame}`, async ({page},testInfo) => {
    await open(page,"frozen-high-volume",width,height);
    const ledger=page.getByRole("grid",{name:"Ordered Lightstreamer Evidence"});
    const rows=ledger.locator("[data-evidence-id]");
    await expect(rows).toHaveCount(60);
    expect(await ledger.getByRole("columnheader").allTextContents()).toEqual(["Op","Key / item","Data"]);
    expect(await rows.evaluateAll(elements=>elements.every(row=>{
      const key=row.querySelector<HTMLElement>(".workbench-react__evidence-key")!;
      return row.getBoundingClientRect().height===30 && getComputedStyle(key).whiteSpace==="nowrap" && key.scrollWidth<=key.clientWidth+1 && getComputedStyle(key).textOverflow==="clip";
    }))).toBe(true);
    const positions=()=>rows.first().evaluate(row=>({op:row.querySelector(".workbench-react__evidence-op")!.getBoundingClientRect().left,key:row.querySelector(".workbench-react__evidence-key")!.getBoundingClientRect().left,data:row.querySelector(".workbench-react__evidence-data")!.getBoundingClientRect().left}));
    const pinnedEdges=()=>ledger.evaluate((element)=>{
      const header=element.querySelector<HTMLElement>(".workbench-react__ledger-header > :first-child")!.getBoundingClientRect();
      const op=element.querySelector<HTMLElement>(".workbench-react__evidence-op")!.getBoundingClientRect();
      const ledger=element.getBoundingClientRect();
      return {headerLeft:header.left,headerRight:header.right,opLeft:op.left,opRight:op.right,ledgerLeft:ledger.left};
    });
    const start=await positions(),startEdges=await pinnedEdges();
    expect(startEdges.headerLeft).toBeCloseTo(startEdges.opLeft);expect(startEdges.headerRight).toBeCloseTo(startEdges.opRight);expect(startEdges.opLeft).toBeCloseTo(startEdges.ledgerLeft);
    await ledger.evaluate(el=>el.scrollLeft=500);
    const scroll=await ledger.evaluate(el=>el.scrollLeft),after=await positions(),afterEdges=await pinnedEdges();
    expect(scroll).toBeGreaterThan(0);expect(after.op).toBeCloseTo(start.op);expect(start.key-after.key).toBeCloseTo(scroll);expect(start.data-after.data).toBeCloseTo(scroll);
    expect(afterEdges.headerLeft).toBeCloseTo(afterEdges.opLeft);expect(afterEdges.headerRight).toBeCloseTo(afterEdges.opRight);expect(afterEdges.opLeft).toBeCloseTo(afterEdges.ledgerLeft);
    const dataPositions=await rows.evaluateAll(elements=>elements.map(row=>row.querySelector(".workbench-react__evidence-data")!.getBoundingClientRect().left));
    expect(new Set(dataPositions).size).toBe(1);
    await ledger.focus();await page.keyboard.press("ArrowDown");
    expect(await ledger.evaluate(el=>el.scrollLeft)).toBe(scroll);
    await page.getByRole("button",{name:"Raw fields",exact:true}).click();
    expect(await ledger.evaluate(el=>el.scrollLeft)).toBe(scroll);
    await page.getByRole("button",{name:"Readable",exact:true}).click();
    await accessible(page);
    await expect(page.locator(".workbench-react")).toHaveScreenshot(`key-stream-${frame}.png`);
    await testInfo.attach(`key-stream-${frame}`,{body:await page.locator(".workbench-react").screenshot(),contentType:"image/png"});
  });
  test(`Codes reference is grouped, bounded and keyboard dismissible · ${frame}`, async ({page},testInfo) => {
    await open(page,"live-selected",width,height);
    const trigger=page.getByLabel("Codes",{exact:true});
    await trigger.focus();await page.keyboard.press("Enter");
    const codes=page.getByRole("dialog",{name:"Evidence codes"});
    await expect(codes).toBeVisible();
    await testInfo.attach(`key-stream-codes-top-${frame}`,{body:await page.locator(".workbench-react").screenshot(),contentType:"image/png"});
    for(const text of ["Lightstreamer TLCP","Workbench capture","SUBCMD","EOS","L−"])await expect(codes).toContainText(text);
    await codes.evaluate(el=>el.scrollTop=el.scrollHeight);
    const close=codes.getByRole("button",{name:/Close/});
    await expect(close).toBeVisible();
    expect(await close.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);
    await close.focus();await page.keyboard.press("Escape");
    await expect(codes).not.toBeVisible();await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");await accessible(page);
    await expect(page.locator(".workbench-react")).toHaveScreenshot(`key-stream-codes-${frame}.png`);
    await testInfo.attach(`key-stream-codes-${frame}`,{body:await page.locator(".workbench-react").screenshot(),contentType:"image/png"});
    await close.click();await expect(trigger).toBeFocused();
  });
}
test("Readable JSON is identified and Raw fields keeps captured string types",async({page},testInfo)=>{
  await open(page,"local-injection-json",900,700);
  const row=page.locator('[data-evidence-id="json-string-event"]');
  await expect(row.locator(".workbench-react__evidence-key")).toHaveText("json-string-alpha");
  await expect(row.locator(".workbench-react__json-string-marker")).toContainText("JSON");
  const readable=JSON.parse(await row.locator(".workbench-react__evidence-data code").innerText());
  expect(readable.modelValues.passenger.selected).toBe(false);expect(readable.scalar).toBe("true");
  await page.getByRole("button",{name:"Raw fields",exact:true}).click();
  const raw=JSON.parse(await row.locator(".workbench-react__evidence-data code").innerText());
  expect(typeof raw.modelValues).toBe("string");expect(JSON.parse(raw.modelValues).passenger.selected).toBe(false);
  await expect(row.locator(".workbench-react__json-string-marker")).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-selected","true");
  await accessible(page);
  await expect(page.locator(".workbench-react")).toHaveScreenshot("key-stream-raw-fields.png");
  await testInfo.attach("key-stream-raw-fields",{body:await page.locator(".workbench-react").screenshot(),contentType:"image/png"});
});
