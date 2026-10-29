pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Wayland
import "Wallpaper.js" as Wallpaper

PanelWindow {
    id: surface

    property var settings: null
    property string mediaStatus: "error"
    property string kind: "image"
    property bool completed: false

    readonly property string sourcePath: settings?.wallpaper?.source ?? ""
    readonly property string fit: settings?.wallpaper?.fit ?? "fill"
    readonly property color backgroundColor: settings?.wallpaper?.background_color ?? "#000000"
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
        fade.stop();
        probe.active = false;
        image.active = false;
        video.active = false;
        mediaStatus = "error";
        console.warn("Wallpaper " + (screen?.name || "output") + ": " + message);
    }

    function apply() {
        probe.active = false;
        image.active = false;
        video.active = false;
        deadline.stop();
        fade.stop();
        image.opacity = 0;
        if (!settings || !sourcePath || !screen) {
            mediaStatus = !settings ? "error" : screen ? "ready" : "loading";
            return;
        }
        mediaStatus = "loading";
        deadline.start();
        probe.active = true;
    }

    function render(mediaKind) {
        kind = mediaKind;
        if (kind === "video") {
            deadline.stop(); // The video component owns its startup deadline.
            video.active = true;
        } else {
            image.active = true;
        }
    }

    function decoded(status) {
        if (!image.active)
            return;
        if (status === Image.Error) {
            // Let the decoder's native callback return before unloading it.
            const failedImage = image.item;
            Qt.callLater(function () {
                if (image.item === failedImage)
                    surface.fail("Cannot decode " + surface.sourcePath);
            });
        } else if (status === Image.Ready && mediaStatus === "loading") {
            deadline.stop();
            mediaStatus = "ready";
            if (fadeDuration > 0)
                fade.start();
            else
                image.opacity = 1;
        }
    }

    onSettingsChanged: if (completed)
        Qt.callLater(apply)
    onScreenChanged: if (completed)
        Qt.callLater(apply)
    Component.onCompleted: {
        completed = true;
        apply();
    }

    Timer {
        id: deadline
        interval: 20000
        onTriggered: surface.fail("Media loading timed out: " + surface.sourcePath)
    }

    Loader {
        id: probe
        active: false
        sourceComponent: Component {
            MediaProbe {
                id: inspection
                sourcePath: surface.sourcePath
                onIdentified: kind => {
                    if (probe.item === inspection)
                        surface.render(kind);
                }
                onFailed: message => {
                    if (probe.item !== inspection)
                        return;
                    Qt.callLater(function () {
                        surface.fail(message);
                    });
                }
            }
        }
    }

    NumberAnimation {
        id: fade
        target: image
        property: "opacity"
        from: 0
        to: 1
        duration: surface.fadeDuration
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

        Loader {
            id: image
            width: parent.width / surface.nativeScale
            height: parent.height / surface.nativeScale
            scale: surface.nativeScale
            transformOrigin: Item.TopLeft
            active: false
            opacity: 0
            sourceComponent: surface.kind === "animated" ? animated : still
            onLoaded: surface.decoded(item.status)
        }
    }

    Component {
        id: still
        Image {
            source: Wallpaper.fileUrl(surface.sourcePath)
            fillMode: surface.imageFillMode
            asynchronous: true
            cache: false
            autoTransform: true
            smooth: surface.fit !== "center" && surface.fit !== "tile"
            mipmap: smooth
            sourceSize: /\.svg$/i.test(surface.sourcePath) && smooth ? Qt.size(surface.width * (surface.screen?.devicePixelRatio || 1), surface.height * (surface.screen?.devicePixelRatio || 1)) : undefined
            onStatusChanged: surface.decoded(status)
        }
    }

    Component {
        id: animated
        AnimatedImage {
            source: Wallpaper.fileUrl(surface.sourcePath)
            fillMode: surface.imageFillMode
            asynchronous: true
            cache: false
            smooth: surface.fit !== "center" && surface.fit !== "tile"
            mipmap: smooth
            paused: surface.pauseMedia
            onStatusChanged: surface.decoded(status)
            function repeatAnimation() {
                if (status === Image.Ready && frameCount > 1) {
                    currentFrame = 0;
                    playing = true;
                }
            }
            onPlayingChanged: if (!playing)
                Qt.callLater(repeatAnimation)
        }
    }

    Loader {
        id: video
        active: false
        sourceComponent: Component {
            VideoWallpaper {
                sourcePath: surface.sourcePath
                outputName: surface.screen?.name || ""
                fit: surface.fit
                backgroundColor: surface.backgroundColor
                paused: surface.pauseMedia
                onStatusChanged: surface.mediaStatus = status
                onFailed: message => {
                    const failedPlayer = video.item;
                    Qt.callLater(function () {
                        if (video.item === failedPlayer)
                            surface.fail(message);
                    });
                }
            }
        }
        onStatusChanged: if (status === Loader.Error)
            surface.fail("Could not load the video backend")
    }
}
