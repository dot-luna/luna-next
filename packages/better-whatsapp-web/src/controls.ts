import { settingsSchema, shortcutLabel, type Settings, type Shortcut } from "./schema.ts";

/** A shadow root keeps WhatsApp's styles out of the controls and our styles out of WhatsApp. */
export function createControls(
  document: Document,
  get: () => Settings,
  save: (value: Settings) => void,
) {
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { color-scheme:light dark; font:14px system-ui; }
    dialog { color:CanvasText; background:Canvas; border:1px solid GrayText; padding:20px; width:300px; max-width:80vw; }
    dialog::backdrop { background:#0006; } h2 { margin:0 0 16px; font-size:18px; }
    label { display:block; margin:12px 0; } input[type=range] { width:100%; }
    button { font:inherit; padding:6px 10px; cursor:pointer; } .row { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    p { font-size:12px; } #status { min-height:1em; }
  </style><dialog aria-labelledby="title">
    <h2 id="title">WhatsApp controls</h2>
    <label>Message text <output id="size-label"></output><input id="size" aria-label="Message text size" type="range" min="10" max="32" step="1"></label>
    <button id="default-size" type="button">Default text size</button>
    <label class="row">Next unread <button id="next" type="button"></button></label>
    <label class="row">Previous unread <button id="previous" type="button"></button></label>
    <label><input id="numbered" type="checkbox"> Ctrl+Alt+1–9: unread chat</label>
    <p>Ctrl+Alt+Space opens these controls. Escape cancels a shortcut.</p>
    <p id="status" role="status" aria-live="polite"></p>
    <button id="close" type="button">Close</button>
  </dialog>`;
  document.body.append(host);
  const dialog = root.querySelector("dialog")!;
  const size = root.querySelector<HTMLInputElement>("#size")!;
  const sizeLabel = root.querySelector("#size-label")!;
  const numbered = root.querySelector<HTMLInputElement>("#numbered")!;
  const status = root.querySelector<HTMLElement>("#status")!;
  let recording: "next" | "previous" | null = null;
  function refresh() {
    const settings = get();
    size.value = String(settings.fontSize ?? 14);
    sizeLabel.textContent = settings.fontSize === null ? "Default" : `${settings.fontSize}px`;
    numbered.checked = settings.numbered;
    for (const action of ["next", "previous"] as const)
      root.querySelector(`#${action}`)!.textContent = shortcutLabel(settings[action]);
  }
  size.addEventListener("input", () => {
    save({ ...get(), fontSize: Number(size.value) });
    refresh();
  });
  numbered.addEventListener("change", () => save({ ...get(), numbered: numbered.checked }));
  root.querySelector("#default-size")!.addEventListener("click", () => {
    save({ ...get(), fontSize: null });
    refresh();
  });
  root.querySelector("#close")!.addEventListener("click", () => dialog.close());
  for (const action of ["next", "previous"] as const)
    root.querySelector(`#${action}`)!.addEventListener("click", () => {
      recording = action;
      status.textContent = "Press a shortcut with Ctrl or Alt.";
    });
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (!recording) return;
    if (event.key === "Tab" || event.key === "Escape") {
      recording = null;
      status.textContent = "";
      if (event.key === "Escape") event.preventDefault();
      return;
    }
    event.preventDefault();
    if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
    const binding: Shortcut = {
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
    };
    const other = recording === "next" ? "previous" : "next";
    const settings = { ...get(), [recording]: binding };
    if (
      event.metaKey ||
      !settingsSchema.safeParse(settings).success ||
      shortcutLabel(binding) === shortcutLabel(settings[other]) ||
      (binding.ctrl &&
        binding.alt &&
        !binding.shift &&
        (binding.code === "Space" || /^Digit[1-9]$/u.test(binding.code)))
    ) {
      status.textContent = "Choose a different Ctrl or Alt shortcut.";
      return;
    }
    recording = null;
    save(settings);
    refresh();
    status.textContent = "Shortcut saved.";
  });
  dialog.addEventListener("close", () => {
    recording = null;
    status.textContent = "";
  });
  const button = document.createElement("button");
  button.textContent = "Aa";
  button.type = "button";
  button.setAttribute("aria-label", "WhatsApp controls");
  button.title = "WhatsApp controls (Ctrl+Alt+Space)";
  button.style.cssText =
    "font:inherit;color:inherit;background:transparent;border:0;padding:8px;cursor:pointer";
  function open() {
    if (!dialog.open) {
      refresh();
      dialog.showModal();
    }
  }
  button.addEventListener("click", open);
  return {
    button,
    open,
    get isOpen() {
      return dialog.open;
    },
  };
}
