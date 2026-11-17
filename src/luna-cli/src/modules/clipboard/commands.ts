import { Luna } from "@luna/api";
import type { Command } from "commander";
import type { createOutput } from "@/lib/output.ts";

/** Argument parsing and presentation only; history and paste behavior live in the API. */
export function addClipboardCommands(
  program: Command,
  output: ReturnType<typeof createOutput>,
  setExitCode: (code: number) => void,
) {
  const group = program
    .command("clipboard")
    .description("Open clipboard history or manage saved entries")
    .option("--install-dir <path>", "Luna source checkout for the menu");
  group.action(async () => {
    const response = await Luna.menu.clipboard({
      repository: group.opts<{ installDir?: string }>().installDir,
    });
    setExitCode(output.response(response, () => "Clipboard opened"));
  });
  group
    .command("start")
    .description("Start session clipboard history capture")
    .action(async () => {
      setExitCode(output.response(await Luna.clipboard.start(), () => "Clipboard history running"));
    });
  group
    .command("list")
    .description("List saved entries, newest first")
    .action(async () => {
      setExitCode(
        output.response(await Luna.clipboard.list(), (entries) =>
          entries.map((entry) => `${entry.id}\t${entry.name}`).join("\n"),
        ),
      );
    });
  group
    .command("preview <id>")
    .description("Read the complete text or image preview")
    .action(async (id: string) => {
      setExitCode(
        output.response(await Luna.clipboard.preview(id), (entry) => entry.text || entry.image),
      );
    });
  group
    .command("copy <id>")
    .description("Copy a saved entry without pasting")
    .action(async (id: string) => {
      setExitCode(output.response(await Luna.clipboard.copy(id), () => "Copied"));
    });
  group
    .command("paste <id>")
    .description("Copy and paste into the focused application")
    .option("--target <address>", "Require the window captured before opening the menu")
    .action(async (id: string, options: { target?: string }) => {
      setExitCode(
        output.response(await Luna.clipboard.paste(id, { target: options.target }), () => "Pasted"),
      );
    });
  group
    .command("target")
    .description("Read the focused Hyprland window address")
    .action(async () => {
      setExitCode(output.response(await Luna.clipboard.target(), (target) => target.address));
    });
  group
    .command("delete <id>")
    .description("Remove one saved entry")
    .action(async (id: string) => {
      setExitCode(output.response(await Luna.clipboard.delete(id), () => "Deleted"));
    });
  group
    .command("clear")
    .description("Clear saved history; keep the current clipboard")
    .action(async () => {
      setExitCode(output.response(await Luna.clipboard.clear(), () => "Clipboard history cleared"));
    });
}
