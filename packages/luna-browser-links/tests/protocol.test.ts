import { expect, test } from "bun:test";
import { encodeMessage, readMessage } from "../src/protocol.ts";
import { originRules, redirectRule } from "../src/rules.ts";

function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("native messages accept fragmented Unicode frames", async () => {
  const message = { type: "open", url: "https://example.com/नेपाली?a=$()" };
  const bytes = encodeMessage(message);
  expect(
    await readMessage(stream([bytes.subarray(0, 2), bytes.subarray(2, 8), bytes.subarray(8)])),
  ).toEqual(message);
});

test("native messages reject oversized, truncated, malformed and extra frames", async () => {
  await expect(readMessage(stream([Buffer.from([255, 255, 255, 255])]))).rejects.toThrow("length");
  await expect(readMessage(stream([Buffer.from([10, 0, 0, 0, 123])]))).rejects.toThrow("Truncated");
  await expect(readMessage(stream([Buffer.from([1, 0, 0, 0, 33])]))).rejects.toThrow();
  await expect(
    readMessage(stream([Buffer.concat([encodeMessage({}), encodeMessage({})])])),
  ).rejects.toThrow("one");
});

test("routing allows exact registered origins without leaking to lookalike domains or ports", () => {
  const rule = originRules(["https://web.whatsapp.com", "https://web.whatsapp.com"])[0]!;
  const regex = new RegExp(rule.condition.regexFilter!);
  expect(regex.test("https://web.whatsapp.com/chat")).toBe(true);
  for (const url of [
    "http://web.whatsapp.com/",
    "https://web.whatsapp.com.evil.test/",
    "https://web.whatsapp.com:8080/",
    "https://evil.web.whatsapp.com/",
  ])
    expect(regex.test(url)).toBe(false);
  expect(originRules(["https://web.whatsapp.com", "https://web.whatsapp.com"])).toHaveLength(1);
  const redirect = redirectRule("a".repeat(32));
  expect(redirect.condition.resourceTypes).toEqual(["main_frame"]);
  expect(redirect.condition.requestMethods).toEqual(["get"]);
});
