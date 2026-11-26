import { HOST } from "./host.ts";

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.frameId !== 0)
    return;
  if (message?.type === "origins" && /^https?:\/\//u.test(sender.url || "")) {
    void chrome.runtime
      .sendNativeMessage(HOST, { type: "origins" })
      .then(respond)
      .catch((error) => respond({ error: String(error.message || error) }));
    return true;
  }
  if (
    message?.type === "open" &&
    typeof message.url === "string" &&
    /^https?:\/\//u.test(sender.url || "")
  ) {
    const tabId = sender.tab.id;
    const source = sender.url!;
    void (async () => {
      const result = await chrome.runtime.sendNativeMessage(HOST, {
        type: "open",
        url: message.url,
        source,
      });
      if (result.error) throw new Error(result.error);
      // Successful handoffs need no browser navigation or temporary tab.
      if (!result.opened) {
        if (message.newTab) await chrome.tabs.create({ url: message.url });
        else await chrome.tabs.update(tabId, { url: message.url });
      }
      respond({ opened: result.opened });
    })().catch(async (error) => {
      const route = new URL(chrome.runtime.getURL("open.html"));
      route.searchParams.set("source", source);
      route.searchParams.set("error", String(error.message || error));
      route.hash = message.url;
      await chrome.tabs.create({ url: route.href });
      respond({ opened: false });
    });
    return true;
  }
  // Retry and close requests belong only to the extension's error page.
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL("open.html") + "?")) return;
  if (message?.type === "close") {
    void chrome.tabs.remove(sender.tab.id);
    return;
  }
  if (message?.type !== "route" || typeof message.url !== "string") return;
  const tabId = sender.tab.id;
  const source = new URL(sender.url).searchParams.get("source");
  void (async () => {
    const result = await chrome.runtime.sendNativeMessage(HOST, {
      type: "open",
      url: message.url,
      source,
    });
    if (result.error) throw new Error(result.error);
    if (!result.opened) await chrome.tabs.update(tabId, { url: message.url });
    respond({ opened: result.opened });
  })().catch((error) => respond({ error: String(error.message || error) }));
  return true;
});
