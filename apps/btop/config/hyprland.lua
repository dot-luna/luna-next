-- Match only the dedicated btop terminal, leaving ordinary terminals alone.
hl.window_rule({
  match = { class = "^luna-next-btop$" },
  float = true,
  center = true,
  size = { 875, 600 },
})

hl.bind("SUPER + SHIFT + T", hl.dsp.exec_cmd(
  "xdg-terminal-exec --app-id=luna-next-btop --title=btop -- btop"
), {
  description = "Open btop",
  non_consuming = false,
  dont_inhibit = true,
})
