import { expect, test } from "bun:test";
import { entryLabel, fileNames, fileLabel } from "../src/modules/clipboard/presentation.ts";

test("plain text stays intact and only complete binary markers get attachment labels", () => {
  expect(entryLabel("hello <world>")).toEqual({ name: "hello <world>" });
  expect(entryLabel("[[ binary data is just text")).toEqual({
    name: "[[ binary data is just text",
  });
  expect(entryLabel("[[ binary data 10 KiB jpeg 320x240 ]]")).toEqual({
    name: "[JPEG] 10 KiB jpeg 320x240",
    attachment: true,
  });
});

test("file-manager URI lists show decoded names without reading referenced files", () => {
  expect(fileNames("copy\nfile:///tmp/photo%20one.png\nfile:///tmp/archive.zip")).toBe(
    "[PNG] photo one.png · [ZIP] archive.zip",
  );
  expect(fileNames("# comment\nfile:///tmp/notes")).toBe("[File] notes");
  expect(fileNames("https://example.com/file.pdf")).toBeNull();
  expect(fileNames("file:///tmp/%GG")).toBeNull();
  expect(fileNames("file:///tmp/a.pdf\nnot a URI")).toBeNull();
  expect(fileLabel("application/octet-stream", "42 bytes")).toBe("[File] 42 bytes");
});
