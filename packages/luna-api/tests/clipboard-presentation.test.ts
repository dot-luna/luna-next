import { expect, test } from "bun:test";
import { clipboardPresentation } from "../src/modules/clipboard/presentation.ts";

test("plain text stays intact and only complete binary markers get attachment labels", () => {
  expect(clipboardPresentation.entryLabel("hello <world>")).toEqual({ name: "hello <world>" });
  expect(clipboardPresentation.entryLabel("[[ binary data is just text")).toEqual({
    name: "[[ binary data is just text",
  });
  expect(clipboardPresentation.entryLabel("[[ binary data 10 KiB jpeg 320x240 ]]")).toEqual({
    name: "[JPEG] 10 KiB jpeg 320x240",
    attachment: true,
  });
});

test("file-manager URI lists show decoded names without reading referenced files", () => {
  expect(
    clipboardPresentation.fileNames("copy\nfile:///tmp/photo%20one.png\nfile:///tmp/archive.zip"),
  ).toBe("[PNG] photo one.png · [ZIP] archive.zip");
  expect(
    clipboardPresentation.fileNames("copy file:///tmp/photo%20one.png file:///tmp/archive.zip"),
  ).toBe("[PNG] photo one.png · [ZIP] archive.zip");
  expect(
    clipboardPresentation.fileNames("file:///tmp/photo%20one.png file:///tmp/archive.zip"),
  ).toBe("[PNG] photo one.png · [ZIP] archive.zip");
  expect(clipboardPresentation.fileNames("# comment\nfile:///tmp/notes")).toBe("[File] notes");
  expect(clipboardPresentation.fileNames("https://example.com/file.pdf")).toBeNull();
  expect(clipboardPresentation.fileNames("file:///tmp/%GG")).toBeNull();
  expect(clipboardPresentation.fileNames("file:///tmp/a.pdf\nnot a URI")).toBeNull();
  expect(
    clipboardPresentation.fileLabel({ mime: "application/octet-stream", detail: "42 bytes" }),
  ).toBe("[File] 42 bytes");
});
