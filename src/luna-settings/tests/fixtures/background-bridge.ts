const [operation, value] = Bun.argv.slice(2);
if (operation === "install") {
  console.log(JSON.stringify({ succes: false, errMessage: "Invalid media" }));
} else {
  if (operation === "select" && value !== "a file #1.png") process.exit(1);
  console.log(JSON.stringify({ succes: true, data: [{ name: "a file #1.png", current: operation === "select" }] }));
}
