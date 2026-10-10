#include "AppSettings.h"

#include <QtGlobal>

namespace {
// key -> default. Every web-visible boolean preference lives here.
struct BoolPref { const char *key; bool fallback; };
constexpr BoolPref BOOL_PREFS[] = {
    {"closeToTray", true},
    {"minimizeToTray", false},
    {"startOnLogin", false},
    {"startMinimized", false},
    {"spellcheck", true},
    {"nativeNotifications", true},
    {"globalShortcuts", true},
    {"hardwareAcceleration", true},
};
constexpr int DEFAULT_IDLE_MINUTES = 10;
}

AppSettings::AppSettings(QObject *parent)
    : QObject(parent)
    , m_settings(QSettings::NativeFormat, QSettings::UserScope,
                 QStringLiteral("SerikaCord"), QStringLiteral("SerikaCord"))
{
}

bool AppSettings::boolValue(const char *key, bool fallback) const {
    return m_settings.value(QStringLiteral("prefs/%1").arg(QLatin1String(key)), fallback).toBool();
}

bool AppSettings::closeToTray() const { return boolValue("closeToTray", true); }
bool AppSettings::minimizeToTray() const { return boolValue("minimizeToTray", false); }
bool AppSettings::startOnLogin() const { return boolValue("startOnLogin", false); }
bool AppSettings::startMinimized() const { return boolValue("startMinimized", false); }
bool AppSettings::spellcheck() const { return boolValue("spellcheck", true); }
bool AppSettings::nativeNotifications() const { return boolValue("nativeNotifications", true); }
bool AppSettings::globalShortcuts() const { return boolValue("globalShortcuts", true); }
bool AppSettings::hardwareAcceleration() const { return boolValue("hardwareAcceleration", true); }

int AppSettings::idleTimeoutMinutes() const {
    const int v = m_settings.value(QStringLiteral("prefs/idleTimeoutMinutes"), DEFAULT_IDLE_MINUTES).toInt();
    return qBound(0, v, 240);
}

QVariantMap AppSettings::toMap() const {
    QVariantMap map;
    for (const auto &p : BOOL_PREFS) map.insert(QLatin1String(p.key), boolValue(p.key, p.fallback));
    map.insert(QStringLiteral("idleTimeoutMinutes"), idleTimeoutMinutes());
    return map;
}

bool AppSettings::set(const QString &key, const QVariant &value) {
    for (const auto &p : BOOL_PREFS) {
        if (key == QLatin1String(p.key)) {
            if (!value.canConvert<bool>()) return false;
            const bool b = value.toBool();
            if (boolValue(p.key, p.fallback) == b) return true;
            m_settings.setValue(QStringLiteral("prefs/%1").arg(key), b);
            emit changed(key, b);
            return true;
        }
    }
    if (key == QLatin1String("idleTimeoutMinutes")) {
        bool ok = false;
        const int v = value.toInt(&ok);
        if (!ok) return false;
        const int clamped = qBound(0, v, 240);
        m_settings.setValue(QStringLiteral("prefs/idleTimeoutMinutes"), clamped);
        emit changed(key, clamped);
        return true;
    }
    return false;
}

QByteArray AppSettings::windowGeometry() const {
    return m_settings.value(QStringLiteral("window/geometry")).toByteArray();
}

bool AppSettings::windowMaximized() const {
    return m_settings.value(QStringLiteral("window/maximized"), false).toBool();
}

void AppSettings::saveWindowState(const QByteArray &geometry, bool maximized) {
    m_settings.setValue(QStringLiteral("window/geometry"), geometry);
    m_settings.setValue(QStringLiteral("window/maximized"), maximized);
}

double AppSettings::zoomFactor() const {
    return qBound(0.5, m_settings.value(QStringLiteral("window/zoom"), 1.0).toDouble(), 2.0);
}

void AppSettings::setZoomFactor(double factor) {
    m_settings.setValue(QStringLiteral("window/zoom"), qBound(0.5, factor, 2.0));
}
