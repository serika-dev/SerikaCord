#pragma once

#include <QtGlobal>

#if QT_VERSION >= QT_VERSION_CHECK(6, 7, 0)
#define SERIKA_HAS_DESKTOP_MEDIA_REQUEST 1

#include <QDialog>
#include <QWebEngineDesktopMediaRequest>

class QListWidget;
class QTabWidget;
class QPushButton;
class QAbstractItemModel;

// Discord-style "Share your screen" picker for getDisplayMedia(): a Screens
// and an Applications tab with live thumbnails where the OS allows grabbing
// them. Answers the request exactly once (select or cancel).
class ScreenPicker : public QDialog {
    Q_OBJECT

public:
    ScreenPicker(const QWebEngineDesktopMediaRequest &request, QWidget *parent = nullptr);
    ~ScreenPicker() override;

private slots:
    void rebuild();
    void accept() override;
    void reject() override;

private:
    void fillList(QListWidget *list, QAbstractItemModel *model, bool screens);
    void updateShareButton();

    QWebEngineDesktopMediaRequest m_request;
    QTabWidget *m_tabs;
    QListWidget *m_screens;
    QListWidget *m_windows;
    QPushButton *m_share;
    bool m_answered{false};
};

#endif
