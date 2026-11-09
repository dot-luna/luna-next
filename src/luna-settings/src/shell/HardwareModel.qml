import QtQuick

// Session-only mock API boundary. Setters change memory; no hardware or files are touched.
QtObject {
    readonly property string deviceName: "Nitro ANV15-51"
    readonly property string cpuName: "Intel Core i7-13620H"
    readonly property string gpuName: "NVIDIA GeForce RTX 4060"

    property string profile: "balanced"
    // Zero delegates a fan to automatic control; 1–100 represent a manual percentage.
    property int cpuFan: 0
    property int gpuFan: 0
    property bool chargeLimit: true
    property bool keyboardTimeout: true

    readonly property int batteryPercentage: 76
    readonly property int healthPercent: 91
    readonly property int cycles: 218
    readonly property bool onBattery: false
    readonly property int cpuTemp: profile === "performance" ? 54 : profile === "power-saver" ? 42 : 48
    readonly property int gpuTemp: profile === "performance" ? 49 : profile === "power-saver" ? 38 : 43
    readonly property int cpuRpm: cpuFan > 0 ? Math.max(900, Math.round(cpuFan * 56))
        : profile === "performance" ? 2700 : profile === "power-saver" ? 1500 : 2100
    readonly property int gpuRpm: gpuFan > 0 ? Math.max(900, Math.round(gpuFan * 55))
        : profile === "performance" ? 2300 : profile === "power-saver" ? 1200 : 1800

    // Invalid input returns false and leaves the current selection unchanged.
    function setProfile(value: var): bool {
        if (value !== "power-saver" && value !== "balanced" && value !== "performance")
            return false;
        profile = value;
        return true;
    }

    // Validate both targets before changing either, keeping a rejected pair unchanged.
    function setFans(cpu: var, gpu: var): bool {
        if (typeof cpu !== "number" || typeof gpu !== "number"
                || !Number.isInteger(cpu) || !Number.isInteger(gpu)
                || cpu < 0 || cpu > 100 || gpu < 0 || gpu > 100)
            return false;
        cpuFan = cpu;
        gpuFan = gpu;
        return true;
    }

    function setChargeLimit(enabled: var): bool {
        if (typeof enabled !== "boolean")
            return false;
        chargeLimit = enabled;
        return true;
    }

    function setKeyboardTimeout(enabled: var): bool {
        if (typeof enabled !== "boolean")
            return false;
        keyboardTimeout = enabled;
        return true;
    }
}
