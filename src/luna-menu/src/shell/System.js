// Preserve the old Luna System list; unsupported actions deliberately have no command.
const entries = [
    {name: "Screensaver", icon: "computer"},
    {name: "Lock", icon: "lock-key"},
    {name: "Suspend", icon: "moon-02"},
    {name: "Hibernate", icon: "snowflake"},
    {name: "Logout", icon: "logout-01", action: "logout"},
    {name: "Reboot", icon: "refresh", action: "reboot"},
    {name: "Shutdown", icon: "power-service", action: "shutdown"}
];

// Use normal session/systemd requests so authorization and inhibitors still apply.
function command(action) {
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
