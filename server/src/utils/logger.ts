import { inspect } from 'util';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

interface LogConfig {
  level: LogLevel;
  colors: boolean;
  timestamps: boolean;
  context: boolean;
}

class Logger {
  private config: LogConfig = {
    level: LogLevel.INFO,
    colors: true,
    timestamps: true,
    context: true
  };

  constructor() {
    this.loadConfigFromEnv();
  }

  private loadConfigFromEnv() {
    // Load log level from environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    if (envLevel && envLevel in LogLevel) {
      this.config.level = LogLevel[envLevel as keyof typeof LogLevel];
    }

    // Load other config from environment
    if (process.env.LOG_COLORS === 'false') {
      this.config.colors = false;
    }
    
    if (process.env.LOG_TIMESTAMPS === 'false') {
      this.config.timestamps = false;
    }
    
    if (process.env.LOG_CONTEXT === 'false') {
      this.config.context = false;
    }
  }

  setLevel(level: LogLevel | string) {
    if (typeof level === 'string') {
      const upperLevel = level.toUpperCase();
      if (upperLevel in LogLevel) {
        this.config.level = LogLevel[upperLevel as keyof typeof LogLevel];
      }
    } else {
      this.config.level = level;
    }
  }

  setColors(enabled: boolean) {
    this.config.colors = enabled;
  }

  setTimestamps(enabled: boolean) {
    this.config.timestamps = enabled;
  }

  setContext(enabled: boolean) {
    this.config.context = enabled;
  }

  getConfig() {
    return { ...this.config };
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.config.level && this.config.level !== LogLevel.SILENT;
  }

  private formatMessage(level: string, message: string, data?: any, context?: string): string {
    let output = '';

    // Add timestamp
    if (this.config.timestamps) {
      const timestamp = new Date().toISOString();
      if (this.config.colors) {
        output += `\x1b[90m${timestamp}\x1b[0m `;
      } else {
        output += `${timestamp} `;
      }
    }

    // Add level with colors
    if (this.config.colors) {
      const colors = {
        DEBUG: '\x1b[36m', // cyan
        INFO: '\x1b[32m',  // green
        WARN: '\x1b[33m',  // yellow
        ERROR: '\x1b[31m', // red
      };
      const color = colors[level as keyof typeof colors] || '';
      output += `${color}[${level}]\x1b[0m `;
    } else {
      output += `[${level}] `;
    }

    // Add context
    if (context && this.config.context) {
      if (this.config.colors) {
        output += `\x1b[35m[${context}]\x1b[0m `;
      } else {
        output += `[${context}] `;
      }
    }

    // Add message
    output += message;

    // Add data if provided
    if (data !== undefined) {
      const dataStr = typeof data === 'object' 
        ? inspect(data, { colors: this.config.colors, depth: 3, compact: true })
        : String(data);
      output += ` ${dataStr}`;
    }

    return output;
  }

  debug(message: string, data?: any, context?: string) {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.debug(this.formatMessage('DEBUG', message, data, context));
    }
  }

  info(message: string, data?: any, context?: string) {
    if (this.shouldLog(LogLevel.INFO)) {
      console.info(this.formatMessage('INFO', message, data, context));
    }
  }

  warn(message: string, data?: any, context?: string) {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(this.formatMessage('WARN', message, data, context));
    }
  }

  error(message: string, data?: any, context?: string) {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(this.formatMessage('ERROR', message, data, context));
    }
  }

  // Convenience method for creating contextual loggers
  withContext(context: string) {
    return {
      debug: (message: string, data?: any) => this.debug(message, data, context),
      info: (message: string, data?: any) => this.info(message, data, context),
      warn: (message: string, data?: any) => this.warn(message, data, context),
      error: (message: string, data?: any) => this.error(message, data, context),
    };
  }
}

export const logger = new Logger();

// Export convenience methods for quick access
export const log = {
  debug: logger.debug.bind(logger),
  info: logger.info.bind(logger),
  warn: logger.warn.bind(logger),
  error: logger.error.bind(logger),
  withContext: logger.withContext.bind(logger),
  setLevel: logger.setLevel.bind(logger),
  setColors: logger.setColors.bind(logger),
  setTimestamps: logger.setTimestamps.bind(logger),
  setContext: logger.setContext.bind(logger),
  getConfig: logger.getConfig.bind(logger),
};