/** Desktop Exec values have a desktop-string escaping layer before argument unquoting. */
export function desktopArgument(value: string) {
  const quoted = value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("%", "%%");
  return '"' + quoted.replaceAll("\\", "\\\\") + '"';
}
