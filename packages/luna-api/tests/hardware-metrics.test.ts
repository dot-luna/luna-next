import { describe, expect, test } from "bun:test";
import type {
  HardwareCommand,
  HardwareContext,
  HardwareFileMetadata,
} from "../src/hardware/context.ts";
import { createMetrics, inspectMetrics } from "../src/hardware/metrics.ts";
import type { CpuSample, MetricsInput, MetricsSample } from "../src/hardware/types.ts";

const bootId = "00000000-0000-4000-8000-000000000001";
const pci = "0000:01:00.0";
const gpuPath = `/sys/bus/pci/devices/${pci}`;
const coretemp = "/sys/class/hwmon/hwmon7";
const acer = "/sys/class/hwmon/hwmon91";

/** Synthetic Linux files and command output; no operation falls through to the host. */
function fixture() {
  const files = new Map<string, string>([
    ["/proc/stat", "cpu 100 20 30 400 50 10 5 5 1000 1000\ncpu0 10 0 0 40\n"],
    ["/proc/sys/kernel/random/boot_id", `${bootId}\n`],
    [`${coretemp}/name`, "coretemp\n"],
    [`${coretemp}/temp1_label`, "Package id 0\n"],
    [`${coretemp}/temp1_input`, "45000\n"],
    [`${coretemp}/temp2_label`, "Core 0\n"],
    [`${coretemp}/temp2_input`, "99000\n"],
    [`${acer}/name`, "acer\n"],
    [`${acer}/fan1_input`, "0\n"],
    [`${acer}/fan2_input`, "4200\n"],
    [`${gpuPath}/vendor`, "0x10de\n"],
    [`${gpuPath}/class`, "0x030000\n"],
    [`${gpuPath}/power/runtime_status`, "suspended\n"],
  ]);
  const directories = new Map<string, string[]>([
    ["/sys/class/hwmon", ["hwmon7", "hwmon91"]],
    [coretemp, ["name", "temp1_label", "temp1_input", "temp2_label", "temp2_input"]],
    [acer, ["name", "fan1_input", "fan2_input"]],
    ["/sys/bus/pci/devices", [pci]],
  ]);
  const realPaths = new Map([
    ["/sys/devices/platform/acer-wmi/driver", "/sys/bus/platform/drivers/acer-wmi"],
    ["/sys/devices/platform/acer-wmi/driver/module", "/sys/module/linuwu_sense"],
    [`${acer}/device`, "/sys/devices/platform/acer-wmi"],
    [`${acer}/device/driver/module`, "/sys/module/linuwu_sense"],
    [`${gpuPath}/driver`, "/sys/bus/pci/drivers/nvidia"],
  ]);
  const metadata = new Map<string, HardwareFileMetadata>([
    ["/sys/module/linuwu_sense", { uid: 0, mode: 0o755, kind: "directory" }],
    ["/usr/bin/nvidia-smi", { uid: 0, mode: 0o755, kind: "file" }],
  ]);
  const calls: HardwareCommand[] = [];
  const reads: string[] = [];
  const command = { code: 0, stdout: "56, 0\n", stderr: "" };
  const missing = (path: string) =>
    Object.assign(new Error(`Missing fixture: ${path}`), { code: "ENOENT" });
  const context: HardwareContext = {
    platform: "linux",
    now: () => Date.parse("2026-11-08T00:00:00.000Z"),
    monotonicMs: () => 1000,
    async readText(path) {
      reads.push(path);
      const value = files.get(path);
      if (value === undefined) throw missing(path);
      return value;
    },
    async listNames(path) {
      reads.push(path);
      const value = directories.get(path);
      if (!value) throw missing(path);
      return value;
    },
    async realPath(path) {
      const value = realPaths.get(path);
      if (!value) throw missing(path);
      return value;
    },
    async metadata(path) {
      const value = metadata.get(path);
      if (!value) throw missing(path);
      return value;
    },
    async run(input) {
      calls.push(input);
      return command;
    },
  };
  return { context, files, directories, realPaths, metadata, calls, reads, command };
}

