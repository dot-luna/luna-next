import { respond, ApiError } from "@/lib/response.ts";
import { menuContext, type MenuOptions, type MenuState, type StayAwakeState } from "./context.ts";
import { menuRuntime } from "./runtime.ts";
import { stayAwakeActionSchema, type StayAwakeAction } from "./schema.ts";

/** Actions that start a hidden instance when needed; all but start then forward to the shell. */
const opening = ["start", "show", "toggle", "system", "clipboard", "emoji"] as const;
type MenuAction = (typeof opening)[number] | "status" | "hide" | "stop";

/** Show/toggle/system start a hidden instance when needed. Existing instances retain their theme snapshot. */
class Menu {
  /** Session-only inhibition, owned by the menu. Status/off never start a stopped menu. */
  stayAwake(action: StayAwakeAction = "toggle", options: MenuOptions = {}) {
    return respond(async (): Promise<StayAwakeState> => {
      if (!stayAwakeActionSchema.safeParse(action).success)
        throw new ApiError("INVALID_ARGUMENT", "Stay awake expects on, off, toggle, or status");
      const context = await menuContext.resolve(options);
      if (action === "on" || action === "toggle") await menuRuntime.start(context);
      else if (!(await menuRuntime.running(context))) return { enabled: false };
      const result = await menuRuntime.ipc({ context, method: "stayAwake", args: [action] });
      if (result.stdout !== "on" && result.stdout !== "off")
        throw new ApiError("COMMAND_FAILED", `Unexpected stay-awake response: ${result.stdout}`);
      return { enabled: result.stdout === "on" };
    });
  }

  status(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "status", options }));
  }

  start(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "start", options }));
  }

  show(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "show", options }));
  }

  system(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "system", options }));
  }

  clipboard(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "clipboard", options }));
  }

  emoji(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "emoji", options }));
  }

  /** Hide a running menu; a stopped menu is not started. */
  hide(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "hide", options }));
  }

  toggle(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "toggle", options }));
  }

  stop(options: MenuOptions = {}) {
    return respond(() => this._operate({ action: "stop", options }));
  }

  private async _operate({
    action,
    options,
  }: {
    action: MenuAction;
    options: MenuOptions;
  }): Promise<MenuState> {
    const context = await menuContext.resolve(options);
    if ((opening as readonly string[]).includes(action)) {
      await menuRuntime.start(context);
      if (action !== "start") await menuRuntime.ipc({ context, method: action });
    }
    if (action === "hide" && (await menuRuntime.running(context)))
      await menuRuntime.ipc({ context, method: "hide" });
    if (action === "stop") await menuRuntime.stop(context);
    return { running: await menuRuntime.running(context), shellDirectory: context.shellDirectory };
  }
}

export const menu = new Menu();
