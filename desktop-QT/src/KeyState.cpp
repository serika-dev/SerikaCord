#include "KeyState.h"

#include <cctype>
#include <cstring>

#if defined(_WIN32)
#  ifndef NOMINMAX
#    define NOMINMAX
#  endif
#  include <windows.h>
#elif defined(__APPLE__)
#  include <ApplicationServices/ApplicationServices.h>
#elif defined(SERIKA_HAVE_X11)
#  include <X11/Xlib.h>
#  include <X11/keysym.h>
#endif

namespace {

// ── Platform-neutral token parsing ──────────────────────────────────────────

enum class Kind { Letter, Digit, Function, Named, Punct, Numpad, Mouse };
struct Logical { Kind kind; int value; };

// Named keys, in the order of the per-platform tables below.
const char *const NAMED[] = {
    "Space", "Tab", "Enter", "Escape", "Backspace", "Insert", "Delete", "Home",
    "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right", "CapsLock",
    "Pause", "ScrollLock",
};
constexpr int NAMED_COUNT = sizeof(NAMED) / sizeof(NAMED[0]);
// Punctuation (US layout positions), in the order of the per-platform tables.
const char PUNCT[] = "`-=[]\\;',./";
constexpr int PUNCT_COUNT = sizeof(PUNCT) - 1;

constexpr int MOUSE_BASE = 0x100000;

bool equalsIgnoreCase(const std::string &a, const char *b) {
    const size_t n = std::strlen(b);
    if (a.size() != n) return false;
    for (size_t i = 0; i < n; ++i) {
        if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i]))) return false;
    }
    return true;
}

bool parse(const std::string &t, Logical &out) {
    if (t.size() == 1) {
        const char c = t[0];
        if (c >= 'a' && c <= 'z') { out = {Kind::Letter, c - 'a'}; return true; }
        if (c >= 'A' && c <= 'Z') { out = {Kind::Letter, c - 'A'}; return true; }
        if (c >= '0' && c <= '9') { out = {Kind::Digit, c - '0'}; return true; }
        const char *p = std::strchr(PUNCT, c);
        if (p && c != '\0') { out = {Kind::Punct, static_cast<int>(p - PUNCT)}; return true; }
        return false;
    }
    if ((t[0] == 'F' || t[0] == 'f') && t.size() <= 3) {
        int n = 0;
        for (size_t i = 1; i < t.size(); ++i) {
            if (!std::isdigit(static_cast<unsigned char>(t[i]))) return false;
            n = n * 10 + (t[i] - '0');
        }
        if (n >= 1 && n <= 24) { out = {Kind::Function, n}; return true; }
        return false;
    }
    if (t.size() == 4 && equalsIgnoreCase(t.substr(0, 3), "Num") && std::isdigit(static_cast<unsigned char>(t[3]))) {
        out = {Kind::Numpad, t[3] - '0'};
        return true;
    }
    if (equalsIgnoreCase(t, "Mouse4")) { out = {Kind::Mouse, 4}; return true; }
    if (equalsIgnoreCase(t, "Mouse5")) { out = {Kind::Mouse, 5}; return true; }
    for (int i = 0; i < NAMED_COUNT; ++i) {
        if (equalsIgnoreCase(t, NAMED[i])) { out = {Kind::Named, i}; return true; }
    }
    return false;
}

} // namespace

// ═════════════════════════════════════════════════════════════════════════════
#if defined(_WIN32)

namespace {
const int NAMED_VK[NAMED_COUNT] = {
    VK_SPACE, VK_TAB, VK_RETURN, VK_ESCAPE, VK_BACK, VK_INSERT, VK_DELETE, VK_HOME,
    VK_END, VK_PRIOR, VK_NEXT, VK_UP, VK_DOWN, VK_LEFT, VK_RIGHT, VK_CAPITAL,
    VK_PAUSE, VK_SCROLL,
};
const int PUNCT_VK[PUNCT_COUNT] = {
    VK_OEM_3, VK_OEM_MINUS, VK_OEM_PLUS, VK_OEM_4, VK_OEM_6, VK_OEM_5, VK_OEM_1,
    VK_OEM_7, VK_OEM_COMMA, VK_OEM_PERIOD, VK_OEM_2,
};
bool down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
}

