import { expect, test } from "bun:test";

const appsDirectory = new URL("../../apps/", import.meta.url);

test("the default installer includes the CLI tools, Luna Wallpaper, and T3 Code", async () => {
  const catalog = Bun.JSONC.parse(await Bun.file(new URL("apps.jsonc", appsDirectory)).text()) as {
    packages: string[];
  };
  for (const app of [
    "starship",
    "bat",
    "tmux",
    "glow",
    "btop",
    "fastfetch",
    "claude",
    "luna-wallpaper",
    "t3code",
  ]) {
    const file = `${app}/app.jsonc`;
    expect(catalog.packages).toContain(file);
    const manifest = Bun.JSONC.parse(await Bun.file(new URL(file, appsDirectory)).text());
    expect(manifest).toMatchObject({ enabled: true });
  }
});

test("T3 Code installs the build with its post-configuration hook disabled", async () => {
  const file = Bun.file(new URL("t3code/app.jsonc", appsDirectory));
  const manifest = Bun.JSONC.parse(await file.text()) as { hooks: Record<string, string[]> };
  expect(manifest.hooks.after_build).toEqual(["scripts/install.ts"]);
  expect(manifest.hooks.after_configure).toBeUndefined();
});
