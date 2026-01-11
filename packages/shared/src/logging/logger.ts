/**
 * Structured JSON logger with correlation IDs
 * @module @stark-o/shared/logging/logger
 */

/**
 * Log levels
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Log level numeric values for comparison
 */
const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

/**
 * Log entry metadata
 */
export interface LogMeta {
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** Request ID */
  requestId?: string;
  /** User ID */
  userId?: string;
  /** Service name */
  service?: string;
  /** Component name */
  component?: string;
  /** Additional context */
  [key: string]: unknown;
}

/**
 * Structured log entry
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Log message */
  message: string;
  /** Metadata */
  meta?: LogMeta;
  /** Error details */
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
  };
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Minimum log level */
  level: LogLevel;
  /** Service name */
  service?: string;
  /** Component name */
  component?: string;
  /** Pretty print output (development) */
  pretty?: boolean;
  /** Enable timestamps */
  timestamps?: boolean;
  /** Custom output function */
  output?: (entry: LogEntry) => void;
}

/**
 * Default logger configuration
 */
const DEFAULT_CONFIG: LoggerConfig = {
  level: 'info',
  timestamps: true,
  pretty: false,
};

/**
 * Structured JSON logger
 */
export class Logger {
  private config: LoggerConfig;
  private meta: LogMeta;

  constructor(config: Partial<LoggerConfig> = {}, meta: LogMeta = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.meta = {
      ...meta,
      service: config.service || meta.service,
      component: config.component || meta.component,
    };
  }

  /**
   * Check if a log level is enabled
   */
  private isLevelEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.config.level];
  }

  /**
   * Format and output a log entry
   */
  private log(level: LogLevel, message: string, meta?: LogMeta, error?: Error): void {
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    // Merge metadata
    const mergedMeta = { ...this.meta, ...meta };
    if (Object.keys(mergedMeta).length > 0) {
      entry.meta = mergedMeta;
    }

    // Add error details
    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
      // Include error code if available
      if ('code' in error) {
        entry.error.code = (error as Error & { code?: string | number }).code;
      }
    }

    // Output the entry
    if (this.config.output) {
      this.config.output(entry);
    } else {
      this.defaultOutput(entry);
    }
  }

  /**
   * Default output to console
   */
  private defaultOutput(entry: LogEntry): void {
    const output = this.config.pretty ? this.formatPretty(entry) : JSON.stringify(entry);

    switch (entry.level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
      case 'fatal':
        console.error(output);
        break;
    }
  }

  /**
   * Format log entry for pretty printing
   */
  private formatPretty(entry: LogEntry): string {
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[90m', // Gray
      info: '\x1b[36m',  // Cyan
      warn: '\x1b[33m',  // Yellow
      error: '\x1b[31m', // Red
      fatal: '\x1b[35m', // Magenta
    };
    const reset = '\x1b[0m';
    const color = levelColors[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);

    let output = `${entry.timestamp} ${color}${levelStr}${reset} ${entry.message}`;

    if (entry.meta?.correlationId) {
      output += ` ${color}[${entry.meta.correlationId}]${reset}`;
    }

    if (entry.meta?.component) {
      output += ` ${color}(${entry.meta.component})${reset}`;
    }

    if (entry.error) {
      output += `\n  Error: ${entry.error.name}: ${entry.error.message}`;
      if (entry.error.stack) {
        output += `\n${entry.error.stack}`;
      }
    }

    return output;
  }

  /**
   * Create a child logger with additional metadata
   */
  child(meta: LogMeta): Logger {
    return new Logger(this.config, { ...this.meta, ...meta });
  }

  /**
   * Create a child logger with a correlation ID
   */
  withCorrelationId(correlationId: string): Logger {
    return this.child({ correlationId });
  }

  /**
   * Create a child logger with a request ID
   */
  withRequestId(requestId: string): Logger {
    return this.child({ requestId });
  }

  /**
   * Create a child logger with a user ID
   */
  withUserId(userId: string): Logger {
    return this.child({ userId });
  }

  /**
   * Log a debug message
   */
  debug(message: string, meta?: LogMeta): void {
    this.log('debug', message, meta);
  }

  /**
   * Log an info message
   */
  info(message: string, meta?: LogMeta): void {
    this.log('info', message, meta);
  }

  /**
   * Log a warning message
   */
  warn(message: string, meta?: LogMeta): void {
    this.log('warn', message, meta);
  }

  /**
   * Log an error message
   */
  error(message: string, error?: Error | LogMeta, meta?: LogMeta): void {
    if (error instanceof Error) {
      this.log('error', message, meta, error);
    } else {
      this.log('error', message, error);
    }
  }

  /**
   * Log a fatal error message
   */
  fatal(message: string, error?: Error | LogMeta, meta?: LogMeta): void {
    if (error instanceof Error) {
      this.log('fatal', message, meta, error);
    } else {
      this.log('fatal', message, error);
    }
  }
}

/**
 * Check if running in test environment
 */
export function isTestEnvironment(): boolean {
  return (
    process?.env?.NODE_ENV === 'test' ||
    process?.env?.VITEST === 'true' ||
    process?.env?.JEST_WORKER_ID !== undefined
  );
}

/**
 * Get the default log level based on environment
 */
function getDefaultLogLevel(): LogLevel {
  // In test environment, suppress logs unless explicitly set
  if (isTestEnvironment() && !process?.env?.LOG_LEVEL) {
    return 'fatal'; // Only show fatal errors during tests
  }
  return (process?.env?.LOG_LEVEL as LogLevel) || 'info';
}

/**
 * Silent output function for tests
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function silentOutput(_entry: LogEntry): void {
  // Intentionally empty - suppresses all output
}

/**
 * Create a new logger instance (basic, does not apply test environment detection)
 */
export function createLogger(config?: Partial<LoggerConfig>, meta?: LogMeta): Logger {
  return new Logger(config, meta);
}

/**
 * Create a logger instance with test environment detection
 * Automatically suppresses output during tests unless LOG_LEVEL is explicitly set
 */
export function createServiceLogger(config?: Partial<LoggerConfig>, meta?: LogMeta): Logger {
  const testConfig: Partial<LoggerConfig> = {};
  
  // In test environment, override to suppress logs unless LOG_LEVEL is set
  if (isTestEnvironment() && !process?.env?.LOG_LEVEL) {
    testConfig.level = 'fatal';
    testConfig.output = silentOutput;
  }
  
  return new Logger({ ...config, ...testConfig }, meta);
}

/**
 * Default logger instance
 */
export const logger = createLogger({
  level: getDefaultLogLevel(),
  pretty: process?.env?.NODE_ENV !== 'production',
  service: 'stark-orchestrator',
  // Use silent output in test environment unless LOG_LEVEL is explicitly set
  output: isTestEnvironment() && !process?.env?.LOG_LEVEL ? silentOutput : undefined,
});

/**
 * Generate a correlation ID
 */
export function generateCorrelationId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}
