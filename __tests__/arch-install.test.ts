import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const installer = resolve(import.meta.dir, "../arch-install.sh");
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "arch-install-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// All disk/package commands are doubles. Only temporary files and password hashes are real.
const setup = `
source "$LUNA_TEST_SCRIPT"
exec 3<&0
staging=$LUNA_TEST_ROOT; target=$staging/target; log=$staging/log
disk=/dev/test-disk; username=tester; sudo_access=yes
lsblk() {
    case " $* " in
        *" --output TYPE "*)
            if [[ $* == *--nodeps* ]]; then
                if [[ \${!#} == /dev/test-part ]]; then echo part
                else echo "\${LUNA_TEST_TYPE:-disk}"; fi
            else printf '%s\\n' "\${LUNA_TEST_TYPES:-disk
part}"; fi ;;
        *" --output RO "*) echo "\${LUNA_TEST_RO:-0}" ;;
        *" --output MOUNTPOINTS "*) printf '%s' "\${LUNA_TEST_MOUNTS:-}" ;;
        *" --output PKNAME "*) echo "\${LUNA_TEST_PARENT:-/dev/test-disk}" ;;
        *" --output SIZE,LOG-SEC,MAJ:MIN,SERIAL,WWN "*)
            echo "\${LUNA_TEST_BYTES:-34359738368} \${LUNA_TEST_SECTOR:-512} 8:0 \${LUNA_TEST_SERIAL:-serial} wwn" ;;
        *) echo '/dev/test-disk 32G Test disk' ;;
    esac
}
getent() { return 2; }
`;

