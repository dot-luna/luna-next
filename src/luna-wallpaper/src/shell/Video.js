.pragma library

// Media paths are separate process arguments, never part of mpv's option string.
function options(fit, background, paused) {
    const sizing = {
        fill: "keepaspect=yes panscan=1 video-unscaled=no",
        fit: "keepaspect=yes panscan=0 video-unscaled=no",
        stretch: "keepaspect=no panscan=0 video-unscaled=no",
        center: "keepaspect=yes panscan=0 video-unscaled=yes"
    };
    let sizingOptions = sizing.fill;
    // Tiling is image-only; videos retain their native size for this mode.
    if (fit === "tile")
        sizingOptions = sizing.center;
    else if (Object.prototype.hasOwnProperty.call(sizing, fit))
        sizingOptions = sizing[fit];

    return [
        "config=no load-scripts=no input-default-bindings=no input-terminal=no terminal=no",
        "loop-file=inf audio=no sub=no osc=no osd-level=0",
        "hwdec=auto scale=ewa_lanczossharp cscale=ewa_lanczossharp dscale=mitchell",
        "background=color background-color='" + background + "'",
        "pause=" + (paused ? "yes" : "no"),
        "input-ipc-server=./ipc",
        sizingOptions
    ].join(" ");
}

function videoReady(parameters) {
    return parameters !== null && typeof parameters === "object"
        && Number.isFinite(parameters.w) && parameters.w > 0
        && Number.isFinite(parameters.h) && parameters.h > 0;
}
