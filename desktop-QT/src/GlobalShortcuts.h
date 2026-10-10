#pragma once

#include <QObject>
#include <QString>
#include <QTimer>
#include <QVariantList>
#include <QVector>

// System-wide shortcuts: push-to-talk (hold) and toggle mute / deafen, even
// while SerikaCord is in the background. The web app sends the bindings
// (from its Keybinds settings) through the bridge; presses come back as
// triggered(action, pressed).
class GlobalShortcuts : public QObject {
    Q_OBJECT

public:
    explicit GlobalShortcuts(QObject *parent = nullptr);
    ~GlobalShortcuts() override;

    // Each entry: { action: string, accelerator: "Ctrl+Shift+M", hold: bool,
    //               whileFocused: bool }. Unknown/unsupported keys are skipped.
    // Returns the actions that could be bound.
    QStringList setShortcuts(const QVariantList &list);
    void setEnabled(bool enabled);
    bool isEnabled() const { return m_enabled; }
    static bool available();

    struct Parsed {
        unsigned modifiers{0};
        QString keyToken;
        bool valid{false};
    };
    // "Ctrl+Shift+M" -> { Ctrl|Shift, "M" }. Exposed for tests/logging.
    static Parsed parseAccelerator(const QString &accelerator);

signals:
    void triggered(const QString &action, bool pressed);

private slots:
    void poll();

private:
    struct Binding {
        QString action;
        unsigned modifiers{0};
        int nativeKey{-1};
        bool hold{false};
        bool whileFocused{false};
        bool active{false};
        bool emittedPress{false};
    };

    void updateTimer();

    QVector<Binding> m_bindings;
    QTimer m_timer;
    bool m_enabled{true};
};
