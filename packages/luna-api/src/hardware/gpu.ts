import { errorMessage, isMissing, type HardwareContext } from "./context.ts";
import type { HardwareCapability, MetricsSample, ReadIssue } from "./types.ts";

const nvidiaSmi = "/usr/bin/nvidia-smi";

interface NvidiaDevice {
  pciAddress: string | null;
  runtimeStatus: string | null;
  capability: HardwareCapability;
}

/** PCI metadata does not need NVML and avoids waking the discrete GPU during discovery. */
export async function discoverNvidia(context: HardwareContext): Promise<NvidiaDevice> {
  const result: NvidiaDevice = {
    pciAddress: null,
    runtimeStatus: null,
    capability: { status: "unavailable", reason: "No NVIDIA display device is exposed" },
  };
  try {
    const names = (await context.listNames("/sys/bus/pci/devices")).filter((name) =>
      /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/iu.test(name),
    );
    const found = (
      await Promise.all(
        names.map(async (name) => {
          const path = `/sys/bus/pci/devices/${name}`;
          const [vendor, deviceClass] = await Promise.all([
            context.readText(`${path}/vendor`),
            context.readText(`${path}/class`),
          ]);
          return vendor.trim().toLowerCase() === "0x10de" &&
            /^0x03[0-9a-f]{4}$/iu.test(deviceClass.trim())
            ? name
            : null;
        }),
      )
    ).filter((name): name is string => name !== null);
    if (found.length === 0) {
      result.capability = { status: "unsupported", reason: "No NVIDIA display device was found" };
      return result;
    }
    if (found.length > 1) {
      result.capability.reason = "Multiple NVIDIA GPUs cannot be represented as one GPU";
      return result;
    }
    result.pciAddress = found[0]!;
    const path = `/sys/bus/pci/devices/${result.pciAddress}`;
    const [driver, executable, runtimeStatus] = await Promise.all([
      context.realPath(`${path}/driver`),
      context.metadata(nvidiaSmi),
      context.readText(`${path}/power/runtime_status`),
    ]);
    result.runtimeStatus = runtimeStatus.trim();
    if (
      driver !== "/sys/bus/pci/drivers/nvidia" ||
      executable.kind !== "file" ||
      (executable.mode & 0o111) === 0
    ) {
      result.capability.reason = "The NVIDIA driver and executable nvidia-smi are required";
      return result;
    }
    if (result.runtimeStatus !== "active" && result.runtimeStatus !== "suspended") {
      result.capability.reason = `GPU runtime power state is ${result.runtimeStatus || "unknown"}; telemetry was skipped`;
      return result;
    }
    result.capability = { status: "available", reason: null };
  } catch (error) {
    result.capability.reason = `Cannot inspect NVIDIA telemetry support: ${errorMessage(error)}`;
  }
  return result;
}

function numericMetric(
  raw: string,
  component: string,
  maximum: number,
): { value: number | null; issues: ReadIssue[] } {
  if (raw === "N/A" || raw === "[N/A]")
    return {
      value: null,
      issues: [
        { component, code: "unsupported", message: "NVIDIA reports this metric as unavailable" },
      ],
    };
  const value = Number(raw);
  if (!/^[0-9]+(?:\.[0-9]+)?$/u.test(raw) || !Number.isFinite(value) || value > maximum)
    return {
      value: null,
      issues: [
        { component, code: "read-failed", message: `NVIDIA returned an invalid metric: ${raw}` },
      ],
    };
  return { value, issues: [] };
}

export async function readGpu(
  context: HardwareContext,
): Promise<{ gpu: MetricsSample["gpu"]; issues: ReadIssue[] }> {
  const device = await discoverNvidia(context);
  const gpu: MetricsSample["gpu"] = {
    pciAddress: device.pciAddress,
    temperatureC: null,
    utilizationPercent: null,
  };
  const failure = (code: ReadIssue["code"], message: string) => ({
    gpu,
    issues: [
      ...(gpu.pciAddress === null ? ["gpu.pciAddress"] : []),
      "gpu.temperatureC",
      "gpu.utilizationPercent",
    ].map((component) => ({ component, code, message })),
  });
  if (device.capability.status !== "available")
    return failure(device.capability.status, device.capability.reason!);
  if (device.runtimeStatus === "suspended")
    return failure(
      "suspended",
      "NVIDIA GPU is suspended; telemetry was skipped to avoid waking it",
    );

  try {
    // Power can change after discovery; this preflight avoids needless wakes, not all races.
    const result = await context.run({
      argv: [
        nvidiaSmi,
        `--id=${device.pciAddress}`,
        "--query-gpu=temperature.gpu,utilization.gpu",
        "--format=csv,noheader,nounits",
      ],
      timeoutMs: 5000,
    });
    if (result.code !== 0)
      throw new Error(`nvidia-smi failed (${result.code}): ${result.stderr.trim()}`);
    const rows = result.stdout.trim().split(/\r?\n/u);
    const fields = rows[0]?.split(",").map((field) => field.trim());
    if (rows.length !== 1 || !fields || fields.length !== 2)
      throw new Error("NVIDIA returned malformed telemetry CSV");
    const temperature = numericMetric(fields[0]!, "gpu.temperatureC", Number.MAX_SAFE_INTEGER);
    const utilization = numericMetric(fields[1]!, "gpu.utilizationPercent", 100);
    gpu.temperatureC = temperature.value;
    gpu.utilizationPercent = utilization.value;
    return { gpu, issues: [...temperature.issues, ...utilization.issues] };
  } catch (error) {
    return failure(isMissing(error) ? "unavailable" : "read-failed", errorMessage(error));
  }
}
