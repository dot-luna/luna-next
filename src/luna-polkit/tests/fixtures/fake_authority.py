"""Fake authority for a private bus; unsupported identities never start PAM."""

import json
import os
from pathlib import Path
import sys


AUTHORITY_NAME = "org.freedesktop.PolicyKit1"
AUTHORITY_PATH = "/org/freedesktop/PolicyKit1/Authority"


def run_authority(mode, events_path):
    address = os.environ.get("LUNA_NEXT_POLKIT_TEST_BUS")
    if not address or os.environ.get("DBUS_SYSTEM_BUS_ADDRESS") != address:
        raise RuntimeError("The fake authority requires an explicitly isolated test bus")
    # Only this subprocess imports GI, so normal discovery also works in a venv.
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio, GLib

    def record(event, **fields):
        with Path(events_path).open("a") as output:
            output.write(json.dumps({"event": event, **fields}) + "\n")

    connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
    introspection = Gio.DBusNodeInfo.new_for_xml("""
        <node>
          <interface name="org.freedesktop.PolicyKit1.Authority">
            <method name="RegisterAuthenticationAgent">
              <arg type="(sa{sv})" direction="in"/>
              <arg type="s" direction="in"/>
              <arg type="s" direction="in"/>
            </method>
            <method name="RegisterAuthenticationAgentWithOptions">
              <arg type="(sa{sv})" direction="in"/>
              <arg type="s" direction="in"/>
              <arg type="s" direction="in"/>
              <arg type="a{sv}" direction="in"/>
            </method>
            <method name="UnregisterAuthenticationAgent">
              <arg type="(sa{sv})" direction="in"/>
              <arg type="s" direction="in"/>
            </method>
            <property name="BackendName" type="s" access="read"/>
            <property name="BackendVersion" type="s" access="read"/>
            <property name="BackendFeatures" type="u" access="read"/>
          </interface>
        </node>
    """)

    def unsupported_finished(bus, result, _data):
        try:
            bus.call_finish(result)
            record("unsupported_completed")
        except GLib.Error as error:
            record("unsupported_cancelled", error=str(error))

    def begin_unsupported(sender, path):
        # Quickshell rejects netgroup identities before creating a PAM session.
        # A nonexistent unix-user would still start the privileged PAM helper.
        identities = [("unix-netgroup", {"name": GLib.Variant("s", "luna-next-test-netgroup")})]
        parameters = GLib.Variant("(sssa{ss}sa(sa{sv}))", (
            "org.luna.test.unsupported", "Unsupported identity test", "", {},
            "luna-next-test-cookie", identities,
        ))
        connection.call(
            sender, path, "org.freedesktop.PolicyKit1.AuthenticationAgent",
            "BeginAuthentication", parameters, GLib.VariantType.new("()"),
            Gio.DBusCallFlags.NONE, 3000, None, unsupported_finished, None,
        )
        return GLib.SOURCE_REMOVE

    def method_call(_bus, sender, _path, _interface, method, parameters, invocation):
        values = parameters.unpack()
        if method.startswith("RegisterAuthenticationAgent"):
            subject, _locale, path = values[:3]
            record("registration", subject=subject[0], session=subject[1].get("session-id"),
                   path=path, rejected=mode == "reject")
            if mode == "reject":
                invocation.return_dbus_error(
                    "org.freedesktop.PolicyKit1.Error.Failed", "Test authority rejected registration",
                )
                return
            invocation.return_value(GLib.Variant("()", ()))
            if mode == "unsupported":
                GLib.timeout_add(100, begin_unsupported, sender, path)
        elif method == "UnregisterAuthenticationAgent":
            record("unregistration", path=values[1])
            invocation.return_value(GLib.Variant("()", ()))

    def get_property(_bus, _sender, _path, _interface, name):
        if name == "BackendFeatures":
            return GLib.Variant("u", 0)
        return GLib.Variant("s", "luna-next-test")

    connection.register_object(AUTHORITY_PATH, introspection.interfaces[0],
                               method_call, get_property, None)
    connection.call_sync(
        "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
        "RequestName", GLib.Variant("(su)", (AUTHORITY_NAME, 4)),
        GLib.VariantType.new("(u)"), Gio.DBusCallFlags.NONE, 3000, None,
    )
    record("ready")
    GLib.MainLoop().run()


if __name__ == "__main__":
    run_authority(sys.argv[1], sys.argv[2])
