#include "config.h"
#include "luna-next-hocon-qml/src/lib.rs.h"

#include <QDir>
#include <QUrl>
#include <exception>

Config *Config::create(QQmlEngine *, QJSEngine *engine) {
    return new Config(engine);
}

QJSValue Config::load_as_json(const QString &path) const {
    const auto fail = [this](const QString &message) {
        engine_->throwError(message);
        return QJSValue(QJSValue::UndefinedValue);
    };

    const QUrl url(path);
    if (!url.isRelative() && !url.isLocalFile() && !QDir::isAbsolutePath(path)) {
        return fail(QStringLiteral("Config.load_as_json expects a local file path or file URL"));
    }
    const QByteArray localPath = (url.isLocalFile() ? url.toLocalFile() : path).toUtf8();
    try {
        const auto json = luna_next::config::load_as_json(
            rust::Str(localPath.constData(), static_cast<std::size_t>(localPath.size())));
        // JSON.parse creates ordinary JavaScript objects and arrays. QVariant
        // conversion would expose Qt sequence wrappers to the caller instead.
        const auto parse = engine_->globalObject().property(QStringLiteral("JSON"))
            .property(QStringLiteral("parse"));
        const auto object = parse.call({QJSValue(QString::fromUtf8(
            json.data(), static_cast<qsizetype>(json.size())))});
        if (object.isError()) {
            engine_->throwError(object);
            return QJSValue(QJSValue::UndefinedValue);
        }
        return object;
    } catch (const std::exception &error) {
        return fail(QString::fromUtf8(error.what()));
    }
}
