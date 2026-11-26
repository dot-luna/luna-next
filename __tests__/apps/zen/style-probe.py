"""Inspect a disposable Zen profile through its loopback-only Marionette test interface."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time

profile = Path(sys.argv[1])
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    port = reservation.getsockname()[1]
with (profile / "user.js").open("a") as preferences:
    preferences.write(f'\nuser_pref("marionette.port", {port});\n')
log = (profile / "browser.log").open("w")
browser = subprocess.Popen(
    [sys.argv[2], "--headless", "--no-remote", "--profile", str(profile), "--marionette", "about:blank"],
    env={**os.environ, "MOZ_REMOTE_ALLOW_SYSTEM_ACCESS": "1"},
    stdout=subprocess.DEVNULL, stderr=log,
)
connection = None
try:
    deadline = time.monotonic() + 20
    while True:
        try:
            connection = socket.create_connection(("127.0.0.1", port), timeout=1)
            break
        except OSError:
            if time.monotonic() > deadline or browser.poll() is not None:
                raise RuntimeError((profile / "browser.log").read_text())
            time.sleep(0.05)
    connection.settimeout(20)

    def receive():
        header = b""
        while not header.endswith(b":"):
            chunk = connection.recv(1)
            if not chunk:
                raise RuntimeError("Zen closed Marionette")
            header += chunk
        size = int(header[:-1])
        data = b""
        while len(data) < size:
            chunk = connection.recv(size - len(data))
            if not chunk:
                raise RuntimeError("Truncated Marionette message")
            data += chunk
        return json.loads(data)

    receive()
    sequence = 0

    def call(method, params=None):
        global sequence
        sequence += 1
        payload = json.dumps([0, sequence, method, params or {}]).encode()
        connection.sendall(str(len(payload)).encode() + b":" + payload)
        response = receive()
        if response[2]:
            raise RuntimeError(response[2])
        return response[3]

    def script(code, asynchronous=False):
        return call("WebDriver:ExecuteAsyncScript" if asynchronous else "WebDriver:ExecuteScript", {
            "script": code, "args": [], "newSandbox": True, "sandbox": "default",
            "line": 1, "filename": "luna-theme-test",
        })["value"]

    call("WebDriver:NewSession")
    call("WebDriver:SetTimeouts", {"pageLoad": 15000, "script": 15000})
    call("Marionette:SetContext", {"value": "chrome"})
    result = {}
    result["find"] = script("""
        const done = arguments[arguments.length - 1];
        window.gBrowser.getFindBar().then(bar => {
            bar.open();
            const style = node => { const s = getComputedStyle(node); return {bg:s.backgroundColor, fg:s.color, radius:s.borderRadius}; };
            const field = bar._findField;
            field.focus();
            const states = {bar:style(bar), field:style(field)};
            field.setAttribute('status', 'notfound'); states.error = style(field);
            field.removeAttribute('status'); field.setAttribute('flash', 'true'); states.warning = style(field);
            done(states);
        });
    """, True)
    result["surfaces"] = script("""
        const result = {};
        for (const id of ['appMenu-popup', 'downloadsPanel', 'identity-popup', 'permission-popup', 'editBookmarkPanel', 'tabContextMenu', 'contentAreaContextMenu', 'urlbar']) {
            let element = document.getElementById(id);
            if (!element) {
                const template = [...document.querySelectorAll('template')].find(t => t.content?.querySelector('#' + id));
                if (template) { template.replaceWith(template.content); element = document.getElementById(id); }
            }
            if (!element) { result[id] = null; continue; }
            const s = getComputedStyle(element);
            result[id] = {fg:s.color, bg:s.backgroundColor, panel:s.getPropertyValue('--panel-background-color').trim(), text:s.getPropertyValue('--panel-text-color').trim()};
        }
        return result;
    """)
    call("Marionette:SetContext", {"value": "content"})
    result["pages"] = {}
    for url in ['about:preferences', 'about:addons', 'about:downloads', 'about:config', 'about:support', 'about:newtab', sys.argv[3]]:
        call("WebDriver:Navigate", {"url": url})
        result["pages"][url] = script("""
            const s = getComputedStyle(document.documentElement);
            const test = document.getElementById('luna-fixture');
            const t = test && getComputedStyle(test);
            return {bg:s.backgroundColor, fg:s.color, fixture:t && {radius:t.borderRadius,bg:t.backgroundColor,fg:t.color}};
        """)
    print(json.dumps(result))
finally:
    if connection:
        connection.close()
    browser.terminate()
    try:
        browser.wait(timeout=8)
    except subprocess.TimeoutExpired:
        browser.kill()
        browser.wait()
    log.close()
