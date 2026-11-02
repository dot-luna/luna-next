import { expect, test } from "bun:test";
import { createLogger } from "../src/index.ts";

test("JSON logs carry child context and remain undecorated", () => {
  let text = "";
  const logger = createLogger({ format: "json", name: "test", destination: { write(chunk) { text += chunk; } } });
  logger.child({ app: "kitty" }).info("Installed");
  expect(JSON.parse(text)).toMatchObject({ name: "test", app: "kitty", msg: "Installed", level: 30 });
  expect(text).not.toContain("\u001b");
});

test("pretty logging supports explicit colors and level filtering", () => {
  let text = "";
  const logger = createLogger({ color: true, level: "warn", destination: { write(chunk) { text += chunk; } } });
  logger.info("hidden");
  logger.warn("visible");
  expect(text).not.toContain("hidden");
  expect(text).toContain("visible");
  expect(text).toContain("\u001b[");
});
