# Luna Hardware API

Status: draft for user review. Date: 2026-11-08.

This specification covers the shared API only. It does not authorize implementation,
installation, hardware changes, or Git publication. CLI commands, settings screens,
and application packaging are outside this document's scope.

## Scope and decisions

Build `Luna.hardware` in `packages/luna-api` for the owner's Acer Nitro ANV15-51.
Translate the useful DAMX behavior into Luna-owned TypeScript operations, using
Linux services and the Acer kernel driver directly.

Accepted scope:

- Extend the existing Bun-based `@luna/api`; Bun is the confirmed runtime.
- Standard power profiles that other compatible Linux applications can observe.
- CPU/GPU fan control: automatic, manual percentages, and maximum speed.
- Fixed 80% battery charge limit and battery charge, health, and cycle readings.
- Keyboard backlight timeout toggle, where supported.
- CPU/GPU temperature and utilization, plus real fan RPM where available.
- Capability discovery so missing hardware support does not become a fake control.

USB charging and battery calibration are explicitly excluded. RGB lighting,
LCD overrides, boot effects, custom fan curves, arbitrary charge thresholds,
custom timeout durations, multi-vendor support, and automatic AC/battery presets
are deferred. Do not force driver quirks to expose unsupported features.

Proposed engineering defaults, pending review:

- Use one-shot `busctl` calls for standard D-Bus operations and a small privileged
  helper for the three Acer-specific write operations.
- Read live state on demand. Do not add saved presets, polling services, event
  subscriptions, configuration watchers, or automatic restoration in v1.

These defaults describe a coherent draft; they are not already implemented or
approved implementation choices.

## Current baseline

Read-only inspection found the following on the target machine:

| Component             | Observed state                                                           |
| --------------------- | ------------------------------------------------------------------------ |
| Laptop                | Acer Nitro ANV15-51, BIOS V1.31                                          |
| CPU / GPU             | Intel Core i7-13620H / NVIDIA GeForce RTX 4060 Laptop GPU                |
| Kernel                | Arch Linux `7.2.14-arch1-1`                                              |
| Power service         | `power-profiles-daemon` 0.30, running; three standard profiles available |
| Current power backend | Intel CPU driver; no confirmed Acer platform-profile integration         |
| Battery service       | UPower running; laptop battery exposed                                   |
| Acer driver           | Stock `acer_wmi`; `linuwu_sense` absent                                  |
| Sensors               | CPU temperature exposed; Acer fan RPM not currently exposed              |

The inspected Linuwu source lists ANV15-51 with the default Nitro quirk. That
establishes an expected driver path, not proof that controls work with this BIOS
and kernel. Driver installation and all hardware write acceptance remain future
work. Existing Luna has no hardware namespace in its
[API entry point](../packages/luna-api/src/index.ts).

## Requirements

| ID    | Required behavior                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| HW-01 | Discover each capability independently and distinguish missing prerequisites from unsupported hardware.                            |
| HW-02 | Read and change standard power profiles through the existing power-profiles service; preserve interoperability with other clients. |
| HW-03 | Set a complete CPU/GPU fan target pair and label its readback as driver-reported requests, separate from physical RPM.             |
| HW-04 | Read and toggle the driver's fixed 80% battery charge limiter.                                                                     |
| HW-05 | Read laptop battery state through UPower, preserving unknown readings as null.                                                     |
| HW-06 | Read and toggle the driver's fixed 30-second keyboard backlight timeout.                                                           |
| HW-07 | Return bounded, on-demand telemetry without invented readings or unnecessary repeated subprocesses.                                |
| HW-08 | Validate writes, use existing system authorization, and report rejected or potentially partial changes honestly.                   |
| HW-09 | Keep live hardware state authoritative; do not save, replay, or secretly restore settings.                                         |

## Standard interfaces and tools

