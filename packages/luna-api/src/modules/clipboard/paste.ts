import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { command, type ClipboardContext } from "./context.ts";
import { clipboardLayersSchema, clipboardTargetSchema, clipboardWindowSchema } from "./schema.ts";
import { copy } from "./history.ts";

export async function activeWindow(context: ClipboardContext) {
  const result = await command({ context, args: ["hyprctl", "-j", "activewindow"] });
  return validate(clipboardWindowSchema, JSON.parse(result.output.toString()), "Focused window");
}

/** The picker must hide before calling paste. Never redirect a paste to a newly focused app. */
export async function paste({
  context,
  id,
  target,
}: {
  context: ClipboardContext;
  id: string;
  target?: string;
}) {
  const address = await pasteTarget({ context, target });
  await copy({ context, id });
  await pasteIntoWindow({ context, address });
  return { id, target: address };
}

/** Resolve before copying so invalid targets cannot replace clipboard contents. */
export async function pasteTarget({
  context,
  target,
}: {
  context: ClipboardContext;
  target?: string;
}) {
  const address = target ?? (await activeWindow(context)).address ?? "";
  if (!clipboardTargetSchema.safeParse(address).success)
    throw new ApiError("INVALID_ARGUMENT", "Paste requires a valid focused window address");
  return address;
}

/** Shared by history and emoji insertion, after the new clipboard owner is ready. */
export async function pasteIntoWindow({
  context,
  address,
}: {
  context: ClipboardContext;
  address: string;
}) {
  // Wait for the actual menu surface to unmap, rather than guessing its animation duration.
  const deadline = Date.now() + 1500;
  while (true) {
    const result = await command({ context, args: ["hyprctl", "-j", "layers"] });
    const monitors = validate(
      clipboardLayersSchema,
      JSON.parse(result.output.toString()),
      "Layer surfaces",
    );
    const menuVisible = Object.values(monitors).some((monitor) =>
      Object.values(monitor.levels).some((layers) =>
        layers.some((layer) => layer.namespace === "luna-menu"),
      ),
    );
    if (!menuVisible) break;
    if (Date.now() >= deadline)
      throw new ApiError("CONFLICT", "Copied, but the menu is still open; paste manually");
    await Bun.sleep(25);
  }
  const window = await activeWindow(context);
  if (window.address !== address)
    throw new ApiError(
      "CONFLICT",
      "Copied, but focus changed; paste manually in the intended application",
    );
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
  const modifiers = terminals.includes((window.class ?? "").toLowerCase()) ? "CTRL SHIFT" : "CTRL";

  // Recheck focus and send both key states in one compositor call. Only validated addresses
  // and fixed shortcut values enter this Lua code; clipboard contents never do.
  const script = `local window = hl.get_active_window()
if not window or window.address ~= "${address}" then error("Luna clipboard: focus changed") end
local down = hl.dispatch(hl.dsp.send_key_state({mods="${modifiers}", key="V", state="down", window="address:${address}"}))
local up = hl.dispatch(hl.dsp.send_key_state({mods="${modifiers}", key="V", state="up", window="address:${address}"}))
if not down.ok then error(down.error) end
if not up.ok then error(up.error) end`;
  const result = await command({ context, args: ["hyprctl", "eval", script] });
  if (result.output.toString().trim() !== "ok")
    throw new ApiError(
      "COMMAND_FAILED",
      `Copied, but paste failed: ${result.output.toString().trim()}`,
    );
  return { target: address };
}
