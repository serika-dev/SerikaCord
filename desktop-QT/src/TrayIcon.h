#pragma once

#include <QSystemTrayIcon>
#include <QMenu>
#include <QAction>
#include <QCheckBox>

class MainWindow;

class TrayIcon : public QObject {
    Q_OBJECT

public:
    explicit TrayIcon(MainWindow *window, QObject *parent = nullptr);
    ~TrayIcon() override;

    void show();
    void setMuteChecked(bool checked);

signals:
    void quitRequested();
    void checkUpdatesRequested();
    void muteToggled(bool muted);

private slots:
    void onActivated(QSystemTrayIcon::ActivationReason reason);
    void onShowClicked();
    void onQuitClicked();
    void onCheckUpdatesClicked();
    void onMuteToggled(bool checked);

private:
    MainWindow *m_window;
    QSystemTrayIcon *m_tray;
    QMenu *m_menu;
    QAction *m_showAction;
    QAction *m_updateAction;
    QAction *m_muteAction;
    QAction *m_quitAction;
};