| Responsibility            | Interface / tool                                     | Luna's role                                                                 |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| Power profiles            | System D-Bus, `org.freedesktop.UPower.PowerProfiles` | Read properties and set `ActiveProfile` through the existing daemon.        |
| Battery information       | System D-Bus, `org.freedesktop.UPower`               | Enumerate battery devices and read their properties.                        |
| D-Bus transport           | systemd `busctl --system --json=short`               | Spawn fixed argument arrays; parse machine-readable results.                |
| Acer controls             | Div-Linuwu-Sense sysfs attributes                    | Read supported endpoints; write through the narrow privileged helper.       |
| CPU temperature / fan RPM | Kernel hwmon                                         | Discover by device identity and sensor labels, never by fixed `hwmonN`.     |
| CPU utilization           | `/proc/stat`                                         | Calculate differences between explicit caller-provided samples.             |
| NVIDIA telemetry          | `nvidia-smi` selective CSV query                     | Query requested metrics together, targeting the discovered PCI device.      |
| Privileged writes         | Polkit and `pkexec`                                  | Authorize a fixed installed helper; keep normal API consumers unprivileged. |

### Power service ownership

Use system-bus destination and interface `org.freedesktop.UPower.PowerProfiles`,
object `/org/freedesktop/UPower/PowerProfiles`, and
`org.freedesktop.DBus.Properties.GetAll` / `Set`.

`power.set` changes only `ActiveProfile`. The daemon owns driver coordination and
standard `PropertiesChanged` notifications. Other compatible clients can observe
the same state; this does not mean every application changes its behavior.
Changes made by another client appear on Luna's next read.

Do not register a replacement D-Bus service, emit synthetic profile signals,
write `platform_profile` directly, or adjust CPU governors alongside the daemon.
Do not implement profile holds in v1; expose existing holds for observation and
leave their policy to the daemon. `powerprofilesctl` is a diagnostic tool, not
the API's human-output parser. [Power-profile interface][ppd]

After the Acer driver is provisioned, verify whether the daemon actually selects
its platform backend. CPU-only profiles remain useful, but must not be advertised
as confirmed Nitro firmware modes. Do not invent a fourth standard profile named
Turbo or assume Acer's firmware labels map one-to-one to the standard three.

### Acer driver ownership

Resolve the target driver's Nitro device directory, including the known
`/sys/module/linuwu_sense/drivers/platform:acer-wmi/acer-wmi/nitro_sense`
layout. Validate driver/device identity and real paths. Public inputs must never
select arbitrary sysfs paths. The writable allowlist is exactly `fan_speed`,
`battery_limiter`, and `backlight_timeout`.

The source exposes integer fan pairs, boolean limiter/timeout controls, and
separate optional hwmon sensors. Fan target readback is cached requested state;
it is not a measurement. A fan operation can partially change firmware before
failing. Some platform-profile transitions reset fans even if the profile change
subsequently fails. Persistence across reboot, driver reload, suspend, and firmware
transitions is not guaranteed. [Driver source][driver]

The inspected driver defines the limiter as 80% and the enabled timeout as
30 seconds. Disabling the timeout disables that timer; it does not turn the
keyboard lighting off. [Driver documentation][driver-readme]

Do not depend on the DAMX GUI, Python daemon, Unix socket, or maintenance commands.
DAMX is a behavior/source reference. Retain applicable upstream license notices
for any translated or copied code. [DAMX daemon][damx], [license][damx-license]

## Public API contract

All methods are asynchronous and return `Promise<ApiResponse<T>>`, using the
existing [response contract](../packages/luna-api/src/lib/response.ts):

```ts
type ApiResponse<T> =
  | { succes: true; data: T }
  | { succes: false; err: ApiErrorCode; errMessage: string };
```

The `succes` spelling is intentional. Results contain JSON-compatible values;
missing readings are `null`, not omitted, zero-filled, `NaN`, or `undefined`.
No method prints, launches an application, installs dependencies, or changes system
services. An explicitly permitted authentication dialog belongs to Polkit.

| Method                                                  | Input                                 | Success data             |
| ------------------------------------------------------- | ------------------------------------- | ------------------------ |
| `Luna.hardware.inspect()`                               | None                                  | `HardwareCapabilities`   |
| `Luna.hardware.power.get()`                             | None                                  | `PowerState`             |
| `Luna.hardware.power.set(input)`                        | `{ profile: PowerProfile }`           | Fresh `PowerState`       |
| `Luna.hardware.fans.get()`                              | None                                  | `FanState`               |
| `Luna.hardware.fans.set(input, options?)`               | `{ cpu: number, gpu: number }`        | Fresh `FanState`         |
| `Luna.hardware.battery.get()`                           | None                                  | `BatteryState`           |
| `Luna.hardware.battery.setChargeLimit(input, options?)` | `{ enabled: boolean }`                | Fresh `ChargeLimitState` |
| `Luna.hardware.keyboard.get()`                          | None                                  | `KeyboardState`          |
| `Luna.hardware.keyboard.setTimeout(input, options?)`    | `{ enabled: boolean }`                | Fresh `KeyboardState`    |
| `Luna.hardware.metrics.sample(input?)`                  | `{ previousCpu?: CpuSample \| null }` | `MetricsSample`          |

