import QtQuick

// Apps supply one resolved Luna theme; this adapter never reads configuration files.
QtObject {
    required property var snapshot

    readonly property color surface: snapshot.colors.background
    readonly property color sidebar: snapshot.colors.dark_background
    readonly property color error: snapshot.colors.error
    readonly property color selected: snapshot.colors.selection
    readonly property color selectedText: snapshot.colors.selection_foreground
    readonly property color raised: snapshot.colors.lighter_background
    readonly property color text: snapshot.colors.bright_foreground
    readonly property color subtle: snapshot.colors.foreground
    readonly property color line: snapshot.colors.muted
    readonly property color accent: snapshot.colors.accent
    readonly property color accentText: snapshot.colors.accent_foreground
    readonly property string font: snapshot.fonts.ui
    readonly property int rounding: snapshot.appearance.rounding
    readonly property int borderWidth: snapshot.appearance.border_width
}
