import { expect, test } from "bun:test";
import { externalLink } from "../src/links.ts";

const routing = {
  appOrigins: ["https://web.whatsapp.com"],
  origins: ["https://web.whatsapp.com", "https://accounts.google.com"],
};
test("only installed app sources route external links", () => {
  for (const source of [
    "https://example.com",
    "https://accounts.google.com",
    "about:blank",
    "https://web.whatsapp.com.evil.test",
    "https://sub.web.whatsapp.com",
    "http://web.whatsapp.com",
    "https://web.whatsapp.com:8443",
    "invalid",
  ])
    expect(externalLink({ ...routing, source, destination: "https://external.test" })).toBe(false);
  expect(
    externalLink({
      ...routing,
      source: "https://web.whatsapp.com/chat",
      destination: "https://external.test",
    }),
  ).toBe(true);
});
test("internal, sign-in, download and non-web destinations stay local", () => {
  for (const destination of [
    "https://web.whatsapp.com/chat",
    "https://accounts.google.com/login",
    "blob:https://web.whatsapp.com/id",
    "mailto:test@example.com",
    "javascript:void(0)",
    "https://user:secret@external.test",
    "invalid",
  ]) {
    expect(externalLink({ ...routing, source: "https://web.whatsapp.com/chat", destination })).toBe(
      false,
    );
  }
});
