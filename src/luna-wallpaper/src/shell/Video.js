.pragma library

function sizing(fit) {
    const modes = {
        fill: {keepaspect: true, panscan: 1, unscaled: "no"},
        fit: {keepaspect: true, panscan: 0, unscaled: "no"},
        stretch: {keepaspect: false, panscan: 0, unscaled: "no"},
        center: {keepaspect: true, panscan: 0, unscaled: "yes"}
    };
    // Tiling is image-only; videos retain their native size for this mode.
    if (fit === "tile")
        return modes.center;
    return Object.prototype.hasOwnProperty.call(modes, fit) ? modes[fit] : modes.fill;
}

// Media paths are separate process arguments, never part of mpv's option string.
function options(fit, background, paused) {
    const mode = sizing(fit);

    return [
        "config=no load-scripts=no input-default-bindings=no input-terminal=no terminal=no",
        "loop-file=inf audio=no sub=no osc=no osd-level=0",
        "hwdec=auto scale=ewa_lanczossharp cscale=ewa_lanczossharp dscale=mitchell",
        "background=color background-color='" + background + "'",
        "pause=" + (paused ? "yes" : "no"),
        "input-ipc-server=./ipc",
        "keepaspect=" + (mode.keepaspect ? "yes" : "no")
            + " panscan=" + mode.panscan + " video-unscaled=" + mode.unscaled
    ].join(" ");
}

function videoReady(parameters) {
    return parameters !== null && typeof parameters === "object"
        && Number.isFinite(parameters.w) && parameters.w > 0
        && Number.isFinite(parameters.h) && parameters.h > 0;
}
