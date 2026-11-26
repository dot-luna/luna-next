pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import "BikramSambat.js" as BikramSambat

// A read-only month view in AD or BS; each day also shows the other calendar's date, small.
// Left/Right change month; clicking the title returns to today.
FocusScope {
    id: view
    required property var theme
    /** "ad" or "bs"; switching keeps the period currently shown. */
    property string mode: "ad"
    property date today: new Date()
    property int adYear: today.getFullYear()
    property int adMonth: today.getMonth()
    // 0 when today is outside the bundled BS table; the BS view is then unavailable.
    property int bsYear: 0
    property int bsMonth: 0
    readonly property bool bs: mode === "bs" && bsYear > 0
    readonly property int firstDay: Qt.locale().firstDayOfWeek % 7
    readonly property var days: {
        const first = bs ? BikramSambat.toAd(bsYear, bsMonth, 1) : new Date(adYear, adMonth, 1);
        const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - (first.getDay() - firstDay + 7) % 7);
        const current = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
        const result = [];
        for (let i = 0; i < 42; i++) {
            const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            const other = BikramSambat.fromAd(date);
            result.push({
                date: date,
                bs: other,
                inMonth: bs ? !!other && other.month === bsMonth : date.getMonth() === adMonth,
                today: date.getTime() === current
            });
        }
        return result;
    }
    readonly property int cellWidth: 46
    readonly property int cellHeight: 46
    signal dismissed()

    implicitWidth: 7 * cellWidth + 2 * 16
    implicitHeight: column.implicitHeight + 2 * 16

    function reset() {
        today = new Date();
        adYear = today.getFullYear();
        adMonth = today.getMonth();
        const converted = BikramSambat.fromAd(today);
        bsYear = converted ? converted.year : 0;
        bsMonth = converted ? converted.month : 0;
    }
    function shift(delta) {
        if (bs) {
            const index = bsYear * 12 + bsMonth - 1 + delta;
            const year = Math.floor(index / 12);
            if (!BikramSambat.daysInMonth(year, index % 12 + 1)) return;
            bsYear = year;
            bsMonth = index % 12 + 1;
        } else {
            const next = new Date(adYear, adMonth + delta, 1);
            adYear = next.getFullYear();
            adMonth = next.getMonth();
        }
        slide.direction = delta;
        slide.restart();
    }
    function switchTo(next) {
        if (next === mode) return;
        // Anchor on today when it is in the shown month, otherwise on a day inside it,
        // so the other calendar opens on the same period.
        const shown = days.find(day => day.today && day.inMonth) || days.find(day => day.inMonth);
        const middle = shown.date;
        const converted = BikramSambat.fromAd(middle);
        if (next === "bs" && !converted) return;
        mode = next;
        adYear = middle.getFullYear();
        adMonth = middle.getMonth();
        if (converted) {
            bsYear = converted.year;
            bsMonth = converted.month;
        }
    }
    function showToday() {
        reset();
    }
    function title() {
        return bs ? BikramSambat.monthNames[bsMonth - 1] + " " + bsYear
                  : Qt.locale().standaloneMonthName(adMonth) + " " + adYear;
    }
    // The other calendar's months covered by this view, such as "Kartik – Mangsir 2083".
    function subtitle() {
        const inside = days.filter(day => day.inMonth);
        if (!inside.length) return "";
        const first = inside[0], last = inside[inside.length - 1];
        if (bs) {
            const a = Qt.locale().standaloneMonthName(first.date.getMonth(), Locale.ShortFormat);
            const b = Qt.locale().standaloneMonthName(last.date.getMonth(), Locale.ShortFormat);
            return (a === b ? a : a + " – " + b) + " " + last.date.getFullYear();
        }
        if (!first.bs || !last.bs) return "";
        const a = BikramSambat.monthNames[first.bs.month - 1];
        const b = BikramSambat.monthNames[last.bs.month - 1];
        return (a === b ? a : a + " – " + b) + " " + last.bs.year;
    }

    Keys.onEscapePressed: dismissed()
    Keys.onLeftPressed: shift(-1)
    Keys.onRightPressed: shift(1)

    component NavButton: Button {
        id: nav
        required property string iconName
        width: 28
        height: 28
        padding: 0
        focusPolicy: Qt.NoFocus
        HoverHandler { cursorShape: Qt.PointingHandCursor }
        background: null
        contentItem: Item {
            opacity: nav.hovered ? 1 : 0.6
            Behavior on opacity { NumberAnimation { duration: 100 } }
            Icon {
                anchors.centerIn: parent
                width: 16
                height: 16
                name: nav.iconName
                ink: view.theme.colors.foreground
            }
        }
    }
    component ModeButton: Button {
        id: choice
        required property string value
        readonly property bool selected: view.mode === value
        padding: 0
        leftPadding: 4
        rightPadding: 4
        height: 28
        focusPolicy: Qt.StrongFocus
        onClicked: view.switchTo(value)
        Keys.onReturnPressed: click()
        Keys.onEnterPressed: click()
        HoverHandler { cursorShape: Qt.PointingHandCursor }
        background: Rectangle {
            color: "transparent"
            radius: Math.min(view.theme.appearance.rounding, height / 2)
            border.width: choice.visualFocus ? 1 : 0
            border.color: view.theme.colors.accent
        }
        contentItem: Text {
            text: choice.value.toUpperCase()
            color: choice.selected ? view.theme.colors.accent : view.theme.colors.foreground
            opacity: choice.selected ? 1 : choice.hovered ? 0.85 : 0.5
            font.family: view.theme.fonts.ui
            font.pixelSize: 12
            font.bold: choice.selected
            verticalAlignment: Text.AlignVCenter
            Behavior on opacity { NumberAnimation { duration: 100 } }
        }
    }

    Column {
        id: column
        x: 16
        y: 16
        width: view.width - 32
        spacing: 10

        Item {
            width: parent.width
            height: 40
            Button {
                id: title
                objectName: "calendarTitle"
                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                focusPolicy: Qt.NoFocus
                padding: 0
                Accessible.name: "Show today"
                onClicked: view.showToday()
                HoverHandler { cursorShape: Qt.PointingHandCursor }
                background: null
                contentItem: Column {
                    spacing: 1
                    Text {
                        objectName: "calendarHeading"
                        text: view.title()
                        color: view.theme.colors.foreground
                        font.family: view.theme.fonts.ui
                        font.pixelSize: 16
                        font.bold: true
                    }
                    Text {
                        text: view.subtitle()
                        color: view.theme.colors.foreground
                        opacity: 0.55
                        font.family: view.theme.fonts.ui
                        font.pixelSize: 11
                    }
                }
            }
            Row {
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                spacing: 2
                ModeButton { objectName: "modeAd"; value: "ad"; Accessible.name: "Gregorian calendar" }
                ModeButton { objectName: "modeBs"; value: "bs"; Accessible.name: "Bikram Sambat calendar" }
                Item { width: 6; height: 1 }
                NavButton {
                    objectName: "previousMonth"
                    iconName: "arrow-left-01"
                    Accessible.name: "Previous month"
                    onClicked: view.shift(-1)
                }
                NavButton {
                    objectName: "nextMonth"
                    iconName: "arrow-right-01"
                    Accessible.name: "Next month"
                    onClicked: view.shift(1)
                }
            }
        }

        Row {
            Repeater {
                model: 7
                delegate: Text {
                    required property int index
                    width: view.cellWidth
                    height: 22
                    text: Qt.locale().dayName((view.firstDay + index) % 7, Locale.ShortFormat).slice(0, 2)
                    color: view.theme.colors.foreground
                    opacity: 0.55
                    font.family: view.theme.fonts.ui
                    font.pixelSize: 12
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
            }
        }

        Grid {
            id: grid
            objectName: "monthGrid"
            columns: 7
            transform: Translate { id: offset }
            Repeater {
                model: view.days
                delegate: Item {
                    id: day
                    required property var modelData
                    readonly property string primary: view.bs ? (modelData.bs ? String(modelData.bs.day) : "") : String(modelData.date.getDate())
                    readonly property string secondary: view.bs ? String(modelData.date.getDate()) : (modelData.bs ? String(modelData.bs.day) : "")
                    width: view.cellWidth
                    height: view.cellHeight
                    opacity: modelData.inMonth ? 1 : 0.35
                    Rectangle {
                        anchors.centerIn: parent
                        width: 40
                        height: 40
                        radius: Math.min(view.theme.appearance.rounding, height / 2)
                        color: "transparent"
                        border.width: 1
                        border.color: view.theme.colors.accent
                        opacity: day.modelData.today ? 1 : 0
                        Behavior on opacity { NumberAnimation { duration: 140 } }
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.verticalCenterOffset: -5
                        text: day.primary
                        color: day.modelData.today ? view.theme.colors.accent : view.theme.colors.foreground
                        font.family: view.theme.fonts.ui
                        font.pixelSize: 15
                        font.bold: day.modelData.today
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.verticalCenterOffset: 11
                        text: day.secondary
                        color: day.modelData.today ? view.theme.colors.accent : view.theme.colors.foreground
                        opacity: 0.55
                        font.family: view.theme.fonts.ui
                        font.pixelSize: 10
                    }
                }
            }
        }
    }

    // A short directional slide makes month changes legible without delaying input.
    ParallelAnimation {
        id: slide
        property int direction: 1
        NumberAnimation { target: offset; property: "x"; from: 10 * slide.direction; to: 0; duration: 180; easing.type: Easing.OutCubic }
        NumberAnimation { target: grid; property: "opacity"; from: 0.4; to: 1; duration: 180 }
    }
}
