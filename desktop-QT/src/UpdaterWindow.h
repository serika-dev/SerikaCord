#pragma once

#include <QWidget>
#include <QProgressBar>
#include <QLabel>
#include <QString>

class UpdaterWindow : public QWidget {
    Q_OBJECT

public:
    explicit UpdaterWindow(QWidget *parent = nullptr);
    ~UpdaterWindow() override = default;

    void showSplash();
    void closeSplash();

    void setVersionText(const QString &text);
    void setProgress(const QString &message, int percent);
    void setIndeterminate(const QString &message);
    void setDone(const QString &message);
    void setError(const QString &message);

private:
    QLabel *m_logoLabel;
    QLabel *m_titleLabel;
    QLabel *m_versionLabel;
    QLabel *m_statusLabel;
    QProgressBar *m_progressBar;
};
