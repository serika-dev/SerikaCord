#include "SingleInstance.h"

#include <QLocalSocket>
#include <QVariant>

#include <memory>

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
    // Someone already listening means another instance is running.
    QLocalSocket socket;
    socket.connectToServer(m_key);
    if (socket.waitForConnected(500)) {
        socket.disconnectFromServer();
        return false;
    }

    // No live instance: clear a stale socket left by a crash and listen.
    QLocalServer::removeServer(m_key);
    m_server = new QLocalServer(this);
    m_server->setSocketOptions(QLocalServer::UserAccessOption);
    bool listening = m_server->listen(m_key);
    if (!listening) {
        // UserAccessOption binds in $TMPDIR and renames into place, which
        // fails when $TMPDIR is on another filesystem; plain listen still works.
        QLocalServer::removeServer(m_key);
        m_server->setSocketOptions(QLocalServer::NoOptions);
        listening = m_server->listen(m_key);
    }
    if (!listening) {
        delete m_server;
        m_server = nullptr;
        // Couldn't listen (odd permissions): run anyway rather than refuse to start.
        return true;
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
    while (QLocalSocket *socket = m_server->nextPendingConnection()) {
        // Read asynchronously: the sender writes, then disconnects.
        auto buffer = std::make_shared<QByteArray>();
        auto finish = [this, socket, buffer]() {
            if (socket->property("serikaDone").toBool()) return;
            socket->setProperty("serikaDone", true);
            buffer->append(socket->readAll());
            emit anotherInstanceStarted(QString::fromUtf8(buffer->left(4096)));
            socket->deleteLater();
        };
        connect(socket, &QLocalSocket::readyRead, this, [socket, buffer]() {
            buffer->append(socket->readAll());
        });
        connect(socket, &QLocalSocket::disconnected, this, finish);
        if (socket->state() != QLocalSocket::ConnectedState) finish();
    }
}
