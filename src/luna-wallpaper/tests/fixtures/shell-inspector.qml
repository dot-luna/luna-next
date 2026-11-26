
    IpcHandler {
        target: "test"
        property var knownImages: []
        property var surface: surfaces.instances[0]
        function state(): string { return stateFor(0); }
        function stateFor(index: int): string {
            const surface = surfaces.instances[index];
            const images = [], videos = [], seen = [];
            function visit(item) {
                if (!item || seen.indexOf(item) !== -1) return;
                seen.push(item);
                if (item.objectName === "fake-video") videos.push({source: item.sourcePath, paused: item.paused});
                if (item.source !== undefined && item.sourceSize !== undefined) {
                    if (knownImages.indexOf(item) === -1) knownImages.push(item);
                    images.push({id: knownImages.indexOf(item), source: String(item.source), status: item.status,
                        width: item.sourceSize.width, height: item.sourceSize.height,
                        displayWidth: item.width, displayHeight: item.height,
                        scale: item.parent.scale, opacity: item.parent.opacity,
                        fillMode: item.fillMode, smooth: item.smooth,
                        autoTransform: item.autoTransform || false, frameCount: item.frameCount || 0,
                        playing: item.playing || false, paused: item.paused || false,
                        frame: item.currentFrame || 0});
                }
                if (item.contentItem) visit(item.contentItem);
                for (const child of (item.children || [])) visit(child);
            }
            visit(surface);
            return JSON.stringify({settings: shell.wallpaperSettings, settingsStatus: shell.settingsStatus,
                renderSettings: surface.settings, status: surface.mediaStatus, kind: surface.kind,
                screen: surface.modelData.name,
                images: images, videos: videos, visible: surface.visible,
                fillModes: {fill: Image.PreserveAspectCrop, fit: Image.PreserveAspectFit,
                    stretch: Image.Stretch, center: Image.Pad, tile: Image.Tile},
                color: String(surface.color), width: surface.width, height: surface.height,
                dpr: surface.screen.devicePixelRatio});
        }
        function displays(): string {
            return JSON.stringify(surfaces.instances.map((_, index) => JSON.parse(stateFor(index))));
        }
        function outputs(count: int): void {
            surfaces.model = Quickshell.screens.slice(0, count);
        }
        function mediaStatus(index: int, value: string): void {
            surfaces.instances[index].mediaStatus = value;
        }
        function outputActive(value: bool): void {
            surface.monitor = {lastIpcObject: {dpmsStatus: value}};
        }
        function fullscreen(snapshot: string): void {
            const state = JSON.parse(snapshot);
            surface.monitor = state.monitor;
            surface.testToplevels = state.windows;
        }
        function decodeError(): void { surface.decoded(surface.currentImage, Image.Error); }
    }
