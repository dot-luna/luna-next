import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { messageCss, attachSidebar } from "../src/appearance.ts";
import { defaults, readSettings, matchesShortcut } from "../src/schema.ts";
import { navigateUnread, chatRows, isUnread } from "../src/unread.ts";

function fixture() {
  const window = new Window({ width: 1000, height: 700 });
  window.document.body.innerHTML =
    '<aside><header>Chats</header><div id="pane-side"></div></aside><div id="main"><header>Header</header><div class="message-in"><span class="selectable-text">Message <a>Link</a></span><span>Timestamp</span></div><footer contenteditable="true">Draft</footer></div>';
  const document = window.document as unknown as Document;
  const pane = document.querySelector<HTMLElement>("#pane-side")!;
  return { window, document, pane };
}
function rows(
  pane: HTMLElement,
  entries: Array<{ id: number; unread?: boolean; active?: boolean }>,
) {
  pane.innerHTML = entries
    .map(
      (row) =>
        `<div role="row" aria-rowindex="${row.id}" aria-selected="${!!row.active}"><div role="listitem"><span title="Chat ${row.id}"></span>${row.unread ? '<span aria-label="2 unread messages">2</span>' : ""}</div></div>`,
    )
    .join("");
}
function select(pane: HTMLElement) {
  const clicks: string[] = [];
  pane.addEventListener("click", (event) => {
    clicks.push((event.target as Element).closest('[role="row"]')!.getAttribute("aria-rowindex")!);
  });
  return clicks;
}
const signal = () => new AbortController().signal;

test("mark-as-unread actions do not classify a read row as unread", () => {
  const { pane } = fixture();
  pane.innerHTML = '<div role="row"><button aria-label="Mark as unread"></button></div>';
  expect(isUnread(chatRows(pane)[0]!)).toBe(false);
});

test("message font size excludes sidebar, header, composer and timestamps", () => {
  const { document } = fixture();
  const sheet = new document.defaultView!.CSSStyleSheet();
  sheet.replaceSync(messageCss(22));
  const selector = (sheet.cssRules[0] as CSSStyleRule).selectorText;
  expect(Array.from(document.querySelectorAll(selector)).map((node) => node.tagName)).toEqual([
    "SPAN",
    "A",
  ]);
  expect(messageCss(null)).toBe("");
});

test("invalid stored values reset safely and shortcuts preserve unmodified typing and IME", () => {
  const { window } = fixture();
  expect(readSettings({ fontSize: "999px; color:red" })).toEqual(defaults);
  expect(readSettings({ sidebarWidth: 1 })).toEqual(defaults);
  expect(readSettings({ fontSize: 22 }).fontSize).toBe(22);
  const event = (init: object) =>
    new window.KeyboardEvent("keydown", init) as unknown as KeyboardEvent;
  expect(
    matchesShortcut(event({ code: "ArrowDown", ctrlKey: true, altKey: true }), defaults.next),
  ).toBe(true);
  expect(matchesShortcut(event({ code: "ArrowDown" }), defaults.next)).toBe(false);
  expect(
    matchesShortcut(
      event({ code: "ArrowDown", ctrlKey: true, altKey: true, isComposing: true }),
      defaults.next,
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      event({ code: "ArrowDown", ctrlKey: true, altKey: true, repeat: true }),
      defaults.next,
    ),
  ).toBe(false);
});

test("sidebar keyboard resizing clamps, resets and cleans up", () => {
  const { document, pane, window } = fixture();
  const saved: (number | null)[] = [];
  const sidebar = attachSidebar(pane, 300, (value) => saved.push(value));
  const handle = document.querySelector<HTMLElement>('[role="separator"]')!;
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End" }) as unknown as Event);
  expect(saved.at(-1)).toBe(640);
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home" }) as unknown as Event);
  expect(saved.at(-1)).toBe(220);
  handle.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter" }) as unknown as Event);
  expect(saved.at(-1)).toBe(null);
  sidebar.dispose();
  expect(document.querySelector('[role="separator"]')).toBeNull();
  expect(document.adoptedStyleSheets).toHaveLength(0);
});

test("next unread skips read/current rows and does not touch a draft", async () => {
  const { pane, document } = fixture();
  rows(pane, [{ id: 1, active: true }, { id: 2 }, { id: 3, unread: true }]);
  const clicks = select(pane);
  expect(chatRows(pane)).toHaveLength(3);
  expect(await navigateUnread({ pane, action: { direction: 1 }, signal: signal() })).toBe(true);
  expect(clicks).toEqual(["3"]);
  expect(document.querySelector("footer")!.textContent).toBe("Draft");
});

test("previous unread and numbered selection use sidebar order", async () => {
  const { pane } = fixture();
  rows(pane, [
    { id: 1, unread: true },
    { id: 2 },
    { id: 3, unread: true },
    { id: 4, active: true },
  ]);
  const clicks = select(pane);
  await navigateUnread({ pane, action: { direction: -1 }, signal: signal() });
  await navigateUnread({ pane, action: { number: 2 }, signal: signal(), settle: async () => {} });
  expect(clicks).toEqual(["3", "3"]);
});

test("navigation scans virtualized rows and wraps to the first unread", async () => {
  const { pane } = fixture();
  let top = 0;
  Object.defineProperties(pane, {
    clientHeight: { value: 200 },
    scrollHeight: { value: 600 },
    scrollTop: {
      get: () => top,
      set: (value) => {
        top = Math.max(0, Math.min(400, value));
      },
    },
  });
  const paint = async () => {
    if (top < 160) rows(pane, [{ id: 1, unread: true }, { id: 2 }]);
    else if (top < 320) rows(pane, [{ id: 3 }, { id: 4 }]);
    else rows(pane, [{ id: 5, unread: true }, { id: 6 }]);
  };
  rows(pane, [{ id: 1, active: true }, { id: 2 }]);
  const clicks = select(pane);
  await navigateUnread({ pane, action: { direction: 1 }, signal: signal(), settle: paint });
  expect(clicks).toEqual(["5"]);
  rows(pane, [{ id: 5, active: true }, { id: 6 }]);
  await navigateUnread({ pane, action: { direction: 1 }, signal: signal(), settle: paint });
  expect(clicks).toEqual(["5", "1"]);
});

test("missing target restores scroll and cancellation never opens a chat", async () => {
  const { pane } = fixture();
  rows(pane, [{ id: 1 }, { id: 2 }]);
  pane.scrollTop = 25;
  const clicks = select(pane);
  expect(
    await navigateUnread({ pane, action: { number: 2 }, signal: signal(), settle: async () => {} }),
  ).toBe(false);
  expect(pane.scrollTop).toBe(25);
  rows(pane, [{ id: 1, unread: true }]);
  const controller = new AbortController();
  controller.abort();
  expect(await navigateUnread({ pane, action: { direction: 1 }, signal: controller.signal })).toBe(
    false,
  );
  expect(clicks).toEqual([]);
});
