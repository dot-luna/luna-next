/** Standard power-profiles-daemon identifiers; firmware-only modes are not aliases. */
export type PowerProfile = "power-saver" | "balanced" | "performance";

export interface PowerState {
  active: PowerProfile;
  available: PowerProfile[];
  drivers: { cpu: string | null; platform: string | null };
  performanceDegraded: string | null;
  holds: Array<{ profile: PowerProfile; applicationId: string; reason: string }>;
}

/** Permission to invoke the session's Polkit agent. Omitted/false never invokes pkexec. */
export interface HardwareWriteOptions {
  allowAuthorization?: boolean;
}

/** Zero requests automatic control; 1–100 are driver targets, not measured duty. */
export interface FanTargets {
  cpu: number;
  gpu: number;
}

export interface FanState {
  /** Cached last accepted driver request; even matching readback cannot prove fan motion. */
  driverReportedTargets: FanTargets;
}

export interface ChargeLimitState {
  enabled: boolean | null;
  /** Fixed supported threshold; this does not mean the limiter is enabled. */
  limitPercent: 80;
}

export interface KeyboardState {
  enabled: boolean | null;
  timeoutSeconds: 30;
}

export interface ReadIssue {
  /** Field path, for example cpu.temperatureC or chargeLimit.enabled. */
  component: string;
  code: "unavailable" | "unsupported" | "suspended" | "unknown" | "read-failed";
  message: string;
}

export type BatteryStatus =
  | "charging"
  | "discharging"
  | "empty"
  | "fully-charged"
  | "pending-charge"
  | "pending-discharge";

export interface BatteryState {
  present: boolean | null;
  percentage: number | null;
  healthPercent: number | null;
  cycles: number | null;
  state: BatteryStatus | null;
  onBattery: boolean | null;
  chargeLimit: ChargeLimitState;
  issues: ReadIssue[];
}

/** Caller-owned /proc/stat baseline. Decimal strings preserve counter precision in JSON. */
export interface CpuSample {
  bootId: string;
  totalTicks: string;
  idleTicks: string;
}

export interface MetricsInput {
  previousCpu?: CpuSample | null;
}

export interface MetricsSample {
  /** Collection completion time in UTC; sensors are not sampled atomically. */
  observedAt: string;
  cpu: {
    temperatureC: number | null;
    utilizationPercent: number | null;
    sample: CpuSample | null;
  };
  gpu: {
    pciAddress: string | null;
    temperatureC: number | null;
    utilizationPercent: number | null;
  };
  fans: { cpuRpm: number | null; gpuRpm: number | null };
  issues: ReadIssue[];
}

export interface HardwareCapability {
  /** Missing prerequisites are unavailable; unsupported requires evidence from a present device. */
  status: "available" | "unavailable" | "unsupported";
  reason: string | null;
}

export type HardwareFeature =
  | "powerProfiles"
  | "fanControl"
  | "fanRpm"
  | "chargeLimit"
  | "batteryInfo"
  | "keyboardTimeout"
  | "cpuTemperature"
  | "cpuUtilization"
  | "gpuMetrics";

export interface HardwareCapabilities {
  machine: { manufacturer: string | null; model: string | null };
  /** Availability recognizes interfaces; it neither grants authorization nor verifies hardware effects. */
  features: Record<HardwareFeature, HardwareCapability>;
  privilegedWrites: { helperAvailable: boolean; polkitAvailable: boolean };
}
