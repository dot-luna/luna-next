import QtQuick

// Local vector paths keep authentication independent of other shells and icon fonts.
Canvas {
    id: icon

    required property string name
    required property color ink
    implicitWidth: 20
    implicitHeight: 20

    onInkChanged: requestPaint()
    onNameChanged: requestPaint()
    onWidthChanged: requestPaint()
    onHeightChanged: requestPaint()
    onPaint: {
        const context = getContext("2d");
        context.reset();
        context.scale(width / 24, height / 24);
        context.strokeStyle = ink;
        context.lineWidth = 2;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        if (name === "lock") {
            context.moveTo(7, 11);
            context.lineTo(7, 7);
            context.arc(12, 7, 5, Math.PI, 0);
            context.lineTo(17, 11);
            context.moveTo(5, 11);
            context.lineTo(19, 11);
            context.lineTo(19, 21);
            context.lineTo(5, 21);
            context.closePath();
        } else if (name === "chevron-right") {
            context.moveTo(9, 6);
            context.lineTo(15, 12);
            context.lineTo(9, 18);
        }
        context.stroke();
    }
}