All input objects reject unknown keys. Required fields cannot be omitted or null.
Do not coerce strings, round numbers, or clamp out-of-range values. Acer setter
options accept only `{ allowAuthorization?: boolean }`, default `false`; null is invalid.
No public path, executable, environment, or command override is accepted.

### Capability discovery — HW-01

`HardwareCapabilities` contains:

- `machine: { manufacturer: string | null, model: string | null }`; no serials.
- `features`: an object with keys `powerProfiles`, `fanControl`, `fanRpm`,
  `chargeLimit`, `batteryInfo`, `keyboardTimeout`, `cpuTemperature`,
  `cpuUtilization`, and `gpuMetrics`.
- Every feature value is `{ status, reason }`, with `status` equal to
  `available`, `unavailable`, or `unsupported`, and `reason: string | null`.
- `privilegedWrites: { helperAvailable: boolean, polkitAvailable: boolean }`.

`available` means a recognized runtime interface exists; it does not grant write
authorization or establish hardware acceptance. `unavailable` means prerequisites
are absent or probing failed. `unsupported` requires positive evidence, such as
an absent optional attribute on a present, recognized driver device. A missing
Linuwu module alone means unavailable, not unsupported.

Always report a reason for unavailable/unsupported capabilities. Partial discovery
succeeds with individual statuses. Unsupported platforms fail with
`INVALID_ENVIRONMENT`. Discovery is read-only and must not query a suspended GPU
just to test support. Fan control and RPM availability are independent.

### Power profiles — HW-02

`PowerProfile` is `power-saver | balanced | performance`.

`PowerState` contains `active: PowerProfile`, `available: PowerProfile[]`,
`drivers: { cpu: string | null, platform: string | null }`,
`performanceDegraded: string | null`, and
`holds: Array<{ profile: PowerProfile, applicationId: string, reason: string }>`.
Driver names describe the active profile; an upstream `placeholder` platform
driver is normalized to null. Empty degradation text means null.

Read the daemon's advertised profiles on each operation. A valid standard profile
that is not currently offered fails with `INVALID_ARGUMENT` before mutation.
Unrecognized upstream profiles or malformed required properties fail with
`IO_ERROR`; do not silently substitute balanced. After setting, reread the active
profile. A mismatch returns `CONFLICT` without retrying or overriding another
client. Success confirms the observed daemon selection, not a clock speed or
thermal result.

Power changes may affect fan control through firmware. Callers must discard
previous fan observations after either a successful or failed profile mutation.
Luna must not automatically reapply old manual fan targets. There is no combined
power-and-fans transaction.

### Fan targets — HW-03

Both `cpu` and `gpu` are required integers from 0 through 100. Zero requests
automatic control; 1–100 request manual percentages. The pair `100,100` selects
the driver's dedicated maximum mode. Mixed automatic/manual pairs are permitted.
These are driver request values, not calibrated physical duty percentages.

`FanState` is `{ driverReportedTargets: { cpu: number, gpu: number } }`.
`fans.get` reads the driver's cached last accepted pair, which can initially be
`0,0` without a firmware query. Actual RPM belongs to `metrics.sample`.

Send one complete pair in one sysfs write. Do not read and preserve an omitted
fan, which would introduce a read/modify/write race. Return success only after
the write completes and cached readback matches. A mismatch is `CONFLICT`.
Neither matching readback nor a successful write proves actual fan motion.

### Battery information and limiter — HW-04 / HW-05

`BatteryState` contains `present: boolean | null`, `percentage: number | null`,
`healthPercent: number | null`, `cycles: number | null`,
`state: BatteryStatus | null`, `onBattery: boolean | null`,
`chargeLimit: ChargeLimitState`, and `issues: ReadIssue[]`.

