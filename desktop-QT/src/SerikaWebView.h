#pragma once

#include <QWebEngineView>

// Web view with a native context menu where the page doesn't draw its own:
// spellcheck suggestions in text fields, cut/copy/paste, and link/image items.
class SerikaWebView : public QWebEngineView {
    Q_OBJECT
public:
    explicit SerikaWebView(QWidget *parent = nullptr);

signals:
    void spellcheckToggled(bool enabled);

protected:
    void contextMenuEvent(QContextMenuEvent *event) override;
};
