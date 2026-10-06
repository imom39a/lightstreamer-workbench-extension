import { afterEach, expect, it, vi } from "vitest";
import { createFirefoxConsentWindow } from "../src/extension/firefox-consent-window";
import { ANALYTICS_MESSAGE } from "../src/extension/analytics/events";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixture() {
  const base = "moz-extension://11111111-2222-4333-8444-555555555555/";
  let listener!: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
  let removed!: (id: number) => void;
  const getAll = vi.fn(async () => ({data_collection:["technicalAndInteraction"]}));
  const create = vi.fn(async () => ({id:71}));
  vi.stubGlobal("browser",{permissions:{getAll}});
  vi.stubGlobal("chrome",{runtime:{id:"workbench",getURL:(path:string)=>base+path,onMessage:{addListener:(fn:typeof listener)=>{listener=fn;}}},windows:{create,onRemoved:{addListener:(fn:typeof removed)=>{removed=fn;}}}});
  const open = createFirefoxConsentWindow();
  const sender = {id:"workbench",url:base+"extension/analytics-consent/index.html",tab:{windowId:71}} as chrome.runtime.MessageSender;
  return {open,listener,getAll,create,sender,close:()=>removed(71)};
}
it("reuses one window and accepts only its owning sender plus a verified native grant", async () => {
  const f=fixture(), result=f.open();
  expect(f.open()).toBe(result); await Promise.resolve();
  for (const sender of [{...f.sender,id:"other"},{...f.sender,url:f.sender.url+"?forged"},{...f.sender,tab:{windowId:72}}]) {
    expect(f.listener({type:ANALYTICS_MESSAGE,action:"consent-result",allowed:true},sender as chrome.runtime.MessageSender,vi.fn())).toBe(false);
  }
  const respond=vi.fn();
  expect(f.listener({type:ANALYTICS_MESSAGE,action:"consent-result",allowed:true},f.sender,respond)).toBe(true);
  expect(await result).toBe(true); expect(respond).toHaveBeenCalledWith({ok:true}); expect(f.create).toHaveBeenCalledTimes(1);
});
it("fails closed for permission-read and window-creation failures and supports a later retry", async () => {
  const f=fixture(); f.getAll.mockRejectedValueOnce(new Error("unavailable"));
  const result=f.open(); await Promise.resolve();
  f.listener({type:ANALYTICS_MESSAGE,action:"consent-result",allowed:true},f.sender,vi.fn());
  expect(await result).toBe(false);
  f.create.mockRejectedValueOnce(new Error("window unavailable"));
  expect(await f.open()).toBe(false);
  const retry=f.open(); await Promise.resolve(); f.close(); expect(await retry).toBe(false);
});
