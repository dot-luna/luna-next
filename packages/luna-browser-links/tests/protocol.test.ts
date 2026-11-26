import { expect, test } from "bun:test";
import { encodeMessage, readMessage } from "../src/protocol.ts";

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
