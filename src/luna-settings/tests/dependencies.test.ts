import { expect, test } from "bun:test";
import { Luna } from "@luna/api";

test("Settings can import the shared theme API from its workspace", () => {
  expect(Luna.theme.get).toBeFunction();
});
