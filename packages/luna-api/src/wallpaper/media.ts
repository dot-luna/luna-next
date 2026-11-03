import { ApiError } from "../lib/response.ts";

export interface MediaContext {
  env: Record<string, string>;
}

/** Capture media tool diagnostics without printing or changing the caller's environment. */
async function command(context: MediaContext, args: string[]) {
  const executable = Bun.which(args[0]!, { PATH: context.env.PATH ?? "" });
  if (!executable)
    throw new ApiError("COMMAND_FAILED", `Install ${args[0]} to manage wallpaper media`);
  const child = Bun.spawn([executable, ...args.slice(1)], {
    env: context.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new ApiError(
      "COMMAND_FAILED",
      `${args[0]} failed (${code}): ${(stderr || stdout).trim()}`,
    );
  return stdout.trim();
}

/** Validate file contents rather than filename extensions; SVG is supported too. */
export async function validateMedia(context: MediaContext, path: string) {
  const mime = await command(context, ["file", "--mime-type", "--brief", "--", path]);
  if (!mime.startsWith("image/") && !mime.startsWith("video/"))
    throw new ApiError("INVALID_METADATA", `Unsupported wallpaper media: ${path}`);
  return mime;
}

/** Limit redirects to HTTP(S); curl never interprets the URL as a command option. */
export async function downloadMedia(context: MediaContext, url: string, path: string) {
  await command(context, [
    "curl",
    "--disable",
    "--globoff",
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--max-redirs",
    "10",
    "--max-time",
    "60",
    "--output",
    path,
    "--",
    url,
  ]);
}

/** A stable extension keeps unnamed HTTP downloads usable by desktop media tools. */
export function mediaExtension(mime: string) {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/x-ms-bmp": "bmp",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
    "video/x-msvideo": "avi",
  };
  return extensions[mime] ?? mime.split("/")[1]!.replace(/[^a-z0-9]/giu, "");
}
