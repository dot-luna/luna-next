import QtQuick

Text {
    required property var theme
    color: theme.colors.foreground
    font.family: theme.fonts.ui
    font.pixelSize: 12
    wrapMode: Text.Wrap
}
