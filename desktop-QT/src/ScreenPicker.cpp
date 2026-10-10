#include "ScreenPicker.h"

#ifdef SERIKA_HAS_DESKTOP_MEDIA_REQUEST

#include <QAbstractListModel>
#include <QApplication>
#include <QDialogButtonBox>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QIcon>
#include <QLabel>
#include <QListWidget>
#include <QPainter>
#include <QPixmap>
#include <QPushButton>
#include <QScreen>
#include <QStyle>
#include <QTabWidget>
#include <QTimer>
#include <QVBoxLayout>

namespace {
constexpr int THUMB_W = 240;
constexpr int THUMB_H = 135;
constexpr int ROW_ROLE = Qt::UserRole + 1;

// Letterboxed thumbnail on a dark card, so every tile is the same size.
QPixmap card(const QPixmap &content, const QIcon &fallback) {
    QPixmap out(THUMB_W, THUMB_H);
    out.fill(QColor(0x1e, 0x1f, 0x22));
    QPainter p(&out);
    p.setRenderHint(QPainter::SmoothPixmapTransform);
    if (!content.isNull()) {
        const QPixmap s = content.scaled(THUMB_W, THUMB_H, Qt::KeepAspectRatio, Qt::SmoothTransformation);
        p.drawPixmap((THUMB_W - s.width()) / 2, (THUMB_H - s.height()) / 2, s);
    } else {
        const QPixmap icon = fallback.pixmap(56, 56);
        p.drawPixmap((THUMB_W - icon.width()) / 2, (THUMB_H - icon.height()) / 2, icon);
    }
    return out;
}
}

ScreenPicker::ScreenPicker(const QWebEngineDesktopMediaRequest &request, QWidget *parent)
    : QDialog(parent)
    , m_request(request)
    , m_tabs(new QTabWidget(this))
    , m_screens(new QListWidget(this))
    , m_windows(new QListWidget(this))
    , m_share(nullptr)
{
    setWindowTitle(tr("Share your screen"));
    setModal(true);
    resize(820, 560);

    for (QListWidget *list : {m_screens, m_windows}) {
        list->setViewMode(QListView::IconMode);
        list->setIconSize(QSize(THUMB_W, THUMB_H));
        list->setGridSize(QSize(THUMB_W + 24, THUMB_H + 48));
        list->setResizeMode(QListView::Adjust);
        list->setMovement(QListView::Static);
        list->setUniformItemSizes(true);
        list->setWordWrap(true);
        list->setSelectionMode(QAbstractItemView::SingleSelection);
        connect(list, &QListWidget::itemSelectionChanged, this, &ScreenPicker::updateShareButton);
        connect(list, &QListWidget::itemDoubleClicked, this, [this]() { accept(); });
    }
    m_tabs->addTab(m_screens, tr("Screens"));
    m_tabs->addTab(m_windows, tr("Applications"));
    connect(m_tabs, &QTabWidget::currentChanged, this, &ScreenPicker::updateShareButton);

    auto *heading = new QLabel(tr("Choose what to share"), this);
    QFont f = heading->font();
    f.setPointSizeF(f.pointSizeF() * 1.25);
    f.setBold(true);
    heading->setFont(f);

    auto *buttons = new QDialogButtonBox(this);
    m_share = buttons->addButton(tr("Go Live"), QDialogButtonBox::AcceptRole);
    buttons->addButton(QDialogButtonBox::Cancel);
    connect(buttons, &QDialogButtonBox::accepted, this, &ScreenPicker::accept);
    connect(buttons, &QDialogButtonBox::rejected, this, &ScreenPicker::reject);

    auto *layout = new QVBoxLayout(this);
    layout->addWidget(heading);
    layout->addWidget(m_tabs, 1);
    layout->addWidget(buttons);

    // Sources are discovered asynchronously; refresh as the models change.
    for (QAbstractItemModel *model : {static_cast<QAbstractItemModel *>(m_request.screensModel()),
                                      static_cast<QAbstractItemModel *>(m_request.windowsModel())}) {
        if (!model) continue;
        connect(model, &QAbstractItemModel::rowsInserted, this, &ScreenPicker::rebuild);
        connect(model, &QAbstractItemModel::rowsRemoved, this, &ScreenPicker::rebuild);
        connect(model, &QAbstractItemModel::modelReset, this, &ScreenPicker::rebuild);
        connect(model, &QAbstractItemModel::dataChanged, this, &ScreenPicker::rebuild);
    }
    rebuild();
}

ScreenPicker::~ScreenPicker() {
    if (!m_answered) m_request.cancel();
}

void ScreenPicker::fillList(QListWidget *list, QAbstractItemModel *model, bool screens) {
    const int previous = list->currentRow();
    list->clear();
    if (!model) return;
    const QList<QScreen *> qtScreens = QGuiApplication::screens();
    const QIcon screenIcon = style()->standardIcon(QStyle::SP_DesktopIcon);
    const QIcon windowIcon = style()->standardIcon(QStyle::SP_TitleBarNormalButton);
    for (int row = 0; row < model->rowCount(); ++row) {
        const QString name = model->data(model->index(row, 0), Qt::DisplayRole).toString();
        QPixmap thumb;
        // Chromium lists screens in the same order Qt reports them; grabbing
        // works on Windows, macOS (with permission) and X11 but not Wayland.
        if (screens && row < qtScreens.size() && model->rowCount() == qtScreens.size()) {
            thumb = qtScreens[row]->grabWindow(0);
        }
        auto *item = new QListWidgetItem(QIcon(card(thumb, screens ? screenIcon : windowIcon)),
                                         name.isEmpty() ? (screens ? tr("Screen %1").arg(row + 1) : tr("Window"))
                                                        : name);
        item->setData(ROW_ROLE, row);
        item->setToolTip(name);
        list->addItem(item);
    }
    if (previous >= 0 && previous < list->count()) list->setCurrentRow(previous);
    else if (screens && list->count() > 0 && list->currentRow() < 0) list->setCurrentRow(0);
}

void ScreenPicker::rebuild() {
    // Coalesce bursts of model updates.
    static const char *PENDING = "serikaRebuildPending";
    if (property(PENDING).toBool()) return;
    setProperty(PENDING, true);
    QTimer::singleShot(120, this, [this]() {
        setProperty(PENDING, false);
        fillList(m_screens, m_request.screensModel(), true);
        fillList(m_windows, m_request.windowsModel(), false);
        m_tabs->setTabEnabled(1, m_windows->count() > 0);
        updateShareButton();
    });
}

void ScreenPicker::updateShareButton() {
    if (!m_share) return;
    QListWidget *list = m_tabs->currentIndex() == 0 ? m_screens : m_windows;
    m_share->setEnabled(list->currentItem() != nullptr);
}

void ScreenPicker::accept() {
    if (m_answered) return;
    const bool screens = m_tabs->currentIndex() == 0;
    QListWidget *list = screens ? m_screens : m_windows;
    QListWidgetItem *item = list->currentItem();
    if (!item) return;
    const int row = item->data(ROW_ROLE).toInt();
    QAbstractListModel *model = screens ? m_request.screensModel() : m_request.windowsModel();
    if (!model || row >= model->rowCount()) return;
    m_answered = true;
    if (screens) m_request.selectScreen(model->index(row, 0));
    else m_request.selectWindow(model->index(row, 0));
    QDialog::accept();
}

void ScreenPicker::reject() {
    if (!m_answered) {
        m_answered = true;
        m_request.cancel();
    }
    QDialog::reject();
}

#endif
