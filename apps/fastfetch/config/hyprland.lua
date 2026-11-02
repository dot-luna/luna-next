-- Match the dedicated Fastfetch terminal so ordinary terminals keep their layout.
hl.window_rule({
  match = { class = "^luna-next-fastfetch$" },
  float = true,
  center = true,
  size = { 1000, 700 },
})

-- Kitty's --hold starts an interactive shell. Wait silently for one key instead.
hl.bind("SUPER + SHIFT + F", hl.dsp.exec_cmd(
  [[xdg-terminal-exec --app-id=luna-next-fastfetch --title=Fastfetch -- bash -c 'fastfetch; status=$?; read -r -s -n 1; exit "$status"']]
), {
  description = "Open Fastfetch",
  non_consuming = false,
  dont_inhibit = true,
})
