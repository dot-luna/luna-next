import QtQuick as Quick

Quick.Text {
    required property Theme theme

    font.family: theme.font
    font.pixelSize: 13
    color: theme.text
    textFormat: Quick.Text.PlainText
    wrapMode: Quick.Text.WordWrap
}
