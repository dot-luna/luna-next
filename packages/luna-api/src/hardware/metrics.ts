import { respond, type ApiResponse } from "../lib/response.ts";
import { requireLinux, type HardwareContext } from "./context.ts";
import { readCpuUsage } from "./cpu.ts";
import { discoverNvidia, readGpu } from "./gpu.ts";
import { metricsInputSchema, validate } from "./schema.ts";
import { discoverSensors, readSensor } from "./sensors.ts";
import type {
  HardwareCapabilities,
  HardwareCapability,
  MetricsInput,
  MetricsSample,
} from "./types.ts";

export function createMetrics(context: HardwareContext) {
  return {
    /**
     * Read sensors once. Pass the previous caller-owned CPU token for utilization;
     * the first sample returns null utilization without sleeping or retaining state.
     * Missing sources produce field issues, and suspended NVIDIA GPUs are not queried.
     */
    sample(input?: MetricsInput): Promise<ApiResponse<MetricsSample>> {
      return respond(async () => {
        requireLinux(context);
        const { previousCpu } = validate(metricsInputSchema, input === undefined ? {} : input);
        const [usage, gpu, sensors] = await Promise.all([
          readCpuUsage(context, previousCpu),
          readGpu(context),
          discoverSensors(context),
        ]);
        const [temperature, cpuFan, gpuFan] = await Promise.all([
          readSensor(context, sensors.temperature, "cpu.temperatureC", 1000),
          readSensor(context, sensors.cpuFan, "fans.cpuRpm"),
          readSensor(context, sensors.gpuFan, "fans.gpuRpm"),
        ]);
        return {
          observedAt: new Date(context.now()).toISOString(),
          cpu: { ...usage.cpu, temperatureC: temperature.value },
          gpu: gpu.gpu,
          fans: { cpuRpm: cpuFan.value, gpuRpm: gpuFan.value },
          issues: [
            ...usage.issues,
            ...temperature.issues,
            ...gpu.issues,
            ...cpuFan.issues,
            ...gpuFan.issues,
          ],
        };
      });
    },
  };
}

/** Read-only capability probes never launch nvidia-smi, including on a suspended GPU. */
export async function inspectMetrics(
  context: HardwareContext,
): Promise<
  Pick<
    HardwareCapabilities["features"],
    "fanRpm" | "cpuTemperature" | "cpuUtilization" | "gpuMetrics"
  >
> {
  const [sensors, usage, gpu] = await Promise.all([
    discoverSensors(context),
    readCpuUsage(context, null),
    discoverNvidia(context),
  ]);
  const fanCapabilities = [sensors.cpuFan.capability, sensors.gpuFan.capability];
  const fanRpm: HardwareCapability =
    fanCapabilities.find((capability) => capability.status === "available") ??
    fanCapabilities.find((capability) => capability.status === "unavailable") ??
    fanCapabilities[0]!;
  return {
    fanRpm,
    cpuTemperature: sensors.temperature.capability,
    cpuUtilization: usage.cpu.sample
      ? { status: "available", reason: null }
      : { status: "unavailable", reason: usage.issues[0]!.message },
    gpuMetrics: gpu.capability,
  };
}
