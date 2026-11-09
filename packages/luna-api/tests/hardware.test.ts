import { describe, expect, test } from "bun:test";
import { createHardware } from "../src/hardware/index.ts";
import type { HardwareContext } from "../src/hardware/context.ts";

function fixture() {
  const calls: string[][] = [];
  const reads: string[] = [];
  const files = new Map([
    ["/sys/class/dmi/id/sys_vendor", "Acer"],
    ["/sys/class/dmi/id/product_name", "Nitro ANV15-51"],
    ["/proc/stat", "cpu 10 0 20 70 0 0 0 0 0 0\n"],
    ["/proc/sys/kernel/random/boot_id", "00000000-0000-4000-8000-000000000001"],
  ]);
  const absent = (path: string): never => {
    throw Object.assign(new Error(`Missing ${path}`), { code: "ENOENT" });
  };
  let active = "balanced";
  const context: HardwareContext = {
    platform: "linux",
    async readText(path) {
      reads.push(path);
      return files.get(path) ?? absent(path);
    },
    async listNames() {
      return [];
    },
    async realPath(path) {
      return absent(path);
    },
    async metadata(path) {
      return absent(path);
    },
    now: () => 1_700_000_000_000,
    monotonicMs: () => 1000,
    async run({ argv }) {
      calls.push(argv);
      const offset = argv.indexOf("call");
      const destination = argv[offset + 1];
      const method = argv[offset + 4];
      const data =
        destination === "org.freedesktop.UPower.PowerProfiles"
          ? {
              ActiveProfile: active,
              Profiles: [
                { Profile: "balanced", CpuDriver: "intel_pstate", PlatformDriver: "placeholder" },
                { Profile: "power-saver", CpuDriver: "intel_pstate" },
              ],
              PerformanceDegraded: "",
              ActiveProfileHolds: [],
            }
          : { OnBattery: false };
      if (method === "Set") {
        active = argv.at(-1)!;
        return { code: 0, stdout: "", stderr: "" };
      }
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify({
          type: method === "EnumerateDevices" ? "ao" : "a{sv}",
          data: [method === "EnumerateDevices" ? [] : data],
        }),
      };
    },
  };
  return {
    context,
    calls,
    reads,
    files,
    externalProfile: (profile: string) => {
      active = profile;
    },
  };
}

describe("hardware API composition", () => {
  test("construction does no I/O; absent Acer prerequisites leave standard services available", async () => {
    const backend = fixture();
    const hardware = createHardware(backend.context);
    expect(backend.reads).toEqual([]);
    expect(backend.calls).toEqual([]);
    const response = await hardware.inspect();
    expect(response.succes).toBe(true);
    if (!response.succes) return;
    expect(response.data.features.powerProfiles.status).toBe("available");
    expect(response.data.features.batteryInfo.status).toBe("available");
    expect(response.data.features.fanControl.status).toBe("unavailable");
    expect(response.data.features.cpuUtilization.status).toBe("available");
    expect(response.data.privilegedWrites).toEqual({
      helperAvailable: false,
      polkitAvailable: false,
    });
    expect(backend.calls.every((argv) => argv[0] === "/usr/bin/busctl")).toBe(true);
  });

  test("reads reflect external changes and a power change performs no Acer write", async () => {
    const backend = fixture();
    const hardware = createHardware(backend.context);
    expect(await hardware.power.get()).toMatchObject({
      succes: true,
      data: { active: "balanced" },
    });
    backend.externalProfile("power-saver");
    expect(await hardware.power.get()).toMatchObject({
      succes: true,
      data: { active: "power-saver" },
    });
    expect(await hardware.power.set({ profile: "balanced" })).toMatchObject({
      succes: true,
      data: { active: "balanced" },
    });
    expect(backend.calls.filter((argv) => argv.includes("Set"))).toHaveLength(1);
    expect(backend.calls.every((argv) => argv[0] === "/usr/bin/busctl")).toBe(true);
  });

  test("partial reads keep a valid zero while unavailable sensors stay null", async () => {
    const { context } = fixture();
    const hardware = createHardware(context);
    expect(await hardware.battery.get()).toMatchObject({
      succes: true,
      data: { present: false, onBattery: false, chargeLimit: { enabled: null } },
    });
    const first = await hardware.metrics.sample();
    expect(first).toMatchObject({
      succes: true,
      data: {
        cpu: { sample: { totalTicks: "100", idleTicks: "70" }, utilizationPercent: null },
        fans: { cpuRpm: null, gpuRpm: null },
      },
    });
  });

  test("non-Linux requests fail explicitly", async () => {
    const { context } = fixture();
    const hardware = createHardware({ ...context, platform: "darwin" });
    expect(await hardware.inspect()).toMatchObject({ succes: false, err: "INVALID_ENVIRONMENT" });
    expect(await hardware.power.get()).toMatchObject({ succes: false, err: "INVALID_ENVIRONMENT" });
    expect(await hardware.battery.get()).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
    expect(await hardware.metrics.sample()).toMatchObject({
      succes: false,
      err: "INVALID_ENVIRONMENT",
    });
  });
});
