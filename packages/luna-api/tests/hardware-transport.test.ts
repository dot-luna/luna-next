import { describe, expect, test } from "bun:test";
import { runCommand } from "../src/hardware/command.ts";
import { systemContext } from "../src/hardware/context.ts";
import { callBus, getProperties } from "../src/hardware/dbus.ts";
import { cpuSampleSchema, fanTargetsSchema, helperRequestSchema } from "../src/hardware/schema.ts";

describe("hardware process transport", () => {
  test("preserves argument boundaries and excludes inherited loader settings", async () => {
    const response = await runCommand({
      argv: [
        process.execPath,
        "--eval",
        "console.log(JSON.stringify({arg:process.argv[1], keys:Object.keys(process.env).sort()}))",
        "$(echo unsafe); space",
      ],
      timeoutMs: 5000,
    });
    expect(response.code).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual({
      arg: "$(echo unsafe); space",
      keys: ["LANG", "LC_ALL", "PATH"],
    });
  });

  test("bounds a stalled process", async () => {
    await expect(
      runCommand({
        argv: [process.execPath, "--eval", "setInterval(() => {}, 1000)"],
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      message: expect.stringContaining("timed out"),
    });
  });

  test("rejects oversized output while the producer is still running", async () => {
    await expect(
      runCommand({
        argv: [
          process.execPath,
          "--eval",
          'process.stdout.write("x".repeat(70000));setInterval(() => {}, 1000)',
        ],
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "COMMAND_FAILED",
      message: expect.stringContaining("output limit"),
    });
  });
});

describe("standard D-Bus transport", () => {
  test("unwraps nested variants and uses the noninteractive system bus", async () => {
    const calls: string[][] = [];
    const context = {
      ...systemContext,
      run: async ({ argv }: { argv: string[] }) => {
        calls.push(argv);
        return {
          code: 0,
          stderr: "",
          stdout: JSON.stringify({
            type: "a{sv}",
            data: [
              {
                ActiveProfile: { type: "s", data: "balanced" },
                Profiles: { type: "aa{sv}", data: [{ Profile: { type: "s", data: "balanced" } }] },
              },
            ],
          }),
        };
      },
    };
    expect(
      await getProperties(context, {
        destination: "service",
        path: "/object",
        interface: "interface",
      }),
    ).toEqual({
      ActiveProfile: "balanced",
      Profiles: [{ Profile: "balanced" }],
    });
    expect(calls[0]).toContain("--allow-interactive-authorization=no");
    expect(calls[0]).toContain("--system");
    expect(calls[0]).toContain("call");
  });

  test("distinguishes a missing service from permission denial and malformed responses", async () => {
    const endpoint = {
      destination: "service",
      path: "/object",
      interface: "interface",
      method: "Method",
    };
    for (const [stderr, code] of [
      ["org.freedesktop.DBus.Error.ServiceUnknown", "INVALID_ENVIRONMENT"],
      ["org.freedesktop.DBus.Error.AccessDenied", "COMMAND_FAILED"],
    ]) {
      await expect(
        callBus(
          { ...systemContext, run: async () => ({ code: 1, stdout: "", stderr: stderr! }) },
          endpoint,
        ),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      callBus(
        { ...systemContext, run: async () => ({ code: 0, stdout: "not json", stderr: "" }) },
        endpoint,
      ),
    ).rejects.toMatchObject({ code: "IO_ERROR" });
  });
});

test("shared write/token schemas reject coercion, omitted fans and arbitrary helper operations", () => {
  expect(fanTargetsSchema.safeParse({ cpu: 0, gpu: 100 }).success).toBe(true);
  for (const value of [
    { cpu: 40 },
    { cpu: "0", gpu: 0 },
    { cpu: 1.5, gpu: 20 },
    { cpu: 0, gpu: 101 },
  ])
    expect(fanTargetsSchema.safeParse(value).success).toBe(false);
  expect(
    cpuSampleSchema.safeParse({
      bootId: "00000000-0000-4000-8000-000000000001",
      totalTicks: "1",
      idleTicks: "2",
    }).success,
  ).toBe(false);
  expect(
    helperRequestSchema.safeParse({
      operation: "write",
      path: "/tmp/untrusted",
      deadlineUptimeMs: 100,
    }).success,
  ).toBe(false);
});
