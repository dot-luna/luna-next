.pragma library

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
