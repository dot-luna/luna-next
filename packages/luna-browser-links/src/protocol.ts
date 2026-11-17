/** One native-message request per process. Bound the frame before allocating/decoding its body. */
export async function readMessage(stream: ReadableStream<Uint8Array>): Promise<unknown> {
  const reader = stream.getReader();
  let bytes = Buffer.alloc(0);
  let length: number | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Truncated native message");
      bytes = Buffer.concat([bytes, value]);
      if (bytes.length >= 4 && length === undefined) {
        length = bytes.readUInt32LE(0);
        if (length === 0 || length > 65536) throw new Error("Invalid native message length");
      }
      if (length !== undefined && bytes.length >= length + 4) {
        if (bytes.length !== length + 4) throw new Error("Expected one native message");
        return JSON.parse(bytes.subarray(4).toString("utf8"));
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function encodeMessage(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
