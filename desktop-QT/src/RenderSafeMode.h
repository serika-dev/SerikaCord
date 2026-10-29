#pragma once

#include <QString>
#include <QStringList>

// Keeps the page (Chromium renderer) alive on hosts where the bundled
// QtWebEngine's defaults kill it, which shows up as a blank window (CORD-69),
// and prints the one log a bug report needs.
//
// On Linux a renderer that dies before the app ever loaded moves the app one
// step down this ladder and relaunches it; the step that works is remembered
// until the next app version (which probes from the top again):
//   0 Normal     full Chromium sandbox, GPU per the user's preference
//   1 NoSeccomp  --disable-seccomp-filter-sandbox (namespace sandbox stays)
//   2 NoSandbox  --no-sandbox (QTWEBENGINE_DISABLE_SANDBOX=1)
//   3 Software   --no-sandbox --no-zygote, no GPU, Qt Quick software
//                rendering, Mesa llvmpipe
// When even step 3 fails the window shows a native message with "Open in
// browser" instead of staying blank.
//
// Overrides: SERIKA_RENDER_MODE=0..3 pins a step (no automatic changes),
// SERIKA_DISABLE_SECCOMP=1 is at least step 1. `--diagnostics` or
// SERIKACORD_DEBUG=1 prints paths, environment, flags and renderer exits.
namespace RenderSafeMode {

enum Level { Normal = 0, NoSeccomp = 1, NoSandbox = 2, Software = 3 };
constexpr int MaxLevel = Software;

// Before QApplication exists: reads argv for --diagnostics, picks the step and
// exports QTWEBENGINE_CHROMIUM_FLAGS (after whatever the user set),
// QTWEBENGINE_DISABLE_SANDBOX, QT_QUICK_BACKEND and LIBGL_ALWAYS_SOFTWARE.
void configure(int argc, char **argv);

bool diagnostics();
int level();
QString levelName(int level);

// What this launch overrides (environment variables, Chromium switches,
// --diagnostics), empty when nothing. A running instance started with
// different overrides is replaced instead of reused, so they take effect.
QString overridesFingerprint(const QStringList &unknownOptions);
void rememberRunningFingerprint(const QString &fingerprint);
QString runningFingerprint();

// Writes to stderr with a "SerikaCord:" prefix; debug() only in diagnostics mode.
void log(const QString &line);
void debug(const QString &line);

// After QApplication: Qt/WebEngine paths, bundled files, environment, flags.
QString report();
void printReport();

// "signal 31 (SIGSYS), core dumped" / "exit code 1" for Chromium's raw wait status.
QString describeExit(int exitCode);

enum class Action { Ignore, Reload, Relaunch, GiveUp };
// A page renderer ended. status is QWebEnginePage::RenderProcessTerminationStatus.
// Relaunch means the next step is already saved: call relaunch() and quit.
Action onRendererTerminated(int status, int exitCode, bool earlyInSession);
QString lastFailure();

// Starts this app again (same arguments, the environment the user started it
// with) once this process has exited. resetLevel starts from step 0.
bool relaunch(bool resetLevel);

// A relaunched process waits here for the previous one to exit before it
// takes the single-instance lock.
void waitForPreviousInstance();

} // namespace RenderSafeMode
