import QtQuick
import "MockData.js" as Data

QtObject {
    required property var theme
    required property var library
    property string page: "appearance"
    property string query: ""
    property var saved: Data.defaults(theme, library)
    property var draft: Data.defaults(theme, library)
    readonly property string parentPage: Data.parentPage(page)
    readonly property var groups: Data.groups(page, theme)
    readonly property var results: Data.search(query)

    function navigate(destination) {
        page = destination;
        query = "";
    }

    function setValue(page, key, value) {
        // Keep unchanged gallery models stable so keyboard focus survives selection.
        const next = Object.assign({}, draft);
        next[page] = Object.assign({}, draft[page]);
        next[page][key] = value;
        draft = next;
    }

    function addTheme(repository) {
        const url = repository.trim();
        if (!/^https:\/\/[^\s/]+\/[^\s]+$/.test(url)) return "Enter an HTTPS repository URL.";
        const name = url.replace(/\/$/, "").split("/").pop().replace(/\.git$/, "");
        if (draft.appearance.themes.some(entry => entry.name === name)) return "This theme is already added.";
        // Imported cards are stand-ins until repository installation is implemented.
        const entry = Object.assign({}, Data.themeCard(theme), { name: name, repository: url });
        setValue("appearance", "themes", draft.appearance.themes.concat([entry]));
        return "";
    }

    function removeTheme(name) {
        if (name === saved.appearance.theme) return;
        setValue("appearance", "themes", draft.appearance.themes.filter(entry => entry.name !== name));
        if (draft.appearance.theme === name) setValue("appearance", "theme", saved.appearance.theme);
    }

}
