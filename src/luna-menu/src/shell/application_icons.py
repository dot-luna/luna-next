"""Resolve one batch of desktop icons without inheriting Quickshell's Qt icon cache."""

import json
import os
from pathlib import Path
import sys

import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk


def resolve_icons(names):
    """Return file URLs, or an empty string for unavailable icons, keyed by icon name.

    GTK supplies XDG search paths and theme inheritance. A fresh process sees icons
    installed after a previous lookup failed; file revisions also refresh images
    replaced at the same path without disabling Qt's cache for unchanged images.
    """
    theme = Gtk.IconTheme.new()
    settings = Gtk.Settings.get_default()
    theme.set_custom_theme(os.environ.get("QS_ICON_THEME")
                           or (settings.get_property("gtk-icon-theme-name") if settings else "hicolor"))
    sources = {}
    for name in dict.fromkeys(names):
        path = Path(name) if name.startswith("/") else None
        if path is None:
            icon = theme.lookup_icon(name, 32, Gtk.IconLookupFlags.FORCE_SIZE)
            if icon and icon.get_filename():
                path = Path(icon.get_filename())
        sources[name] = ""
        if path is not None:
            try:
                stat = path.stat()
                if path.is_file():
                    sources[name] = f"{path.as_uri()}?v={stat.st_mtime_ns}-{stat.st_ctime_ns}-{stat.st_size}"
            except OSError:
                # Installation/removal can race the lookup; the next refresh retries.
                pass
    return sources


if __name__ == "__main__":
    print(json.dumps(resolve_icons(json.load(sys.stdin))))
