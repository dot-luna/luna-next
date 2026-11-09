import { expect, test } from "bun:test";
import { ApiError } from "../src/lib/response.ts";
import { inspectAcer, readChargeLimit, setChargeLimit } from "../src/hardware/acer.ts";
import type {
  HardwareCommand,
  HardwareContext,
  HardwareFileMetadata,
} from "../src/hardware/context.ts";
import { createFans } from "../src/hardware/fans.ts";
import { createKeyboard } from "../src/hardware/keyboard.ts";
import { runHelperRequest, type HelperContext } from "../src/hardware/helper.ts";

const MODULE = "/sys/module/linuwu_sense";
const DRIVER = "/sys/bus/platform/drivers/acer-wmi";
const DEVICE = "/sys/devices/platform/acer-wmi";
const NITRO = `${DEVICE}/nitro_sense`;
const missing = () => Object.assign(new Error("Fixture file missing"), { code: "ENOENT" });

// Every read, process invocation, and write is in memory; these tests never touch real hardware.
function fixture() {
  let uptimeMs = 1000;
  const commands: HardwareCommand[] = [];
  const reads: string[] = [];
  const writes: Array<{ path: string; value: string }> = [];
  const files = new Map([
    ["/sys/class/dmi/id/sys_vendor", "Acer\n"],
    ["/sys/class/dmi/id/product_name", "Nitro ANV15-51\n"],
    [`${NITRO}/fan_speed`, "0,0\n"],
    [`${NITRO}/battery_limiter`, "0\n"],
    [`${NITRO}/backlight_timeout`, "1\n"],
  ]);
  const links = new Map([
    [`${DRIVER}/module`, MODULE],
    [`${MODULE}/drivers/platform:acer-wmi`, DRIVER],
    [`${DRIVER}/acer-wmi`, DEVICE],
    [`${DEVICE}/driver`, DRIVER],
    [`${MODULE}/drivers/platform:acer-wmi/acer-wmi/nitro_sense`, NITRO],
  ]);
  const metadata = new Map<string, HardwareFileMetadata>();
  for (const directory of ["/", "/usr", "/usr/lib", "/usr/lib/luna", "/usr/bin", NITRO])
    metadata.set(directory, { uid: 0, mode: 0o755, kind: "directory" });
  for (const path of files.keys()) metadata.set(path, { uid: 0, mode: 0o644, kind: "file" });
  for (const path of ["/usr/lib/luna/luna-hardware-helper", "/usr/bin/pkexec"])
    metadata.set(path, { uid: 0, mode: 0o755, kind: "file" });

  const context: HardwareContext = {
    platform: "linux",
    async readText(path) {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) throw missing();
      return value;
    },
    async listNames() {
      return [];
    },
    async realPath(path) {
      if (links.has(path)) return links.get(path)!;
      if (metadata.has(path)) return path;
      throw missing();
    },
    async metadata(path) {
      const value = metadata.get(path);
      if (!value) throw missing();
      return value;
    },
    async run(command) {
      commands.push(command);
      const result = await runHelperRequest(JSON.parse(command.argv[3]!), helper);
      return { stdout: JSON.stringify(result), stderr: "", code: result.succes ? 0 : 1 };
    },
    now: () => 0,
    monotonicMs: () => uptimeMs,
  };
  const helper: HelperContext = {
    hardware: context,
    effectiveUid: 0,
    async writeAttribute(request) {
      request.beforeWrite();
      writes.push({ path: request.path, value: request.value });
      files.set(request.path, request.value);
    },
  };
  return {
    context,
    helper,
    files,
    metadata,
    links,
    commands,
    reads,
    writes,
    advance(ms: number) {
      uptimeMs += ms;
    },
  };
}

