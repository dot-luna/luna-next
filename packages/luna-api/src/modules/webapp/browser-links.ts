import { z } from "zod";
import { webapp } from "./index.ts";
import { webappUrlSchema } from "./schema.ts";

/** The bridge accepts HTTP(S) URLs only; it never accepts a command or executable from the browser. */
export const browserLinkRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("origins") }).strict(),
  z.object({ type: z.literal("open"), url: webappUrlSchema }).strict(),
]);

const originSchema = webappUrlSchema.transform((value) => new URL(value).origin);
export const browserLinkExtraOriginsSchema = z.array(originSchema);
export const browserLinkConfigSchema = z
  .object({
    dataDir: z.string().startsWith("/"),
    profileRoot: z.string().startsWith("/"),
    extensionId: z.string().regex(/^[a-p]{32}$/u),
    extraOrigins: browserLinkExtraOriginsSchema.default([]),
  })
  .strict();
export type BrowserLinkConfig = z.infer<typeof browserLinkConfigSchema>;

/** Resolve registered web apps on each request, including apps installed since Chromium started. */
export async function browserLinkOrigins(config: BrowserLinkConfig, env: Record<string, string>) {
  const apps = await webapp.list({ env, dataDir: config.dataDir, profileRoot: config.profileRoot });
  if (!apps.succes) throw new Error(apps.errMessage);
  return [
    ...new Set([...apps.data.map((app) => new URL(app.url).origin), ...config.extraOrigins]),
  ].sort();
}

async function command(args: string[], env: Record<string, string>) {
  const child = Bun.spawn(args, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(error.trim() || `${args[0]} failed (${code})`);
  return output.trim();
}

/** Route only outside registered origins. GIO uses desktop MIME defaults without shell interpolation. */
export async function routeBrowserLink({
  request,
  config,
  env,
  run = command,
}: {
  request: unknown;
  config: BrowserLinkConfig;
  env: Record<string, string>;
  run?: (args: string[], env: Record<string, string>) => Promise<string>;
}) {
  const message = browserLinkRequestSchema.parse(request);
  const origins = await browserLinkOrigins(config, env);
  if (message.type === "origins") return { origins, opened: false };
  if (origins.includes(new URL(message.url).origin)) return { origins, opened: false };
  const cleanEnvironment = { ...env };
  // Do not carry Luna's Chromium-specific directory overrides into another browser.
  delete cleanEnvironment.CHROME_USER_DATA_DIR;
  delete cleanEnvironment.CHROME_CONFIG_HOME;
  delete cleanEnvironment.BROWSER;
  const scheme = new URL(message.url).protocol.slice(0, -1);
  const desktop = await run(
    ["xdg-mime", "query", "default", `x-scheme-handler/${scheme}`],
    cleanEnvironment,
  );
  if (!desktop || /chromium|luna-webapp/iu.test(desktop))
    throw new Error("Choose a default browser other than Luna's Chromium to open external links.");
  await run(["gio", "open", message.url], cleanEnvironment);
  return { origins, opened: true };
}
