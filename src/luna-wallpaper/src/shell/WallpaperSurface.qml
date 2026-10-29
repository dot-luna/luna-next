pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland

// Own the image slots and reusable video backend for this output.
PanelWindow {
    id: surface

    property var settings: null
    property string mediaStatus: "error"
    property string kind: "image"
    property bool completed: false
    property string requestedSource: ""
    // The old visible slot survives decoding and, when enabled, the replacement fade.
    property var currentImage: null
    property var pendingImage: null
    property var retiringImage: null
    // Deferred failures belong to one request, even when its Loader slot is reused.
    property int generation: 0

    readonly property string sourcePath: settings?.wallpaper?.source ?? ""
    readonly property string fit: settings?.wallpaper?.fit ?? "fill"
    readonly property color backgroundColor: settings?.wallpaper?.background_color ?? "#000000"
    // Center/tile preserve physical source pixels rather than enlarging them on HiDPI.
    readonly property real nativeScale: fit === "center" || fit === "tile" ? 1 / (screen?.devicePixelRatio || 1) : 1
    readonly property int imageFillMode: {
        switch (fit) {
        case "fill": return Image.PreserveAspectCrop;
        case "fit": return Image.PreserveAspectFit;
        case "stretch": return Image.Stretch;
        case "tile": return Image.Tile;
        default: return Image.Pad;
        }
    }
    readonly property int fadeDuration: (settings?.transition?.type ?? "fade") === "fade" ? (settings?.transition?.duration_ms ?? 200) : 0

    readonly property bool hasHyprland: !!Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE")
    readonly property var monitor: hasHyprland && screen ? Hyprland.monitorFor(screen) : null
    readonly property bool outputActive: !monitor || !monitor.lastIpcObject || (monitor.lastIpcObject.dpmsStatus !== false && monitor.lastIpcObject.disabled !== true)
    readonly property bool pauseMedia: (settings?.playback?.pause_when_output_inactive ?? true) && !outputActive

    visible: screen !== null
    anchors {
        top: true
        bottom: true
        left: true
        right: true
    }
    exclusionMode: ExclusionMode.Ignore
    color: mediaStatus === "error" ? "#000000" : backgroundColor
    mask: Region {}
    WlrLayershell.layer: WlrLayer.Background
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    WlrLayershell.namespace: "luna-next-wallpaper"

    function fail(message) {
        deadline.stop();
        probe.active = false;
        if (pendingImage) {
            pendingImage.active = false;
            pendingImage = null;
        }
        if (video.item?.status === "error")
            video.active = false;
        mediaStatus = "error";
        console.warn("Wallpaper " + (screen?.name || "output") + ": " + message);
    }

    function finishFade() {
        if (retiringImage && retiringImage !== currentImage)
            retiringImage.active = false;
        retiringImage = null;
    }

    function apply(force) {
        const nextSource = settings?.wallpaper?.source ?? "";
        // Fit, color, and playback settings update through their existing bindings.
        if (!force && nextSource === requestedSource && mediaStatus !== "error")
            return;
        generation++;
        probe.active = false;
        requestedSource = nextSource;
        deadline.stop();
        fade.stop();
        finishFade();
        if (currentImage)
            currentImage.opacity = 1;
        if (pendingImage) {
            pendingImage.active = false;
            pendingImage = null;
        }
        // mpvpaper selects its output at startup, so a screen change needs a new backend.
        if (force)
            video.active = false;
        if (!settings || !requestedSource || !screen) {
            if (currentImage)
                currentImage.active = false;
            currentImage = null;
            video.active = false;
            mediaStatus = !settings ? "error" : screen ? "ready" : "loading";
            return;
        }
        // Reverting a failed replacement can reuse the image that remained visible.
        if (!force && currentImage?.sourcePath === requestedSource && currentImage.item?.status === Image.Ready) {
            video.active = false;
            kind = currentImage.mediaKind;
            mediaStatus = "ready";
            return;
        }
        mediaStatus = "loading";
        deadline.start();
        probe.active = true;
    }

    function render(mediaKind) {
        kind = mediaKind;
        if (kind === "video") {
            deadline.stop(); // The video component owns the remaining loading deadline.
            if (video.item && video.item.status !== "error" && !video.item.stopping) {
                // Changing media through IPC keeps the player's existing layer surface.
                video.item.load(requestedSource);
                videoStatusChanged();
            } else {
                video.active = false;
                video.setSource("VideoWallpaper.qml", {
                    sourcePath: requestedSource,
                    outputName: screen.name,
                    fit: Qt.binding(() => surface.fit),
                    backgroundColor: Qt.binding(() => surface.backgroundColor),
                    paused: Qt.binding(() => surface.pauseMedia)
                });
                video.active = true;
            }
        } else {
            // Decode into the spare slot before releasing the visible image.
            const next = currentImage === firstImage ? secondImage : firstImage;
            next.active = false;
            next.sourcePath = requestedSource;
            next.mediaKind = kind;
            next.opacity = 0;
            next.z = 1;
            pendingImage = next;
            next.active = true;
        }
    }

    function decoded(image, status) {
        if (image !== pendingImage && image !== currentImage)
            return;
        if (status === Image.Error) {
            const request = generation;
            Qt.callLater(function () {
                if (generation === request && (image === pendingImage || image === currentImage)) {
                    if (image === currentImage) {
                        currentImage.active = false;
                        currentImage = null;
                    }
                    surface.fail("Cannot decode " + surface.sourcePath);
                }
            });
        } else if (status === Image.Ready && image === pendingImage && mediaStatus === "loading") {
            deadline.stop();
            const previous = currentImage;
            currentImage = image;
            pendingImage = null;
            const replacingVideo = video.active;
            video.active = false;
            mediaStatus = "ready";
            if (previous)
                previous.z = 0;
            // The fade covers Qt image slots; mpvpaper's separate surface is already released.
            if (!replacingVideo && fadeDuration > 0) {
                retiringImage = previous;
                fade.target = image;
                fade.start();
            } else {
                image.opacity = 1;
                if (previous)
                    previous.active = false;
            }
        }
    }

    function videoStatusChanged() {
        if (kind !== "video" || !video.item || video.item.sourcePath !== requestedSource)
            return;
        mediaStatus = video.item.status;
        if (mediaStatus === "ready" && currentImage) {
            currentImage.active = false;
            currentImage = null;
        }
    }

    onSettingsChanged: if (completed)
        apply(false)
    onScreenChanged: if (completed)
        apply(true)
    Component.onCompleted: {
        completed = true;
        apply(false);
    }

    Timer {
        id: deadline
        interval: 20000
        onTriggered: surface.fail("Media loading timed out: " + surface.sourcePath)
    }

    Loader {
        id: probe
        active: false
        // A new request destroys the old probe; callbacks must still verify item identity.
        sourceComponent: Component {
            MediaProbe {
                id: inspection
                sourcePath: surface.requestedSource
                onIdentified: kind => {
                    if (probe.item === inspection)
                        surface.render(kind);
                }
                onFailed: message => {
                    if (probe.item !== inspection)
                        return;
                    const request = surface.generation;
                    Qt.callLater(function () {
                        if (surface.generation === request)
                            surface.fail(message);
                    });
                }
            }
        }
    }

    NumberAnimation {
        id: fade
        property: "opacity"
        from: 0
        to: 1
        duration: surface.fadeDuration
        onFinished: surface.finishFade()
    }

    Timer {
        interval: 2000
        repeat: true
        running: surface.hasHyprland && !!surface.sourcePath && surface.kind !== "image" && surface.mediaStatus !== "error" && (surface.settings?.playback?.pause_when_output_inactive ?? true)
        triggeredOnStart: true
        onTriggered: Hyprland.refreshMonitors()
    }

    Item {
        anchors.fill: parent
        clip: true

        WallpaperImage {
            id: firstImage
            width: parent.width / surface.nativeScale
            height: parent.height / surface.nativeScale
            scale: surface.nativeScale
            transformOrigin: Item.TopLeft
            active: false
            opacity: 0
            fit: surface.fit
            fillMode: surface.imageFillMode
            paused: surface.pauseMedia
            pixelRatio: surface.screen?.devicePixelRatio || 1
            onDecoded: status => surface.decoded(firstImage, status)
        }

        WallpaperImage {
            id: secondImage
            width: parent.width / surface.nativeScale
            height: parent.height / surface.nativeScale
            scale: surface.nativeScale
            transformOrigin: Item.TopLeft
            active: false
            opacity: 0
            fit: surface.fit
            fillMode: surface.imageFillMode
            paused: surface.pauseMedia
            pixelRatio: surface.screen?.devicePixelRatio || 1
            onDecoded: status => surface.decoded(secondImage, status)
        }
    }

    Loader {
        id: video
        active: false
        onLoaded: surface.videoStatusChanged()
        onStatusChanged: if (status === Loader.Error)
            surface.fail("Could not load the video backend")
    }

    Connections {
        target: video.item
        function onStatusChanged() { surface.videoStatusChanged(); }
        function onFailed(message) {
            const failedPlayer = video.item;
            Qt.callLater(function () {
                if (video.item === failedPlayer)
                    surface.fail(message);
            });
        }
    }
}
