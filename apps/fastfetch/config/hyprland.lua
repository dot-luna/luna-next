-- Match the dedicated Fastfetch terminal so ordinary terminals keep their layout.
hl.window_rule({
  match = { class = "^luna-next-fastfetch$" },
  float = true,
  center = true,
  -- Fits the output with margins about one line on every side.
  size = { 1000, 534 },
})

-- Kitty's --hold starts an interactive shell. Wait silently for one key instead.
-- Printing without the trailing newline and hiding the cursor keeps the bottom margin even.
hl.bind("SUPER + SHIFT + F", hl.dsp.exec_cmd(
  [[xdg-terminal-exec --app-id=luna-next-fastfetch --title=Fastfetch -- bash -c 'output=$(fastfetch --pipe false); status=$?; printf "\e[?25l%s" "$output"; read -r -s -n 1; exit "$status"']]
), {
  description = "Open Fastfetch",
  non_consuming = false,
  dont_inhibit = true,
})
