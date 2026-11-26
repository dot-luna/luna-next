import { copyFile, mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "pathe";
import { metadata } from "@/lib/files.ts";
import { canonicalPath, hasControlCharacters, ordinaryParents, overlaps } from "@/lib/paths.ts";
import { capture } from "@/lib/process.ts";
import { ApiError } from "@/lib/response.ts";
import type { LoginContext } from "./context.ts";
import { loginDeployment } from "./deployment.ts";
import { loginSddm } from "./sddm.ts";
import { loginSettings } from "./settings.ts";

/** Caller holds the config lock. Keep one stable image; no wallpaper library is created. */
class LoginWallpaper {
  async set({ context, source }: { context: LoginContext; source: string }) {
    if (!source || hasControlCharacters(source))
      throw new ApiError("INVALID_ARGUMENT", "Choose a local image file");
    const input = await realpath(source);
    const info = await metadata(input);
    if (!info || info.isDirectory())
      throw new ApiError("INVALID_PATH", "The Login wallpaper must be an image file");
    const mime = await capture({
      args: ["file", "--brief", "--mime-type", "--", input],
      env: context.env,
    });
    if (mime.code !== 0 || !mime.stdout.trim().startsWith("image/"))
      throw new ApiError("INVALID_ARGUMENT", "Only image backgrounds are supported by Login");
    const destination = context.wallpaperFile;
    if (!destination)
      throw new ApiError("INVALID_PATH", "Set Luna's data home or HOME for the Login wallpaper");
    await ordinaryParents(destination);
    const previousInfo = await metadata(destination);
    if (previousInfo && (!previousInfo.isFile() || previousInfo.isSymbolicLink()))
      throw new ApiError("INVALID_PATH", "The managed Login wallpaper must be an ordinary file");
    const actual = await canonicalPath(destination);
    if (overlaps(actual, await canonicalPath(context.configFile)))
      throw new ApiError("INVALID_PATH", "Login's wallpaper and config paths must be separate");
    const previous = await loginSettings.read(context);
    const value = loginSettings.patch({
      previous: previous.value,
      patch: { background: { path: destination } },
    });
    const installed = (await loginSddm.state(context)).installed;
    await mkdir(dirname(destination), { recursive: true });
    const stage = await mkdtemp(join(dirname(destination), ".luna-wallpaper-"));
    try {
      if (previousInfo) await copyFile(destination, join(stage, "previous"));
      await copyFile(input, join(stage, "image"));
      const published = Buffer.from(await Bun.file(join(stage, "image")).arrayBuffer());
      await rename(join(stage, "image"), destination);
      try {
        return await loginSettings.save({
          context,
          previous,
          value,
          apply: async () => {
            if (installed) await loginDeployment.install({ context, select: false });
          },
        });
      } catch (error) {
        // A failed deployment must not replace an image edited outside the API in the meantime.
        if (
          !(await Bun.file(destination).exists()) ||
          !published.equals(Buffer.from(await Bun.file(destination).arrayBuffer()))
        )
          throw new ApiError("CONFLICT", `${String(error)}; Login wallpaper changed externally`);
        if (previousInfo) await rename(join(stage, "previous"), destination);
        else await rm(destination, { force: true });
        throw error;
      }
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
}
export const loginWallpaper = new LoginWallpaper();
