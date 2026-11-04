// Unsupported actions deliberately have no command.
function entries() {
    return [
        {name: "Screensaver", icon: "play", action: "screensaver"},
        {name: "Lock", icon: "ai-lock", action: "lock"},
        {name: "Suspend", icon: "moon-02"},
        {name: "Hibernate", icon: "snowflake"},
        {name: "Logout", icon: "logout-01", action: "logout"},
        {name: "Reboot", icon: "refresh", action: "reboot"},
        {name: "Shutdown", icon: "shut-down", action: "shutdown"}
    ];
}

// Run Luna apps through their API CLI; native session requests retain authorization and inhibitors.
function command(action, launcher) {
    if ((action === "screensaver" || action === "lock") && launcher) return [launcher, action];
    const captureMode = action.replace(/^screenshot-/, "");
    if (action !== captureMode && ["region", "screen", "window", "all"].includes(captureMode) && launcher)
        return [launcher, "screenshot", captureMode];
    if (action === "logout") return ["hyprctl", "eval", "hl.dispatch(hl.dsp.exit())"];
    if (action === "reboot") return ["systemctl", "reboot"];
    if (action === "shutdown") return ["systemctl", "poweroff"];
    return [];
}

// Match Super+Shift+F: retain Fastfetch's output until a silent keypress.
function aboutCommand() {
    return ["xdg-terminal-exec", "--app-id=luna-next-fastfetch", "--title=Fastfetch", "--", "bash", "-c",
        'fastfetch; status=$?; read -r -s -n 1; exit "$status"'];
}
