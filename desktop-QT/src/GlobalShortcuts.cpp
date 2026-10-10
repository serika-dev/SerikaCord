#include "GlobalShortcuts.h"
#include "KeyState.h"

#include <QGuiApplication>
#include <QVariantMap>

namespace {
constexpr int POLL_MS = 15;
}

GlobalShortcuts::GlobalShortcuts(QObject *parent)
    : QObject(parent)
{
    m_timer.setInterval(POLL_MS);
    m_timer.setTimerType(Qt::PreciseTimer);
    connect(&m_timer, &QTimer::timeout, this, &GlobalShortcuts::poll);
}

GlobalShortcuts::~GlobalShortcuts() = default;

bool GlobalShortcuts::available() {
    return KeyState::available();
}

GlobalShortcuts::Parsed GlobalShortcuts::parseAccelerator(const QString &accelerator) {
    Parsed out;
    const QString acc = accelerator.trimmed();
    if (acc.isEmpty()) return out;
    // A lone "+" key isn't supported (it would read as a separator).
    const QStringList parts = acc.split('+', Qt::KeepEmptyParts);
    if (parts.isEmpty()) return out;
    for (int i = 0; i < parts.size() - 1; ++i) {
        const QString m = parts[i].trimmed().toLower();
        if (m == "ctrl" || m == "control" || m == "cmd" || m == "command" || m == "cmdorctrl") {
            out.modifiers |= KeyState::Ctrl;
        } else if (m == "shift") {
            out.modifiers |= KeyState::Shift;
        } else if (m == "alt" || m == "option") {
            out.modifiers |= KeyState::Alt;
        } else if (m == "meta" || m == "super" || m == "win") {
            out.modifiers |= KeyState::Meta;
        } else {
            return out; // unknown modifier
        }
    }
    out.keyToken = parts.last().trimmed();
    out.valid = !out.keyToken.isEmpty();
    return out;
}

QStringList GlobalShortcuts::setShortcuts(const QVariantList &list) {
    // Release anything held under the old bindings so PTT can't get stuck on.
    for (const Binding &b : std::as_const(m_bindings)) {
        if (b.hold && b.emittedPress) emit triggered(b.action, false);
    }
    m_bindings.clear();
    QStringList bound;
    for (const QVariant &v : list) {
        const QVariantMap m = v.toMap();
        const QString action = m.value("action").toString();
        const Parsed p = parseAccelerator(m.value("accelerator").toString());
        if (action.isEmpty() || !p.valid) continue;
        const int key = KeyState::nativeKey(p.keyToken.toStdString());
        if (key < 0) continue;
        Binding b;
        b.action = action;
        b.modifiers = p.modifiers;
        b.nativeKey = key;
        b.hold = m.value("hold").toBool();
        b.whileFocused = m.value("whileFocused").toBool();
        m_bindings.append(b);
        bound << action;
    }
    updateTimer();
    return bound;
}

void GlobalShortcuts::setEnabled(bool enabled) {
    if (m_enabled == enabled) return;
    m_enabled = enabled;
    if (!enabled) {
        for (Binding &b : m_bindings) {
            if (b.hold && b.emittedPress) emit triggered(b.action, false);
            b.active = false;
            b.emittedPress = false;
        }
    }
    updateTimer();
}

void GlobalShortcuts::updateTimer() {
    const bool run = m_enabled && !m_bindings.isEmpty() && KeyState::available();
    if (run && !m_timer.isActive()) m_timer.start();
    else if (!run && m_timer.isActive()) m_timer.stop();
}

void GlobalShortcuts::poll() {
    KeyState::snapshot();
    const unsigned mods = KeyState::modifiers();
    // While the window is focused the page's own key handlers already see
    // these keys; only act then if the page has no equivalent binding.
    const bool focused = QGuiApplication::applicationState() == Qt::ApplicationActive;

    for (Binding &b : m_bindings) {
        const bool keyDown = KeyState::isDown(b.nativeKey);
        const bool modsOk = b.hold
            ? (mods & b.modifiers) == b.modifiers // PTT keeps working with extra modifiers held
            : mods == b.modifiers;
        const bool active = keyDown && modsOk;
        if (active == b.active) continue;
        b.active = active;

        if (active) {
            if (focused && !b.whileFocused) continue;
            b.emittedPress = true;
            emit triggered(b.action, true);
        } else if (b.emittedPress) {
            b.emittedPress = false;
            if (b.hold) emit triggered(b.action, false);
        }
    }
}
