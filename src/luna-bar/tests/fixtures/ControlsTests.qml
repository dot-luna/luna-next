import QtQuick
import QtTest
import QtQuick.Controls.Basic
import Quickshell
import Quickshell.Networking
import "../../src/shell" as Bar

TestCase {
    id: tests
    name: "Controls"
    visible: true
    width: 400
    height: 600
    property int toggles: 0
    property int pages: 0
    readonly property var theme: ({colors: {accent: "#abcdef", foreground: "#ffffff", background: "#111111", muted: "#555555"},
        fonts: {ui: "Sans"}, appearance: {rounding: 4, border_width: 1, opacity: {active: 1}, gaps: {outer: 5}, blur: {enabled: false}}})
    QtObject {
        id: network
        property string name: "Test network"
        property int security: WifiSecurityType.Wpa2Psk
        property bool known: false
        property bool connected: false
        property bool stateChanging: false
        property real signalStrength: 0.8
        property string received: ""
        signal connectionFailed(int reason)
        function connectWithPsk(psk) { received = psk; }
        function connect() { connected = true; }
        function disconnect() { connected = false; }
    }
    QtObject {
        id: fakeWifi
        property bool scannerEnabled: false
        property var networks: ({values: [network]})
    }
    QtObject {
        id: fakeServices
        property var wifi: fakeWifi
        property bool wifiEnabled: true
        function toggleWifi() { wifiEnabled = !wifiEnabled; }
    }
    Bar.Tile {
        id: tile
        width: 180
        theme: tests.theme
        iconName: "wifi-01"
        label: "Wi-Fi"
        hasMore: true
        onToggled: tests.toggles++
        onMore: tests.pages++
    }
    Bar.ControlSlider {
        id: slider
        y: 50
        width: 300
        theme: tests.theme
        iconName: "volume-high"
        label: "Volume"
        hasMore: true
        iconClickable: true
        onIconClicked: tests.toggles++
        onMore: tests.pages++
    }
    Component {
        id: fakeWifiComponent
        Bar.WifiPage { width: 300; theme: tests.theme; services: fakeServices }
    }
    function check(actual, expected) {
        try { compare(actual, expected); } catch (error) {
            console.error(qtest_results.functionName + ": actual=" + JSON.stringify(actual) + " expected=" + JSON.stringify(expected));
            throw error;
        }
    }
    Component {
        id: stateComponent
        Bar.ControlsState {}
    }
    Bar.PanelScroll {
        id: overflow
        y: 100
        width: 200
        height: 80
        contentHeight: 500
        Button { id: lastRow; y: 460; width: 180; height: 40; text: "Last row" }
    }
    function test_long_list_follows_focus() {
        overflow.contentY = 0;
        lastRow.forceActiveFocus();
        tryCompare(overflow, "contentY", 420);
    }
    function test_wired_status_keeps_chevron() {
        tile.toggleEnabled = false;
        mouseClick(tile, 30, 20);
        check(toggles, 0);
        mouseClick(tile, 168, 20);
        check(pages, 1);
        tile.toggleEnabled = true;
    }
    function test_brightness_failure_stays_visible() {
        const services = stateComponent.createObject(tests);
        tryCompare(services, "hasBrightness", true);
        services.setBrightness(0.7);
        tryCompare(services, "error", "Could not change brightness");
        tryCompare(services, "brightness", 0.5);
        check(services.error, "Could not change brightness");
        services.destroy();
        wait(0);
    }
    function init() { toggles = 0; pages = 0; network.received = ""; network.connected = false; }
    function cleanupTestCase() {
        console.log("LUNA_BAR_TEST_RESULT " + JSON.stringify({passed: qtest_results.passCount,
            failed: qtest_results.failCount, skipped: qtest_results.skipCount}));
    }
    function test_split_tile_mouse_and_keyboard() {
        mouseClick(tile, 30, 20);
        check(toggles, 1); check(pages, 0);
        mouseClick(tile, 168, 20);
        check(toggles, 1); check(pages, 1);
        keyClick(Qt.Key_Return);
        check(pages, 2);
    }
    function test_slider_mute_and_page() {
        mouseClick(slider, 12, 14);
        check(toggles, 1); check(pages, 0);
        mouseClick(slider, 290, 14);
        check(toggles, 1); check(pages, 1);
    }
    function test_wifi_password_retry_and_scanner_cleanup() {
        const page = fakeWifiComponent.createObject(tests, {y: 100});
        verify(page !== null);
        check(fakeWifi.scannerEnabled, true);
        page.choose(network);
        check(page.needsPassword, true);
        const password = findChild(page, "wifiPassword");
        password.text = "test secret";
        page.connectPassword();
        check(network.received, "test secret");
        check(password.text, "");
        check(page.needsPassword, false);
        network.connectionFailed(ConnectionFailReason.NoSecrets);
        check(page.needsPassword, true);
        verify(page.error.length > 0);
        page.destroy();
        wait(0);
        check(fakeWifi.scannerEnabled, false);
    }
}
