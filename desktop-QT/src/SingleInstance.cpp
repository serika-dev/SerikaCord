#include "SingleInstance.h"

#include <QLocalSocket>

SingleInstance::SingleInstance(const QString &key, QObject *parent)
    : QObject(parent)
    , m_key(key)
    , m_server(nullptr)
{
}

SingleInstance::~SingleInstance() {
    release();
}

bool SingleInstance::tryLock() {
    // Try connecting to an existing server
    QLocalSocket socket;
    socket.connectToServer(m_key);
    if (socket.waitForConnected(500)) {
        // Another instance is running
        socket.disconnectFromServer();
        return false;
    }

    // No existing instance — create the server
    // Clean up stale socket file
    QLocalServer::removeServer(m_key);

    m_server = new QLocalServer(this);
    if (!m_server->listen(m_key)) {
        delete m_server;
        m_server = nullptr;
        return false;
    }

    connect(m_server, &QLocalServer::newConnection, this, &SingleInstance::onNewConnection);
    return true;
}

void SingleInstance::release() {
    if (m_server) {
        m_server->close();
        delete m_server;
        m_server = nullptr;
    }
}

void SingleInstance::onNewConnection() {
    QLocalSocket *socket = m_server->nextPendingConnection();
    if (!socket) return;

    if (socket->waitForReadyRead(1000)) {
        QByteArray data = socket->readAll();
        QString message = QString::fromUtf8(data);
        emit anotherInstanceStarted(message);
    }

    socket->deleteLater();
}
