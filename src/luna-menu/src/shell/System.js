// Unsupported actions deliberately have no command.
function entries(stayAwake) {
    return [
        {name: "Screensaver", icon: "computer", action: "screensaver"},
        {name: "Lock", icon: "lock-key", action: "lock"},
        {name: "Stay awake", icon: "computer", action: "stay-awake", checked: stayAwake},
        {name: "Suspend", icon: "moon-02"},
        {name: "Hibernate", icon: "snowflake"},
        {name: "Logout", icon: "logout-01", action: "logout"},
        {name: "Reboot", icon: "refresh", action: "reboot"},
        {name: "Shutdown", icon: "power-service", action: "shutdown"}
    ];
}

// Run Luna apps through their API CLI; native session requests retain authorization and inhibitors.
function command(action, launcher) {
    if ((action === "screensaver" || action === "lock") && launcher) return [launcher, action];
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
