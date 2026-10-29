#include "config.h"
#include "luna-next-hocon-qml/src/lib.rs.h"

#include <QDir>
#include <QUrl>
#include <exception>
#include <stdexcept>

namespace {
QByteArray localPath(const QString &path) {
    const QUrl url(path);
    if (!url.isRelative() && !url.isLocalFile() && !QDir::isAbsolutePath(path)) {
        throw std::invalid_argument("Config.load_as_json expects local file paths or file URLs");
    }
    return (url.isLocalFile() ? url.toLocalFile() : path).toUtf8();
}
}

Config *Config::create(QQmlEngine *, QJSEngine *engine) {
    return new Config(engine);
}

QJSValue Config::load_as_json(const QString &path, const QString &schemaPath) const {
    const auto fail = [this](const QString &message) {
        engine_->throwError(message);
        return QJSValue(QJSValue::UndefinedValue);
    };

    try {
        const auto pathBytes = localPath(path);
        const auto schemaBytes = localPath(schemaPath);
        const auto json = luna_next::config::load_as_json_with_schema(
            rust::Str(pathBytes.constData(), static_cast<std::size_t>(pathBytes.size())),
            rust::Str(schemaBytes.constData(), static_cast<std::size_t>(schemaBytes.size())));
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
