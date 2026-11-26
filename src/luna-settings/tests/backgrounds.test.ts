import { afterEach, beforeEach, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Luna } from "@luna/api";
import { WallpaperFixture } from "../../../packages/luna-api/tests/fixtures/wallpaper-fixture.ts";
import { backgroundRequest } from "../src/backgrounds.ts";

let fixture: WallpaperFixture;
beforeEach(() => {
  fixture = new WallpaperFixture();
  for (const tool of ["file", "curl"]) symlinkSync(Bun.which(tool)!, join(fixture.bin, tool));
});
afterEach(() => fixture.dispose());

function picture(name: string, color: string) {
  const path = join(fixture.root, "pictures", name);
  fixture.write(
    path,
    `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${color}"/></svg>`,
  );
  return path;
}
function request(operation: string, value?: string) {
  return backgroundRequest({ operation, value }, fixture.options);
}

test("installed backgrounds persist, apply immediately, randomize, and protect the active wallpaper", async () => {
  expect(await request("list")).toEqual({ succes: true, data: [] });
  const first = picture("blue sky #1.svg", "blue");
  const second = picture("green.svg", "green");
  expect(await request("install", pathToFileURL(first).href)).toMatchObject({ succes: true });
  expect(await request("install", second)).toMatchObject({ succes: true });
  const library = await request("list");
  expect(library).toMatchObject({ succes: true, data: [{ current: false }, { current: false }] });
  if (!library.succes || !library.data) throw new Error("Missing library");
  expect(library.data[0]!.source).toContain("blue%20sky%20%231.svg");
  expect(await Luna.wallpaper.start(fixture.options)).toMatchObject({ succes: true });
  const selected = await request("select", "blue sky #1.svg");
  expect(selected).toMatchObject({
    succes: true,
    data: [{ name: "blue sky #1.svg", current: true }, { current: false }],
  });
  expect(fixture.state().settings.wallpaper.source).toEndWith("/blue sky #1.svg");
  expect(await request("remove", "blue sky #1.svg")).toMatchObject({ succes: false });
  const randomized = await request("random");
  expect(randomized).toMatchObject({
    succes: true,
    data: [{ current: false }, { name: "green.svg", current: true }],
  });
  expect(fixture.state().settings.wallpaper.source).toEndWith("/green.svg");
  expect(await request("remove", "blue sky #1.svg")).toMatchObject({
    succes: true,
    data: [{ name: "green.svg" }],
  });
  expect(await request("list")).toMatchObject({
    succes: true,
    data: [{ name: "green.svg", current: true }],
  });
});

test("URL downloads install media and expose errors without changing the saved selection", async () => {
  const image = picture("source.svg", "purple");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/wallpaper.svg"
        ? new Response(Bun.file(image), { headers: { "Content-Type": "image/svg+xml" } })
        : new Response("Not an image", { headers: { "Content-Type": "text/html" } }),
  });
  try {
    expect(await request("install", new URL("/wallpaper.svg", server.url).href)).toMatchObject({
      succes: true,
      data: [{ name: "wallpaper.svg", current: false }],
    });
    expect(await request("install", new URL("/page.html", server.url).href)).toMatchObject({
      succes: false,
    });
    expect(await request("install", "https://")).toMatchObject({ succes: false });
    expect(await Luna.wallpaper.current(fixture.options)).toEqual({ succes: true, data: null });
    expect(await request("list")).toMatchObject({
      succes: true,
      data: [{ name: "wallpaper.svg" }],
    });
  } finally {
    await server.stop(true);
  }
});

test("failed rendering retains the previous applied badge and saved source", async () => {
  await request("install", picture("good.svg", "blue"));
  await request("install", picture("broken.svg", "red"));
  await request("select", "good.svg");
  await Luna.wallpaper.start(fixture.options);
  fixture.env.LUNA_TEST_REJECT = "1";
  expect(await request("select", "broken.svg")).toMatchObject({ succes: false });
  expect(await request("list")).toMatchObject({
    succes: true,
    data: [
      { name: "broken.svg", current: false },
      { name: "good.svg", current: true },
    ],
  });
  expect(fixture.state().settings.wallpaper.source).toEndWith("/good.svg");
});
