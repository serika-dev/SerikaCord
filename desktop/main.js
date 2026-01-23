const { app, BrowserWindow, shell, Menu, Tray, nativeImage, ipcMain, Notification } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// App URL - change this to your domain
const APP_URL = 'https://waifu.ws';
const isDev = process.argv.includes('--dev');

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 500,
    title: 'SerikaCord',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    backgroundColor: '#0a0a0a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true,
      // Enable features for better compatibility
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
    show: false, // Don't show until ready
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(APP_URL);
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Check for updates (not in dev)
    if (!isDev) {
      autoUpdater.checkForUpdatesAndNotify();
    }
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external links in browser
    if (!url.startsWith(APP_URL) && !url.startsWith('http://localhost')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Handle navigation
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith('http://localhost')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      
      // Show notification on first minimize
      if (Notification.isSupported()) {
        new Notification({
          title: 'SerikaCord',
          body: 'SerikaCord is still running in the background',
          silent: true,
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createMenu();
}

function createMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'SerikaCord Website',
          click: () => shell.openExternal('https://serika.dev')
        },
        {
          label: 'Report Issue',
          click: () => shell.openExternal('https://github.com/serika-dev/SerikaCord/issues')
        },
        { type: 'separator' },
        {
          label: 'Check for Updates',
          click: () => autoUpdater.checkForUpdatesAndNotify()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createTray() {
  const iconPath = path.join(__dirname, 'resources', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open SerikaCord',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Check for Updates',
      click: () => autoUpdater.checkForUpdatesAndNotify()
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('SerikaCord');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Auto updater events
autoUpdater.on('update-available', () => {
  if (Notification.isSupported()) {
    new Notification({
      title: 'Update Available',
      body: 'A new version of SerikaCord is available. Downloading...',
    }).show();
  }
});

autoUpdater.on('update-downloaded', () => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: 'Update Ready',
      body: 'A new version has been downloaded. Restart to apply the update.',
    });
    notification.on('click', () => {
      isQuitting = true;
      autoUpdater.quitAndInstall();
    });
    notification.show();
  }
});

// App events
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit on Windows/Linux - keep in tray
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

// Handle deep links (serikacord://)
app.setAsDefaultProtocolClient('serikacord');

app.on('open-url', (event, url) => {
  event.preventDefault();
  // Handle deep link URL
  if (mainWindow) {
    const path = url.replace('serikacord://', '/');
    mainWindow.loadURL(`${APP_URL}${path}`);
    mainWindow.show();
    mainWindow.focus();
  }
});
