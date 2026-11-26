import { join } from "pathe";

/** Copy defined values so per-call changes never reach Bun.env or the caller's object. */
export function environment(env: Record<string, string | undefined> = Bun.env) {
  const copy: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (value !== undefined) copy[key] = value;
  return copy;
}

/** Luna's configuration home, or undefined when neither XDG_CONFIG_HOME nor HOME is set. */
export function lunaConfigHome(env: Record<string, string>) {
  if (env.LUNA_CONFIG_HOME_DIR) return env.LUNA_CONFIG_HOME_DIR;
  if (env.XDG_CONFIG_HOME) return join(env.XDG_CONFIG_HOME, "luna");
  return env.HOME ? join(env.HOME, ".config/luna") : undefined;
}