test("Acer discovery separates absent driver, absent optional controls, and write readiness", async () => {
  const f = fixture();
  const present = await inspectAcer(f.context);
  expect(present.features.fanControl.status).toBe("available");
  expect(present.privilegedWrites).toEqual({ helperAvailable: true, polkitAvailable: true });
  f.metadata.delete(`${NITRO}/backlight_timeout`);
  f.metadata.delete("/usr/lib/luna/luna-hardware-helper");
  const partial = await inspectAcer(f.context);
  expect(partial.features.keyboardTimeout.status).toBe("unsupported");
  expect(partial.features.fanControl.status).toBe("available");
  expect(partial.privilegedWrites.helperAvailable).toBe(false);
  f.links.delete(`${DRIVER}/module`);
  expect((await inspectAcer(f.context)).features.fanControl.status).toBe("unavailable");
  expect(f.commands).toHaveLength(0);
  expect(f.writes).toHaveLength(0);
});

test("fan reads reflect driver cached pairs and reject malformed/out-of-range readings", async () => {
  const f = fixture();
  const fans = createFans(f.context);
  expect(await fans.get()).toEqual({
    succes: true,
    data: { driverReportedTargets: { cpu: 0, gpu: 0 } },
  });
  f.files.set(`${NITRO}/fan_speed`, "100,45\n");
  expect(await fans.get()).toMatchObject({
    succes: true,
    data: { driverReportedTargets: { cpu: 100, gpu: 45 } },
  });
  for (const value of ["101,0", "0", "00,10", "10.5,20", "CPU: 20 GPU: 30"]) {
    f.files.set(`${NITRO}/fan_speed`, value);
    expect(await fans.get()).toMatchObject({ succes: false, err: "IO_ERROR" });
  }
});

test("invalid fan inputs/options reject before probing or authorization", async () => {
  const f = fixture();
  const fans = createFans(f.context);
  for (const input of [
    { cpu: 20 },
    { cpu: 1.5, gpu: 50 },
    { cpu: -1, gpu: 0 },
    { cpu: 0, gpu: 101 },
    { cpu: "30", gpu: 40 },
    { cpu: 0, gpu: 0, path: "/tmp/anything" },
  ])
    expect(await fans.set(input as never, { allowAuthorization: true })).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  for (const options of [
    null,
    { allowAuthorization: "true" },
    { allowAuthorization: true, path: "x" },
  ])
    expect(await fans.set({ cpu: 0, gpu: 0 }, options as never)).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  expect(f.reads).toHaveLength(0);
  expect(f.commands).toHaveLength(0);
});

test("valid default writes require opt-in without invoking Polkit", async () => {
  const f = fixture();
  expect(await createFans(f.context).set({ cpu: 0, gpu: 0 })).toMatchObject({
    succes: false,
    err: "INPUT_REQUIRED",
  });
  expect(await setChargeLimit(f.context, { enabled: true })).toMatchObject({
    succes: false,
    err: "INPUT_REQUIRED",
  });
  expect(
    await createKeyboard(f.context).setTimeout({ enabled: false }, { allowAuthorization: false }),
  ).toMatchObject({ succes: false, err: "INPUT_REQUIRED" });
  expect(f.commands).toHaveLength(0);
  expect(f.writes).toHaveLength(0);
});

test("fan auto, mixed, manual, and max requests write exactly one complete pair each", async () => {
  const f = fixture();
  const inputs = [
    { cpu: 0, gpu: 0 },
    { cpu: 0, gpu: 45 },
    { cpu: 1, gpu: 100 },
    { cpu: 100, gpu: 100 },
    { cpu: 100, gpu: 100 },
  ];
  for (const input of inputs)
    expect(await createFans(f.context).set(input, { allowAuthorization: true })).toEqual({
      succes: true,
      data: { driverReportedTargets: input },
    });
  expect(f.writes.map((write) => write.value)).toEqual([
    "0,0\n",
    "0,45\n",
    "1,100\n",
    "100,100\n",
    "100,100\n",
  ]);
  expect(
    f.commands.every(
      (command) =>
        command.argv.slice(0, 3).join(" ") ===
        "/usr/bin/pkexec --disable-internal-agent /usr/lib/luna/luna-hardware-helper",
    ),
  ).toBe(true);
  expect(f.commands.every((command) => command.timeoutMs === 120_000)).toBe(true);
});

