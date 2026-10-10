cmake_minimum_required(VERSION 3.21)
project(SerikaCord VERSION 2.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# ── Qt dependencies ──────────────────────────────────────────────────────────
find_package(Qt6 REQUIRED COMPONENTS
    Widgets
    WebEngineWidgets
    WebEngineCore
    Network
    WebChannel
)

# Linux: D-Bus for native notifications and idle time; X11 for global
# shortcuts (push-to-talk) and the idle fallback. Both optional.
if(UNIX AND NOT APPLE)
    find_package(Qt6 COMPONENTS DBus)
    find_package(X11)
endif()

# OpenSSL provides Ed25519 + BLAKE2b for verifying minisign update signatures.
find_package(OpenSSL REQUIRED)

# ── Sources ──────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    src/AppConfig.cpp
    src/AppSettings.cpp
    src/AutoStart.cpp
    src/MainWindow.cpp
    src/SerikaWebPage.cpp
    src/SerikaWebView.cpp
    src/Updater.cpp
    src/TrayIcon.cpp
    src/SingleInstance.cpp
    src/UpdaterWindow.cpp
    src/PresenceDetector.cpp
    src/WebBridge.cpp
    src/DeepLinkHandler.cpp
    src/NotificationManager.cpp
    src/GlobalShortcuts.cpp
    src/KeyState.cpp
    src/IdleMonitor.cpp
    src/ScreenPicker.cpp
)

set(HEADERS
    src/AppConfig.h
    src/AppSettings.h
    src/AutoStart.h
    src/MainWindow.h
    src/InjectedScripts.h
    src/Updater.h
    src/SerikaWebPage.h
    src/SerikaWebView.h
    src/TrayIcon.h
    src/SingleInstance.h
    src/UpdaterWindow.h
    src/PresenceDetector.h
    src/WebBridge.h
    src/DeepLinkHandler.h
    src/NotificationManager.h
    src/GlobalShortcuts.h
    src/KeyState.h
    src/IdleMonitor.h
    src/ScreenPicker.h
)

set(RESOURCES
    src/resources/serikacord.qrc
)

# ── Executable ───────────────────────────────────────────────────────────────
if(WIN32)
    add_executable(${PROJECT_NAME} WIN32 ${SOURCES} ${HEADERS} ${RESOURCES})
else()
    add_executable(${PROJECT_NAME} ${SOURCES} ${HEADERS} ${RESOURCES})
endif()

target_link_libraries(${PROJECT_NAME} PRIVATE
    Qt6::Widgets
    Qt6::WebEngineWidgets
    Qt6::WebEngineCore
    Qt6::Network
    Qt6::WebChannel
    OpenSSL::Crypto
)

target_include_directories(${PROJECT_NAME} PRIVATE src)

# The app reports the CMake project version (bumped by scripts/release.ts).
target_compile_definitions(${PROJECT_NAME} PRIVATE SERIKA_APP_VERSION="${PROJECT_VERSION}")

if(UNIX AND NOT APPLE)
    if(TARGET Qt6::DBus)
        target_link_libraries(${PROJECT_NAME} PRIVATE Qt6::DBus)
        target_compile_definitions(${PROJECT_NAME} PRIVATE SERIKA_HAVE_DBUS=1)
    else()
        message(WARNING "Qt6 DBus not found: native Linux notifications and idle detection are limited")
    endif()
    if(X11_FOUND)
        target_include_directories(${PROJECT_NAME} PRIVATE ${X11_INCLUDE_DIR})
        target_link_libraries(${PROJECT_NAME} PRIVATE ${X11_LIBRARIES})
        target_compile_definitions(${PROJECT_NAME} PRIVATE SERIKA_HAVE_X11=1)
    else()
        message(WARNING "libX11 not found: global shortcuts (push-to-talk) are disabled on Linux")
    endif()
endif()

# ── Platform-specific ────────────────────────────────────────────────────────
if(WIN32)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        psapi      # process enumeration
        shell32    # ShellExecuteA
        user32     # GetAsyncKeyState / GetLastInputInfo
    )
    # Hide console on Windows release builds
    if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
        set_target_properties(${PROJECT_NAME} PROPERTIES WIN32_EXECUTABLE TRUE)
    endif()
elseif(APPLE)
    find_library(APPKIT_LIBRARY AppKit)
    find_library(APPSERVICES_LIBRARY ApplicationServices)
    target_link_libraries(${PROJECT_NAME} PRIVATE ${APPKIT_LIBRARY} ${APPSERVICES_LIBRARY})
    # macOS bundle with Info.plist
    set_target_properties(${PROJECT_NAME} PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_INFO_PLIST "${CMAKE_CURRENT_SOURCE_DIR}/Info.plist"
        MACOSX_BUNDLE_BUNDLE_NAME "SerikaCord"
        MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
        MACOSX_BUNDLE_GUI_IDENTIFIER "dev.serika.serikacord"
    )
endif()

# ── Linux: install .desktop file ─────────────────────────────────────────────
if(UNIX AND NOT APPLE)
    install(FILES serikacord.desktop DESTINATION share/applications)
endif()

# ── Install ──────────────────────────────────────────────────────────────────
install(TARGETS ${PROJECT_NAME}
    RUNTIME DESTINATION bin
    BUNDLE DESTINATION .
)
