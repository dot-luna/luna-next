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
    Q_INVOKABLE QJSValue load_as_json(const QString &path) const;

private:
    explicit Config(QJSEngine *engine) : QObject(engine), engine_(engine) {}
    QJSEngine *engine_;
};