async function sample(context: HardwareContext, input?: MetricsInput): Promise<MetricsSample> {
  const result = await createMetrics(context).sample(input);
  if (!result.succes) throw new Error(result.errMessage);
  return result.data;
}

describe("hardware CPU telemetry", () => {
  test("first sample returns caller-owned counters without guest double counting or hidden state", async () => {
    const { context, files, calls } = fixture();
    const first = await sample(context);
    expect(first.cpu).toEqual({
      temperatureC: 45,
      utilizationPercent: null,
      sample: { bootId, totalTicks: "620", idleTicks: "450" },
    });
    expect(first.issues).toContainEqual(
      expect.objectContaining({ component: "cpu.utilizationPercent", code: "unknown" }),
    );
    files.set("/proc/stat", "cpu 150 20 30 450 50 10 5 5 2000 2000\n");
    expect((await sample(context, { previousCpu: first.cpu.sample })).cpu.utilizationPercent).toBe(
      50,
    );
    expect((await sample(context)).cpu.utilizationPercent).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("counter precision survives JSON values beyond Number.MAX_SAFE_INTEGER", async () => {
    const { context, files } = fixture();
    files.set("/proc/stat", "cpu 9007199254740993 0 0 9007199254740993 0 0 0 0\n");
    const first = await sample(context);
    expect(first.cpu.sample?.totalTicks).toBe("18014398509481986");
    files.set("/proc/stat", "cpu 9007199254740994 0 0 9007199254740994 0 0 0 0\n");
    expect((await sample(context, { previousCpu: first.cpu.sample })).cpu.utilizationPercent).toBe(
      50,
    );
  });

  test("reboots, regressions, no elapsed ticks, and inconsistent idle deltas replace the baseline", async () => {
    const { context } = fixture();
    const cases: CpuSample[] = [
      { bootId: "00000000-0000-4000-8000-000000000002", totalTicks: "500", idleTicks: "400" },
      { bootId, totalTicks: "630", idleTicks: "450" },
      { bootId, totalTicks: "620", idleTicks: "450" },
      { bootId, totalTicks: "500", idleTicks: "451" },
      { bootId, totalTicks: "600", idleTicks: "420" },
    ];
    for (const previousCpu of cases) {
      const result = await sample(context, { previousCpu });
      expect(result.cpu.utilizationPercent).toBeNull();
      expect(result.cpu.sample).toEqual({ bootId, totalTicks: "620", idleTicks: "450" });
      expect(result.issues).toContainEqual(
        expect.objectContaining({ component: "cpu.utilizationPercent", code: "unknown" }),
      );
    }
  });

  test("malformed CPU input is rejected before any source is read", async () => {
    const { context, reads, calls } = fixture();
    for (const invalid of [
      null,
      { extra: true },
      { previousCpu: { bootId, totalTicks: "01", idleTicks: "0" } },
      { previousCpu: { bootId, totalTicks: "1", idleTicks: "2" } },
    ]) {
      const response = await createMetrics(context).sample(invalid as MetricsInput);
      expect(response).toMatchObject({ succes: false, err: "INVALID_ARGUMENT" });
    }
    expect(reads).toEqual([]);
    expect(calls).toEqual([]);
    expect((await sample(context, { previousCpu: null })).cpu.sample).not.toBeNull();
  });

  test("broken CPU accounting leaves temperatures and real fan readings intact", async () => {
    const { context, files } = fixture();
    files.set("/proc/stat", "cpu 10 nope 20\n");
    const result = await sample(context);
    expect(result.cpu).toEqual({ temperatureC: 45, sample: null, utilizationPercent: null });
    expect(result.fans).toEqual({ cpuRpm: 0, gpuRpm: 4200 });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ component: "cpu.sample", code: "read-failed" }),
    );
  });
});

