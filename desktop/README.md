# SerikaCord Desktop

Electron-based desktop application for SerikaCord.

## Development

```bash
# Install dependencies
npm install

# Run in development mode (connects to localhost:3000)
npm run dev

# Run in production mode (connects to waifu.ws)
npm start
```

## Building

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux

# Build for all platforms
npm run build:all
```

## Distribution

Built apps will be in the `dist/` folder:

- **Windows**: `.exe` installer and portable `.exe`
- **macOS**: `.dmg` and `.zip`
- **Linux**: `.AppImage`, `.deb`, and `.rpm`

## Features

- 🖥️ Native desktop experience
- 🔔 System notifications
- 📌 System tray support
- 🔄 Auto-updates
- 🔗 Deep linking support (`serikacord://`)
- ⌨️ Native keyboard shortcuts
- 🎨 Platform-specific window controls

## Protocol Handler

The app registers `serikacord://` as a protocol handler. You can use it to link directly into the app:

- `serikacord://channels/me` - Open DMs
- `serikacord://channels/{serverId}` - Open a server
- `serikacord://channels/{serverId}/{channelId}` - Open a specific channel

## Configuration

Edit `main.js` to change:
- `APP_URL` - The URL to load (default: `https://waifu.ws`)
- Window size and behavior
- Menu items

## Icons

Place your icons in the `resources/` folder:
- `icon.png` - 512x512 PNG for Linux/macOS
- `icon.ico` - Windows icon
- `icon.icns` - macOS icon set
