-- Match the dedicated Fastfetch terminal so ordinary terminals keep their layout.
hl.window_rule({
  match = { class = "^luna-next-fastfetch$" },
  float = true,
  center = true,
  size = { 1000, 700 },
})

-- Hold the default terminal open after Fastfetch finishes printing.
hl.bind("SUPER + SHIFT + F", hl.dsp.exec_cmd(
  "xdg-terminal-exec --app-id=luna-next-fastfetch --title=Fastfetch --hold -- fastfetch"
), {
  description = "Open Fastfetch",
  non_consuming = false,
  dont_inhibit = true,
})
