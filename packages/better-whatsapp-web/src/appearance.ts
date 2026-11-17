/** Only message bodies receive text sizing; header, composer, timestamps and icons keep their size. */
export function messageCss(size: number | null): string {
  if (size === null) return "";
  return `#main :is(.message-in, .message-out) .selectable-text,
    #main :is(.message-in, .message-out) .selectable-text :is(span, a, strong, b, em, i, code, pre) {
    font-size: ${size}px !important; line-height: 1.45 !important;
  }`;
}

/** Attach one keyboard and pointer divider; dispose before replacing the sidebar element. */
export function attachSidebar(
  sidebar: HTMLElement,
  initial: number | null,
  save: (value: number | null) => void,
) {
  const pane = sidebar.parentElement!;
  const document = sidebar.ownerDocument;
  const view = document.defaultView!;
  const sheet = new view.CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const marker = "data-luna-chat-sidebar";
  pane.setAttribute(marker, "");
  const handle = document.createElement("div");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-label", "Chat sidebar width");
  handle.setAttribute("aria-orientation", "vertical");
  handle.tabIndex = 0;
  handle.style.cssText =
    "position:fixed;width:8px;cursor:col-resize;touch-action:none;z-index:100;outline-offset:-2px";
  document.body.append(handle);
  let width = initial;
  let dragging = false;
  let pending = 0;
  const maximum = () => Math.min(720, Math.max(220, view.innerWidth - 360));
  function render() {
    // On narrow screens leave WhatsApp's single-pane layout intact.
    const enabled = view.innerWidth >= 640;
    sheet.replaceSync(
      width !== null && enabled
        ? `[${marker}] { width:${Math.min(width, maximum())}px !important; flex:0 0 ${Math.min(width, maximum())}px !important; max-width:none !important; }`
        : "",
    );
    const rect = pane.getBoundingClientRect();
    const rtl = view.getComputedStyle(pane).direction === "rtl";
    handle.hidden = !enabled || rect.width === 0 || rect.height === 0;
    handle.style.left = `${(rtl ? rect.left : rect.right) - 4}px`;
    handle.style.top = `${rect.top}px`;
    handle.style.height = `${rect.height}px`;
    handle.setAttribute("aria-valuemin", "220");
    handle.setAttribute("aria-valuemax", String(maximum()));
    handle.setAttribute("aria-valuenow", String(Math.round(rect.width)));
  }
  function change(value: number | null) {
    width = value === null ? null : Math.round(Math.max(220, Math.min(maximum(), value)));
    render();
    save(width);
  }
  handle.addEventListener("keydown", (event) => {
    const rect = pane.getBoundingClientRect();
    const direction = view.getComputedStyle(pane).direction === "rtl" ? -1 : 1;
    let next: number | null;
    if (event.key === "ArrowLeft") next = rect.width - direction * (event.shiftKey ? 40 : 10);
    else if (event.key === "ArrowRight") next = rect.width + direction * (event.shiftKey ? 40 : 10);
    else if (event.key === "Home") next = 220;
    else if (event.key === "End") next = maximum();
    else if (event.key === "Enter") next = null;
    else return;
    event.preventDefault();
    event.stopPropagation();
    change(next);
  });
  handle.addEventListener("dblclick", () => change(null));
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    dragging = true;
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const rect = pane.getBoundingClientRect();
    const rtl = view.getComputedStyle(pane).direction === "rtl";
    width = Math.round(
      Math.max(
        220,
        Math.min(maximum(), rtl ? rect.right - event.clientX : event.clientX - rect.left),
      ),
    );
    render();
  });
  const finish = () => {
    if (dragging) {
      dragging = false;
      save(width);
    }
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  const observer = new view.ResizeObserver(() => {
    if (!pending)
      pending = view.requestAnimationFrame(() => {
        pending = 0;
        render();
      });
  });
  observer.observe(pane);
  view.addEventListener("resize", render);
  render();
  return {
    update(value: number | null) {
      width = value;
      render();
    },
    dispose() {
      observer.disconnect();
      view.removeEventListener("resize", render);
      view.cancelAnimationFrame(pending);
      pane.removeAttribute(marker);
      handle.remove();
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((item) => item !== sheet);
    },
  };
}
