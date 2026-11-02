hl.window_rule({
  match = { class = "^(Bitwarden|bitwarden)$" },
  float = true,
  center = true,
})

hl.bind("SUPER + SHIFT + P", hl.dsp.exec_cmd("bitwarden"), {
  description = "Open Bitwarden",
  non_consuming = false,
  dont_inhibit = true,
})
