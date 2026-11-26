import { afterEach, expect, test, spyOn } from "bun:test";
import { join } from "node:path";
import { SelfFixture } from "./fixtures/self-fixture.ts";
import { appContext } from "../src/modules/apps/context.ts";
import { whatlyDependencies } from "../src/modules/self/migrations/releases/whatly-dependencies.ts";

const start = "2026-11-10T12:00:00.000Z";
const end = "2026-11-10T12:00:10.000Z";
const targets = ["qt6-webengine", "qt6-webchannel", "qt6-base", "gcc"];
const records = [{ start: Date.parse(start), end: Date.parse(end), targets }];
const history = (lines: string[]) =>
  lines.map((line) => `[2026-11-10T12:00:01+0000] ${line}`).join("\n");
const transaction = history([
  `[PACMAN] Running 'pacman -S --needed --noconfirm -- ${targets.join(" ")}'`,
  "[ALPM] transaction started",
  "[ALPM] installed qt6-webengine (1.0)",
  "[ALPM] installed qt6-webchannel (1.0)",
  "[ALPM] installed helper (1.0)",
  "[ALPM] transaction completed",
]);
function details(name: string, required = "None", optional = "None") {
  return `Name            : ${name}\nRequired By     : ${required}\nOptional For    : ${optional}\n\n`;
}

test("only newly installed packages in a proven Whatly transaction belong to Whatly", () => {
  expect([
    ...whatlyDependencies.ownedPackages({ source: transaction, installations: records }),
  ]).toEqual(["qt6-webengine", "qt6-webchannel", "helper"]);
  expect([...whatlyDependencies.ownedPackages({ source: transaction, installations: [] })]).toEqual(
    [],
  );
  expect([
    ...whatlyDependencies.ownedPackages({
      source: transaction,
      installations: [
        { ...records[0]!, start: Date.parse(start) + 60000, end: Date.parse(end) + 60000 },
      ],
    }),
  ]).toEqual([]);
});

test("later explicit installs and removals revoke ownership while normal upgrades retain it", () => {
  const source =
    transaction +
    "\n" +
    history([
      "[PACMAN] Running 'pacman -Syu'",
      "[ALPM] upgraded helper (1.0 -> 2.0)",
      "[PACMAN] Running 'pacman -S qt6-webengine'",
      "[ALPM] reinstalled qt6-webengine (1.0)",
      "[PACMAN] Running 'pacman -R qt6-webchannel'",
      "[ALPM] removed qt6-webchannel (1.0)",
    ]);
  expect([...whatlyDependencies.ownedPackages({ source, installations: records })]).toEqual([
    "helper",
  ]);
});

test("other apps' hard and optional dependencies and Luna recipe dependencies stay installed", () => {
  const source =
    details("qt6-webengine") +
    details("qt6-webchannel", "qt6-webengine") +
    details("qt6-base", "qt6-webchannel  other-app") +
    details("optional-lib", "None", "another-app") +
    details("gcc");
  expect(
    whatlyDependencies.removablePackages({
      source,
      candidates: new Set(["qt6-webengine", "qt6-webchannel", "qt6-base", "optional-lib", "gcc"]),
      protected: new Set(["gcc"]),
    }),
  ).toEqual(["qt6-webchannel", "qt6-webengine"]);
});

test("retaining a package also retains its dependencies through the entire chain", () => {
  expect(
    whatlyDependencies.removablePackages({
      source: details("a", "b") + details("b", "c") + details("c", "external"),
      candidates: new Set(["a", "b", "c"]),
      protected: new Set(),
    }),
  ).toEqual([]);
  expect(() =>
    whatlyDependencies.removablePackages({
      source: "Name : a\nRequired By : None\n",
      candidates: new Set(["a"]),
      protected: new Set(),
    }),
  ).toThrow("Missing pacman");
});

let fixture: SelfFixture | undefined;
afterEach(() => {
  fixture?.dispose();
  fixture = undefined;
});
test("dependency cleanup uses retained installer evidence and only removes the closed unused package set", async () => {
  const f = (fixture = new SelfFixture());
  const context = await appContext.resolve({ env: f.env });
  f.write(
    f.home,
    ".local/state/luna/install-logs/previous/events.jsonl",
    [
      { type: "progress", time: start, message: "Installing whatly..." },
      {
        type: "command",
        time: start,
        id: "0001",
        args: ["sudo", "pacman", "-S", "--needed", "--noconfirm", "--", ...targets],
      },
      { type: "exit", time: end, id: "0001", exitCode: 0 },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  const log = join(f.root, "pacman.log");
  f.write(f.root, "pacman.log", transaction);
  const calls: string[][] = [];
  const command = spyOn(context, "execute").mockImplementation(async (args) => {
    calls.push(args);
    const stdout =
      args[0] === "pacman-conf"
        ? log
        : args[1] === "-Qq"
          ? "qt6-webengine\nqt6-webchannel\nhelper\n"
          : args[1] === "-Qi"
            ? details("qt6-webengine") +
              details("qt6-webchannel", "qt6-webengine") +
              details("helper", "None", "other-app")
            : "";
    return { exitCode: 0, stdout, stderr: "" };
  });
  try {
    await whatlyDependencies.remove(context);
    expect(calls.at(-1)).toEqual([
      "sudo",
      "pacman",
      "-R",
      "--noconfirm",
      "--",
      "qt6-webchannel",
      "qt6-webengine",
    ]);
    expect(calls.flat()).not.toContain("-Rs");
  } finally {
    command.mockRestore();
  }
});

test("missing installer ownership evidence performs no package query or removal", async () => {
  const f = (fixture = new SelfFixture());
  const context = await appContext.resolve({ env: f.env });
  const command = spyOn(context, "execute").mockRejectedValue(new Error("Must not run pacman"));
  try {
    await whatlyDependencies.remove(context);
    expect(command).not.toHaveBeenCalled();
  } finally {
    command.mockRestore();
  }
});
