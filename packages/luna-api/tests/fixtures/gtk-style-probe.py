import json
import sys
import warnings

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk

warnings.filterwarnings("ignore", category=DeprecationWarning)
Gtk.init([])
provider = Gtk.CssProvider()
provider.load_from_path(sys.argv[1])
Gtk.StyleContext.add_provider_for_screen(
    Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_USER
)


def hex_color(value):
    return "#" + "".join(
        f"{round(channel * 255):02x}" for channel in (value.red, value.green, value.blue)
    )


def sample(widget, state):
    context = widget.get_style_context()
    context.set_state(state)
    background = context.get_background_color(state)
    return {
        "foreground": hex_color(context.get_color(state)),
        "background": hex_color(background),
        "alpha": background.alpha,
        "image": context.get_property("background-image", state) is not None,
        "radius": context.get_property("border-radius", state),
    }


circular = Gtk.Button()
circular.get_style_context().add_class("circular")
model = Gtk.ModelButton(text="Menu action")
legacy = Gtk.Button(label="Menu action")
for name in ("menuitem", "button", "flat"):
    legacy.get_style_context().add_class(name)

normal = Gtk.StateFlags.NORMAL
hover = Gtk.StateFlags.PRELIGHT
backdrop = Gtk.StateFlags.BACKDROP
selected = Gtk.StateFlags.SELECTED
disabled = Gtk.StateFlags.INSENSITIVE
result = {
    "circular": {
        "normal": sample(circular, normal),
        "hover": sample(circular, hover),
    }
}
for name, widget in (("model", model), ("legacy", legacy)):
    result[name] = {
        "normal": sample(widget, normal),
        "hover": sample(widget, hover),
        "hover_backdrop": sample(widget, hover | backdrop),
        "selected_backdrop": sample(widget, selected | backdrop),
        "disabled_selected_backdrop": sample(widget, disabled | selected | backdrop),
    }
print(json.dumps(result))
