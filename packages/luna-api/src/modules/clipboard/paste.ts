import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { clipboardTools } from "./tools.ts";
import type { ClipboardContext } from "./context.ts";
import { clipboardHistory } from "./history.ts";
import { clipboardLayersSchema, clipboardTargetSchema, clipboardWindowSchema } from "./schema.ts";

// Window classes that paste with Ctrl+Shift+V; other windows receive Ctrl+V.
const terminals = [
  "kitty",
  "alacritty",
  "foot",
  "footclient",
  "org.wezfurlong.wezterm",
  "com.mitchellh.ghostty",
  "org.gnome.terminal",
  "konsole",
];

/** Paste into a window captured before the picker opened. Never redirect to a newly focused app. */
class ClipboardPaste {
  async activeWindow(context: ClipboardContext) {
    const result = await clipboardTools.run({
      context,
      args: ["hyprctl", "-j", "activewindow"],
    });
    return validate(clipboardWindowSchema, JSON.parse(result.stdout), "Focused window");
  }

  /** The picker must hide before calling paste; focus failures leave the entry copied. */
  async paste({ context, id, target }: { context: ClipboardContext; id: string; target?: string }) {
    const address = await this.target({ context, target });
    await clipboardHistory.copy({ context, id });
    await this.intoWindow({ context, address });
    return { id, target: address };
  }

  /** Resolve before copying so invalid targets cannot replace clipboard contents. */
  async target({ context, target }: { context: ClipboardContext; target?: string }) {
    const address = target ?? (await this.activeWindow(context)).address ?? "";
    if (!clipboardTargetSchema.safeParse(address).success)
      throw new ApiError("INVALID_ARGUMENT", "Paste requires a valid focused window address");
    return address;
  }

  /**
   * Send the paste shortcut to address once the new clipboard owner is ready.
   * Shared by history and emoji insertion. Raises CONFLICT when the menu stays open
   * or focus has moved, and COMMAND_FAILED when Hyprland rejects the key events.
   */
  async intoWindow({ context, address }: { context: ClipboardContext; address: string }) {
    await this._waitForMenuClose(context);
    const window = await this.activeWindow(context);
    if (window.address !== address)
      throw new ApiError(
        "CONFLICT",
        "Copied, but focus changed; paste manually in the intended application",
      );
    const modifiers = terminals.includes((window.class ?? "").toLowerCase())
      ? "CTRL SHIFT"
      : "CTRL";

    // Recheck focus and send both key states in one compositor call. Only validated addresses
    // and fixed shortcut values enter this Lua code; clipboard contents never do.
    const script = `local window = hl.get_active_window()
if not window or window.address ~= "${address}" then error("Luna clipboard: focus changed") end
local down = hl.dispatch(hl.dsp.send_key_state({mods="${modifiers}", key="V", state="down", window="address:${address}"}))
local up = hl.dispatch(hl.dsp.send_key_state({mods="${modifiers}", key="V", state="up", window="address:${address}"}))
if not down.ok then error(down.error) end
if not up.ok then error(up.error) end`;
    const result = await clipboardTools.run({ context, args: ["hyprctl", "eval", script] });
    const output = result.stdout.trim();
    if (output !== "ok")
      throw new ApiError("COMMAND_FAILED", `Copied, but paste failed: ${output}`);
    return { target: address };
  }

  /** Wait for the actual menu surface to unmap, rather than guessing its animation duration. */
  private async _waitForMenuClose(context: ClipboardContext) {
    const deadline = Date.now() + 1500;
    while (true) {
      const result = await clipboardTools.run({ context, args: ["hyprctl", "-j", "layers"] });
      const monitors = validate(clipboardLayersSchema, JSON.parse(result.stdout), "Layer surfaces");
      const menuVisible = Object.values(monitors).some((monitor) =>
        Object.values(monitor.levels).some((layers) =>
          layers.some((layer) => layer.namespace === "luna-menu"),
        ),
      );
      if (!menuVisible) return;
      if (Date.now() >= deadline)
        throw new ApiError("CONFLICT", "Copied, but the menu is still open; paste manually");
      await Bun.sleep(25);
    }
  }
}

export const clipboardPaste = new ClipboardPaste();