namespace KeyState {
bool available() { return true; }

int nativeKey(const std::string &token) {
    Logical l{};
    if (!parse(token, l)) return -1;
    switch (l.kind) {
    case Kind::Letter: return 'A' + l.value;
    case Kind::Digit: return '0' + l.value;
    case Kind::Function: return VK_F1 + (l.value - 1);
    case Kind::Named: return NAMED_VK[l.value];
    case Kind::Punct: return PUNCT_VK[l.value];
    case Kind::Numpad: return VK_NUMPAD0 + l.value;
    case Kind::Mouse: return l.value == 4 ? VK_XBUTTON1 : VK_XBUTTON2;
    }
    return -1;
}

void snapshot() {}
bool isDown(int key) { return key >= 0 && down(key); }

unsigned modifiers() {
    unsigned m = 0;
    if (down(VK_CONTROL)) m |= Ctrl;
    if (down(VK_SHIFT)) m |= Shift;
    if (down(VK_MENU)) m |= Alt;
    if (down(VK_LWIN) || down(VK_RWIN)) m |= Meta;
    return m;
}

unsigned long long inputFingerprint() { return 0; }

long long systemIdleSeconds() {
    LASTINPUTINFO lii;
    lii.cbSize = sizeof(lii);
    if (!GetLastInputInfo(&lii)) return -1;
    return static_cast<long long>((GetTickCount() - lii.dwTime) / 1000);
}

void shutdown() {}
} // namespace KeyState

// ═════════════════════════════════════════════════════════════════════════════
#elif defined(__APPLE__)

namespace {
// kVK_ANSI_* virtual key codes (Carbon Events.h), A..Z.
const int LETTER_VK[26] = {
    0x00, 0x0B, 0x08, 0x02, 0x0E, 0x03, 0x05, 0x04, 0x22, 0x26, 0x28, 0x25, 0x2E,
    0x2D, 0x1F, 0x23, 0x0C, 0x0F, 0x01, 0x11, 0x20, 0x09, 0x0D, 0x07, 0x10, 0x06,
};
const int DIGIT_VK[10] = { 0x1D, 0x12, 0x13, 0x14, 0x15, 0x17, 0x16, 0x1A, 0x1C, 0x19 };
const int FUNCTION_VK[20] = {
    0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F,
    0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50, 0x5A,
};
const int NAMED_VK[NAMED_COUNT] = {
    0x31, 0x30, 0x24, 0x35, 0x33, 0x72, 0x75, 0x73,
    0x77, 0x74, 0x79, 0x7E, 0x7D, 0x7B, 0x7C, 0x39,
    -1, -1,
};
const int PUNCT_VK[PUNCT_COUNT] = { 0x32, 0x1B, 0x18, 0x21, 0x1E, 0x2A, 0x29, 0x27, 0x2B, 0x2F, 0x2C };
const int NUMPAD_VK[10] = { 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5B, 0x5C };
}

namespace KeyState {
bool available() { return true; }

int nativeKey(const std::string &token) {
    Logical l{};
    if (!parse(token, l)) return -1;
    switch (l.kind) {
    case Kind::Letter: return LETTER_VK[l.value];
    case Kind::Digit: return DIGIT_VK[l.value];
    case Kind::Function: return l.value <= 20 ? FUNCTION_VK[l.value - 1] : -1;
    case Kind::Named: return NAMED_VK[l.value];
    case Kind::Punct: return PUNCT_VK[l.value];
    case Kind::Numpad: return NUMPAD_VK[l.value];
    case Kind::Mouse: return MOUSE_BASE + (l.value - 1); // CGMouseButton 3 / 4
    }
    return -1;
}

void snapshot() {}

bool isDown(int key) {
    if (key < 0) return false;
    if (key >= MOUSE_BASE) {
        return CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState,
                                        static_cast<CGMouseButton>(key - MOUSE_BASE));
    }
    return CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, static_cast<CGKeyCode>(key));
}

unsigned modifiers() {
    const CGEventFlags f = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
    unsigned m = 0;
    // ⌘ maps to "Ctrl" so the same accelerator means Cmd on macOS, like the web app.
    if (f & kCGEventFlagMaskCommand) m |= Ctrl;
    if (f & kCGEventFlagMaskShift) m |= Shift;
    if (f & kCGEventFlagMaskAlternate) m |= Alt;
    if (f & kCGEventFlagMaskControl) m |= Meta;
    return m;
}

unsigned long long inputFingerprint() { return 0; }

long long systemIdleSeconds() {
    const double s = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState,
                                                            kCGAnyInputEventType);
    return s < 0 ? -1 : static_cast<long long>(s);
}

void shutdown() {}
} // namespace KeyState

// ═════════════════════════════════════════════════════════════════════════════
#elif defined(SERIKA_HAVE_X11)

