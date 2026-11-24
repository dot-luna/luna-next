import { ApiError } from "./response.ts";

/**
 * Return `value`, or the value at a dot-separated key; missing segments return null.
 * Empty segments fail with INVALID_ARGUMENT; `label` names the feature, such as "Lock".
 */
export function valueAtKey({ value, key, label }: { value: unknown; key?: string; label: string }) {
  if (key === undefined) return value;
  if (key.split(".").some((part) => !part))
    throw new ApiError("INVALID_ARGUMENT", `${label} keys use nonempty dot-separated segments`);
  let current = value;
  for (const part of key.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
