#pragma once

#include <QJSEngine>
#include <QJSValue>
#include <QObject>
#include <QQmlEngine>
#include <QtQml/qqmlregistration.h>

class Config final : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON

public:
    static Config *create(QQmlEngine *, QJSEngine *engine);
    // Return a fresh mutable JavaScript object, or throw a catchable JavaScript Error.
    // Local paths and file URLs are accepted; relative paths use the working directory.
    Q_INVOKABLE QJSValue load_as_json(const QString &path,
                                    const QString &schemaPath = QString()) const;

private:
    explicit Config(QJSEngine *engine) : QObject(engine), engine_(engine) {}
    // The parent engine owns this singleton; engine_ is a non-owning pointer.
    QJSEngine *engine_;
};
