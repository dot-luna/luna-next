import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = Bun.env.LUNA_TEST_VIDEO_ROOT!;
const path = (name: string) => join(root, name);
const has = (name: string) => existsSync(path(name));
appendFileSync(
  path("launches"),
  JSON.stringify({
    args: process.argv.slice(2),
    pid: process.pid,
    cwd: process.cwd(),
    home: Bun.env.HOME,
  }) + "\n",
);
if (has("crash")) process.exit(3);
let current = process.argv.at(-1);
let pending: string | null = null;
let entry = 1;
let announced = false;
let input = "";
let updates: Record<string, unknown>[] = [];

Bun.listen<ReturnType<typeof setInterval>>({
  unix: "ipc",
  socket: {
    data(socket, bytes) {
      input += bytes.toString();
      let newline;
      while ((newline = input.indexOf("\n")) !== -1) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        const message = JSON.parse(line);
        appendFileSync(path("commands"), JSON.stringify(message) + "\n");
        const result: Record<string, unknown> = {
          request_id: message.request_id,
          error: "success",
        };
        const command = message.command;
        if (command[0] === "loadfile") {
          if (has("command-error")) result.error = "loading failed";
          else {
            pending = command[1];
            socket.write(
              JSON.stringify({ event: "end-file", reason: "stop", playlist_entry_id: entry }) +
                "\n",
            );
          }
        } else if (command[0] === "get_property" && command[1] === "path") result.data = current;
        else if (command[0] === "get_property" && command[1] === "video-out-params") {
          result.data = has("hold") ? null : { w: 3840, h: 2160 };
          if (has("defer-parameters")) {
            writeFileSync(path("deferred-reply"), JSON.stringify(result));
            continue;
          }
        } else if (command[0] === "set_property" && has("command-error"))
          result.error = "property unavailable";
        if (command[0] === "set_property" && has("hold-updates")) updates.push(result);
        else socket.write(JSON.stringify(result) + "\n");
      }
    },
    open(socket) {
      const timer = setInterval(() => {
        if (updates.length && !has("hold-updates")) {
          for (const result of updates) {
            if (has("command-error")) result.error = "property unavailable";
            socket.write(JSON.stringify(result) + "\n");
          }
          updates = [];
        }
        if (has("disconnect")) {
          clearInterval(timer);
          socket.end();
          return;
        }
        if (has("event")) {
          socket.write(readFileSync(path("event"), "utf8") + "\n");
          unlinkSync(path("event"));
        }
        if (pending !== null && !has("hold-load")) {
          current = pending;
          pending = null;
          entry++;
          announced = false;
          for (const event of [
            { event: "start-file", playlist_entry_id: entry },
            { event: "file-loaded" },
          ])
            socket.write(JSON.stringify(event) + "\n");
        }
        if (!announced && !has("hold")) {
          socket.write(
            JSON.stringify({
              event: "property-change",
              name: "video-out-params",
              data: { w: 3840, h: 2160 },
            }) + "\n",
          );
          announced = true;
        }
      }, 10);
      socket.data = timer;
    },
    close(socket) {
      clearInterval(socket.data);
      process.exit();
    },
  },
});