describe("hardware sensor identity", () => {
  test("uses the coretemp package label and Linuwu's verified CPU/GPU channels without invented labels", async () => {
    const { context } = fixture();
    const result = await sample(context);
    expect(result.cpu.temperatureC).toBe(45);
    expect(result.fans).toEqual({ cpuRpm: 0, gpuRpm: 4200 });
    expect(result.observedAt).toBe("2026-11-08T00:00:00.000Z");
  });

  test("does not accept an acer-named hwmon device owned by a different driver", async () => {
    const { context, metadata, realPaths } = fixture();
    metadata.delete("/sys/module/linuwu_sense");
    realPaths.set(`${acer}/device/driver/module`, "/sys/module/acer_wmi");
    const result = await sample(context);
    expect(result.fans).toEqual({ cpuRpm: null, gpuRpm: null });
    expect((await inspectMetrics(context)).fanRpm.status).toBe("unavailable");
  });

  test("reports absent RPM as unsupported only when Linuwu is bound to the device", async () => {
    const { context, directories, metadata } = fixture();
    directories.set("/sys/class/hwmon", ["hwmon7"]);
    expect((await inspectMetrics(context)).fanRpm.status).toBe("unsupported");
    metadata.delete("/sys/module/linuwu_sense");
    expect((await inspectMetrics(context)).fanRpm.status).toBe("unavailable");
  });

  test("a loaded module with absent or stock device binding leaves RPM unavailable", async () => {
    const { context, directories, realPaths } = fixture();
    directories.set("/sys/class/hwmon", ["hwmon7"]);
    realPaths.delete("/sys/devices/platform/acer-wmi/driver");
    expect((await inspectMetrics(context)).fanRpm.status).toBe("unavailable");
    realPaths.set("/sys/devices/platform/acer-wmi/driver", "/sys/bus/platform/drivers/acer-wmi");
    realPaths.set("/sys/devices/platform/acer-wmi/driver/module", "/sys/module/acer_wmi");
    expect((await inspectMetrics(context)).fanRpm.status).toBe("unavailable");
  });

  test("an unreadable CPU fan label preserves the independently readable GPU channel", async () => {
    const { context, directories } = fixture();
    directories.get(acer)!.push("fan1_label");
    const result = await sample(context);
    expect(result.fans).toEqual({ cpuRpm: null, gpuRpm: 4200 });
    expect((await inspectMetrics(context)).fanRpm.status).toBe("available");
  });

  test("an unexpected supplied fan label disables only that channel", async () => {
    const { context, directories, files } = fixture();
    directories.get(acer)!.push("fan1_label");
    files.set(`${acer}/fan1_label`, "Chassis\n");
    const result = await sample(context);
    expect(result.fans).toEqual({ cpuRpm: null, gpuRpm: 4200 });
    expect((await inspectMetrics(context)).fanRpm.status).toBe("available");
  });

  test("malformed readings remain null with issues instead of becoming zero or NaN", async () => {
    const { context, files } = fixture();
    files.set(`${coretemp}/temp1_input`, "NaN\n");
    files.set(`${acer}/fan1_input`, "-1\n");
    const result = await sample(context);
    expect(result.cpu.temperatureC).toBeNull();
    expect(result.fans).toEqual({ cpuRpm: null, gpuRpm: 4200 });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ component: "cpu.temperatureC", code: "read-failed" }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ component: "fans.cpuRpm", code: "read-failed" }),
    );
  });
});

