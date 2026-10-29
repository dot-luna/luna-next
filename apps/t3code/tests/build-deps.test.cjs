const assert = require("node:assert/strict");
const { test } = require("node:test");
const { withBuildDependencies } = require("../src/build-deps.cjs");

const buildDependencies = ["base-devel", "libsecret", "pkgconf", "imagemagick", "libxcrypt-compat"];
const withoutImageTools = ["base-devel", "libsecret", "pkgconf", "libxcrypt-compat"];

function fixture(preinstalled = buildDependencies) {
  const installed = new Map(preinstalled.map((name) => [name, { explicit: true, requires: [] }]));
  const calls = [];
  const state = { installed, calls, installError: false, removeError: false, snapshotError: false };
  state.run = (program, args) => {
    calls.push([program, ...args]);
    if (program === "/usr/bin/pacman") {
      if (args[0] === "-Qq") {
        if (state.snapshotError && calls.length > 1)
          return { status: 1, stderr: "cannot read package database" };
        return { status: 0, stdout: [...installed.keys()].join("\n") };
      }
      assert.deepEqual(args, ["-Qdtq"]);
      const required = new Set([...installed.values()].flatMap((pkg) => pkg.requires));
      const orphans = [...installed]
        .filter(([name, pkg]) => !pkg.explicit && !required.has(name))
        .map(([name]) => name);
      return { status: orphans.length ? 0 : 1, stdout: orphans.join("\n") };
    }
    assert.match(program, /^\/usr\/bin\/(pkexec|sudo)$/);
    assert.equal(args[0], "/usr/bin/pacman");
    const packages = args.slice(args.indexOf("--") + 1);
    if (args[1] === "-S") {
      const temporary = args.includes("--asdeps");
      assert.deepEqual(
        args.slice(1, temporary ? 6 : 5),
        temporary
          ? ["-S", "--asdeps", "--needed", "--noconfirm", "--"]
          : ["-S", "--needed", "--noconfirm", "--"],
      );
      for (const name of packages)
        installed.set(name, {
          explicit: !temporary,
          requires:
            name === "imagemagick"
              ? ["image-codec"]
              : name === "libsecret"
                ? ["secret-runtime"]
                : [],
        });
      if (packages.includes("imagemagick"))
        installed.set("image-codec", { explicit: false, requires: [] });
      if (packages.includes("libsecret"))
        installed.set("secret-runtime", { explicit: false, requires: [] });
      return state.installError ? { status: 8 } : { status: 0 };
    }
    assert.deepEqual(args.slice(1, 4), ["-R", "--noconfirm", "--"]);
    if (state.removeError) return { status: 9 };
    for (const name of packages) installed.delete(name);
    return { status: 0 };
  };
  return state;
}

function transactions(state, operation) {
  return state.calls.filter((call) => call[0] !== "/usr/bin/pacman" && call[2] === operation);
}

test("already-installed build dependencies run the callback without privilege or cleanup", () => {
  const state = fixture();
  state.installed.set("old-orphan", { explicit: false, requires: [] });
  assert.equal(
    withBuildDependencies(() => "built", state.run),
    "built",
  );
  assert.deepEqual(state.calls, [["/usr/bin/pacman", "-Qq"]]);
  assert(state.installed.has("old-orphan"));
});

test("temporary dependencies and transitive leaves are removed without removing old orphans", () => {
  const state = fixture(withoutImageTools);
  state.installed.set("old-orphan", { explicit: false, requires: [] });
  withBuildDependencies(() => {
    assert(state.installed.has("imagemagick"));
    assert(state.installed.has("image-codec"));
  }, state.run);
  assert.deepEqual(transactions(state, "-S")[0].slice(7), ["imagemagick"]);
  assert.deepEqual(
    transactions(state, "-R").map((call) => call.slice(5)),
    [["imagemagick"], ["image-codec"]],
  );
  assert.deepEqual([...state.installed.keys()], [...withoutImageTools, "old-orphan"]);
});

test("missing libsecret and its runtime dependencies remain while build-only packages are removed", () => {
  const state = fixture(["base-devel", "pkgconf"]);
  withBuildDependencies(() => {
    assert(state.installed.get("libsecret").explicit);
    assert(state.installed.has("secret-runtime"));
    assert(state.installed.has("libxcrypt-compat"));
  }, state.run);
  const installs = transactions(state, "-S");
  assert.deepEqual(installs[0].slice(6), ["libsecret"]);
  assert.deepEqual(installs[1].slice(7), ["imagemagick", "libxcrypt-compat"]);
  assert(state.installed.get("libsecret").explicit);
  assert(state.installed.has("secret-runtime"));
  assert(!state.installed.has("imagemagick"));
  assert(!state.installed.has("libxcrypt-compat"));
  assert(!state.installed.has("image-codec"));
});

test("cleanup runs after a callback failure and preserves the original error", () => {
  const state = fixture(withoutImageTools);
  const failure = new Error("source build failed");
  assert.throws(
    () =>
      withBuildDependencies(() => {
        throw failure;
      }, state.run),
    (error) => error === failure,
  );
  assert(!state.installed.has("imagemagick"));
  assert(!state.installed.has("image-codec"));
});

test("partial failed installs are cleaned without starting the build", () => {
  const state = fixture(withoutImageTools);
  state.installError = true;
  let built = false;
  assert.throws(
    () =>
      withBuildDependencies(() => {
        built = true;
      }, state.run),
    /failed \(8\)/,
  );
  assert.equal(built, false);
  assert(!state.installed.has("imagemagick"));
  assert(!state.installed.has("image-codec"));
});

test("packages made explicit or required elsewhere are retained along with later additions", () => {
  const state = fixture(["base-devel", "libsecret", "libxcrypt-compat"]);
  withBuildDependencies(() => {
    state.installed.get("pkgconf").explicit = true;
    state.installed.set("other-app", { explicit: true, requires: ["imagemagick"] });
    state.installed.set("later-orphan", { explicit: false, requires: [] });
  }, state.run);
  assert(state.installed.has("pkgconf"));
  assert(state.installed.has("imagemagick"));
  assert(state.installed.has("image-codec"));
  assert(state.installed.has("later-orphan"));
  assert.deepEqual(transactions(state, "-R"), []);
});

test("build and cleanup diagnostics are both retained", () => {
  const state = fixture(withoutImageTools);
  state.removeError = true;
  const failure = new Error("source build failed");
  assert.throws(
    () =>
      withBuildDependencies(() => {
        throw failure;
      }, state.run),
    (error) => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors[0], failure);
      assert.match(error.message, /source build failed/);
      assert.match(error.message, /failed \(9\)/);
      return true;
    },
  );
});

test("failed package snapshots stop the build and do not guess cleanup targets", () => {
  const state = fixture(withoutImageTools);
  state.snapshotError = true;
  let built = false;
  assert.throws(
    () =>
      withBuildDependencies(() => {
        built = true;
      }, state.run),
    /cannot read package database/,
  );
  assert.equal(built, false);
  assert.deepEqual(transactions(state, "-R"), []);
});
