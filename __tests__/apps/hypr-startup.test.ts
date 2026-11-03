import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { appContext } from "../../packages/luna-api/src/apps/context.ts";
import { AppFixture } from "../../packages/luna-api/tests/fixtures/app-fixture.ts";
import { readCatalog } from "../../packages/luna-api/src/apps/catalog.ts";

test("Hyprland starts a declared authentication agent and registered Luna commands at login", async () => {
  const repository = fileURLToPath(new URL("../../", import.meta.url));
  const startup = `${repository}apps/hypr/config/autostart.lua`;
  const script = `
hl = {
  on = function(event, callback)
    assert(event == "hyprland.start")
    callback()
  end,
  dsp = { exec_cmd = function(command) return command end },
  dispatch = function(command) print(command) end,
}
dofile(arg[1])
`;
  const result = Bun.spawnSync(["lua", "-", startup], { stdin: Buffer.from(script) });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const commands = result.stdout.toString().trim().split("\n");
  expect(commands).toContain("/usr/lib/polkit-kde-authentication-agent-1");
  const fixture = new AppFixture();
  try {
    const context = await appContext({ repository, env: fixture.env });
    const catalog = await readCatalog(context);
    const hypr = catalog.find((app) => app.id === "hypr")!;
    expect(hypr.manifest.deps?.map((dep) => dep.name)).toContain("polkit-kde-agent");
  } finally {
    fixture.dispose();
  }
  for (const command of commands.filter((command) =>
    command.startsWith('"$HOME/.local/bin/luna" '),
  )) {
    const args = command.slice('"$HOME/.local/bin/luna" '.length).split(" ");
    const help = Bun.spawnSync([
      process.execPath,
      `${repository}src/luna-cli/src/index.ts`,
      ...args,
      "--help",
    ]);
    expect(help.exitCode, help.stderr.toString()).toBe(0);
    expect(help.stdout.toString()).toContain(`Usage: luna ${args.join(" ")}`);
  }
  expect(commands.some((command) => command.includes("menu start"))).toBe(true);
  expect(commands.some((command) => command.includes("wallpaper start"))).toBe(true);
  expect(commands.some((command) => command.includes("screensaver start"))).toBe(true);
  expect(commands.some((command) => command.includes("lock start"))).toBe(true);
});
