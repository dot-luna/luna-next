/** Standalone defaults; the greeter never needs the user's desktop theme. */
export const loginDefaults = {
  login: { user: "jrtilak" },
  actions: { shutdown_delay: 3 },
  theme: {
    colors: {
      background: "#1a1b26",
      lighter_background: "#24283b",
      foreground: "#a9b1d6",
      bright_foreground: "#c0caf5",
      accent: "#7aa2f7",
      accent_foreground: "#1a1b26",
      selection: "#292e42",
      selection_foreground: "#c0caf5",
      muted: "#414868",
      warning: "#e0af68",
      error: "#f7768e",
    },
    fonts: { ui: "sans-serif" },
    appearance: {
      rounding: 0,
      blur: { enabled: true, size: 10, passes: 3 },
    },
  },
};
