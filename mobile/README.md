# SerikaCord Mobile

Capacitor-based mobile application for SerikaCord. Supports both iOS and Android.

## Prerequisites

### iOS Development
- macOS with Xcode installed
- iOS Simulator or physical device
- Apple Developer account (for distribution)

### Android Development
- Android Studio installed
- Android SDK
- Android Emulator or physical device

## Setup

```bash
# Install dependencies
npm install

# Initialize Capacitor (if not already done)
npm run cap:init

# Add platforms
npm run cap:add:ios      # iOS
npm run cap:add:android  # Android
```

## Development

The app loads directly from `https://waifu.ws` by default, so you don't need to build the web app locally for testing.

```bash
# Sync changes to native projects
npm run cap:sync

# Open in IDE
npm run cap:open:ios      # Opens Xcode
npm run cap:open:android  # Opens Android Studio

# Run on device/emulator
npm run ios               # Run on iOS
npm run android           # Run on Android
```

## Building for Production

### iOS
```bash
# Open Xcode and archive from there
npm run cap:open:ios

# Or use CLI (requires signing setup)
npm run build:ios
```

### Android
```bash
# Open Android Studio and build from there
npm run cap:open:android

# Or use CLI
npm run build:android
```

## Configuration

### App Settings
Edit `capacitor.config.json` to change:
- `appId` - Bundle identifier
- `appName` - Display name
- `server.url` - URL to load (default: `https://waifu.ws`)
- Plugin configurations

### Deep Linking
The app supports `serikacord://` deep links:
- `serikacord://channels/me` - Open DMs
- `serikacord://channels/{serverId}` - Open a server
- `serikacord://channels/{serverId}/{channelId}` - Open a specific channel

### Push Notifications
1. Set up Firebase Cloud Messaging for Android
2. Set up APNs for iOS
3. Add the google-services.json (Android) and GoogleService-Info.plist (iOS) files

## Features

- 📱 Native iOS and Android apps
- 🔔 Push notifications
- 📳 Haptic feedback
- ⌨️ Native keyboard handling
- 🔗 Deep linking support
- 📤 Native share dialog
- 🎨 Native status bar styling
- 🚀 Splash screen

## Folder Structure

```
mobile/
├── capacitor.config.json  # Capacitor configuration
├── package.json           # Dependencies
├── src/
│   └── app.ts            # Native app initialization
├── www/                   # Web assets (built from main app)
├── ios/                   # iOS native project (auto-generated)
└── android/               # Android native project (auto-generated)
```

## Troubleshooting

### iOS Build Issues
```bash
cd ios/App
pod install
```

### Android Build Issues
- Make sure Android SDK is up to date
- Sync Gradle files in Android Studio
- Check `android/app/build.gradle` for SDK versions

### Hot Reload
For development, you can point to a local server:
```json
// capacitor.config.json
{
  "server": {
    "url": "http://YOUR_LOCAL_IP:3000",
    "cleartext": true
  }
}
```