namespace {
Display *g_display = nullptr;
bool g_triedOpen = false;
char g_keys[32] = {};
unsigned int g_buttons = 0;
int g_rootX = 0, g_rootY = 0;
bool g_haveSnapshot = false;

Display *display() {
    if (!g_display && !g_triedOpen) {
        g_triedOpen = true;
        g_display = XOpenDisplay(nullptr);
    }
    return g_display;
}

const KeySym NAMED_SYM[NAMED_COUNT] = {
    XK_space, XK_Tab, XK_Return, XK_Escape, XK_BackSpace, XK_Insert, XK_Delete, XK_Home,
    XK_End, XK_Page_Up, XK_Page_Down, XK_Up, XK_Down, XK_Left, XK_Right, XK_Caps_Lock,
    XK_Pause, XK_Scroll_Lock,
};
const KeySym PUNCT_SYM[PUNCT_COUNT] = {
    XK_grave, XK_minus, XK_equal, XK_bracketleft, XK_bracketright, XK_backslash,
    XK_semicolon, XK_apostrophe, XK_comma, XK_period, XK_slash,
};

bool keycodeDown(int kc) {
    if (kc <= 0 || kc > 255) return false;
    return (g_keys[kc / 8] & (1 << (kc % 8))) != 0;
}

bool symDown(KeySym sym) {
    Display *d = display();
    if (!d) return false;
    return keycodeDown(XKeysymToKeycode(d, sym));
}
}

namespace KeyState {
bool available() { return display() != nullptr; }

int nativeKey(const std::string &token) {
    Display *d = display();
    if (!d) return -1;
    Logical l{};
    if (!parse(token, l)) return -1;
    KeySym sym = NoSymbol;
    switch (l.kind) {
    case Kind::Letter: sym = XK_a + l.value; break;
    case Kind::Digit: sym = XK_0 + l.value; break;
    case Kind::Function: sym = XK_F1 + (l.value - 1); break;
    case Kind::Named: sym = NAMED_SYM[l.value]; break;
    case Kind::Punct: sym = PUNCT_SYM[l.value]; break;
    case Kind::Numpad: sym = XK_KP_0 + l.value; break;
    case Kind::Mouse: return -1; // X core protocol only reports buttons 1-5
    }
    const KeyCode kc = XKeysymToKeycode(d, sym);
    return kc == 0 ? -1 : static_cast<int>(kc);
}

void snapshot() {
    Display *d = display();
    if (!d) return;
    XQueryKeymap(d, g_keys);
    Window root = DefaultRootWindow(d), rootRet = 0, childRet = 0;
    int winX = 0, winY = 0;
    unsigned int mask = 0;
    if (XQueryPointer(d, root, &rootRet, &childRet, &g_rootX, &g_rootY, &winX, &winY, &mask)) {
        g_buttons = mask & (Button1Mask | Button2Mask | Button3Mask | Button4Mask | Button5Mask);
    }
    g_haveSnapshot = true;
}

bool isDown(int key) { return g_haveSnapshot && keycodeDown(key); }

unsigned modifiers() {
    if (!g_haveSnapshot) return 0;
    unsigned m = 0;
    if (symDown(XK_Control_L) || symDown(XK_Control_R)) m |= Ctrl;
    if (symDown(XK_Shift_L) || symDown(XK_Shift_R)) m |= Shift;
    if (symDown(XK_Alt_L) || symDown(XK_Alt_R) || symDown(XK_ISO_Level3_Shift)) m |= Alt;
    if (symDown(XK_Super_L) || symDown(XK_Super_R)) m |= Meta;
    return m;
}

unsigned long long inputFingerprint() {
    if (!display()) return 0;
    snapshot();
    unsigned long long h = 1469598103934665603ULL; // FNV-1a
    auto mix = [&h](unsigned long long v) { h ^= v; h *= 1099511628211ULL; };
    for (char k : g_keys) mix(static_cast<unsigned char>(k));
    mix(static_cast<unsigned long long>(g_rootX) & 0xffffffffULL);
    mix(static_cast<unsigned long long>(g_rootY) & 0xffffffffULL);
    mix(g_buttons);
    return h == 0 ? 1 : h;
}

long long systemIdleSeconds() { return -1; }

void shutdown() {
    if (g_display) {
        XCloseDisplay(g_display);
        g_display = nullptr;
    }
}
} // namespace KeyState

// ═════════════════════════════════════════════════════════════════════════════
#else // no backend

namespace KeyState {
bool available() { return false; }
int nativeKey(const std::string &) { return -1; }
void snapshot() {}
bool isDown(int) { return false; }
unsigned modifiers() { return 0; }
unsigned long long inputFingerprint() { return 0; }
long long systemIdleSeconds() { return -1; }
void shutdown() {}
} // namespace KeyState

#endif
