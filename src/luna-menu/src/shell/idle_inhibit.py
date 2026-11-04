"""Translate desktop D-Bus idle inhibition into the menu's Wayland inhibitors."""

import json
import sys

import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib


SERVICE = "org.freedesktop.ScreenSaver"
PATH = "/org/freedesktop/ScreenSaver"


class ScreenSaver(dbus.service.Object):
    """Each cookie belongs to its calling connection and expires on disconnect."""

    SUPPORTS_MULTIPLE_OBJECT_PATHS = True

    def __init__(self, bus, name):
        super().__init__(name, PATH)
        self.cookies = {}
        self.next_cookie = 0
        self.inhibited = None
        # Firefox/VLC use /ScreenSaver; portal clients use the specification's path.
        # Both endpoints share ownership and the same outstanding requests.
        self.add_to_connection(bus, "/ScreenSaver")
        bus.add_signal_receiver(self.owner_changed, signal_name="NameOwnerChanged",
                                dbus_interface="org.freedesktop.DBus")
        self.publish()

    def publish(self):
        inhibited = bool(self.cookies)
        if inhibited != self.inhibited:
            self.inhibited = inhibited
            print(json.dumps({"inhibited": inhibited}), flush=True)

    @dbus.service.method(SERVICE, in_signature="ss", out_signature="u", sender_keyword="sender")
    def Inhibit(self, application_name, reason_for_inhibit, sender=None):
        self.next_cookie = self.next_cookie % 0xFFFFFFFF + 1
        while self.next_cookie in self.cookies:
            self.next_cookie = self.next_cookie % 0xFFFFFFFF + 1
        self.cookies[self.next_cookie] = sender
        self.publish()
        return dbus.UInt32(self.next_cookie)

    @dbus.service.method(SERVICE, in_signature="u", out_signature="", sender_keyword="sender")
    def UnInhibit(self, cookie, sender=None):
        if self.cookies.get(cookie) == sender:
            self.cookies.pop(cookie, None)
            self.publish()

    def owner_changed(self, name, old_owner, new_owner):
        if name.startswith(":") and not new_owner:
            self.cookies = {cookie: owner for cookie, owner in self.cookies.items() if owner != name}
            self.publish()


def main():
    DBusGMainLoop(set_as_default=True)
    bus = dbus.SessionBus()
    # Refuse an existing provider rather than replacing its outstanding cookies.
    name = dbus.service.BusName(SERVICE, bus, do_not_queue=True)
    service = ScreenSaver(bus, name)
    GLib.MainLoop().run()
    service.remove_from_connection()


if __name__ == "__main__":
    try:
        main()
    except (dbus.DBusException, BrokenPipeError) as error:
        print(f"Luna idle inhibition: {error}", file=sys.stderr)
        sys.exit(1)