`BatteryStatus` is `charging | discharging | empty | fully-charged |
pending-charge | pending-discharge`. Unknown UPower state becomes null.
Percentage is 0–100; health uses UPower's `Capacity` reading and is not a diagnosis.
Cycles are nonnegative integers; UPower's unknown cycle sentinel becomes null.
Apply property-specific unknown-value rules; do not treat every zero as missing.

Use UPower's `EnumerateDevices`, selecting a present device whose `Type` is battery
and `PowerSupply` is true, not a peripheral battery. This laptop has one battery;
multiple matching system batteries return an issue and null battery-specific
fields rather than inventing aggregation; `present` remains true. `OnBattery` comes from the root UPower
object. A successful enumeration with no present system battery means
`present: false`, including when only peripherals or absent batteries remain.
An unavailable service means `present: null`. [UPower device interface][upower]

`ChargeLimitState` is `{ enabled: boolean | null, limitPercent: 80 }`.
The enabled state comes from Linuwu, independent of UPower. Battery reads succeed
with partial fields and issues if either source is unavailable. The fixed 80 is
the control's supported threshold, not a claim that it is enabled. Setters require
the control to exist and verify its boolean readback; they do not configure
UPower charging thresholds as a second authority. Disabling the limiter restores
firmware's normal charging policy; it does not force charging or discharging.
Only exact driver values `0`/`1` are boolean states. Invalid reads yield null plus
an issue; after a write, an invalid verification read returns `IO_ERROR` and
explicitly uncertain effects.

### Keyboard timeout — HW-06

`KeyboardState` is `{ enabled: boolean | null, timeoutSeconds: 30 }`.
Read only exact `0`/`1` as false/true. The driver's `-1` unknown response produces
null; other malformed responses fail with `IO_ERROR`. A setter succeeds only
after exact matching boolean readback. Unknown post-write state is an `IO_ERROR`
with a message that the requested change may already have taken effect.

### Telemetry — HW-07

`MetricsSample` contains:

- `observedAt`: UTC ISO-8601 timestamp when collection finishes. Readings are not
  an atomic snapshot.
- `cpu: { temperatureC: number | null, utilizationPercent: number | null,
  sample: CpuSample | null }`.
- `gpu: { pciAddress: string | null, temperatureC: number | null,
  utilizationPercent: number | null }` for this machine's NVIDIA GPU.
- `fans: { cpuRpm: number | null, gpuRpm: number | null }`.
- `issues: ReadIssue[]`.

`ReadIssue` is `{ component: string, code, message: string }`, where `code` is
`unavailable | unsupported | suspended | unknown | read-failed`. Components use
field paths such as `cpu.temperatureC` or `chargeLimit.enabled`. Every null reading
caused by a failed/missing source has an issue; a first CPU sample has an `unknown`
issue explaining the missing baseline. Valid zero readings remain zero.

Discover the CPU package temperature using the `coretemp` device and its labels.
Read Acer fan tachometers only after verifying the Linuwu driver/device identity.
The inspected driver exposes no fan labels: its defined `fan1_input` and
`fan2_input` channels identify CPU and GPU respectively. Validate labels if a
future driver supplies them; never infer identity from the `hwmonN` number.
Do not estimate RPM from requested percentages or mistake NVIDIA's fan percentage
for laptop fan RPM. Missing readings must not fail unrelated measurements.

`CpuSample` is `{ bootId: string, totalTicks: string, idleTicks: string }`.
Ticks are canonical unsigned decimal strings so JSON does not lose integer
precision. Read the aggregate CPU counters; total includes user, nice, system,
idle, iowait, irq, softirq, and steal, excluding guest counters already counted
elsewhere. Idle includes idle plus iowait. Calculate utilization as
`100 * (deltaTotal - deltaIdle) / deltaTotal`. These are Linux `USER_HZ` counters;
iowait can regress. [Kernel accounting documentation][proc-stat]

Omitted or null `previousCpu` produces a fresh token and null utilization without
waiting. Invalid token shapes fail with `INVALID_ARGUMENT`. A different boot ID,
counter regression, nonpositive total delta, or idle delta outside the total
delta produces null utilization plus an issue and a replacement token. Keep no
hidden sampling cache and do not sleep to obtain a second reading.

