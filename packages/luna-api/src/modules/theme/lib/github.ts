import { basename, dirname } from "pathe";
import { ApiError } from "@/lib/response.ts";
import { validate } from "@/lib/validation.ts";
import { githubCommitSchema, githubTreeSchema } from "../schema.ts";
import { themeRemote } from "./remote.ts";
import { themeValues } from "./values.ts";

export interface RemoteThemeFile {
  path: string;
  url: string;
  sha?: string;
  size?: number;
}
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Read GitHub metadata and one manifest. Assets are fetched only after the caller approves. */
export async function githubSource(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const raw = url.hostname === "raw.githubusercontent.com";
  if (!raw && url.hostname !== "github.com") return;
  const [owner, repoInput, kind, ...tail] = segments;
  const repo = repoInput?.replace(/\.git$/u, "");
  if (!owner || !repo || !/^[\w.-]+$/u.test(owner) || !/^[\w.-]+$/u.test(repo))
    throw new ApiError("INVALID_ARGUMENT", "Invalid GitHub theme URL");
  let ref = "HEAD";
  let folder = "";
  let file: string | undefined;
  if (raw || kind === "raw") {
    const parts = raw ? [kind ?? "HEAD", ...tail] : tail;
    if (parts[0] === "refs" && (parts[1] === "heads" || parts[1] === "tags"))
      ref = parts.splice(0, 3).join("/");
    else ref = parts.shift() ?? "HEAD";
    file = parts.join("/");
  } else if (kind === "tree" || kind === "blob") {
    ref = tail.shift() ?? "HEAD";
    if (kind === "blob") file = tail.join("/");
    else folder = tail.join("/");
  } else if (kind)
    throw new ApiError("INVALID_ARGUMENT", "Use a GitHub repository, folder, or JSON file URL");
  if (file !== undefined) {
    if (!/\.jsonc?$/iu.test(file))
      throw new ApiError("INVALID_ARGUMENT", "Theme files must be JSON or JSONC");
    folder = dirname(file) === "." ? "" : dirname(file);
  }
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  const commit = validate(
    githubCommitSchema,
    JSON.parse(await themeRemote.text(`${api}/commits/${encodeURIComponent(ref)}`)),
    "GitHub revision",
  );
  const tree = validate(
    githubTreeSchema,
    JSON.parse(await themeRemote.text(`${api}/git/trees/${commit.sha}?recursive=1`)),
    "GitHub files",
  );
  if (tree.truncated)
    throw new ApiError(
      "INVALID_METADATA",
      "GitHub file list is too large; import a local folder instead",
    );
  const prefix = folder ? folder + "/" : "";
  const members = tree.tree.filter(
    (entry) => entry.path.startsWith(prefix) && entry.type !== "tree",
  );
  const manifests = file
    ? members.filter((entry) => entry.path === file)
    : members.filter((entry) => /^theme\.jsonc?$/u.test(entry.path.slice(prefix.length)));
  if (manifests.length !== 1 || !["100644", "100755"].includes(manifests[0]!.mode))
    throw new ApiError(
      "INVALID_METADATA",
      "GitHub folder needs exactly one regular theme.json or theme.jsonc",
    );
  const manifest = manifests[0]!;
  const text = await themeRemote.text(
    `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${encodePath(manifest.path)}`,
  );
  const sources = file ? (themeValues.parse(text, url.href).wallpaper?.sources ?? []) : [];
  const files: RemoteThemeFile[] = [];
  for (const entry of members) {
    const path = entry.path.slice(prefix.length);
    // A raw manifest imports only its declared assets, not the containing repository.
    if (
      file &&
      entry !== manifest &&
      !sources.some((source) => path === source || path.startsWith(source + "/"))
    )
      continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new ApiError(
        "INVALID_PATH",
        "GitHub theme folders cannot contain symlinks or submodules",
      );
    if (
      !path ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      path.includes("\\") ||
      [...path].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new ApiError("INVALID_PATH", "Invalid GitHub theme file path");
    files.push({
      path,
      sha: entry.sha,
      size: entry.size,
      url: `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${encodePath(entry.path)}`,
    });
  }
  // A standalone file may have any name; the installed manifest always has the canonical stem.
  const manifestPath = `theme${manifest.path.endsWith(".jsonc") ? ".jsonc" : ".json"}`;
  return {
    files: files.filter((entry) => entry.path !== manifest.path.slice(prefix.length)),
    manifestPath,
    text,
    stem: file ? basename(file).replace(/\.jsonc?$/iu, "") : basename(folder || repo),
    file: file !== undefined,
    revision: commit.sha,
  };
}
