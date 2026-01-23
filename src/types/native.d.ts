// Global type declarations for native app detection

interface ElectronAPI {
  platform: string;
  isElectron: boolean;
  window: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
  };
  notifications: {
    show: (title: string, body: string, options?: Record<string, unknown>) => Promise<void>;
  };
  updates: {
    check: () => void;
    onUpdateAvailable: (callback: () => void) => void;
    onUpdateDownloaded: (callback: () => void) => void;
    install: () => void;
  };
  system: {
    openExternal: (url: string) => void;
    getVersion: () => Promise<string>;
  };
  badge: {
    set: (count: number) => void;
    clear: () => void;
  };
}

interface CapacitorGlobal {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
    Capacitor?: CapacitorGlobal;
  }
}

export {};
