import { attachSidebar, messageCss } from "./appearance.ts";
import { createControls } from "./controls.ts";
import { matchesShortcut, readSettings, type Settings } from "./schema.ts";
import { navigateUnread, type UnreadAction } from "./unread.ts";

async function start() {
  let settings = readSettings((await chrome.storage.local.get("settings")).settings);
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  let sidebar: ReturnType<typeof attachSidebar> | undefined;
  let pane: HTMLElement | null = null;
  let navigation: AbortController | undefined;
  function apply() {
    sheet.replaceSync(messageCss(settings.fontSize));
    sidebar?.update(settings.sidebarWidth);
  }
  function save(value: Settings) {
    settings = value;
    apply();
    void chrome.storage.local
      .set({ settings })
      .catch((error) => console.error("Luna WhatsApp preferences:", error));
  }
  const controls = createControls(document, () => settings, save);
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.style.cssText =
    "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:200;padding:8px;background:Canvas;color:CanvasText;font:14px system-ui";
  status.hidden = true;
  document.body.append(status);
  let dismiss = 0;
  function announce(message: string) {
    status.textContent = message;
    status.hidden = !message;
    clearTimeout(dismiss);
    if (message)
      dismiss = window.setTimeout(() => {
        status.hidden = true;
      }, 3000);
  }
  function attach() {
    const next = document.querySelector<HTMLElement>("#pane-side");
    if (next !== pane) {
      navigation?.abort();
      sidebar?.dispose();
      pane = next;
      sidebar = pane
        ? attachSidebar(pane, settings.sidebarWidth, (sidebarWidth) =>
            save({ ...settings, sidebarWidth }),
          )
        : undefined;
    }
    const header = pane?.parentElement?.querySelector("header");
    if (header && !controls.button.isConnected) header.append(controls.button);
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      attach();
    });
  }).observe(document.body, { childList: true, subtree: true });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.settings) {
      settings = readSettings(changes.settings.newValue);
      apply();
    }
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (controls.isOpen || event.isComposing || event.repeat || event.metaKey) return;
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.code === "Space") {
        event.preventDefault();
        event.stopImmediatePropagation();
        controls.open();
        return;
      }
      if (event.key === "Escape") {
        navigation?.abort();
        return;
      }
      let action: UnreadAction | undefined;
      if (matchesShortcut(event, settings.next)) action = { direction: 1 };
      else if (matchesShortcut(event, settings.previous)) action = { direction: -1 };
      else if (
        settings.numbered &&
        event.ctrlKey &&
        event.altKey &&
        !event.shiftKey &&
        /^Digit[1-9]$/u.test(event.code)
      )
        action = { number: Number(event.code.slice(-1)) };
      if (!action || !pane) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigation?.abort();
      const controller = (navigation = new AbortController());
      announce("");
      void navigateUnread({ pane, action, signal: controller.signal })
        .then((found) => {
          if (!found && !controller.signal.aborted)
            announce("No matching unread chat in this list.");
        })
        .catch((error) => {
          console.error("Luna unread navigation:", error);
          announce("Unread navigation is unavailable.");
        });
    },
    true,
  );
  document.addEventListener("pointerdown", () => navigation?.abort(), true);
  document.addEventListener("wheel", () => navigation?.abort(), { capture: true, passive: true });
  apply();
  attach();
}

void start().catch((error) => console.error("Luna Better WhatsApp Web:", error));
