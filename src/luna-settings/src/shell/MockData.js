.pragma library

// Sample controls for the UI mock, independent of Luna's configuration contracts.
var titles = { home: "Home", appearance: "Appearance", login: "Login screen", lock: "Lock screen", desktop: "Desktop" };

function defaults(theme) {
    return {
        appearance: { font: theme.fonts.ui, scale: "100%" },
        login: { background: "Night", user: "Last signed-in user", session: "Hyprland", layout: "English (US)", showUsers: true },
        lock: { background: "Night", idle: "10 minutes", dpms: "30 seconds", clock: true, format: "24-hour" },
        desktop: { background: "Night", layout: "Tiling", inner: theme.appearance.gaps.inner, outer: theme.appearance.gaps.outer, rounding: theme.appearance.rounding, blur: theme.appearance.blur.enabled, bar: true }
    };
}

var sections = {
    home: [],
    appearance: [
        { title: "Text", rows: [
            { key: "font", label: "Font", type: "select", options: ["Outfit", "Inter", "System default"], keywords: "typography" },
            { key: "scale", label: "Size", type: "select", options: ["90%", "100%", "110%", "125%"], keywords: "text scaling" }
        ] },
        { title: "More", rows: [
            { type: "link", page: "login", label: "Login screen" },
            { type: "link", page: "lock", label: "Lock screen" }
        ] }
    ],
    login: [
        { title: "", rows: [{ key: "background", label: "Background", type: "select", options: ["Night", "Dusk", "Forest"], keywords: "wallpaper" }] },
        { title: "Sign-in", rows: [
            { key: "user", label: "Selected user", type: "select", options: ["Last signed-in user", "Tilak"], keywords: "account" },
            { key: "session", label: "Default session", type: "select", options: ["Hyprland", "Last used session"] },
            { key: "layout", label: "Keyboard layout", type: "select", options: ["English (US)", "English (UK)"], keywords: "language" },
            { key: "showUsers", label: "Show user list", type: "toggle", keywords: "accounts" }
        ] }
    ],
    lock: [
        { title: "", rows: [{ key: "background", label: "Background", type: "select", options: ["Night", "Dusk", "Forest"], keywords: "wallpaper" }] },
        { title: "Privacy", rows: [
            { key: "idle", label: "Lock after inactivity", type: "select", options: ["Never", "1 minute", "5 minutes", "10 minutes", "15 minutes", "30 minutes"], keywords: "automatic timeout" },
            { key: "dpms", label: "Turn off displays when locked", type: "select", options: ["Never", "15 seconds", "30 seconds", "1 minute", "5 minutes"], keywords: "power saving" }
        ] },
        { title: "Clock", rows: [
            { key: "clock", label: "Show clock", type: "toggle" },
            { key: "format", label: "Time format", type: "select", options: ["24-hour", "12-hour"] }
        ] }
    ],
    desktop: [
        { title: "", rows: [{ key: "background", label: "Wallpaper", type: "select", options: ["Night", "Dusk", "Forest"], keywords: "background" }] },
        { title: "Windows", rows: [
            { key: "layout", label: "Default layout", type: "select", options: ["Tiling", "Floating"] },
            { key: "inner", label: "Space between windows", type: "slider", max: 30, keywords: "inner gaps" },
            { key: "outer", label: "Space around windows", type: "slider", max: 40, keywords: "outer gaps" },
            { key: "rounding", label: "Corner radius", type: "slider", max: 24, keywords: "rounding" },
            { key: "blur", label: "Background blur", type: "toggle" }
        ] },
        { title: "Luna Bar", rows: [{ key: "bar", label: "Show bar", type: "toggle" }] }
    ]
};

function parentPage(page) { return page === "login" || page === "lock" ? "appearance" : page; }
function path(page) { return parentPage(page) === page ? titles[page] : "Appearance / " + titles[page]; }
function groups(page, theme) {
    return sections[page].map(section => ({
        page: page,
        title: section.title,
        rows: section.rows.map(row => {
            if (page !== "appearance" || row.key !== "font") return row;
            return Object.assign({}, row, { options: [theme.fonts.ui].concat(row.options.filter(option => option !== theme.fonts.ui)) });
        })
    }));
}

function search(query) {
    var results = [];
    var needle = query.trim().toLocaleLowerCase();
    if (!needle) return results;
    for (var entry of [
        { page: "appearance", key: "theme", label: "Theme", keywords: "style colors dark light" },
        { page: "appearance", key: "background", label: "Background", keywords: "wallpaper picture" }
    ]) {
        if ((entry.label + " " + entry.keywords + " Appearance").toLocaleLowerCase().includes(needle))
            results.push({ page: entry.page, key: entry.key, label: entry.label, path: path(entry.page) });
    }
    for (var page of ["appearance", "login", "lock"]) {
        for (var group of sections[page]) {
            for (var row of group.rows) {
                if (row.type === "link") continue;
                var haystack = [path(page), group.title, row.label, row.keywords || ""].join(" ").toLocaleLowerCase();
                if (haystack.includes(needle)) results.push({ page: page, key: row.key, label: row.label, path: path(page) });
            }
        }
    }
    return results;
}