test("limiter and keyboard use exact boolean reads, preserving the keyboard unknown sentinel", async () => {
  const f = fixture();
  const keyboard = createKeyboard(f.context);
  expect(await readChargeLimit(f.context)).toEqual({ enabled: false, limitPercent: 80 });
  expect(await setChargeLimit(f.context, { enabled: true }, { allowAuthorization: true })).toEqual({
    succes: true,
    data: { enabled: true, limitPercent: 80 },
  });
  for (const [raw, enabled] of [
    ["0", false],
    ["1", true],
    ["-1", null],
  ] as const) {
    f.files.set(`${NITRO}/backlight_timeout`, raw);
    expect(await keyboard.get()).toEqual({ succes: true, data: { enabled, timeoutSeconds: 30 } });
  }
  expect(await keyboard.setTimeout({ enabled: false }, { allowAuthorization: true })).toEqual({
    succes: true,
    data: { enabled: false, timeoutSeconds: 30 },
  });
  f.files.set(`${NITRO}/battery_limiter`, "2");
  await expect(readChargeLimit(f.context)).rejects.toThrow("Invalid battery limiter");
  f.files.set(`${NITRO}/backlight_timeout`, "true");
  expect(await keyboard.get()).toMatchObject({ succes: false, err: "IO_ERROR" });
  expect(await keyboard.setTimeout({ enabled: "false" } as never)).toMatchObject({
    succes: false,
    err: "INVALID_ARGUMENT",
  });
});

test("untrusted helpers, ancestors, or device paths never reach authorization", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fixture>) =>
      f.metadata.set("/usr/lib/luna", { uid: 1000, mode: 0o755, kind: "directory" }),
    (f: ReturnType<typeof fixture>) =>
      f.metadata.set("/usr/lib/luna/luna-hardware-helper", { uid: 0, mode: 0o777, kind: "file" }),
    (f: ReturnType<typeof fixture>) => f.links.set(`${NITRO}/fan_speed`, "/tmp/fake-fan"),
    (f: ReturnType<typeof fixture>) => f.links.set(`${DRIVER}/module`, "/sys/module/acer_wmi"),
    (f: ReturnType<typeof fixture>) => f.files.set("/sys/class/dmi/id/product_name", "Other Acer"),
  ]) {
    const f = fixture();
    mutate(f);
    expect(
      await createFans(f.context).set({ cpu: 100, gpu: 100 }, { allowAuthorization: true }),
    ).toMatchObject({ succes: false, err: "INVALID_ENVIRONMENT" });
    expect(f.commands).toHaveLength(0);
    expect(f.writes).toHaveLength(0);
  }
});

test("helper rejects direct invalid operations, paths, inputs, identity, and unprivileged execution", async () => {
  const f = fixture();
  const valid = { operation: "fanTargets", input: { cpu: 0, gpu: 0 }, deadlineUptimeMs: 121_000 };
  for (const request of [
    { ...valid, operation: "usbCharging" },
    { ...valid, input: { cpu: 101, gpu: 0 } },
    { ...valid, path: "/tmp/anything" },
    { ...valid, deadlineUptimeMs: 122_000 },
  ])
    expect(await runHelperRequest(request, f.helper)).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
  expect(await runHelperRequest(valid, { ...f.helper, effectiveUid: 1000 })).toMatchObject({
    succes: false,
    err: "INVALID_ENVIRONMENT",
  });
  f.files.set("/sys/class/dmi/id/sys_vendor", "Not Acer");
  expect(await runHelperRequest(valid, f.helper)).toMatchObject({
    succes: false,
    err: "INVALID_ENVIRONMENT",
  });
  expect(f.writes).toHaveLength(0);
});

