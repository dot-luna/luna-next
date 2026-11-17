const rowSelector = '[role="row"], [role="listitem"]';
const badgeSelector = '[data-testid="icon-unread-count"], [data-icon="unread-count"]';

/** Isolate WhatsApp's DOM assumptions so interface changes have one navigation adapter. */
export function chatRows(pane: HTMLElement): HTMLElement[] {
  return Array.from(pane.querySelectorAll<HTMLElement>(rowSelector)).filter(
    (row) => !row.parentElement?.closest(rowSelector),
  );
}

export function isUnread(row: HTMLElement): boolean {
  if (row.querySelector(badgeSelector)) return true;
  // A row's "Mark as unread" action is not an unread badge.
  return Array.from(row.querySelectorAll('[aria-label*="unread" i]')).some((node) =>
    /^(?:[0-9]+\s+unread\s+messages?|unread)$/iu.test(node.getAttribute("aria-label")!.trim()),
  );
}

function rowKey(row: HTMLElement): string {
  return (
    row.getAttribute("aria-rowindex") ||
    row.dataset.id ||
    row.querySelector<HTMLElement>("[title]")?.title ||
    row.textContent ||
    ""
  );
}

export type UnreadAction = { direction: 1 | -1 } | { number: number };

/**
 * Scan the rendered chat list in response to one user action, scrolling to load virtual rows.
 * Wrap once, never open a read chat, and restore the list position when no target is found.
 * Cancellation leaves the current scroll position; it never clears or writes the composer.
 */
export async function navigateUnread({
  pane,
  action,
  signal,
  settle = () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
}: {
  pane: HTMLElement;
  action: UnreadAction;
  signal: AbortSignal;
  settle?: () => Promise<void>;
}): Promise<boolean> {
  const view = pane.ownerDocument.defaultView!;
  const direction = "number" in action ? 1 : action.direction;
  const startTop = pane.scrollTop;
  const initialRows = chatRows(pane);
  const active = initialRows.findIndex(
    (row) => row.matches('[aria-selected="true"]') || row.querySelector('[aria-selected="true"]'),
  );
  const activeKey = active >= 0 ? rowKey(initialRows[active]!) : null;
  let remaining = "number" in action ? action.number : 1;
  const seen = new Set<string>();
  let wrapped = false;
  let first = true;
  if ("number" in action) {
    pane.scrollTop = 0;
    await settle();
  }
  // Bound work if WhatsApp keeps appending rows while the user receives new chats.
  for (let page = 0; page < 250 && !signal.aborted && pane.isConnected; page++) {
    let rows = chatRows(pane);
    if (first && !("number" in action) && active >= 0)
      rows = direction === 1 ? rows.slice(active + 1) : rows.slice(0, active);
    if (direction === -1) rows.reverse();
    for (const row of rows) {
      const key = rowKey(row);
      if (key === activeKey && wrapped) {
        pane.scrollTop = startTop;
        return false;
      }
      if (key === activeKey || seen.has(key)) continue;
      seen.add(key);
      if (!isUnread(row) || --remaining !== 0) continue;
      row.scrollIntoView({ block: "nearest" });
      const target = row.querySelector<HTMLElement>('[role="gridcell"], [tabindex]') || row;
      // WhatsApp selects rows on mouse-down in some layouts; a click also supports keyboard-style handlers.
      for (const type of ["mousedown", "mouseup", "click"])
        target.dispatchEvent(
          new view.MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
        );
      return true;
    }
    first = false;
    const before = pane.scrollTop;
    pane.scrollTop = Math.max(
      0,
      Math.min(
        pane.scrollHeight - pane.clientHeight,
        before + direction * Math.max(100, pane.clientHeight * 0.8),
      ),
    );
    await settle();
    if (signal.aborted) return false;
    if (pane.scrollTop === before) {
      if (wrapped || "number" in action) break;
      wrapped = true;
      pane.scrollTop = direction === 1 ? 0 : pane.scrollHeight;
      await settle();
    }
    if (
      wrapped &&
      ((direction === 1 && pane.scrollTop > startTop + pane.clientHeight) ||
        (direction === -1 && pane.scrollTop < startTop - pane.clientHeight))
    )
      break;
  }
  if (!signal.aborted && pane.isConnected) pane.scrollTop = startTop;
  return false;
}
