.pragma library

// Only compositor fullscreen on a visible workspace covers this output.
// Maximized windows and fullscreen clients on another workspace must keep it playing.
function fullscreenCovered(monitor, toplevels) {
    if (!monitor) return false;
    const regular = monitor.lastIpcObject?.activeWorkspace?.id;
    const special = monitor.lastIpcObject?.specialWorkspace?.id;
    // Internal fullscreen is bit 2; a client's fullscreen request alone may stay windowed.
    return Array.from(toplevels).some(toplevel => {
        const window = toplevel.lastIpcObject;
        return window && window.monitor === monitor.id && window.mapped !== false
            && window.hidden !== true && (window.fullscreen & 2) !== 0
            && (window.workspace?.id === regular || (special && window.workspace?.id === special));
    });
}

// Inspect contents rather than guessing from the filename. Qt handles ordinary
// images and GIF/WebP animation; mpvpaper also handles animated PNG.
function mediaKind(metadata) {
    const format = metadata.format?.format_name || "";
    const codec = metadata.streams?.[0]?.codec_name || "";
    if (codec === "gif" || codec === "webp")
        return "animated";
    if (!codec || format === "image2" || format.endsWith("_pipe"))
        return "image";
    return "video";
}

// Encode path segments so literal spaces, #, and ? remain filename characters.
function fileUrl(path) {
    return path ? "file://" + path.split("/").map(encodeURIComponent).join("/") : "";
}