test("late authorization and helper work exceeding its own deadline cannot start writes", async () => {
  const late = fixture();
  expect(
    await runHelperRequest(
      { operation: "fanTargets", input: { cpu: 0, gpu: 0 }, deadlineUptimeMs: 999 },
      late.helper,
    ),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(late.writes).toHaveLength(0);
  const slow = fixture();
  const realPath = slow.context.realPath;
  slow.context.realPath = async (path) => {
    const value = await realPath(path);
    slow.advance(10_001);
    return value;
  };
  expect(
    await runHelperRequest(
      { operation: "fanTargets", input: { cpu: 0, gpu: 0 }, deadlineUptimeMs: 121_000 },
      slow.helper,
    ),
  ).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  expect(slow.writes).toHaveLength(0);
});

test("partial firmware failures retain failure despite old cached targets and never retry", async () => {
  const f = fixture();
  f.helper.writeAttribute = async (request) => {
    request.beforeWrite();
    f.writes.push({ path: request.path, value: request.value });
    throw new Error("Second firmware step failed");
  };
  const result = await createFans(f.context).set(
    { cpu: 40, gpu: 50 },
    { allowAuthorization: true },
  );
  expect(result).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  if (!result.succes) expect(result.errMessage).toContain("partial or unknown");
  expect(f.writes).toHaveLength(1);
  expect(f.files.get(`${NITRO}/fan_speed`)).toBe("0,0\n");
});

test("a timed-out helper cannot dispatch a delayed write after returning its failure", async () => {
  const f = fixture();
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  let completed!: () => void;
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  f.helper.writeAttribute = async (request) => {
    await gate;
    try {
      request.beforeWrite();
      f.writes.push({ path: request.path, value: request.value });
    } finally {
      completed();
    }
  };
  const result = await runHelperRequest(
    { operation: "fanTargets", input: { cpu: 100, gpu: 100 }, deadlineUptimeMs: 1005 },
    f.helper,
  );
  expect(result).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  resume();
  await finished;
  expect(f.writes).toHaveLength(0);
});

test("post-write mismatches and unknown states fail without compensating writes", async () => {
  const f = fixture();
  f.helper.writeAttribute = async (request) => {
    request.beforeWrite();
    f.writes.push({ path: request.path, value: request.value });
  };
  expect(
    await createFans(f.context).set({ cpu: 50, gpu: 50 }, { allowAuthorization: true }),
  ).toMatchObject({ succes: false, err: "CONFLICT" });
  f.files.set(`${NITRO}/backlight_timeout`, "-1");
  const unknown = await createKeyboard(f.context).setTimeout(
    { enabled: true },
    { allowAuthorization: true },
  );
  expect(unknown).toMatchObject({ succes: false, err: "IO_ERROR" });
  if (!unknown.succes) expect(unknown.errMessage).toContain("partial or unknown");
  expect(f.writes).toHaveLength(2);
});

test("client rejects cancellation, malformed replies, and contradictory helper success", async () => {
  const cases = [
    {
      code: 126,
      stdout: "",
      stderr: "Canceled by user",
      expected: "COMMAND_FAILED",
      message: "canceled",
    },
    {
      code: 127,
      stdout: "",
      stderr: "Not authorized",
      expected: "COMMAND_FAILED",
      message: "denied",
    },
    {
      code: 0,
      stdout: "not json",
      stderr: "",
      expected: "IO_ERROR",
      message: "partial or unknown",
    },
    {
      code: 0,
      stdout: JSON.stringify({ succes: true, data: { driverReportedTargets: { cpu: 0, gpu: 0 } } }),
      stderr: "",
      expected: "CONFLICT",
      message: "differs",
    },
  ];
  for (const item of cases) {
    const f = fixture();
    f.context.run = async () => item;
    const result = await createFans(f.context).set(
      { cpu: 50, gpu: 50 },
      { allowAuthorization: true },
    );
    expect(result).toMatchObject({ succes: false, err: item.expected });
    if (!result.succes) expect(result.errMessage).toContain(item.message);
    expect(f.writes).toHaveLength(0);
  }
});

test("a transport timeout reports uncertain effects without retrying", async () => {
  const f = fixture();
  let calls = 0;
  f.context.run = async () => {
    calls++;
    throw new ApiError("COMMAND_FAILED", "Timed out");
  };
  const result = await createFans(f.context).set({ cpu: 0, gpu: 0 }, { allowAuthorization: true });
  expect(result).toMatchObject({ succes: false, err: "COMMAND_FAILED" });
  if (!result.succes) expect(result.errMessage).toContain("partial or unknown");
  expect(calls).toBe(1);
});