Inspect the NVIDIA PCI device's runtime power state first. If it is suspended,
skip `nvidia-smi`, preserve PCI identity, and return null GPU readings with a
`suspended` issue. If the power state cannot be determined, skip the query and
report an issue. For an active device, fetch temperature and utilization together
in one bounded `--query-gpu` CSV invocation with `noheader,nounits`, selected by
PCI address. Map `N/A` to null. A power-state race is possible; verify actual
behavior on this laptop before claiming queries never wake the GPU.

The CLI output is not guaranteed stable across NVIDIA releases. Keep parsing
focused and tested; NVML is a future option if this becomes a real limitation.
Do not add an FFI framework for v1. [NVIDIA telemetry documentation][nvidia]

## Authorization, failures, and state — HW-08 / HW-09

### Privileged boundary

Standard power changes use the daemon's existing Polkit policy noninteractively.
PPD 0.30 does not offer interactive escalation for this operation. Denied access
returns `COMMAND_FAILED` with the authorization reason. [PPD authorization][ppd-auth]

Use `busctl --system --json=short --no-pager --allow-interactive-authorization=no`
and its `call` operation for both property reads and writes. Set through
`org.freedesktop.DBus.Properties.Set` with signature `ssv`; do not rely on the
`set-property` shortcut to honor the interaction flag. [busctl documentation][busctl]

For Acer writes, propose a root-owned executable at
`/usr/lib/luna/luna-hardware-helper`, compiled from the API's own helper source.
It accepts only the three allowlisted operations and validated values. Never
execute mutable checkout code as root or accept caller-supplied paths, shell
fragments, environment overrides, or executable names. Resolve trusted tools by
fixed installed paths at the privileged boundary.

`allowAuthorization: false` does not invoke `pkexec`; an otherwise valid Acer
write returns `INPUT_REQUIRED`, asking the caller to explicitly allow system
authorization. With `true`, invoke the fixed helper using
`pkexec --disable-internal-agent`. An existing graphical Polkit agent may prompt;
Luna does not collect passwords or start a terminal fallback; inherited stdin is
disabled. Bind the Polkit action to this exact helper executable, never a generic
Bun/interpreter command. This flag alone is
not a noninteractive guarantee, which is why the default skips `pkexec` entirely.
[Polkit execution documentation][pkexec]

Read-only methods never elevate. Validate inputs and known prerequisites before
authorization, then repeat validation and device checks inside the helper using
the same owning schemas. Helper provisioning and its Polkit policy are deployment
prerequisites, not API methods. No persistent root daemon or custom D-Bus service
is needed. Helper output is a bounded JSON result, never arbitrary command output.

### Errors and mutation results

Use existing error codes; do not change the shared response envelope:

