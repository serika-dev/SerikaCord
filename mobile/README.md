# SerikaCord Mobile

Capacitor 8 shell for SerikaCord on Android (`android/`) and iOS (`ios/`).
Both load the hosted web app (`server.url` = `https://serika.chat/channels/me`
in `capacitor.config.json`), so there is no web build to bundle: web changes
ship with a normal deploy, and a new app build is only needed for native
changes (plugins, permissions, icons, push, signing).

- App ID / bundle ID: `dev.serika.serikacord`, name **SerikaCord**
- Navigation allowed inside the app: `serika.chat` and `accounts.serika.dev`
  (sign-in). Other links open in the system browser.
- The web app talks to the shell through `src/lib/native/` and
  `src/components/native/NativeAppBridge.tsx` (feature-detected, no-ops in a
  normal browser).

## Setup

```bash
cd mobile
bun install
bunx cap sync          # copies config + plugins into android/ and ios/
bunx cap open android  # Android Studio
bunx cap open ios      # Xcode (macOS)
```

`mobile/www/` only holds the offline fallback page; the app itself is the
hosted site. To point a debug build at a local server, temporarily set
`server.url` to `http://YOUR_LAN_IP:3000` and `server.cleartext` to `true`
(don't commit that).

## Versions

`scripts/release.ts` keeps both platforms in step with the web version:
Android `versionName` / `versionCode` in `android/app/build.gradle`, iOS
`MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` in
`ios/App/App.xcodeproj/project.pbxproj` (build number +1 on every release).

---

## Android

### Push notifications

Pushes go out for DMs, mentions and incoming calls when the user isn't using
the app (no open activity stream / recent heartbeat, or the phone app reported
it went to the background). Everything is skipped gracefully until both halves
below are configured; the app then still shows local notifications while open.

1. **App**: in the Firebase console (project `serikacord`) add an Android app
   with package `dev.serika.serikacord`, download `google-services.json` and
   put it at `mobile/android/app/google-services.json`, then rebuild the APK.
   Without it the app never registers for push (it checks before registering,
   so it can't crash).
2. **Server**: Firebase console → Project settings → Service accounts →
   Generate new private key. Put the JSON (one line, or base64) in
   `FCM_SERVICE_ACCOUNT_JSON` in the server `.env` and restart. The same
   service account sends to iOS devices.
3. Device tokens are stored in `push_devices` (created at boot, or apply
   `drizzle/manual_push_devices.sql`).

### Native integration

`MainActivity` registers an app-local plugin, `SerikaNative`
(`android/app/src/main/java/dev/serika/serikacord/SerikaNativePlugin.java`),
that the hosted web app feature-detects:

- status / navigation bar colours follow the app theme
- safe-area and keyboard insets are measured natively and exposed to CSS as
  `--native-inset-*` (works edge to edge on Android 15+)
- notification channels (`messages`, `calls`) and a full-screen incoming-call
  notification (`CallMessagingService` replaces the push plugin's FCM service)
- rich message notifications with inline Reply / Mark as read, and
  end-to-end encrypted previews decrypted on the phone (push protocol 3)
- tapped notifications open the right conversation
- the Android back button closes sheets/dialogs, walks back up the screens,
  then minimizes the app

### Release

Pushing a `v*` tag runs the `Release Build` workflow
(`.github/workflows/build.yml`), which signs the APK with the
`ANDROID_KEYSTORE_*` secrets and attaches it to the GitHub release.

---

## iOS

The Xcode project lives in `ios/App` (Swift Package Manager, no CocoaPods).
Requirements: **Xcode 26** or newer (App Store uploads need the iOS 26 SDK,
and Firebase 13 needs Swift 6.2). The app runs on **iOS 15+** (Capacitor 8's
minimum), on iPhone and iPad, portrait and landscape.

Apple team: **B648X59JCQ** ("Noa Bolk"). It is set as `DEVELOPMENT_TEAM` in
the project, in `ios/App/ExportOptions.plist`, and in
`https://serika.chat/.well-known/apple-app-site-association` (env
`APPLE_TEAM_ID` overrides it on the server, `vars.APPLE_TEAM_ID` in CI).

### What's in the shell

| File | Purpose |
|------|---------|
| `ios/App/App/AppDelegate.swift` | Firebase setup, APNs token → FCM token for `@capacitor/push-notifications`, background "read" / "call ended" pushes that remove notifications, universal links + `serikacord://` → App plugin `appUrlOpen` |
| `ios/App/App/SerikaNativePlugin.swift` | iOS side of `SerikaNative`: `getCapabilities` (`firebase`, push protocol 1), `clearNotifications`, `setBadge` |
| `ios/App/App/MainViewController.swift` | Bridge view controller (Main.storyboard) that registers `SerikaNative` |
| `ios/App/App/Info.plist` | Display name, usage descriptions (camera, microphone, photos, local network), background modes `audio` + `remote-notification`, `ITSAppUsesNonExemptEncryption = NO`, `serikacord://` scheme |
| `ios/App/App/App.entitlements` / `AppRelease.entitlements` | Push (`development` for Debug, `production` for Release), associated domains `applinks:serika.chat`, `applinks:canary.serika.chat`, `webcredentials:serika.chat`, `webcredentials:accounts.serika.dev` |
| `ios/App/App/PrivacyInfo.xcprivacy` | Privacy manifest (no tracking) |
| `ios/App/ExportOptions.plist` | App Store export: method `app-store-connect`, team B648X59JCQ, profile "SerikaCord App Store" |
| `scripts/generate-ios-assets.ts` | Regenerates the app icon (1024, opaque) and the dark `#05060a` launch image from `public/logo-icon.svg`: `bun mobile/scripts/generate-ios-assets.ts` |

The web view is edge to edge (`ios.contentInset: "never"`); the web app pads
itself with `env(safe-area-inset-*)` (`--safe-area-*` in `globals.css`, the
viewport has `viewport-fit=cover`). The keyboard resizes the web view
(`Keyboard.resize: "native"`) and toggles `html.keyboard-open`.

`GoogleService-Info.plist` is **not committed** (it's in `ios/.gitignore`). CI
writes it from a secret; locally, drop your copy at
`ios/App/App/GoogleService-Info.plist`. A build phase copies it into the app
when present. Without it the app works but never registers for push.

### One-time setup checklist

**Apple Developer** (developer.apple.com → Certificates, Identifiers & Profiles)

1. Identifiers → App IDs → register `dev.serika.serikacord` ("SerikaCord")
   with the capabilities **Push Notifications** and **Associated Domains**.
2. Certificates: reuse the team's **Apple Distribution** certificate (the one
   behind SerikaStreaming-App's `IOS_DISTRIBUTION_P12_BASE64`). No new
   certificate is needed.
3. Profiles → + → **App Store Connect** (distribution) → App ID
   `dev.serika.serikacord` → that Apple Distribution certificate → name it
   **`SerikaCord App Store`** → download. Regenerate it (and update the
   secret) whenever the App ID's capabilities change or the certificate is
   renewed.
4. Keys → an **APNs** key (Apple Push Notifications service, "Sandbox &
   Production"). APNs keys are team-wide, so an existing one works; otherwise
   create one, download the `.p8` (only possible once) and note its Key ID.

**Firebase** (console.firebase.google.com → project `serikacord`)

1. Project settings → General → Add app → **iOS**: bundle ID
   `dev.serika.serikacord`, nickname "SerikaCord iOS" (App Store ID can be
   added later). Download **`GoogleService-Info.plist`** and skip the SDK
   steps (the project already has them).
2. Project settings → **Cloud Messaging** → Apple app configuration →
   `dev.serika.serikacord` → APNs Authentication Key → upload the `.p8`, its
   Key ID and Team ID `B648X59JCQ`. Without this FCM cannot deliver to
   iPhones.
3. The server needs nothing new: `FCM_SERVICE_ACCOUNT_JSON` already belongs
   to this project, and iPhones register their FCM token with platform `ios`.

**App Store Connect** (appstoreconnect.apple.com)

1. Apps → + → New App: platform iOS, name **SerikaCord** (pick an alternative
   if the name is taken), primary language English, bundle ID
   `dev.serika.serikacord`, SKU `serikacord`.
2. Users and Access → Integrations → **App Store Connect API** → Team Keys:
   reuse the key SerikaStreaming-App uses (team keys cover every app), or
   create one with the **App Manager** role. Note the Key ID and Issuer ID and
   keep the `.p8`.
3. Before the first external TestFlight / App Store submission: App Privacy
   answers, age rating (user-generated content: chat with reporting and
   blocking), a support URL, a demo account for App Review, and export
   compliance. The app declares `ITSAppUsesNonExemptEncryption = NO` because
   it only uses HTTPS and the OS's WebCrypto (end-to-end encryption uses
   WebCrypto ECDH P-256 / AES-GCM / HKDF in WebKit, see
   `docs/architecture/e2ee.md`). Confirm that answer is right for you; if
   not, set it to `YES` and complete the export compliance questions.

**Universal links / shared credentials**

- `https://serika.chat/.well-known/apple-app-site-association` (and the same
  on `canary.serika.chat`) is served by `src/app/.well-known/apple-app-site-association/route.ts`
  for app ID `B648X59JCQ.dev.serika.serikacord`, paths `/channels/*`,
  `/invite/*`, `/dm/*`, `/qr/*`, `/oauth2/*`, plus `webcredentials`. Check it
  after deploying: `curl -i https://serika.chat/.well-known/apple-app-site-association`
  must return `200`, `Content-Type: application/json`, no redirect.
- Passkeys are registered for the accounts site (WebAuthn RP ID
  `accounts.serika.dev`). For passkey sign-in inside the app,
  `accounts.serika.dev` must also serve an `apple-app-site-association` with
  `"webcredentials": { "apps": ["B648X59JCQ.dev.serika.serikacord"] }` (that
  lives in the `serika-accounts` service, not this repo). Until then, sign in
  with a password or QR code.

**GitHub Actions secrets** (repo or `serika-dev` org; org secrets let
SerikaStreaming-App and SerikaCord share the Apple ones)

| Secret | Value |
|--------|-------|
| `IOS_DISTRIBUTION_P12_BASE64` | `base64 -i distribution.p12` (Apple Distribution cert + private key; same as SerikaStreaming-App) |
| `IOS_DISTRIBUTION_P12_PASSWORD` | the P12's export password (optional if it has none) |
| `SERIKACORD_IOS_PROVISIONING_PROFILE_BASE64` | `base64 -i SerikaCord_App_Store.mobileprovision` |
| `IOS_GOOGLE_SERVICE_INFO_PLIST_BASE64` | `base64 -i GoogleService-Info.plist` |
| `ASC_KEY_ID` | App Store Connect API key ID |
| `ASC_ISSUER_ID` | App Store Connect API issuer ID |
| `ASC_PRIVATE_KEY_BASE64` | `base64 -i AuthKey_<KEYID>.p8` |

Optional Actions variable `APPLE_TEAM_ID` (defaults to `B648X59JCQ`). The
workflow lists every missing secret and stops before building.

### Build locally (Mac)

```bash
cd mobile
bun install
bunx cap sync ios
cp ~/Downloads/GoogleService-Info.plist ios/App/App/   # optional, for push
bunx cap open ios
```

In Xcode, select the **App** scheme and your device, then Run. Debug builds
use automatic signing with team B648X59JCQ and the `development` push
environment. Push only works on a real device, not the simulator. For an App
Store build: Product → Archive → Distribute App → App Store Connect (or
`xcodebuild -exportArchive -exportOptionsPlist ios/App/ExportOptions.plist`).

### Release

```bash
git tag ios-v2.4.0
git push origin ios-v2.4.0
```

The tag runs `.github/workflows/ios.yml` (macOS, Xcode 26): `bun install` +
`cap sync ios`, writes `GoogleService-Info.plist`, installs the certificate
and profile in a temporary keychain (the profile is checked for team, bundle
ID, expiry, production push and associated domains), archives, exports an
App Store IPA, verifies it, attaches it to a GitHub release `ios-v2.4.0`
(never marked "latest", so the desktop updaters keep reading the desktop
release) and uploads it to TestFlight with `xcrun altool`.

- Version = the tag's `x.y.z`; build number = `CURRENT_PROJECT_VERSION` in
  the Xcode project. App Store Connect rejects a build number it has seen
  before for that version, so cut the web release first (`scripts/release.ts`
  bumps it) or run the workflow manually (Actions → iOS App Store Build →
  Run workflow) with a higher **build number** and/or `testflight` off.
- After the upload, Apple processes the build (10–30 min). Add it to a
  TestFlight group, or submit it for review from App Store Connect.

### Known iOS limitations

- **Voice in the background**: the `audio` background mode is what lets
  WebKit keep the microphone and call audio running while the app is in the
  background or the screen is locked during a call. This is best effort and
  must be checked on a real device (it can't be tested on Linux CI). The camera always
  pauses in the background (iOS doesn't allow it), so your video freezes for
  others until you come back. There's no CallKit: calls don't appear in the
  system call UI, and a phone call interrupts SerikaCord audio.
- **Incoming calls** arrive as a normal (time-limited) notification, not a
  full-screen ringing screen; tapping it opens the DM. A real ringing UI
  would need PushKit + CallKit.
- **Notifications** are drawn by iOS from the push (title + text): no inline
  reply, no avatars, and end-to-end encrypted DMs show "New encrypted
  message" (Android's push protocol 3 decrypts on the phone). Notifications
  are cleared when you read the conversation in the app; clearing after
  reading on another device uses background pushes, which iOS throttles.
- **Sign-in**: the accounts site runs inside the app. Third-party providers
  that refuse embedded web views (Google) open in Safari instead; passkeys
  need the accounts-site AASA described above (iOS 16+).
- App Review may ask about the `audio` background mode; it's justified by
  voice channels and calls. Remove it from `Info.plist` if they reject it.

---

## Deep links

- `serikacord://channels/me`, `serikacord://channels/{serverId}/{channelId}`,
  `serikacord://dm/{userId}` (iOS registers the scheme)
- iOS universal links: `https://serika.chat/{channels,dm,invite,qr,oauth2}/…`

Both are routed by `routeFromOpenedUrl` (`src/lib/native/navigation.ts`);
anything else is ignored.
