import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "pathe";
import { metadata, readOptional } from "@/lib/files.ts";
import { canonicalPath, ordinaryParents, overlaps } from "@/lib/paths.ts";
import { ApiError } from "@/lib/response.ts";
import { loginBuilder } from "./build.ts";
import { loginContext, type LoginContext } from "./context.ts";
import { loginSddm } from "./sddm.ts";
import { loginSystem } from "./system.ts";

class LoginDeployment {
  private async _ownedTheme(context: LoginContext) {
    await ordinaryParents(context.themeDirectory);
    const existing = await metadata(context.themeDirectory);
    if (
      existing &&
      (!existing.isDirectory() ||
        existing.isSymbolicLink() ||
        !(await readOptional(join(context.themeDirectory, "metadata.desktop")))?.includes(
          "Theme-Id=luna\n",
        ))
    )
      throw new ApiError(
        "CONFLICT",
        `Refusing to replace a theme not owned by Luna Login: ${context.themeDirectory}`,
      );
    return existing !== undefined;
  }

  /** Replace the prepared theme atomically. Selection affects the next greeter, never the current session. */
  async install({ context, select }: { context: LoginContext; select: boolean }) {
    const sourceDirectory = loginContext.source(context);
    const destination = await canonicalPath(context.themeDirectory);
    for (const source of [sourceDirectory, context.configFile])
      if (overlaps(destination, await canonicalPath(source)))
        throw new ApiError(
          "INVALID_PATH",
          "Login installation cannot overlap its sources or config",
        );
    const temporary = await mkdtemp(join(tmpdir(), "luna-login-install-"));
    try {
      const bundle = await loginBuilder.build({
        configFile: context.configFile,
        sourceDirectory,
        output: join(temporary, "theme"),
        env: context.env,
      });
      return await loginSystem.locked(context, async () => {
        const existing = await this._ownedTheme(context);
        const previous = await readOptional(context.sddmConfigFile);
        const next = select
          ? loginSddm.withoutActivation(previous ?? "") + loginSddm.activation
          : previous;
        if (select) {
          await ordinaryParents(context.sddmConfigFile);
          const info = await metadata(context.sddmConfigFile);
          if (info && (!info.isFile() || info.isSymbolicLink()))
            throw new ApiError("INVALID_PATH", "SDDM's main config must be an ordinary file");
          await Bun.write(join(temporary, "sddm.conf"), next!);
        }
        const parent = dirname(context.themeDirectory);
        await loginSystem.command(context, ["mkdir", "-p", "--", parent]);
        const stage = await loginSystem.command(context, [
          "mktemp",
          "-d",
          join(parent, ".luna-login-XXXXXX"),
        ]);
        let published = false;
        try {
          const staged = join(stage, "theme");
          await loginSystem.command(context, ["cp", "-R", "--", bundle, staged]);
          // Prepared settings may be private in the user's staging area; SDDM must read the deployed copy.
          await loginSystem.command(context, ["chmod", "-R", "a+rX", "--", staged]);
          await loginSystem.command(
            context,
            existing
              ? [
                  "mv",
                  "--exchange",
                  "--no-copy",
                  "--no-target-directory",
                  "--",
                  staged,
                  context.themeDirectory,
                ]
              : ["mv", "--no-target-directory", "--", staged, context.themeDirectory],
          );
          published = true;
          if (select)
            await loginSystem.writeConfig({
              context,
              source: next!,
              expected: previous,
              stagedSource: join(temporary, "sddm.conf"),
            });
        } catch (error) {
          if (published) {
            if (existing)
              await loginSystem.command(context, [
                "mv",
                "--exchange",
                "--no-copy",
                "--no-target-directory",
                "--",
                join(stage, "theme"),
                context.themeDirectory,
              ]);
            else await loginSystem.command(context, ["rm", "-rf", "--", context.themeDirectory]);
          }
          throw error;
        } finally {
          await loginSystem.command(context, ["rm", "-rf", "--", stage]);
        }
        return loginSddm.state(context);
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  /** Remove only Luna's theme and exact activation block; native settings outside it survive. */
  async uninstall(context: LoginContext) {
    const previous = await readOptional(context.sddmConfigFile);
    const next = loginSddm.withoutActivation(previous ?? "");
    if (!(await metadata(context.themeDirectory)) && next === (previous ?? ""))
      return loginSddm.state(context);
    return loginSystem.locked(context, async () => {
      await this._ownedTheme(context);
      const current = await readOptional(context.sddmConfigFile);
      const source = loginSddm.withoutActivation(current ?? "");
      if (source !== current && current !== null) {
        const temporary = await mkdtemp(join(tmpdir(), "luna-login-remove-"));
        try {
          const stagedSource = join(temporary, "sddm.conf");
          await Bun.write(stagedSource, source);
          await loginSystem.writeConfig({ context, source, expected: current, stagedSource });
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
      }
      await loginSystem.command(context, ["rm", "-rf", "--", context.themeDirectory]);
      return loginSddm.state(context);
    });
  }
}
export const loginDeployment = new LoginDeployment();