describe("hardware NVIDIA telemetry", () => {
  test("suspended GPUs retain PCI identity and cause no telemetry subprocess, even during inspection", async () => {
    const { context, calls } = fixture();
    const result = await sample(context);
    expect(result.gpu).toEqual({ pciAddress: pci, temperatureC: null, utilizationPercent: null });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ component: "gpu.temperatureC", code: "suspended" }),
    );
    expect((await inspectMetrics(context)).gpuMetrics.status).toBe("available");
    expect(calls).toHaveLength(0);
  });

  test("active GPUs use one bounded batched query targeted by PCI address", async () => {
    const { context, files, calls } = fixture();
    files.set(`${gpuPath}/power/runtime_status`, "active\n");
    const result = await sample(context);
    expect(result.gpu).toEqual({ pciAddress: pci, temperatureC: 56, utilizationPercent: 0 });
    expect(calls).toEqual([
      {
        argv: [
          "/usr/bin/nvidia-smi",
          `--id=${pci}`,
          "--query-gpu=temperature.gpu,utilization.gpu",
          "--format=csv,noheader,nounits",
        ],
        timeoutMs: 5000,
      },
    ]);
    await inspectMetrics(context);
    expect(calls).toHaveLength(1);
  });

  test("unknown or unreadable GPU power state never launches a query", async () => {
    const { context, files, calls } = fixture();
    for (const state of ["unknown", "suspending", "resuming", ""]) {
      files.set(`${gpuPath}/power/runtime_status`, state);
      expect((await sample(context)).gpu.temperatureC).toBeNull();
    }
    files.delete(`${gpuPath}/power/runtime_status`);
    expect((await sample(context)).gpu.temperatureC).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("N/A stays distinct from a real zero and malformed fields do not discard valid siblings", async () => {
    const { context, files, command } = fixture();
    files.set(`${gpuPath}/power/runtime_status`, "active");
    command.stdout = "N/A, 0\n";
    const unavailable = await sample(context);
    expect(unavailable.gpu).toEqual({ pciAddress: pci, temperatureC: null, utilizationPercent: 0 });
    expect(unavailable.issues).toContainEqual(
      expect.objectContaining({ component: "gpu.temperatureC", code: "unsupported" }),
    );
    command.stdout = "56, 101\n";
    expect((await sample(context)).gpu).toEqual({
      pciAddress: pci,
      temperatureC: 56,
      utilizationPercent: null,
    });
  });

  test("failed or multiline query output is isolated to GPU readings", async () => {
    const { context, files, command } = fixture();
    files.set(`${gpuPath}/power/runtime_status`, "active");
    for (const output of ["56, 20\n57, 21\n", "unrecognized output\n"]) {
      command.stdout = output;
      const result = await sample(context);
      expect(result.gpu).toEqual({ pciAddress: pci, temperatureC: null, utilizationPercent: null });
      expect(result.cpu.temperatureC).toBe(45);
      expect(result.issues).toContainEqual(
        expect.objectContaining({ component: "gpu.utilizationPercent", code: "read-failed" }),
      );
    }
    command.code = 1;
    command.stderr = "GPU unavailable";
    expect((await sample(context)).fans.gpuRpm).toBe(4200);
  });

  test("NVIDIA audio functions are not mistaken for a GPU", async () => {
    const { context, files, calls } = fixture();
    files.set(`${gpuPath}/class`, "0x040300");
    const result = await sample(context);
    expect(result.gpu.pciAddress).toBeNull();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ component: "gpu.pciAddress", code: "unsupported" }),
    );
    expect(calls).toHaveLength(0);
  });

  test("missing nvidia-smi affects only GPU telemetry and preserves detected PCI identity", async () => {
    const { context, metadata, calls } = fixture();
    metadata.delete("/usr/bin/nvidia-smi");
    const result = await sample(context);
    expect(result.gpu.pciAddress).toBe(pci);
    expect(result.gpu.temperatureC).toBeNull();
    expect(result.cpu.temperatureC).toBe(45);
    expect(calls).toHaveLength(0);
  });
});

test("metrics construction performs no I/O and unsupported platforms fail before discovery", async () => {
  const { context, reads, calls } = fixture();
  const metrics = createMetrics({ ...context, platform: "darwin" });
  expect(reads).toEqual([]);
  expect(await metrics.sample()).toMatchObject({ succes: false, err: "INVALID_ENVIRONMENT" });
  expect(reads).toEqual([]);
  expect(calls).toEqual([]);
});
