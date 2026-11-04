.import "System.js" as System

function entries(stayAwake) {
    return [
        {name: "Apps", icon: "grid-view", route: "apps"},
        {name: "Insert", icon: "smile"},
        {name: "Learn", icon: "book-open-01"},
        {name: "Trigger", icon: "flash", route: "trigger", children: [
            {name: "Toggles", icon: "toggle-on", route: "toggles", children: [
                {name: "Stay awake", icon: "computer", action: "stay-awake", checked: stayAwake}
            ]}
        ]},
        {name: "Style", icon: "paint-board"},
        {name: "Setup", icon: "settings-02"},
        {name: "Install", icon: "download-01"},
        {name: "Remove", icon: "delete-02"},
        {name: "About", icon: "information-circle", action: "about"},
        {name: "System", icon: "power-service", route: "system", children: System.entries()}
    ];
}

function children(entries, route) {
    if (route === "root") return entries;
    for (const entry of entries) {
        if (entry.route === route) return entry.children || [];
        const nested = children(entry.children || [], route);
        if (nested.length) return nested;
    }
    return [];
}

// Empty searches show one level; typed searches include descendants and their path.
function search(entries, query, parents) {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return entries;
    parents = parents || [];
    let matches = [];
    for (const entry of entries) {
        const path = parents.concat([entry.name]);
        const text = path.join(" ").toLocaleLowerCase();
        if (words.every(word => text.includes(word)))
            matches.push(Object.assign({}, entry, {parentName: parents.join(" › ")}));
        matches = matches.concat(search(entry.children || [], query, path));
    }
    return matches;
}
