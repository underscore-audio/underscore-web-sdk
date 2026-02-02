/**
 * Configurable debug logging utility for the SDK.
 *
 * By default, logging is disabled (level: 'none').
 * Set the log level via UnderscoreConfig.logLevel to enable.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "none";

export interface Logger {
  debug: (msg: string, ...args: unknown[]) => void;
  info: (msg: string, ...args: unknown[]) => void;
  warn: (msg: string, ...args: unknown[]) => void;
  error: (msg: string, ...args: unknown[]) => void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

/**
 * Create a logger with the specified prefix and minimum log level.
 * Messages below the minimum level are silently ignored.
 */
export function createLogger(prefix: string, level: LogLevel = "none"): Logger {
  const minLevel = LOG_LEVELS[level];

  return {
    debug: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LOG_LEVELS.debug) {
        console.log(`[${prefix}]`, msg, ...args);
      }
    },
    info: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LOG_LEVELS.info) {
        console.log(`[${prefix}]`, msg, ...args);
      }
    },
    warn: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LOG_LEVELS.warn) {
        console.warn(`[${prefix}]`, msg, ...args);
      }
    },
    error: (msg: string, ...args: unknown[]) => {
      if (minLevel <= LOG_LEVELS.error) {
        console.error(`[${prefix}]`, msg, ...args);
      }
    },
  };
}

/**
 * No-op logger that discards all messages.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
