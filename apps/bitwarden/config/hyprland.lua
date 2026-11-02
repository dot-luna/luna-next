hl.window_rule({
  match = { class = "^(Bitwarden|bitwarden)$" },
  float = true,
  center = true,
  -- Keep restored windows within the height limit regardless of how the app is launched.
  suppress_event = "maximize",
  max_size = { "(monitor_w)", "(monitor_h*0.8)" },
})

hl.bind("SUPER + SHIFT + P", hl.dsp.exec_cmd("bitwarden-desktop"), {
  description = "Open Bitwarden",
  non_consuming = false,
  dont_inhibit = true,
})
