import QtQuick
import "MockData.js" as Data

QtObject {
    required property var theme
    property string page: "appearance"
    property string query: ""
    property var saved: Data.defaults(theme)
    property var draft: Data.defaults(theme)
    readonly property string parentPage: Data.parentPage(page)
    readonly property var groups: Data.groups(page)
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

}