| Error                 | Hardware meaning                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`    | Wrong type/range/key, missing required field, or requested standard profile not currently offered.    |
| `INVALID_ENVIRONMENT` | Required service, driver, recognized device, helper, or supported control is unavailable.             |
| `INPUT_REQUIRED`      | Acer mutation requires explicit permission to invoke system authorization.                            |
| `COMMAND_FAILED`      | Service/helper rejects a request, authorization is denied/canceled, or a subprocess times out.        |
| `CONFLICT`            | Post-write readable state differs from the request.                                                   |
| `IO_ERROR`            | Files or machine-readable responses cannot be read or parsed; post-write state cannot be established. |

`power.get`, `fans.get`, and `keyboard.get` fail when their required source is
unavailable. `inspect`, `battery.get`, and `metrics.sample` support partial results
as specified above. Missing privileges are not classified as unsupported hardware.

Validate, authorize, write once, then reread. Do not suppress an explicit mutation
only because a prior read matched: the fan cache can be stale. Failed or timed-out
mutations may already have changed hardware, and a failed fan write can leave old
cached targets. Messages after dispatch must state that effects may be partial or
unknown and that a fresh read is observational, not proof of rollback.

No automatic retries, compensating writes, or atomicity guarantees. Concurrent
callers and external tools can race; observed mismatches are conflicts, but matching
readback cannot exclude later changes. There is no multi-setting batch operation.

Bound ordinary reads to 5 seconds per external command, writes to 10 seconds,
and explicitly interactive authorization/write calls to 120 seconds overall.
Terminate children the caller can signal on expiry and bound captured output.
After elevation, the helper must enforce its own 10-second execution deadline;
an unprivileged caller cannot be assumed able to kill it. It must not start new
writes after that deadline or the original overall request deadline, which is
carried into the helper and checked before dispatch. Late authorization must not
revive an expired request. Uninterruptible kernel work can outlive a timeout;
report effects as uncertain rather than promising cancellation or immediate exit.
Do not create a persistent worker or schedule retries after the caller times out.

### Persistence and optimized work

Importing the API performs no hardware I/O. Every method reads current state when
called; no module-global telemetry cache, background poller, or configuration file
watcher is introduced. Within a call, discover each source once and batch related
properties/metrics. Parallelize independent reads; do not overlap dependent writes
and their verification reads.

There is no Luna hardware configuration file in v1. Do not persist requested
settings, restore fans on process exit, replay writes after resume, or compete with
firmware/PPD behavior. Future saved preferences would use the repository's JSONC
and owning-Zod-schema conventions, subject to a separate specification.

## Proposed ownership and dependencies

Keep implementation under the proposed `packages/luna-api/src/hardware/`, with a
small namespace entry, shared types/schema, focused power/fans/battery/keyboard/
metrics modules, and transport/privileged-helper internals. Share validation rather
than duplicating it in a future consumer or helper. Export the namespace through
the existing API entry point. Tests and fixtures belong to
`packages/luna-api/tests/`; no renderer or CLI changes belong to this feature.

Required runtime dependencies are capability-specific:

- Existing Bun runtime and Zod, as declared by the
  [API package](../packages/luna-api/package.json).
- System D-Bus and systemd's `busctl`; power-profiles-daemon for profile operations;
  UPower for battery information.
- Div-Linuwu-Sense built for the running kernel for Acer controls. Provisioning
  needs matching build prerequisites and resolution of the stock `acer_wmi`
  ownership conflict; ordinary API calls never install/unload modules.
- Polkit, the installed trusted helper/policy, and an authentication agent when
  interactive authorization is required.
- NVIDIA driver tools providing `nvidia-smi` for active NVIDIA GPU readings.

Missing optional prerequisites disable only their dependent features. Do not add
DAMX, Python, another power manager, or a Luna-specific notification protocol.

## Usage examples

These are proposed API examples, not commands to run during specification review.

```ts
const capabilities = await Luna.hardware.inspect();
const power = await Luna.hardware.power.get();

const changed = await Luna.hardware.power.set({ profile: "balanced" });
const fans = await Luna.hardware.fans.set({ cpu: 0, gpu: 0 }, { allowAuthorization: true });

