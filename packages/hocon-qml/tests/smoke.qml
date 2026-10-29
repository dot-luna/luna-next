import QtQml
import LunaNext.Config

QtObject {
    function check(condition, message) {
        if (!condition)
            throw new Error(message)
    }

    function expectError(load, message) {
        var caught = false
        try {
            load()
        } catch (error) {
            caught = error instanceof Error && error.message.length > 0
        }
        check(caught, message)
    }

    Component.onCompleted: {
        try {
            var path = Qt.resolvedUrl("data/config.conf")
            var config = Config.load_as_json(path)

            check(typeof config === "object" && config !== null && !Array.isArray(config),
                  "load_as_json must return a JavaScript object")
            check(config.wallpaper.path === "/usr/share/wallpapers/default.jpg",
                  "included settings must be resolved")
            check(config.wallpaper.duration === 500,
                  "entry-point values must have HOCON precedence")
            check(config.wallpaper.transition === "fade",
                  "nested objects must merge")
            check(config.selected === config.wallpaper.path,
                  "substitutions must be resolved")
            check(typeof config.wallpaper.duration === "number" && config.opacity === 0.75,
                  "numeric values must remain numbers")
            check(config.enabled === true, "booleans must remain booleans")
            check(Array.isArray(config.tags) && config.tags.join(",") === "work,rest",
                  "arrays must remain JavaScript arrays")
            check(config.options.theme === "dark" && config.options.unused === null,
                  "nested objects and null must retain their types")
            check(config.missing === undefined,
                  "missing properties must have ordinary JavaScript behavior")

            config.wallpaper.duration = 900
            config.tags.push("memory")
            check(config.wallpaper.duration === 900 && config.tags.length === 3,
                  "the returned object must be usable and mutable in memory")
            var fresh = Config.load_as_json(path)
            check(fresh.wallpaper.duration === 500 && fresh.tags.length === 2,
                  "mutating the object must not write the file or change later loads")

            check(typeof Config.load_as_json === "function", "the loader must be exposed")
            check(typeof Config.get === "undefined" && typeof Config.set === "undefined"
                  && typeof Config.unset === "undefined" && typeof Config.reload === "undefined",
                  "the adapter must expose no live access or editing API")

            expectError(function() {
                Config.load_as_json(Qt.resolvedUrl("data/malformed.conf"))
            }, "malformed HOCON must throw a catchable Error")
            expectError(function() {
                Config.load_as_json(Qt.resolvedUrl("data"))
            }, "a directory cannot be loaded as a configuration file")

            console.log("LunaNext.Config smoke test passed")
            Qt.exit(0)
        } catch (error) {
            console.error("LunaNext.Config smoke test failed:", error.message)
            Qt.exit(1)
        }
    }
}
