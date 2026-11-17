import { HOST, originRules } from "./rules.ts";

let updating = Promise.resolve();
function updateOrigins(origins: string[]) {
  // Serialize replacement so concurrent tabs cannot leave overlapping rule IDs.
  updating = updating
    .catch(() => {})
    .then(async () => {
      const previous = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: previous.map((rule) => rule.id),
        addRules: originRules(origins),
      });
    });
  return updating;
}

async function refresh() {
  const result = await chrome.runtime.sendNativeMessage(HOST, { type: "origins" });
  if (result.error) throw new Error(result.error);
  await updateOrigins(result.origins);
}
chrome.runtime.onInstalled.addListener(() => {
  void refresh().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => {
  void refresh().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our own routing page may ask the native host to open a URL.
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("open.html") + "#") ||
    sender.tab?.id === undefined
  )
    return;
  if (message?.type === "close") {
    void chrome.tabs.remove(sender.tab.id);
    return;
  }
  if (message?.type !== "route" || typeof message.url !== "string") return;
  const tabId = sender.tab.id;
  void (async () => {
    const result = await chrome.runtime.sendNativeMessage(HOST, { type: "open", url: message.url });
    if (result.error) throw new Error(result.error);
    await updateOrigins(result.origins);
    if (!result.opened) await chrome.tabs.update(tabId, { url: message.url });
    respond({ opened: result.opened });
  })().catch((error) => respond({ error: String(error.message || error) }));
  return true;
});
