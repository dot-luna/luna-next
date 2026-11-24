import { Luna } from "@luna/api";
import type { Command } from "commander";
import type { Output } from "@/lib/output.ts";

export function addEmojiCommands(program: Command, output: Output) {
  const group = program
    .command("emoji")
    .description("Open the emoji picker or insert Unicode emoji")
    .option("--install-dir <path>", "Luna source checkout for the menu");
  group.action(async () => {
    const response = await Luna.menu.emoji({
      repository: group.opts<{ installDir?: string }>().installDir,
    });
    output.response(response, () => "Emoji picker opened");
  });
  group
    .command("list [query]")
    .description("Search the offline emoji catalog")
    .action(async (query?: string) => {
      output.response(await Luna.emoji.list(query), (entries) =>
        entries.map((entry) => `${entry.emoji}\t${entry.name}`).join("\n"),
      );
    });
  group
    .command("copy <emoji...>")
    .description("Copy selected emoji without pasting")
    .action(async (values: string[]) => {
      output.response(await Luna.emoji.copy(values), () => "Copied");
    });
  group
    .command("paste <emoji...>")
    .description("Copy and paste selected emoji in order")
    .option("--target <address>", "Require the window captured before opening the menu")
    .action(async (values: string[], options: { target?: string }) => {
      output.response(await Luna.emoji.paste(values, { target: options.target }), () => "Pasted");
    });
}
