// Native DesktopEntries already excludes Hidden and NoDisplay entries.
// Keep token matching separate from presentation so names and metadata share one search.
function find(entries, query) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return Array.from(entries).filter(entry => {
        if (!entry || entry.noDisplay || !entry.name || !entry.command || !entry.command.length)
            return false;
        const fields = [entry.name, entry.genericName || "", entry.comment || "", entry.id || ""]
            .concat(Array.from(entry.keywords || [])).join(" ").toLocaleLowerCase();
        return words.every(word => fields.includes(word));
    }).sort((left, right) => {
        const a = left.name.toLocaleLowerCase();
        const b = right.name.toLocaleLowerCase();
        const score = name => words.reduce((sum, word) => sum + (name.startsWith(word) ? 0 : name.includes(word) ? 1 : 2), 0);
        return score(a) - score(b) || a.localeCompare(b) || left.id.localeCompare(right.id);
    });
}

// Quickshell 0.3.2 execute() preserves the desktop working directory but ignores
// Terminal=true. Pass its already-parsed arguments to the system terminal launcher.
function launch(entry, detached) {
    if (!entry || !entry.command || !entry.command.length)
        return false;
    if (entry.runInTerminal) {
        detached({
            command: ["xdg-terminal-exec", "--"].concat(Array.from(entry.command)),
            workingDirectory: entry.workingDirectory || ""
        });
    } else {
        entry.execute();
    }
    return true;
}
