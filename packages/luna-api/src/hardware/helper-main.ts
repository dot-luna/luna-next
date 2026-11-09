import { failure } from "../lib/response.ts";
import { systemContext } from "./context.ts";
import { runHelperRequest, writeSysfsAttribute } from "./helper.ts";

// Compile this entry into the fixed, root-owned executable named by the Polkit policy.
// It is intentionally absent from the library entry point: importing @luna/api never runs it.
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0]!.length > 4096)
    return failure("INVALID_ARGUMENT", "Expected one bounded JSON hardware request");
  let input: unknown;
  try {
    input = JSON.parse(args[0]!);
  } catch {
    return failure("INVALID_ARGUMENT", "Hardware request is not valid JSON");
  }
  return runHelperRequest(input, {
    hardware: systemContext,
    effectiveUid: process.geteuid?.(),
    writeAttribute: writeSysfsAttribute,
  });
}

if (import.meta.main) {
  const result = await main();
  // Exiting after the bounded reply prevents timed-out async work from resuming in this process.
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(result.succes ? 0 : 1));
}
