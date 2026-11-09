import { describe, expect, test } from "bun:test";
import { createBattery } from "../src/hardware/battery.ts";
import type { HardwareCommand, HardwareContext } from "../src/hardware/context.ts";
import { createPower } from "../src/hardware/power.ts";

const powerService = "org.freedesktop.UPower.PowerProfiles";
const upowerService = "org.freedesktop.UPower";
const batteryPath = "/org/freedesktop/UPower/devices/battery_BAT1";
const limiterPath = "/sys/devices/platform/acer-wmi/nitro_sense/battery_limiter";

function variants(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]) => [
      name,
      {
        type: Array.isArray(value)
          ? "aa{sv}"
          : typeof value === "boolean"
            ? "b"
            : typeof value === "number"
              ? "d"
              : "s",
        data: Array.isArray(value) ? value.map((entry) => variants(entry)) : value,
      },
    ]),
  );
}

function fixture() {
  const commands: HardwareCommand[] = [];
  const files = new Map<string, string>();
  const links = new Map<string, string>();
  const power: Record<string, unknown> = {
    ActiveProfile: "balanced",
    Profiles: [
      { Profile: "power-saver", CpuDriver: "intel_pstate", PlatformDriver: "placeholder" },
      { Profile: "balanced", CpuDriver: "intel_pstate", PlatformDriver: "placeholder" },
      { Profile: "performance", CpuDriver: "intel_pstate" },
    ],
    PerformanceDegraded: "",
    ActiveProfileHolds: [],
  };
  const battery: Record<string, unknown> = {
    Type: 2,
    PowerSupply: true,
    IsPresent: true,
    Percentage: 52.5,
    Capacity: 88.4,
    ChargeCycles: 120,
    State: 2,
  };
  const devices = new Map<string, Record<string, unknown>>([[batteryPath, battery]]);
  const root: Record<string, unknown> = { OnBattery: false };
  const behavior = {
    upowerMissing: false,
    rootMissing: false,
    powerMissing: false,
    setError: "",
    setMismatch: false,
    corruptAfterSet: false,
    unreadableDevice: "",
  };
  const missing = () => Object.assign(new Error("Fixture path is absent"), { code: "ENOENT" });
  const context: HardwareContext = {
    platform: "linux",
    readText: async (path) => {
      const value = files.get(path);
      if (value === undefined) throw missing();
      return value;
    },
    listNames: async () => {
      throw missing();
    },
    realPath: async (path) => {
      const value = links.get(path);
      if (value !== undefined) return value;
      if (files.has(path)) return path;
      throw missing();
    },
    metadata: async (path) => {
      if (files.has(path)) return { uid: 0, mode: 0o100644, kind: "file" };
      if ([...links.values()].includes(path)) return { uid: 0, mode: 0o40755, kind: "directory" };
      throw missing();
    },
    now: () => 1_800_000_000_000,
    monotonicMs: () => 1_000,
    async run(command) {
      commands.push(command);
      const { argv } = command;
      if (argv[0] !== "/usr/bin/busctl")
        throw new Error("Unexpected executable in service fixture");
      const index = argv.indexOf("call");
      const destination = argv[index + 1];
      const path = argv[index + 2];
      const method = argv[index + 4];
      const result = (type: string, data: unknown[]) => ({
        code: 0,
        stdout: JSON.stringify({ type, data }),
        stderr: "",
      });
      const absent = () => ({
        code: 1,
        stdout: "",
        stderr: "org.freedesktop.DBus.Error.ServiceUnknown",
      });
      if (destination === powerService) {
        if (behavior.powerMissing) return absent();
        if (method === "GetAll") return result("a{sv}", [variants(power)]);
        if (method === "Set") {
          if (behavior.setError) return { code: 1, stdout: "", stderr: behavior.setError };
          if (!behavior.setMismatch) power.ActiveProfile = argv.at(-1);
          if (behavior.corruptAfterSet) power.ActiveProfileHolds = "invalid";
          return { code: 0, stdout: "", stderr: "" };
        }
      }
      if (destination === upowerService) {
        if (behavior.upowerMissing) return absent();
        if (method === "EnumerateDevices") return result("ao", [[...devices.keys()]]);
        if (method === "GetAll" && path === "/org/freedesktop/UPower") {
          if (behavior.rootMissing) return absent();
          return result("a{sv}", [variants(root)]);
        }
        if (method === "GetAll" && path && devices.has(path)) {
          if (behavior.unreadableDevice === path)
            return { code: 1, stdout: "", stderr: "Device disappeared" };
          return result("a{sv}", [variants(devices.get(path)!)]);
        }
      }
      throw new Error(`Unexpected fixture command ${JSON.stringify(argv)}`);
    },
  };
  function enableLimiter(value = "1") {
    files.set("/sys/class/dmi/id/sys_vendor", "Acer\n");
    files.set("/sys/class/dmi/id/product_name", "Nitro ANV15-51\n");
    files.set(limiterPath, value);
    for (const [from, to] of [
      ["/sys/bus/platform/drivers/acer-wmi/module", "/sys/module/linuwu_sense"],
      ["/sys/module/linuwu_sense/drivers/platform:acer-wmi", "/sys/bus/platform/drivers/acer-wmi"],
      ["/sys/bus/platform/drivers/acer-wmi/acer-wmi", "/sys/devices/platform/acer-wmi"],
      ["/sys/devices/platform/acer-wmi/driver", "/sys/bus/platform/drivers/acer-wmi"],
      [
        "/sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/nitro_sense",
        "/sys/devices/platform/acer-wmi/nitro_sense",
      ],
    ] as const)
      links.set(from, to);
  }
  return { context, commands, power, battery, devices, root, behavior, files, enableLimiter };
}

