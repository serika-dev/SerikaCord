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
Pushes go out for DMs, mentions and incoming calls when the user isn't using
the app (no open activity stream / recent heartbeat, or the phone app reported
it went to the background). Everything is skipped gracefully until both halves
below are configured; the app then still shows local notifications while open.

1. **App (Android)**: in the Firebase console add an Android app with package
   `dev.serika.serikacord`, download `google-services.json` and put it at
   `mobile/android/app/google-services.json`, then rebuild the APK. Without
   it the app never registers for push (it checks before registering, so it
   can't crash).
2. **Server**: Firebase console → Project settings → Service accounts →
   Generate new private key. Put the JSON (one line, or base64) in
   `FCM_SERVICE_ACCOUNT_JSON` in the server `.env` and restart.
3. Device tokens are stored in `push_devices` (created at boot, or apply
   `drizzle/manual_push_devices.sql`).
4. iOS (not in this repo yet): APNs key in Firebase + `GoogleService-Info.plist`.

### Native integration (Android)
`MainActivity` registers an app-local plugin, `SerikaNative`
(`android/app/src/main/java/dev/serika/serikacord/SerikaNativePlugin.java`),
that the hosted web app feature-detects:

- status / navigation bar colours follow the app theme
- safe-area and keyboard insets are measured natively and exposed to CSS as
  `--native-inset-*` (works edge to edge on Android 15+)
- notification channels (`messages`, `calls`) and a full-screen incoming-call
  notification (`CallMessagingService` replaces the push plugin's FCM service)
- tapped notifications open the right conversation
- the Android back button closes sheets/dialogs, walks back up the screens,
  then minimizes the app

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
