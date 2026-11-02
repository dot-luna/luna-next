import { expect, test } from "bun:test";
import { createLogger } from "../src/lib/logger.ts";

test("pretty logs include severity and context while honoring the level threshold", () => {
  let output = "";
  const logger = createLogger({
    color: false,
    level: "warn",
    destination: {
      write(chunk) {
        output += chunk;
      },
    },
  });
  logger.info("hidden");
  logger.error({ code: "IO_ERROR" }, "Could not read metadata");
  expect(output).toContain("ERROR");
  expect(output).toContain("Could not read metadata");
  expect(output).toContain("IO_ERROR");
  expect(output).not.toContain("hidden");
  expect(output).not.toContain("\u001b[");
});

test("color can be enabled for a terminal destination", () => {
  let output = "";
  const logger = createLogger({
    color: true,
    destination: {
      write(chunk) {
        output += chunk;
      },
    },
  });
  logger.warn("Warning");
  expect(output).toContain("\u001b[");
  expect(output).toContain("Warning");
});
