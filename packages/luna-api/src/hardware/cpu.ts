import { errorMessage, isMissing, type HardwareContext } from "./context.ts";
import { cpuSampleSchema } from "./schema.ts";
import type { CpuSample, MetricsSample, ReadIssue } from "./types.ts";

/** USER_HZ counters stay as decimal strings until the final utilization ratio. */
export async function readCpuUsage(
  context: HardwareContext,
  previous: CpuSample | null | undefined,
): Promise<{
  cpu: Pick<MetricsSample["cpu"], "sample" | "utilizationPercent">;
  issues: ReadIssue[];
}> {
  let sample: CpuSample;
  try {
    const [stat, bootId] = await Promise.all([
      context.readText("/proc/stat"),
      context.readText("/proc/sys/kernel/random/boot_id"),
    ]);
    const counters = stat
      .split("\n")
      .find((line) => /^cpu\s/u.test(line))
      ?.trim()
      .split(/\s+/u)
      .slice(1, 9);
    if (
      !counters ||
      counters.length !== 8 ||
      counters.some((value) => !/^[0-9]{1,30}$/u.test(value))
    )
      throw new Error("The aggregate /proc/stat CPU counters are malformed");

    // guest and guest_nice are already included in user/nice and must not be counted twice.
    const ticks = counters.map(BigInt);
    sample = cpuSampleSchema.parse({
      bootId: bootId.trim(),
      totalTicks: ticks.reduce((total, value) => total + value, 0n).toString(),
      idleTicks: (ticks[3]! + ticks[4]!).toString(),
    });
  } catch (error) {
    const code = isMissing(error) ? "unavailable" : "read-failed";
    const message = `CPU accounting is unavailable: ${errorMessage(error)}`;
    return {
      cpu: { sample: null, utilizationPercent: null },
      issues: [
        { component: "cpu.sample", code, message },
        { component: "cpu.utilizationPercent", code, message },
      ],
    };
  }

  let reason: string | null = null;
  let utilizationPercent: number | null = null;
  if (!previous) reason = "A previous CPU sample is needed to calculate utilization";
  else if (previous.bootId !== sample.bootId) reason = "CPU baseline belongs to a different boot";
  else {
    const total = BigInt(sample.totalTicks) - BigInt(previous.totalTicks);
    const idle = BigInt(sample.idleTicks) - BigInt(previous.idleTicks);
    // Linux documents that iowait can decrease. A replacement token starts a new interval.
    if (total <= 0n || idle < 0n || idle > total)
      reason = "CPU counters regressed or do not describe a positive sampling interval";
    else utilizationPercent = (100 * Number(total - idle)) / Number(total);
  }
  return {
    cpu: { sample, utilizationPercent },
    issues: reason
      ? [{ component: "cpu.utilizationPercent", code: "unknown", message: reason }]
      : [],
  };
}
