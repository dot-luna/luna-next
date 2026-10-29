use serde_json::{Value, json};

pub(super) fn dark() -> Value {
    json!({
        "colors": {
            "accent": "#7aa2f7",
            "accent_foreground": "#1a1b26",
            "background": "#1a1b26",
            "bright_foreground": "#c0caf5",
            "comment": "#bd8b7b",
            "dark_background": "#13141c",
            "dark_foreground": "#565f89",
            "darker_background": "#0e0e14",
            "error": "#f7768e",
            "error_emphasis": "#ff7a93",
            "error_foreground": "#1a1b26",
            "foreground": "#a9b1d6",
            "info": "#449dab",
            "info_emphasis": "#0db9d7",
            "info_foreground": "#1a1b26",
            "light_foreground": "#b4bee6",
            "lighter_background": "#24283b",
            "link": "#7aa2f7",
            "link_emphasis": "#7da6ff",
            "mode": "dark",
            "muted": "#414868",
            "notice": "#eb927b",
            "notice_foreground": "#1a1b26",
            "secondary_accent": "#ad8ee6",
            "secondary_accent_emphasis": "#bb9af7",
            "secondary_accent_foreground": "#1a1b26",
            "selection": "#292e42",
            "selection_foreground": "#c0caf5",
            "success": "#9ece6a",
            "success_emphasis": "#b9f27c",
            "success_foreground": "#1a1b26",
            "warning": "#e0af68",
            "warning_emphasis": "#ff9e64",
            "warning_foreground": "#1a1b26"
        },
        "fonts": {
            "mono": "Iosevka Nerd Font",
            "ui": "Outfit"
        },
        "wallpaper": {
            "sources": []
        },
        "appearance": {
            "gaps": {
                "inner": 5,
                "outer": 5
            },
            "border_width": 1,
            "rounding": 0,
            "opacity": {
                "active": 0.9,
                "inactive": 0.85,
                "fullscreen": 1
            },
            "blur": {
                "enabled": true,
                "passes": 3,
                "size": 10
            },
            "shadow": {
                "enabled": true,
                "range": 12,
                "falloff": 3
            }
        }
    })
}

pub(super) fn light_colors() -> Value {
    json!({
        "accent": "#34548a",
        "accent_foreground": "#ffffff",
        "background": "#e1e2e7",
        "bright_foreground": "#1a1b26",
        "comment": "#665b55",
        "dark_background": "#d5d6db",
        "dark_foreground": "#9699a3",
        "darker_background": "#c4c5cb",
        "error": "#a52746",
        "error_emphasis": "#8f1734",
        "error_foreground": "#ffffff",
        "foreground": "#343b58",
        "info": "#176879",
        "info_emphasis": "#0d5868",
        "info_foreground": "#ffffff",
        "light_foreground": "#292e42",
        "lighter_background": "#f0f0f3",
        "link": "#34548a",
        "link_emphasis": "#264477",
        "mode": "light",
        "muted": "#b4b5bf",
        "notice": "#934c2b",
        "notice_foreground": "#ffffff",
        "secondary_accent": "#6948a3",
        "secondary_accent_emphasis": "#58358f",
        "secondary_accent_foreground": "#ffffff",
        "selection": "#b7c1df",
        "selection_foreground": "#1a1b26",
        "success": "#386321",
        "success_emphasis": "#2c5318",
        "success_foreground": "#ffffff",
        "warning": "#805400",
        "warning_emphasis": "#704700",
        "warning_foreground": "#ffffff"
    })
}
