function webAddress(value) {
    if (/^https?:\/\/[^\s/?#]+(?:[/?#]\S*)?$/i.test(value)) return value;
    if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]\S*)?$/i.test(value))
        return "https://" + value;
    return "";
}

// Explicit terminal/URL actions lead; browser search always follows matching menu entries.
function results(matches, query) {
    const text = query.trim();
    if (!text) return matches;
    const entries = [];
    if (text.startsWith("!") && text.slice(1).trim()) {
        entries.push({name: "Run in terminal", icon: "command-line", queryAction: "terminal", value: text.slice(1).trim()});
    } else {
        const address = webAddress(text);
        if (address) entries.push({name: "Open in browser", icon: "globe-02", queryAction: "url", value: address});
    }
    return entries.concat(matches, [{name: "Search in browser", icon: "search-01", queryAction: "search", value: text}]);
}

// Only ! runs shell syntax. Keep output until a silent keypress, as About does;
// the requested command stays one argument to the user’s login shell.
function command(entry, shell) {
    if (entry.queryAction === "terminal" && entry.value)
        return ["xdg-terminal-exec", "--", "bash", "-c",
            '"$1" -lc "$2"; status=$?; read -r -s -n 1; exit "$status"',
            "luna-menu", shell || "/bin/sh", entry.value];
    if (entry.queryAction === "url" && webAddress(entry.value))
        return ["xdg-open", webAddress(entry.value)];
    if (entry.queryAction === "search" && entry.value)
        return ["xdg-open", "https://duckduckgo.com/?q=" + encodeURIComponent(entry.value)];
    return [];
}
