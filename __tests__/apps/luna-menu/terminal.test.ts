import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

for (const status of [0, 23]) {
  test(`menu terminal commands preserve output, quoting, and exit ${status} until a keypress`, async () => {
    const root = mkdtempSync(join(tmpdir(), "luna-menu-terminal "));
    mkdirSync(join(root, "bin"));
    const terminalPath = join(root, "bin/xdg-terminal-exec");
    writeFileSync(terminalPath, '#!/bin/sh\nshift\nexec "$@"\n');
    chmodSync(terminalPath, 0o755);
    const value = `printf '%s\\n' 'literal ; $(touch UNEXPECTED)'; exit ${status}`;
    const source = readFileSync(
      new URL("../../../src/luna-menu/src/shell/Query.js", import.meta.url),
      "utf8",
    );
    const args: string[] = runInNewContext(source + '; command(entry, "/bin/sh")', {
      entry: { queryAction: "terminal", value },
    });
    let output = "";
    await using terminal = new Bun.Terminal({
      data(_, data) {
        output += new TextDecoder().decode(data);
      },
    });
    const child = Bun.spawn(args, {
      env: { HOME: root, PATH: `${join(root, "bin")}:/usr/bin:/bin` },
      cwd: root,
      terminal,
    });
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (output.includes("literal") && (terminal.localFlags & 8) === 0) break;
        await Bun.sleep(10);
      }
      expect(child.exitCode).toBeNull();
      expect(terminal.localFlags & 8).toBe(0);
      expect(output).toBe("literal ; $(touch UNEXPECTED)\r\n");
      expect(existsSync(join(root, "UNEXPECTED"))).toBe(false);
      terminal.write("x");
      expect(await child.exited).toBe(status);
      expect(output).toBe("literal ; $(touch UNEXPECTED)\r\n");
    } finally {
      child.kill();
      await child.exited;
      rmSync(root, { recursive: true, force: true });
    }
  });
}
