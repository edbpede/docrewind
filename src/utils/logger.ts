/**
 * Centralized logging utility for the extension
 * Provides consistent logging with different log levels
 */

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Current log level (can be changed at runtime)
let currentLogLevel = LogLevel.INFO;

/**
 * Set the current log level
 * @param level - The log level to set
 */
export const setLogLevel = (level: LogLevel): void => {
  currentLogLevel = level;
};

/**
 * Get the current log level
 * @returns The current log level
 */
export const getLogLevel = (): LogLevel => {
  return currentLogLevel;
};

/**
 * Format a log message with timestamp and module name
 * @param module - The module name
 * @param message - The log message
 * @returns The formatted log message
 */
const formatLogMessage = (module: string, message: string): string => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${module}] ${message}`;
};

/**
 * Log a debug message
 * @param module - The module name
 * @param message - The log message
 * @param data - Optional data to log
 */
export const debug = (module: string, message: string, data?: any): void => {
  if (currentLogLevel <= LogLevel.DEBUG) {
    console.debug(formatLogMessage(module, message), data);
  }
};

/**
 * Log an info message
 * @param module - The module name
 * @param message - The log message
 * @param data - Optional data to log
 */
export const info = (module: string, message: string, data?: any): void => {
  if (currentLogLevel <= LogLevel.INFO) {
    console.info(formatLogMessage(module, message), data);
  }
};

/**
 * Log a warning message
 * @param module - The module name
 * @param message - The log message
 * @param data - Optional data to log
 */
export const warn = (module: string, message: string, data?: any): void => {
  if (currentLogLevel <= LogLevel.WARN) {
    console.warn(formatLogMessage(module, message), data);
  }
};

/**
 * Log an error message
 * @param module - The module name
 * @param message - The log message
 * @param error - Optional error to log
 */
export const error = (module: string, message: string, error?: any): void => {
  if (currentLogLevel <= LogLevel.ERROR) {
    console.error(formatLogMessage(module, message), error);
  }
};

// Export a default logger object
export default {
  debug,
  info,
  warn,
  error,
  setLogLevel,
  getLogLevel,
  LogLevel,
};
