const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electron', {
  // App info
  platform: process.platform,
  isElectron: true,
  
  // Window controls (for custom title bar if needed)
  window: {
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  },
  
  // Notifications
  notifications: {
    show: (title, body, options = {}) => {
      return ipcRenderer.invoke('show-notification', { title, body, ...options });
    },
  },
  
  // Updates
  updates: {
    check: () => ipcRenderer.send('check-for-updates'),
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', callback),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', callback),
    install: () => ipcRenderer.send('install-update'),
  },
  
  // System
  system: {
    openExternal: (url) => ipcRenderer.send('open-external', url),
    getVersion: () => ipcRenderer.invoke('get-version'),
  },
  
  // Badge (for dock/taskbar)
  badge: {
    set: (count) => ipcRenderer.send('set-badge', count),
    clear: () => ipcRenderer.send('clear-badge'),
  },
});

// Add custom CSS for electron-specific styling
window.addEventListener('DOMContentLoaded', () => {
  // Add electron class to body for CSS targeting
  document.body.classList.add('electron-app');
  
  // Inject custom styles
  const style = document.createElement('style');
  style.textContent = `
    /* macOS window drag region */
    .electron-app .drag-region {
      -webkit-app-region: drag;
    }
    
    .electron-app .no-drag {
      -webkit-app-region: no-drag;
    }
    
    /* Hide scrollbars in a nicer way on electron */
    .electron-app ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    
    .electron-app ::-webkit-scrollbar-track {
      background: transparent;
    }
    
    .electron-app ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.2);
      border-radius: 4px;
    }
    
    .electron-app ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.3);
    }
    
    /* Disable text selection on UI elements */
    .electron-app button,
    .electron-app .sidebar,
    .electron-app nav {
      -webkit-user-select: none;
      user-select: none;
    }
  `;
  document.head.appendChild(style);
});
