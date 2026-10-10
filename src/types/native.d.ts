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
  /** Plugin proxies (present when @capacitor/core registered them). */
  Plugins?: Record<string, Record<string, unknown> | undefined>;
  /** Native plugins the shell exposes (injected by the native bridge). */
  PluginHeaders?: Array<{ name: string; methods?: Array<{ name: string; rtype?: string }> }>;
  /** Raw bridge calls, available even without @capacitor/core on the page. */
  nativePromise?: (plugin: string, method: string, options?: unknown) => Promise<unknown>;
  nativeCallback?: (
    plugin: string,
    method: string,
    options: unknown,
    callback: (result: unknown, error?: unknown) => void,
  ) => string;
}

interface TauriCore {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface TauriGlobal {
  core: TauriCore;
}

declare global {
  interface Window {
    electron?: ElectronAPI;
    Capacitor?: CapacitorGlobal;
    __TAURI__?: TauriGlobal;
  }
}

export {};
