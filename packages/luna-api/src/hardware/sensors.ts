import { errorMessage, isMissing, type HardwareContext } from "./context.ts";
import type { HardwareCapability, ReadIssue } from "./types.ts";

interface Sensor {
  path: string | null;
  capability: HardwareCapability;
}

export interface Sensors {
  temperature: Sensor;
  cpuFan: Sensor;
  gpuFan: Sensor;
}

function missing(reason: string, status: "unavailable" | "unsupported" = "unavailable"): Sensor {
  return { path: null, capability: { status, reason } };
}

function available(path: string): Sensor {
  return { path, capability: { status: "available", reason: null } };
}

async function fanSensor(
  context: HardwareContext,
  directory: string,
  entries: string[],
  channel: 1 | 2,
): Promise<Sensor> {
  const kind = channel === 1 ? "CPU" : "GPU";
  if (!entries.includes(`fan${channel}_input`))
    return missing(`${kind} fan RPM is not exposed by Linuwu`, "unsupported");
  if (entries.includes(`fan${channel}_label`)) {
    try {
      const label = (await context.readText(`${directory}/fan${channel}_label`)).trim();
      if (!new RegExp(`^${kind}(?: fan)?$`, "iu").test(label))
        return missing(`Unrecognized ${kind} fan label: ${label}`);
    } catch (error) {
      return missing(`Cannot identify ${kind} fan: ${errorMessage(error)}`);
    }
  }
  return available(`${directory}/fan${channel}_input`);
}

/** Resolve hwmon by identity on each call; enumeration numbers are never stable identifiers. */
export async function discoverSensors(context: HardwareContext): Promise<Sensors> {
  let absentFan = missing("The Linuwu driver is unavailable");
  try {
    const [module, driver, owner] = await Promise.all([
      context.metadata("/sys/module/linuwu_sense"),
      context.realPath("/sys/devices/platform/acer-wmi/driver"),
      context.realPath("/sys/devices/platform/acer-wmi/driver/module"),
    ]);
    // A loaded module can have failed probing or lost the device to the stock driver.
    if (
      module.kind === "directory" &&
      driver === "/sys/bus/platform/drivers/acer-wmi" &&
      owner === "/sys/module/linuwu_sense"
    )
      absentFan = missing("Linuwu does not expose fan RPM sensors", "unsupported");
  } catch (error) {
    if (!isMissing(error)) absentFan = missing(`Cannot inspect Linuwu: ${errorMessage(error)}`);
  }
  const result: Sensors = {
    temperature: missing("No coretemp CPU package temperature sensor is exposed"),
    cpuFan: absentFan,
    gpuFan: absentFan,
  };
  let names: string[];
  try {
    names = await context.listNames("/sys/class/hwmon");
  } catch (error) {
    const sensor = missing(`Cannot enumerate hardware sensors: ${errorMessage(error)}`);
    return { temperature: sensor, cpuFan: sensor, gpuFan: sensor };
  }

  const candidates = await Promise.all(
    names
      .filter((name) => /^hwmon[0-9]+$/u.test(name))
      .map(async (entry) => {
        const directory = `/sys/class/hwmon/${entry}`;
        let name: string;
        try {
          name = (await context.readText(`${directory}/name`)).trim();
        } catch {
          return null;
        }
        if (name !== "coretemp" && name !== "acer") return null;
        try {
          const entries = await context.listNames(directory);
          if (name === "coretemp") {
            const packages = (
              await Promise.all(
                entries
                  .filter((file) => /^temp[0-9]+_label$/u.test(file))
                  .map(async (file) => {
                    const label = (await context.readText(`${directory}/${file}`)).trim();
                    const input = file.replace(/_label$/u, "_input");
                    return /^Package id [0-9]+$/u.test(label) && entries.includes(input)
                      ? `${directory}/${input}`
                      : null;
                  }),
              )
            ).filter((path): path is string => path !== null);
            return {
              name,
              temperature:
                packages.length === 1
                  ? available(packages[0]!)
                  : missing("Expected exactly one coretemp CPU package sensor", "unsupported"),
            };
          }

          const [device, module] = await Promise.all([
            context.realPath(`${directory}/device`),
            context.realPath(`${directory}/device/driver/module`),
          ]);
          if (device !== "/sys/devices/platform/acer-wmi" || module !== "/sys/module/linuwu_sense")
            return null;
          // Linuwu has no labels at the pinned revision: its hwmon channel map is CPU=1/GPU=2.
          // https://github.com/PXDiv/Div-Linuwu-Sense/blob/d8ea437d847268dd9fe2a49ae28d0723dd720968/src/linuwu_sense.c#L4679
          const [cpuFan, gpuFan] = await Promise.all([
            fanSensor(context, directory, entries, 1),
            fanSensor(context, directory, entries, 2),
          ]);
          return { name, cpuFan, gpuFan };
        } catch (error) {
          return { name, error: `Cannot inspect ${name} sensors: ${errorMessage(error)}` };
        }
      }),
  );

  let cpuDevices = 0;
  let acerDevices = 0;
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.name === "coretemp") {
      cpuDevices++;
      result.temperature = candidate.error ? missing(candidate.error) : candidate.temperature!;
    } else {
      acerDevices++;
      result.cpuFan = candidate.error ? missing(candidate.error) : candidate.cpuFan!;
      result.gpuFan = candidate.error ? missing(candidate.error) : candidate.gpuFan!;
    }
  }
  if (cpuDevices > 1)
    result.temperature = missing(
      "Multiple CPU package devices cannot be represented as one temperature",
    );
  if (acerDevices > 1)
    result.cpuFan = result.gpuFan = missing(
      "Multiple Acer sensor devices cannot be identified unambiguously",
    );
  return result;
}

export async function readSensor(
  context: HardwareContext,
  sensor: Sensor,
  component: string,
  divisor = 1,
): Promise<{ value: number | null; issues: ReadIssue[] }> {
  if (!sensor.path)
    return {
      value: null,
      issues: [
        {
          component,
          code: sensor.capability.status === "unsupported" ? "unsupported" : "unavailable",
          message: sensor.capability.reason!,
        },
      ],
    };
  try {
    const raw = (await context.readText(sensor.path)).trim();
    const value = Number(raw);
    if (!/^[0-9]+$/u.test(raw) || !Number.isSafeInteger(value))
      throw new Error("Sensor did not return a nonnegative integer");
    return { value: value / divisor, issues: [] };
  } catch (error) {
    return {
      value: null,
      issues: [
        {
          component,
          code: isMissing(error) ? "unavailable" : "read-failed",
          message: errorMessage(error),
        },
      ],
    };
  }
}
