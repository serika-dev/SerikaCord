#pragma once

#include <QObject>
#include <QString>

class DeepLinkHandler : public QObject {
    Q_OBJECT

public:
    explicit DeepLinkHandler(QObject *parent = nullptr);
    ~DeepLinkHandler() override = default;

    void registerScheme();
    void handleLink(const QString &link);

    static QString normalizeLink(const QString &link);

signals:
    void deepLinkReceived(const QString &path);
};
