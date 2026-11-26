export {};

const [operation, value, name, fingerprint] = Bun.argv.slice(2);
let data: unknown = [{ name: "existing", current: true }];
if (operation === "select") {
  console.log(JSON.stringify({ succes: false, errMessage: "Invalid theme" }));
  process.exit(0);
}
if (operation === "preview" || operation === "install") {
  if (value !== "https://example.com/a file.jsonc") process.exit(1);
  if (operation === "preview") data = { suggestedName: "custom", fingerprint: "reviewed" };
  else {
    if (name !== "custom" || fingerprint !== "reviewed") process.exit(1);
    data = [
      { name: "existing", current: true },
      { name: "custom", current: false },
    ];
  }
}
console.log(JSON.stringify({ succes: true, data }));
