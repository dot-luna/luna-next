pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import "Wallpaper.js" as Wallpaper

// Own the image slots and reusable video backend for this output.
PanelWindow {
    id: surface

    property var settings: null
    property string mediaStatus: "error"
    property string kind: "image"
    property bool completed: false
    property string requestedSource: ""
    // Keep the visible slot until its replacement has decoded.
    property var currentImage: null
    property var pendingImage: null
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

    readonly property bool hasHyprland: !!Quickshell.env("HYPRLAND_INSTANCE_SIGNATURE")
    readonly property var monitor: hasHyprland && screen ? Hyprland.monitorFor(screen) : null
    readonly property bool outputActive: !monitor || !monitor.lastIpcObject || (monitor.lastIpcObject.dpmsStatus !== false && monitor.lastIpcObject.disabled !== true)
    readonly property bool fullscreenCovered: Wallpaper.fullscreenCovered(monitor, Hyprland.toplevels.values)
    readonly property bool pauseMedia: fullscreenCovered || ((settings?.playback?.pause_when_output_inactive ?? true) && !outputActive)

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
    WlrLayershell.namespace: "luna-wallpaper"

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

    function apply(force) {
        const nextSource = settings?.wallpaper?.source ?? "";
        // Fit, color, and playback settings update through their existing bindings.
        if (!force && nextSource === requestedSource && mediaStatus !== "error")
            return;
        generation++;
        probe.active = false;
        requestedSource = nextSource;
        deadline.stop();
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
            next.visible = false;
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
            video.active = false;
            image.visible = true;
            mediaStatus = "ready";
            if (previous)
                previous.active = false;
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

    Connections {
        target: Hyprland
        enabled: surface.hasHyprland && surface.kind !== "image" && !!surface.sourcePath
        onEnabledChanged: if (enabled) {
            Hyprland.refreshMonitors();
            Hyprland.refreshToplevels();
        }
        function onRawEvent(event) {
            if (["fullscreen", "workspacev2", "focusedmon", "focusedmonv2", "activespecial",
                 "activespecialv2", "movewindowv2", "openwindow", "closewindow",
                 "monitoraddedv2", "monitorremoved"].includes(event.name)) {
                Hyprland.refreshMonitors();
                Hyprland.refreshToplevels();
            }
        }
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
