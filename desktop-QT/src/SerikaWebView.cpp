#include "SerikaWebView.h"
#include "SerikaWebPage.h"

#include <QApplication>
#include <QClipboard>
#include <QContextMenuEvent>
#include <QMenu>
#include <QWebEngineContextMenuRequest>
#include <QWebEngineProfile>

namespace {
constexpr int MAX_SUGGESTIONS = 5;
}

SerikaWebView::SerikaWebView(QWidget *parent)
    : QWebEngineView(parent)
{
}

void SerikaWebView::contextMenuEvent(QContextMenuEvent *event) {
    QWebEngineContextMenuRequest *req = lastContextMenuRequest();
    QWebEnginePage *p = page();
    if (!req || !p) return;

    auto *menu = new QMenu(this);
    menu->setAttribute(Qt::WA_DeleteOnClose);

    if (req->isContentEditable()) {
        const QString word = req->misspelledWord();
        if (!word.isEmpty()) {
            const QStringList suggestions = req->spellCheckerSuggestions();
            if (suggestions.isEmpty()) {
                menu->addAction(tr("No spelling suggestions"))->setEnabled(false);
            }
            for (int i = 0; i < suggestions.size() && i < MAX_SUGGESTIONS; ++i) {
                QAction *a = menu->addAction(suggestions[i]);
                QFont f = a->font();
                f.setBold(true);
                a->setFont(f);
                const QString s = suggestions[i];
                connect(a, &QAction::triggered, p, [p, s]() { p->replaceMisspelledWord(s); });
            }
            menu->addSeparator();
        }
        menu->addAction(p->action(QWebEnginePage::Undo));
        menu->addAction(p->action(QWebEnginePage::Redo));
        menu->addSeparator();
        menu->addAction(p->action(QWebEnginePage::Cut));
        menu->addAction(p->action(QWebEnginePage::Copy));
        menu->addAction(p->action(QWebEnginePage::Paste));
        menu->addAction(p->action(QWebEnginePage::PasteAndMatchStyle));
        menu->addAction(p->action(QWebEnginePage::SelectAll));
        menu->addSeparator();
        QAction *spell = menu->addAction(tr("Check Spelling"));
        spell->setCheckable(true);
        const bool on = p->profile() && p->profile()->isSpellCheckEnabled();
        spell->setChecked(on);
        connect(spell, &QAction::toggled, this, &SerikaWebView::spellcheckToggled);
    } else {
        if (!req->selectedText().isEmpty()) {
            menu->addAction(p->action(QWebEnginePage::Copy));
        }
        const QUrl link = req->linkUrl();
        if (link.isValid() && !link.isEmpty()) {
            if (!menu->isEmpty()) menu->addSeparator();
            QAction *open = menu->addAction(tr("Open Link"));
            connect(open, &QAction::triggered, this, [link]() { openExternally(link); });
            menu->addAction(p->action(QWebEnginePage::CopyLinkToClipboard));
        }
        if (req->mediaType() == QWebEngineContextMenuRequest::MediaTypeImage) {
            if (!menu->isEmpty()) menu->addSeparator();
            menu->addAction(p->action(QWebEnginePage::CopyImageToClipboard));
            menu->addAction(p->action(QWebEnginePage::DownloadImageToDisk));
            const QUrl media = req->mediaUrl();
            if (media.scheme().startsWith(QLatin1String("http"))) {
                QAction *copyAddr = menu->addAction(tr("Copy Image Address"));
                connect(copyAddr, &QAction::triggered, this, [media]() {
                    QApplication::clipboard()->setText(media.toString());
                });
            }
        }
    }

    if (menu->isEmpty()) {
        delete menu;
        return;
    }
    menu->popup(event->globalPos());
}
