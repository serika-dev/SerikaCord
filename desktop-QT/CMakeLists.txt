cmake_minimum_required(VERSION 3.21)
project(SerikaCord VERSION 1.2.7 LANGUAGES CXX)

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

# ── Sources ──────────────────────────────────────────────────────────────────
set(SOURCES
    src/main.cpp
    src/MainWindow.cpp
    src/TrayIcon.cpp
    src/SingleInstance.cpp
    src/UpdaterWindow.cpp
    src/PresenceDetector.cpp
    src/WebBridge.cpp
    src/DeepLinkHandler.cpp
)

set(HEADERS
    src/MainWindow.h
    src/SerikaWebPage.h
    src/TrayIcon.h
    src/SingleInstance.h
    src/UpdaterWindow.h
    src/PresenceDetector.h
    src/WebBridge.h
    src/DeepLinkHandler.h
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
)

target_include_directories(${PROJECT_NAME} PRIVATE src)

# ── Platform-specific ────────────────────────────────────────────────────────
if(WIN32)
    target_link_libraries(${PROJECT_NAME} PRIVATE
        psapi      # process enumeration
        shell32    # ShellExecuteA
    )
    # Hide console on Windows release builds
    if(NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
        set_target_properties(${PROJECT_NAME} PROPERTIES WIN32_EXECUTABLE TRUE)
    endif()
elseif(APPLE)
    find_library(APPKIT_LIBRARY AppKit)
    target_link_libraries(${PROJECT_NAME} PRIVATE ${APPKIT_LIBRARY})
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
