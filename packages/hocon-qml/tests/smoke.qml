import QtQml
import LunaNext.Config

QtObject {
    function check(condition, message) {
        if (!condition)
            throw new Error(message)
    }

    function expectError(load, message, expectedDetail) {
        var caught = null
        try {
            load()
        } catch (error) {
            caught = error
        }
        check(caught instanceof Error && caught.message.length > 0, message)
        if (expectedDetail)
            check(caught.message.indexOf(expectedDetail) !== -1,
                  message + ": missing error detail " + expectedDetail)
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

            var schema = Qt.resolvedUrl("data/config.schema.json")
            var validated = Config.load_as_json(path, schema)
            check(validated.wallpaper.path === fresh.wallpaper.path
                  && validated.wallpaper.duration === 500 && validated.enabled === true,
                  "schema validation must use resolved includes and allow unspecified properties")
            check(validated.absent === undefined,
                  "schema defaults must not insert configuration properties")
            validated.tags.push("validated-memory")
            check(validated.tags.length === 3
                  && Config.load_as_json(path, schema).tags.length === 2,
                  "validated results must remain mutable in memory without changing the file")
            var localPath = decodeURIComponent(path.toString().replace(/^file:\/\//, ""))
            var localSchema = decodeURIComponent(schema.toString().replace(/^file:\/\//, ""))
            check(Config.load_as_json(localPath, localSchema).wallpaper.duration === 500,
                  "both arguments must accept local paths as well as file URLs")
            check(Config.load_as_json(path, "").wallpaper.duration === 500,
                  "an empty schema path must skip validation")

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
            expectError(function() {
                Config.load_as_json(Qt.resolvedUrl("data/invalid.conf"), schema)
            }, "invalid settings must throw a catchable Error", "/wallpaper/duration")
            expectError(function() {
                Config.load_as_json(path, Qt.resolvedUrl("data/invalid.schema.json"))
            }, "an invalid schema must throw a catchable Error")
            expectError(function() {
                Config.load_as_json(path, Qt.resolvedUrl("data/malformed.schema.json"))
            }, "malformed schema JSON must throw a catchable Error")
            expectError(function() {
                Config.load_as_json(path, Qt.resolvedUrl("data/missing.schema.json"))
            }, "a missing schema must throw a catchable Error")

            console.log("LunaNext.Config smoke test passed")
            Qt.exit(0)
        } catch (error) {
            console.error("LunaNext.Config smoke test failed:", error.message)
            Qt.exit(1)
        }
    }
}