describe("hardware power service", () => {
  test("constructing APIs performs no I/O, and every get reflects external profile changes", async () => {
    const value = fixture();
    const api = createPower(value.context);
    createBattery(value.context);
    expect(value.commands).toEqual([]);
    value.power.ActiveProfileHolds = [
      { Profile: "power-saver", ApplicationId: "org.example.Reader", Reason: "Reading" },
    ];
    value.power.PerformanceDegraded = "lap-detected";
    expect(await api.get()).toEqual({
      succes: true,
      data: {
        active: "balanced",
        available: ["power-saver", "balanced", "performance"],
        drivers: { cpu: "intel_pstate", platform: null },
        performanceDegraded: "lap-detected",
        holds: [{ profile: "power-saver", applicationId: "org.example.Reader", reason: "Reading" }],
      },
    });
    value.power.ActiveProfile = "performance";
    expect(await api.get()).toMatchObject({
      succes: true,
      data: { active: "performance", drivers: { platform: null } },
    });
    expect(value.commands).toHaveLength(2);
  });

  test("sets through Properties.Set without prompting and verifies the fresh selection", async () => {
    const value = fixture();
    expect(await createPower(value.context).set({ profile: "performance" })).toMatchObject({
      succes: true,
      data: { active: "performance" },
    });
    expect(value.commands).toHaveLength(3);
    const command = value.commands[1]!;
    expect(command.timeoutMs).toBe(10_000);
    expect(command.argv).toContain("--allow-interactive-authorization=no");
    expect(command.argv.slice(command.argv.indexOf("call"))).toEqual([
      "call",
      powerService,
      "/org/freedesktop/UPower/PowerProfiles",
      "org.freedesktop.DBus.Properties",
      "Set",
      "ssv",
      powerService,
      "ActiveProfile",
      "s",
      "performance",
    ]);
  });

  test("rejects strict invalid inputs before I/O and an unoffered standard profile before mutation", async () => {
    const value = fixture();
    const api = createPower(value.context);
    for (const input of [{ profile: "turbo" }, { profile: "balanced", extra: true }, {}, null])
      expect(await api.set(input as never)).toMatchObject({
        succes: false,
        err: "INVALID_ARGUMENT",
      });
    expect(value.commands).toEqual([]);
    value.power.Profiles = [{ Profile: "balanced" }];
    expect(await api.set({ profile: "performance" })).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
    expect(value.commands).toHaveLength(1);
  });

  test("unknown profiles and malformed required service state never silently become balanced", async () => {
    for (const properties of [
      { ActiveProfile: "turbo" },
      { Profiles: [{ Profile: "balanced" }, { Profile: "turbo" }] },
      { Profiles: [{ Profile: "balanced", CpuDriver: 42 }] },
      { Profiles: [{ Profile: "balanced" }, { Profile: "balanced" }] },
      { ActiveProfileHolds: [{ Profile: "turbo", ApplicationId: "x", Reason: "x" }] },
      { ActiveProfileHolds: null },
      { PerformanceDegraded: false },
    ]) {
      const value = fixture();
      Object.assign(value.power, properties);
      expect(await createPower(value.context).get()).toMatchObject({
        succes: false,
        err: "IO_ERROR",
      });
    }
  });

  test("conflicting readback does not retry or restore potentially changed fan state", async () => {
    const value = fixture();
    value.behavior.setMismatch = true;
    expect(await createPower(value.context).set({ profile: "performance" })).toMatchObject({
      succes: false,
      err: "CONFLICT",
      errMessage: expect.stringContaining("fan state may have changed"),
    });
    expect(value.commands.filter((command) => command.argv.includes("Set"))).toHaveLength(1);
  });

  test("denial and failed verification retain uncertainty without compensating writes", async () => {
    const denied = fixture();
    denied.behavior.setError = "AccessDenied: not authorized";
    expect(await createPower(denied.context).set({ profile: "performance" })).toMatchObject({
      succes: false,
      err: "COMMAND_FAILED",
      errMessage: expect.stringContaining("AccessDenied"),
    });
    expect(denied.commands).toHaveLength(2);
    const unreadable = fixture();
    unreadable.behavior.corruptAfterSet = true;
    expect(await createPower(unreadable.context).set({ profile: "performance" })).toMatchObject({
      succes: false,
      err: "IO_ERROR",
      errMessage: expect.stringContaining("may have changed"),
    });
    expect(unreadable.commands).toHaveLength(3);
  });

  test("missing PPD returns unavailable instead of fabricated state", async () => {
    const value = fixture();
    value.behavior.powerMissing = true;
    expect(await createPower(value.context).get()).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
  });
});

