import { fileURLToPath, pathToFileURL } from "node:url";
import { Luna, type WallpaperOptions } from "@luna/api";

/** A one-shot QML bridge. All validation, storage and renderer changes belong to Luna's API. */
export async function backgroundRequest(
  { operation, value = "" }: { operation: string; value?: string },
  options: WallpaperOptions = {},
) {
  let result;
  switch (operation) {
    case "list":
      break;
    case "install":
      result = await Luna.wallpaper.install(
        value.startsWith("file:") ? fileURLToPath(value) : value,
        options,
      );
      break;
    case "select":
      result = await Luna.wallpaper.set(value, options);
      break;
    case "remove":
      result = await Luna.wallpaper.remove([value], options);
      break;
    case "random":
      result = await Luna.wallpaper.random(options);
      break;
    default:
      return { succes: false, errMessage: "Unknown background action" };
  }
  if (result && !result.succes) return result;
  const library = await Luna.wallpaper.list(options);
  if (!library.succes) return library;
  return {
    succes: true,
    data: library.data.map((entry) => ({
      ...entry,
      source: pathToFileURL(entry.path).href,
      video: /\.(mp4|m4v|webm|mkv|mov|avi|ogv|mpeg|mpg)$/i.test(entry.name),
    })),
  };
}

if (import.meta.main) {
  try {
    console.log(
      JSON.stringify(
        await backgroundRequest({ operation: Bun.argv[2] ?? "list", value: Bun.argv[3] }),
      ),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        succes: false,
        errMessage: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