function shell(code: string, input = "", env: Record<string, string> = {}) {
  const result = Bun.spawnSync(["bash", "-c", setup + code], {
    env: { ...process.env, LUNA_TEST_SCRIPT: installer, LUNA_TEST_ROOT: root, ...env },
    stdin: Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

test("prewritten preset fits both sector sizes and keeps the requested defaults", () => {
  for (const sector of ["512", "4096"]) {
    const result = shell(
      "check_disk; printf '$6$salt$hash\\n' > \"$staging/user.hash\"; write_preset",
      "",
      {
        LUNA_TEST_SECTOR: sector,
      },
    );
    expect(result.code, result.err).toBe(0);
    const preset = JSON.parse(readFileSync(join(root, "config.json"), "utf8"));
    const [boot, partition] = preset.disk_config.device_modifications[0].partitions;
    expect([boot.fs_type, boot.mountpoint, boot.size.value]).toEqual(["fat32", "/boot", 1024]);
    expect([partition.fs_type, partition.mountpoint]).toEqual(["ext4", "/"]);
    expect(partition.size.sector_size.value).toBe(Number(sector));
    expect((partition.start.value + partition.size.value) * 1048576).toBeLessThanOrEqual(
      34359738368 - 34 * Number(sector),
    );
    expect(preset.disk_config.disk_encryption).toBeUndefined();
    expect(preset.hostname).toBe("luna");
    expect(preset.timezone).toBe("Asia/Kathmandu");
    expect(preset.packages).toEqual(
      expect.arrayContaining(["hyprland", "kitty", "sddm", "reflector"]),
    );
    expect(preset.network_config.type).toBe("nm");
    expect(preset.bootloader_config.bootloader).toBe("Systemd-boot");
    const credentials = JSON.parse(readFileSync(join(root, "credentials.json"), "utf8"));
    expect(credentials.users[0]).toEqual({
      username: "tester",
      sudo: true,
      groups: [],
      enc_password: "$6$salt$hash",
    });
    expect(statSync(join(root, "credentials.json")).mode & 0o777).toBe(0o600);
  }
});

for (const env of [
  { LUNA_TEST_RO: "1" },
  { LUNA_TEST_TYPE: "part" },
  { LUNA_TEST_BYTES: "8589934592" },
  { LUNA_TEST_MOUNTS: "/run/archiso/bootmnt" },
  { LUNA_TEST_MOUNTS: "[SWAP]" },
  { LUNA_TEST_TYPES: "disk\npart\ncrypt" },
  { LUNA_TEST_SECTOR: "123" },
]) {
  test(`refuses unsafe disk: ${JSON.stringify(env)}`, () => {
    expect(shell("check_disk", "", env).code).not.toBe(0);
  });
}

test("disk checks include all child devices", () => {
  const result = shell(`
lsblk() {
  case " $* " in
    *" --output TYPE "*) echo disk ;;
    *" --output RO "*) echo 0 ;;
    *" --output MOUNTPOINTS "*) [[ $* != *--list* ]] || echo /boot ;;
  esac
}
check_disk
`);
  expect(result.code).not.toBe(0);
  expect(result.err).toContain("mounted partitions");
});

test("invalid disk path cannot inject values into the JSON preset", () => {
  expect(shell("disk='/dev/disk\"injection'; check_disk").code).not.toBe(0);
});

test("password retries stay hidden and produce private hash files", () => {
  const result = shell(
    'password_hash tester "$staging/user.hash"',
    "secret1\nwrong\nsecret2\nsecret2\n",
  );
  expect(result.code, result.err).toBe(0);
  expect(result.out + result.err).not.toContain("secret");
  expect(readFileSync(join(root, "user.hash"), "utf8")).toStartWith("$6$");
  expect(statSync(join(root, "user.hash")).mode & 0o777).toBe(0o600);
});

test("declining sudo requires separate root credentials", () => {
  const result = shell(
    "collect_details",
    "n\nuser-secret\nuser-secret\nroot-secret\nroot-secret\n",
  );
  expect(result.code, result.err).toBe(0);
  const credentials = JSON.parse(readFileSync(join(root, "credentials.json"), "utf8"));
  expect(credentials.users[0].sudo).toBe(false);
  expect(credentials.root_enc_password).toStartWith("$6$");
  expect(credentials.root_enc_password).not.toBe(credentials.users[0].enc_password);
});

test("system usernames fail before asking for passwords", () => {
  const result = shell("username=sddm; collect_details");
  expect(result.code).not.toBe(0);
  expect(result.err).toContain("system account");
});

test("confirmation requires the exact disk", () => {
  expect(shell("confirm_install", "yes\n").code).not.toBe(0);
  expect(shell("confirm_install", "ERASE /dev/another\n").code).not.toBe(0);
  expect(shell("confirm_install", "ERASE /dev/test-disk\n").code).toBe(0);
});

const operations = `
check_disk; selected_identity=$identity
install() { echo mirrors >> "$staging/events"; }
findmnt() { [[ \${LUNA_TEST_MISSING_MOUNT:-0} != 1 ]] || return 1; echo /dev/test-part; }
archinstall() {
    if [[ " $* " == *" --dry-run "* ]]; then
        echo dry-run >> "$staging/events"; return "\${LUNA_TEST_DRY_FAIL:-0}"
    fi
    echo erase >> "$staging/events"; return "\${LUNA_TEST_INSTALL_FAIL:-0}"
}
configure_target() { echo target >> "$staging/events"; }
`;
for (const [env, events] of [
  [{ LUNA_TEST_DRY_FAIL: "1" }, "dry-run\n"],
  [{ LUNA_TEST_INSTALL_FAIL: "1" }, "dry-run\nmirrors\nerase\n"],
  [{ LUNA_TEST_MISSING_MOUNT: "1" }, "dry-run\nmirrors\nerase\n"],
  [{ LUNA_TEST_PARENT: "/dev/another" }, "dry-run\nmirrors\nerase\n"],
] as const) {
  test(`installation stops on ${JSON.stringify(env)}`, () => {
    expect(shell(operations + "perform_installation", "", env).code).not.toBe(0);
    expect(readFileSync(join(root, "events"), "utf8")).toBe(events);
  });
}

test("disk replacement blocks erasure", () => {
  expect(shell(operations + "LUNA_TEST_SERIAL=replaced; perform_installation").code).not.toBe(0);
  expect(readFileSync(join(root, "events"), "utf8")).toBe("dry-run\n");
});

test("success verifies target mounts before provisioning", () => {
  const result = shell(operations + "perform_installation");
  expect(result.code, result.err).toBe(0);
  expect(readFileSync(join(root, "events"), "utf8")).toBe("dry-run\nmirrors\nerase\ntarget\n");
});

test("streamed Bash runs independently of the checkout", () => {
  const result = Bun.spawnSync(["bash", "-s", "--", "--help"], {
    cwd: root,
    stdin: Buffer.from(readFileSync(installer)),
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toContain("Usage:");
});

test("target setup enables login, networking and mirror refresh without installing Luna", () => {
  for (const file of [
    "etc/arch-release",
    "etc/fstab",
    "boot/vmlinuz-linux",
    "boot/initramfs-linux.img",
    "usr/share/wayland-sessions/hyprland.desktop",
  ]) {
    const path = join(root, "target", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "");
  }
  writeFileSync(join(root, "mirrorlist"), "Server = https://example.test/$repo/os/$arch\n");
  writeFileSync(join(root, "config.json"), "{}");
  const result = shell(`
umask 022
arch-chroot() {
  echo "$*" >> "$staging/events"
  if [[ $2 == getent ]]; then echo 'tester:x:1000:1000::/home/tester:/bin/bash'; fi
}
configure_target
`);
  expect(result.code, result.err).toBe(0);
  const events = readFileSync(join(root, "events"), "utf8");
  expect(events).toContain("systemctl enable NetworkManager sddm reflector.timer");
  expect(events).toContain("systemctl set-default graphical.target");
  expect(events).not.toContain("--now");
  expect(readFileSync(join(root, "target/var/lib/sddm/state.conf"), "utf8")).toContain(
    "Session=hyprland.desktop",
  );
  expect(statSync(join(root, "target/etc/sddm.conf.d/arch-install.conf")).mode & 0o777).toBe(0o644);
  expect(existsSync(join(root, "target/home/tester/.local/bin/luna"))).toBe(false);
});

test("exit cleanup removes temporary credentials", () => {
  const result = shell(
    'staging=$LUNA_TEST_ROOT/private; mkdir "$staging"; touch "$staging/credentials.json"; trap cleanup EXIT',
  );
  expect(result.code, result.err).toBe(0);
  expect(existsSync(join(root, "private"))).toBe(false);
});

test.skipIf(!Bun.which("script"))("streamed script reads confirmation through the terminal", () => {
  const definitions = readFileSync(installer, "utf8").split("\nif [[ -z ${BASH_SOURCE[0]:-}")[0]!;
  writeFileSync(
    join(root, "input.sh"),
    definitions +
      "\nexec 3<>/dev/tty\ndisk=/dev/test-disk; username=tester; sudo_access=yes\nconfirm_install\necho CONFIRMED\n",
  );
  const result = Bun.spawnSync(["script", "-qec", "cat input.sh | bash", "/dev/null"], {
    cwd: root,
    stdin: Buffer.from("ERASE /dev/test-disk\n"),
    stdout: "pipe",
    stderr: "pipe",
    timeout: 10_000,
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stdout.toString()).toContain("CONFIRMED");
});
