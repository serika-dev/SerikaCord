#include "TrayIcon.h"

#include <QAction>
#include <QActionGroup>
#include <QApplication>
#include <QMenu>
#include <QPainter>
#include <QPixmap>
#include <QStyle>

namespace {
struct StatusChoice { const char *value; const char *label; };
constexpr StatusChoice STATUSES[] = {
    {"online", "Online"},
    {"idle", "Idle"},
    {"dnd", "Do Not Disturb"},
    {"offline", "Invisible"},
};
}

TrayIcon::TrayIcon(QObject *parent)
    : QObject(parent)
    , m_tray(new QSystemTrayIcon(this))
    , m_menu(new QMenu())
{
    m_baseIcon = QApplication::windowIcon();
    if (m_baseIcon.isNull()) m_baseIcon = QApplication::style()->standardIcon(QStyle::SP_ComputerIcon);
    m_tray->setIcon(m_baseIcon);
    m_tray->setToolTip(QStringLiteral("SerikaCord"));

    m_openAction = m_menu->addAction(tr("Open SerikaCord"));
    QFont bold = m_openAction->font();
    bold.setBold(true);
    m_openAction->setFont(bold);
    m_menu->addSeparator();

    m_muteAction = m_menu->addAction(tr("Mute"));
    m_muteAction->setCheckable(true);
    m_deafenAction = m_menu->addAction(tr("Deafen"));
    m_deafenAction->setCheckable(true);
    m_muteAction->setEnabled(false);   // until the page reports a call
    m_deafenAction->setEnabled(false);

    m_statusMenu = m_menu->addMenu(tr("Status"));
    m_statusGroup = new QActionGroup(this);
    m_statusGroup->setExclusive(true);
    for (const auto &s : STATUSES) {
        QAction *a = m_statusMenu->addAction(tr(s.label));
        a->setCheckable(true);
        a->setData(QString::fromLatin1(s.value));
        m_statusGroup->addAction(a);
        connect(a, &QAction::triggered, this, [this, a]() { emit statusRequested(a->data().toString()); });
    }
    m_statusMenu->setEnabled(false); // until the page reports who's signed in

    m_menu->addSeparator();
    m_installAction = m_menu->addAction(tr("Restart to Update"));
    m_installAction->setVisible(false);
    m_updateAction = m_menu->addAction(tr("Check for Updates…"));
    m_menu->addSeparator();
    m_quitAction = m_menu->addAction(tr("Quit SerikaCord"));

    m_tray->setContextMenu(m_menu);

    connect(m_tray, &QSystemTrayIcon::activated, this, [this](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger) emit toggleRequested();
        else if (reason == QSystemTrayIcon::DoubleClick) emit openRequested();
    });
    connect(m_openAction, &QAction::triggered, this, &TrayIcon::openRequested);
    connect(m_muteAction, &QAction::triggered, this, [this]() {
        // Keep showing the real state until the page confirms the change.
        m_muteAction->setChecked(!m_muteAction->isChecked());
        emit muteToggleRequested();
    });
    connect(m_deafenAction, &QAction::triggered, this, [this]() {
        m_deafenAction->setChecked(!m_deafenAction->isChecked());
        emit deafenToggleRequested();
    });
    connect(m_updateAction, &QAction::triggered, this, &TrayIcon::checkUpdatesRequested);
    connect(m_installAction, &QAction::triggered, this, &TrayIcon::installUpdateRequested);
    connect(m_quitAction, &QAction::triggered, this, &TrayIcon::quitRequested);
}

TrayIcon::~TrayIcon() {
    delete m_menu;
}

void TrayIcon::show() {
    m_tray->show();
}

QIcon TrayIcon::iconWithDot(const QIcon &base, bool dot) {
    if (!dot) return base;
    QIcon out;
    for (int size : {16, 22, 24, 32, 48, 64, 128, 256}) {
        QPixmap pm = base.pixmap(size, size);
        if (pm.isNull()) continue;
        pm = pm.scaled(size, size, Qt::KeepAspectRatio, Qt::SmoothTransformation);
        QPainter p(&pm);
        p.setRenderHint(QPainter::Antialiasing);
        const qreal r = size * 0.22;
        const QPointF c(size - r - size * 0.02, size - r - size * 0.02);
        // Cut-out ring so the dot reads on any icon colour, then the red dot.
        p.setCompositionMode(QPainter::CompositionMode_Clear);
        p.setPen(Qt::NoPen);
        p.setBrush(Qt::black);
        p.drawEllipse(c, r + size * 0.06, r + size * 0.06);
        p.setCompositionMode(QPainter::CompositionMode_SourceOver);
        p.setBrush(QColor(0xf2, 0x3f, 0x43));
        p.drawEllipse(c, r, r);
        p.end();
        out.addPixmap(pm);
    }
    return out.isNull() ? base : out;
}

void TrayIcon::refreshIcon() {
    m_tray->setIcon(iconWithDot(m_baseIcon, m_unread > 0));
    m_tray->setToolTip(m_unread > 0
        ? tr("SerikaCord — %n unread", nullptr, m_unread)
        : QStringLiteral("SerikaCord"));
}

void TrayIcon::setUnread(int count) {
    count = qMax(0, count);
    if (count == m_unread) return;
    const bool dotChanged = (count > 0) != (m_unread > 0);
    m_unread = count;
    if (dotChanged) refreshIcon();
    else m_tray->setToolTip(count > 0 ? tr("SerikaCord — %n unread", nullptr, count) : QStringLiteral("SerikaCord"));
}

void TrayIcon::setVoiceState(bool connected, bool muted, bool deafened) {
    // Like the app's own mute/deafen buttons, these act on the current call.
    m_muteAction->setEnabled(connected);
    m_deafenAction->setEnabled(connected);
    m_muteAction->setChecked(muted);
    m_deafenAction->setChecked(deafened);
}

void TrayIcon::setStatus(const QString &status) {
    m_statusMenu->setEnabled(!status.isEmpty());
    for (QAction *a : m_statusGroup->actions()) a->setChecked(a->data().toString() == status);
}

void TrayIcon::setUpdateReady(const QString &version) {
    m_installAction->setVisible(!version.isEmpty());
    if (!version.isEmpty()) m_installAction->setText(tr("Restart to Update (%1)").arg(version));
}
