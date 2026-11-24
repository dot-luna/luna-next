import { externalLink } from "./links.ts";

// Resolve installed apps for each document. Never infer app membership from the
// destination, tab's opener, or a host suffix: ordinary Chromium pages stay local.
void chrome.runtime
  .sendMessage({ type: "origins" })
  .then((result) => {
    if (!result?.appOrigins?.includes(location.origin)) return;
    const intercept = (event: MouseEvent) => {
      if (!event.isTrusted || event.defaultPrevented || event.altKey) return;
      if (event.type === "click" ? event.button !== 0 : event.button !== 1) return;
      const anchor = event.composedPath().find((node) => node instanceof HTMLAnchorElement);
      if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute("download")) return;
      const target = anchor.target || document.querySelector("base")?.target || "_self";
      if (!["_self", "_top", "_parent", "_blank"].includes(target.toLowerCase())) return;
      if (!externalLink({ source: location.href, destination: anchor.href, ...result })) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void chrome.runtime
        .sendMessage({
          type: "open",
          url: anchor.href,
          newTab:
            event.button === 1 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            target.toLowerCase() === "_blank",
        })
        .catch(console.error);
    };
    window.addEventListener("click", intercept, true);
    window.addEventListener("auxclick", intercept, true);
  })
  .catch(console.error);