describe("hardware battery service", () => {
  test("reads real battery values and preserves zero while the Acer driver is absent", async () => {
    const value = fixture();
    value.battery.Percentage = 0;
    value.battery.ChargeCycles = 0;
    const result = await createBattery(value.context).get();
    expect(result).toMatchObject({
      succes: true,
      data: {
        present: true,
        percentage: 0,
        healthPercent: 88.4,
        cycles: 0,
        state: "discharging",
        onBattery: false,
        chargeLimit: { enabled: null, limitPercent: 80 },
        issues: [{ component: "chargeLimit.enabled", code: "unavailable" }],
      },
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test("the limiter still reads when UPower is unavailable", async () => {
    const value = fixture();
    value.enableLimiter();
    value.behavior.upowerMissing = true;
    const result = await createBattery(value.context).get();
    expect(result).toMatchObject({
      succes: true,
      data: {
        present: null,
        percentage: null,
        healthPercent: null,
        cycles: null,
        state: null,
        onBattery: null,
        chargeLimit: { enabled: true, limitPercent: 80 },
      },
    });
    if (!result.succes) throw new Error(result.errMessage);
    expect(result.data.issues.map((issue) => issue.component).sort()).toEqual([
      "cycles",
      "healthPercent",
      "onBattery",
      "percentage",
      "present",
      "state",
    ]);
    expect(result.data.issues.every((issue) => issue.code === "unavailable")).toBe(true);
  });

  test("a root-property failure does not hide the device or limiter", async () => {
    const value = fixture();
    value.enableLimiter("0");
    value.behavior.rootMissing = true;
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: {
        present: true,
        percentage: 52.5,
        onBattery: null,
        chargeLimit: { enabled: false },
        issues: [{ component: "onBattery", code: "unavailable" }],
      },
    });
  });

  test("unknown cycles, capacity and state are null without hiding valid zero charge", async () => {
    const value = fixture();
    value.enableLimiter();
    Object.assign(value.battery, { Percentage: 0, Capacity: 0, ChargeCycles: -1, State: 0 });
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: {
        present: true,
        percentage: 0,
        healthPercent: null,
        cycles: null,
        state: null,
        issues: [
          { component: "cycles", code: "unknown" },
          { component: "healthPercent", code: "unknown" },
          { component: "state", code: "unknown" },
        ],
      },
    });
  });

  test("malformed individual readings preserve the rest of the battery result", async () => {
    const value = fixture();
    value.enableLimiter("-1");
    value.battery.Percentage = "80";
    value.battery.ChargeCycles = 2.5;
    const result = await createBattery(value.context).get();
    expect(result).toMatchObject({
      succes: true,
      data: {
        present: true,
        percentage: null,
        healthPercent: 88.4,
        cycles: null,
        state: "discharging",
        chargeLimit: { enabled: null },
      },
    });
    if (!result.succes) throw new Error(result.errMessage);
    expect(result.data.issues.map((issue) => issue.component)).toEqual([
      "chargeLimit.enabled",
      "cycles",
      "percentage",
    ]);
  });

  test("peripheral and absent batteries do not count as a present laptop battery", async () => {
    const value = fixture();
    value.battery.IsPresent = false;
    value.devices.set("/org/freedesktop/UPower/devices/mouse", {
      Type: 2,
      PowerSupply: false,
      IsPresent: true,
      Percentage: 90,
    });
    value.devices.set("/org/freedesktop/UPower/devices/line_power_AC", { Type: 1 });
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: {
        present: false,
        percentage: null,
        cycles: null,
        onBattery: false,
      },
    });
  });

  test("multiple system batteries are present but are never silently aggregated", async () => {
    const value = fixture();
    value.devices.set("/org/freedesktop/UPower/devices/battery_BAT2", {
      ...value.battery,
      Percentage: 97,
    });
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: {
        present: true,
        percentage: null,
        healthPercent: null,
        cycles: null,
        state: null,
        issues: expect.arrayContaining([
          {
            component: "percentage",
            code: "unsupported",
            message: expect.stringContaining("Multiple system batteries"),
          },
        ]),
      },
    });
  });

  test("an unreadable enumerated device cannot be treated as an absent or single battery", async () => {
    const value = fixture();
    value.behavior.unreadableDevice = batteryPath;
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: { present: null, percentage: null },
    });
    value.devices.set("/org/freedesktop/UPower/devices/battery_BAT2", { ...value.battery });
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: { present: true, percentage: null },
    });
  });

  test("malformed device selection properties do not produce a false absence claim", async () => {
    const value = fixture();
    value.battery.PowerSupply = "true";
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: true,
      data: { present: null },
    });
  });

  test("charge-limit inputs stay strict and never trigger service or helper work on validation failure", async () => {
    const value = fixture();
    const api = createBattery(value.context);
    expect(await api.setChargeLimit({ enabled: "true" } as never)).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
    expect(await api.setChargeLimit({ enabled: true, path: "/tmp/other" } as never)).toMatchObject({
      succes: false,
      err: "INVALID_ARGUMENT",
    });
    expect(value.commands).toEqual([]);
  });

  test("unsupported hosts fail before any system operation", async () => {
    const value = fixture();
    value.context.platform = "darwin";
    expect(await createBattery(value.context).get()).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
    expect(await createPower(value.context).get()).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
    expect(value.commands).toEqual([]);
  });
});