const first = await Luna.hardware.metrics.sample();
// A caller makes its next explicit request later, when it needs another reading.
if (first.succes) {
  const next = await Luna.hardware.metrics.sample({ previousCpu: first.data.cpu.sample });
}
```

Examples of rejection: `{ cpu: 40 }`, `{ cpu: 40.5, gpu: 50 }`,
`{ enabled: "true" }`, and `{ profile: "turbo" }` are `INVALID_ARGUMENT`.
`{ cpu: 100, gpu: 100 }` requests maximum; `{ cpu: 0, gpu: 45 }` requests CPU
automatic and GPU manual. A null CPU token is valid and resets the baseline.

## Acceptance and verification

Implementation acceptance is future work. Automated cases must use isolated
fixtures/fake transports and must not write the developer's real hardware.

| Requirement   | Observable acceptance case                                                                                                                                                                                                          | Planned verification                        |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| HW-01         | With Linuwu absent, Acer features are unavailable while power and battery reads still work. Missing helper affects write readiness, not support claims.                                                                             | API integration                             |
| HW-01         | A recognized driver without a timeout/RPM attribute reports that capability unsupported; lack of RPM does not disable fan control.                                                                                                  | Fixture tests                               |
| HW-02         | A permitted profile change is visible through a separate standard D-Bus observer; an external change appears in the next API read.                                                                                                  | Service integration and manual laptop check |
| HW-02         | Offered-profile checks, degraded state, holds, and CPU-only backend reporting reflect the daemon; unavailable performance is rejected.                                                                                              | API integration                             |
| HW-02 / HW-03 | A successful or failed profile mutation invalidates prior fan observations; the API never reapplies the old pair.                                                                                                                   | Fake transport and manual laptop check      |
| HW-03         | Automatic, mixed, manual boundary values, and `100,100` issue exactly one pair write; missing/fractional/out-of-range values cause no write.                                                                                        | API integration                             |
| HW-03 / HW-08 | A simulated partial firmware failure returns failure even if cached targets stayed unchanged; messages do not promise rollback.                                                                                                     | Helper integration                          |
| HW-04 / HW-05 | Limiter state and UPower data can fail independently; zero charge and unknown cycles are preserved. Peripheral-only/absent batteries mean not present; multiple present system batteries mean present with null aggregate readings. | Fixture tests                               |
| HW-06         | Reads of `0`, `1`, and `-1` yield false, true, and null; writes accept booleans only and require exact verification.                                                                                                                | API integration                             |
| HW-07         | First/reset CPU samples yield null utilization; valid deltas yield the expected percentage without a sleep or hidden state.                                                                                                         | Fixture tests                               |
| HW-07         | Suspended GPU causes zero NVIDIA subprocesses; active GPU uses one batched query. `N/A`, absent sensors, and real zero RPM remain distinguishable.                                                                                  | Fake transport and manual laptop check      |
| HW-08         | Default Acer writes return `INPUT_REQUIRED` without spawning Polkit; opt-in denial/cancellation causes no helper write. Default power writes cannot prompt.                                                                         | Process integration                         |
| HW-08         | Helper rejects unknown operations/paths, mismatched devices, and invalid inputs even when invoked directly.                                                                                                                         | Isolated helper tests                       |
| HW-08         | Timeout after dispatch and conflicting post-write state return failures without retry or compensating writes.                                                                                                                       | API integration                             |
| HW-08         | After elevation, the helper enforces its deadline; late authorization causes no write. A timed-out in-flight write reports uncertain effects, not completed cancellation.                                                           | Isolated helper tests                       |
| HW-09         | Imports and idle API consumers spawn nothing; repeated reads reflect external changes; no preset/config files are written.                                                                                                          | API integration                             |

Manual validation after separately authorized driver setup must check PPD backend
selection, actual fan response/RPM, limiter and timeout round trips, and state
after AC/battery and suspend transitions. Record unknown or unsupported behavior;
do not broaden scope by forcing capabilities. None of those writes occurred while
drafting this specification.

Future implementation checks, from the [package documentation](../packages/luna-api/DOCS.md):

```sh
bun run --cwd packages/luna-api check
bun run --cwd packages/luna-api test
bun run --cwd packages/luna-api build
```

For this document, verify local links, examples, requirement consistency, Markdown
formatting, and whitespace only. No runtime suite is required for the spec itself.
User review is still needed for the proposed helper/transport approach and
on-demand state handling. Approval of this draft alone does not authorize implementation.

## Sources

Repository policy: [AGENTS.md](../AGENTS.md). Source references below are pinned
where they establish Acer behavior; standard service documentation defines the
interoperability contract.

[ppd]: https://upower.pages.freedesktop.org/power-profiles-daemon/gdbus-org.freedesktop.UPower.PowerProfiles.html
[upower]: https://upower.freedesktop.org/docs/Device.html
[driver]: https://github.com/PXDiv/Div-Linuwu-Sense/blob/d8ea437d847268dd9fe2a49ae28d0723dd720968/src/linuwu_sense.c
[driver-readme]: https://github.com/PXDiv/Div-Linuwu-Sense/blob/d8ea437d847268dd9fe2a49ae28d0723dd720968/README.md
[damx]: https://github.com/PXDiv/Div-Acer-Manager-Max/blob/ad6df143bf6cb860c2150ea7b71bad787ed05194/DAMM-Daemon/DAMX-Daemon.py
[damx-license]: https://github.com/PXDiv/Div-Acer-Manager-Max/blob/ad6df143bf6cb860c2150ea7b71bad787ed05194/LICENSE
[nvidia]: https://docs.nvidia.com/deploy/nvidia-smi/index.html
[ppd-auth]: https://gitlab.freedesktop.org/upower/power-profiles-daemon/-/blob/0.30/src/power-profiles-daemon.c#L906
[busctl]: https://github.com/systemd/systemd/blob/main/man/busctl.xml
[pkexec]: https://github.com/polkit-org/polkit/blob/master/docs/man/pkexec.xml
[proc-stat]: https://www.kernel.org/doc/html/latest/filesystems/proc.html#miscellaneous-kernel-statistics-in-proc-stat
