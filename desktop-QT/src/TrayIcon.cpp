#include "TrayIcon.h"
#include "MainWindow.h"

#include <QSystemTrayIcon>
#include <QMenu>
#include <QStyle>
#include <QApplication>
#include <QDesktopServices>

TrayIcon::TrayIcon(MainWindow *window, QObject *parent)
    : QObject(parent)
    , m_window(window)
    , m_tray(new QSystemTrayIcon(parent))
    , m_menu(new QMenu())
{
    // Set icon from application style or resource
    QIcon icon = QApplication::windowIcon();
    if (icon.isNull()) {
        icon = QApplication::style()->standardIcon(QStyle::SP_ComputerIcon);
    }
    m_tray->setIcon(icon);
    m_tray->setToolTip("SerikaCord");

    // Build menu
    m_showAction = m_menu->addAction("Open SerikaCord");
    m_menu->addSeparator();
    m_updateAction = m_menu->addAction("Check for Updates…");
    m_muteAction = m_menu->addAction("Mute Notifications");
    m_muteAction->setCheckable(true);
    m_menu->addSeparator();
    m_quitAction = m_menu->addAction("Quit");

    m_tray->setContextMenu(m_menu);

    // Connections
    connect(m_tray, &QSystemTrayIcon::activated, this, &TrayIcon::onActivated);
    connect(m_showAction, &QAction::triggered, this, &TrayIcon::onShowClicked);
    connect(m_quitAction, &QAction::triggered, this, &TrayIcon::onQuitClicked);
    connect(m_updateAction, &QAction::triggered, this, &TrayIcon::onCheckUpdatesClicked);
    connect(m_muteAction, &QAction::triggered, this, &TrayIcon::onMuteToggled);
}

TrayIcon::~TrayIcon() {
    delete m_menu;
    delete m_tray;
}

void TrayIcon::show() {
    m_tray->show();
}

void TrayIcon::setMuteChecked(bool checked) {
    m_muteAction->setChecked(checked);
}

void TrayIcon::onActivated(QSystemTrayIcon::ActivationReason reason) {
    if (reason == QSystemTrayIcon::Trigger) {
        // Left-click toggles window visibility
        m_window->toggleVisibility();
    }
}

void TrayIcon::onShowClicked() {
    m_window->showAndFocus();
}

void TrayIcon::onQuitClicked() {
    emit quitRequested();
}

void TrayIcon::onCheckUpdatesClicked() {
    QDesktopServices::openUrl(
        QUrl("https://github.com/serika-dev/SerikaCord/releases"));
    emit checkUpdatesRequested();
}

void TrayIcon::onMuteToggled(bool checked) {
    m_window->toggleMute();
    emit muteToggled(checked);
}
