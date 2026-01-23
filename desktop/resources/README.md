# App Icons

Place your app icons here:

## Required Files

### Desktop (Electron)
- `icon.png` - 512x512 PNG (used for Linux and as source for others)
- `icon.ico` - Windows icon (multi-resolution: 16, 32, 48, 64, 128, 256)
- `icon.icns` - macOS icon set

### Generating Icons

You can use tools like:
- [electron-icon-builder](https://www.npmjs.com/package/electron-icon-builder)
- [png2icons](https://github.com/nicepng/png2icons)
- Online tools like [iconifier.net](https://iconifier.net/)

#### Quick generation with electron-icon-builder:
```bash
npm install -g electron-icon-builder
electron-icon-builder --input=icon.png --output=./
```

### Mobile (Capacitor)
Mobile icons are managed through Xcode (iOS) and Android Studio (Android) after running `cap add`.

For a quick setup, place a 1024x1024 source image and use:
- iOS: Xcode's Asset Catalog
- Android: Android Studio's Image Asset wizard

## Icon Guidelines

- Use a square image (1:1 aspect ratio)
- Recommended source size: 1024x1024 for maximum quality
- Use PNG format with transparency where needed
- Keep important content within the safe zone (center 80%)
