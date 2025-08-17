interface DebugConfig {
  enabled: boolean;
  level: 'info' | 'warn' | 'error' | 'debug';
}

class DebugLogger {
  private config: DebugConfig = {
    enabled: false,
    level: 'info'
  };

  constructor() {
    // Check localStorage for saved debug config (only in browser environment)
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      const savedConfig = localStorage.getItem('cloud-clipboard-debug');
      if (savedConfig) {
        try {
          this.config = { ...this.config, ...JSON.parse(savedConfig) };
        } catch {
          console.warn('Failed to parse debug config from localStorage');
        }
      }
    }

    // Expose debug controls to global window object for console access
    if (typeof window !== 'undefined') {
      (window as any).cloudClipboardDebug = {
        enable: () => this.enable(),
        disable: () => this.disable(),
        setLevel: (level: DebugConfig['level']) => this.setLevel(level),
        getConfig: () => this.getConfig(),
        clear: () => this.clear()
      };
    }
  }

  enable() {
    this.config.enabled = true;
    this.saveConfig();
    console.log('🚀 Cloud Clipboard Debug Mode: ENABLED');
    this.showHelp();
  }

  disable() {
    this.config.enabled = false;
    this.saveConfig();
    console.log('🚀 Cloud Clipboard Debug Mode: DISABLED');
  }

  setLevel(level: DebugConfig['level']) {
    this.config.level = level;
    this.saveConfig();
    console.log(`🚀 Cloud Clipboard Debug Level: ${level.toUpperCase()}`);
  }

  getConfig() {
    return { ...this.config };
  }

  clear() {
    this.config = { enabled: false, level: 'info' };
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.removeItem('cloud-clipboard-debug');
    }
    console.log('🚀 Cloud Clipboard Debug Config: CLEARED');
  }

  private saveConfig() {
    if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
      localStorage.setItem('cloud-clipboard-debug', JSON.stringify(this.config));
    }
  }

  private showHelp() {
    console.log(`
🚀 Cloud Clipboard Debug Controls:
  cloudClipboardDebug.enable()     - Enable debug logging
  cloudClipboardDebug.disable()    - Disable debug logging  
  cloudClipboardDebug.setLevel(level) - Set log level (info|warn|error|debug)
  cloudClipboardDebug.getConfig()  - Get current config
  cloudClipboardDebug.clear()      - Clear all debug settings
    `);
  }

  private shouldLog(level: DebugConfig['level']): boolean {
    if (!this.config.enabled) return false;
    
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevelIndex = levels.indexOf(this.config.level);
    const logLevelIndex = levels.indexOf(level);
    
    return logLevelIndex >= configLevelIndex;
  }

  debug(message: string, ...args: any[]) {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    if (this.shouldLog('info')) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: any[]) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: any[]) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${message}`, ...args);
    }
  }

  group(label: string) {
    if (this.config.enabled) {
      console.group(label);
    }
  }

  groupEnd() {
    if (this.config.enabled) {
      console.groupEnd();
    }
  }

  table(data: any) {
    if (this.config.enabled) {
      console.table(data);
    }
  }
}

export const debug = new DebugLogger();