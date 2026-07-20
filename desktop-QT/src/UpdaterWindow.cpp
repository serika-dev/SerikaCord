#include "UpdaterWindow.h"

#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFrame>
#include <QGraphicsDropShadowEffect>
#include <QScreen>
#include <QGuiApplication>
#include <QApplication>
#include <QPropertyAnimation>
#include <QPixmap>

UpdaterWindow::UpdaterWindow(QWidget *parent)
    : QWidget(parent)
{
    setWindowTitle("SerikaCord");
    setFixedSize(420, 340);
    setWindowFlags(Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint |
                   Qt::Dialog | Qt::CustomizeWindowHint);
    setAttribute(Qt::WA_TranslucentBackground, false);

    // Clean dark background, no gradients
    setStyleSheet("background-color: #16161a; color: #fff; border: 1px solid #2a2a30;");

    auto *layout = new QVBoxLayout(this);
    layout->setAlignment(Qt::AlignCenter);
    layout->setSpacing(14);
    layout->setContentsMargins(36, 40, 36, 32);

    // Logo — use the web app's icon (pre-rendered PNG from logo-icon.svg)
    m_logoLabel = new QLabel(this);
    m_logoLabel->setFixedSize(72, 72);
    m_logoLabel->setAlignment(Qt::AlignCenter);
    {
        QPixmap pixmap(QStringLiteral(":/icons/logo-icon.png"));
        if (!pixmap.isNull()) {
            m_logoLabel->setPixmap(pixmap.scaled(72, 72, Qt::KeepAspectRatio, Qt::SmoothTransformation));
        }
    }

    // Title
    m_titleLabel = new QLabel("SerikaCord", this);
    m_titleLabel->setAlignment(Qt::AlignCenter);
    m_titleLabel->setStyleSheet("font-size: 18px; font-weight: 700; color: #e8e8ee;");

    // Version
    m_versionLabel = new QLabel("", this);
    m_versionLabel->setAlignment(Qt::AlignCenter);
    m_versionLabel->setStyleSheet("font-size: 12px; color: #6a6a7a;");

    // Status
    m_statusLabel = new QLabel("Checking for updates…", this);
    m_statusLabel->setAlignment(Qt::AlignCenter);
    m_statusLabel->setStyleSheet("font-size: 13px; color: #9a9aaa;");

    // Progress bar
    m_progressBar = new QProgressBar(this);
    m_progressBar->setFixedWidth(280);
    m_progressBar->setRange(0, 100);
    m_progressBar->setTextVisible(false);
    m_progressBar->setStyleSheet(
        "QProgressBar {"
        "  background: rgba(255,255,255,0.06);"
        "  border: none; border-radius: 2px;"
        "  height: 3px;"
        "}"
        "QProgressBar::chunk {"
        "  background: #8B5CF6;"
        "  border-radius: 2px;"
        "}"
    );

    layout->addWidget(m_logoLabel, 0, Qt::AlignCenter);
    layout->addWidget(m_titleLabel, 0, Qt::AlignCenter);
    layout->addWidget(m_versionLabel, 0, Qt::AlignCenter);
    layout->addWidget(m_statusLabel, 0, Qt::AlignCenter);
    layout->addWidget(m_progressBar, 0, Qt::AlignCenter);
}

void UpdaterWindow::showSplash() {
    // Center on screen
    auto screen = QGuiApplication::primaryScreen();
    if (screen) {
        auto geometry = screen->availableGeometry();
        move((geometry.width() - width()) / 2 + geometry.x(),
             (geometry.height() - height()) / 2 + geometry.y());
    }

    show();
    raise();
    activateWindow();
}

void UpdaterWindow::closeSplash() {
    close();
}

void UpdaterWindow::setVersionText(const QString &text) {
    m_versionLabel->setText(text);
}

void UpdaterWindow::setProgress(const QString &message, int percent) {
    m_statusLabel->setText(message);
    m_progressBar->setRange(0, 100);
    m_progressBar->setValue(percent);
}

void UpdaterWindow::setIndeterminate(const QString &message) {
    m_statusLabel->setText(message);
    m_progressBar->setRange(0, 0); // indeterminate (animated)
}

void UpdaterWindow::setDone(const QString &message) {
    m_statusLabel->setText(message);
    m_progressBar->setRange(0, 100);
    m_progressBar->setValue(100);
}

void UpdaterWindow::setError(const QString &message) {
    m_statusLabel->setText("Starting SerikaCord…");
    m_progressBar->setRange(0, 100);
    m_progressBar->setValue(0);
}
