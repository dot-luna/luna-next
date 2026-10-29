.pragma library

function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Validate app options; HOCON itself owns parsing, includes, and resolution.
// Omitted options use the renderer's safe defaults. Unknown options are ignored.
function validate(document) {
    if (!object(document))
        throw new Error("Expected a configuration object.");
    for (const section of ["wallpaper", "playback", "transition"]) {
        if (document[section] !== undefined && !object(document[section]))
            throw new Error(section + " must be an object.");
    }

    const wallpaper = document.wallpaper || {};
    if (wallpaper.source !== undefined && (typeof wallpaper.source !== "string"
        || wallpaper.source !== "" && (!wallpaper.source.startsWith("/")
            || /[\u0000-\u001f\u007f]/.test(wallpaper.source))))
        throw new Error("wallpaper.source must be an absolute local path or an empty string.");
    if (wallpaper.fit !== undefined && ["fill", "fit", "stretch", "center", "tile"].indexOf(wallpaper.fit) === -1)
        throw new Error("wallpaper.fit must be fill, fit, stretch, center, or tile.");
    if (wallpaper.background_color !== undefined && (typeof wallpaper.background_color !== "string"
        || !/^#[0-9a-f]{6}$/i.test(wallpaper.background_color)))
        throw new Error("wallpaper.background_color must be a #RRGGBB color.");

    const playback = document.playback || {};
    if (playback.pause_when_output_inactive !== undefined && typeof playback.pause_when_output_inactive !== "boolean")
        throw new Error("playback.pause_when_output_inactive must be true or false.");

    const transition = document.transition || {};
    if (transition.type !== undefined && ["none", "fade"].indexOf(transition.type) === -1)
        throw new Error("transition.type must be none or fade.");
    if (transition.duration_ms !== undefined && (!Number.isInteger(transition.duration_ms)
        || transition.duration_ms < 0 || transition.duration_ms > 2147483647))
        throw new Error("transition.duration_ms must be an integer from 0 to 2147483647.");
    return document;
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

function fileUrl(path) {
    return path ? "file://" + path.split("/").map(encodeURIComponent).join("/") : "";
}
