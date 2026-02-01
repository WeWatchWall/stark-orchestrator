/**
 * CLI Output Utilities
 *
 * Provides structured output support for JSON and human-readable formats.
 * @module @stark-o/cli/output
 */

import chalk from 'chalk';

/**
 * Output format type
 */
export type OutputFormat = 'json' | 'table' | 'plain';

/**
 * Global output format setting (can be overridden per command)
 */
let globalOutputFormat: OutputFormat = 'table';

/**
 * Sets the global output format
 */
export function setOutputFormat(format: OutputFormat): void {
  globalOutputFormat = format;
}

/**
 * Gets the current output format
 */
export function getOutputFormat(): OutputFormat {
  return globalOutputFormat;
}

/**
 * Outputs data in the specified format
 */
export function output(data: unknown, format?: OutputFormat): void {
  const fmt = format ?? globalOutputFormat;

  if (fmt === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    // For table/plain, just output as-is if string
    if (typeof data === 'string') {
      console.log(data);
    } else {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Outputs a success message
 */
export function success(message: string): void {
  if (globalOutputFormat === 'json') {
    console.log(JSON.stringify({ success: true, message }));
  } else {
    console.log(chalk.green('✓') + ' ' + message);
  }
}

/**
 * Outputs an error message
 */
export function error(message: string, details?: unknown): void {
  if (globalOutputFormat === 'json') {
    console.error(JSON.stringify({ success: false, error: message, details }));
  } else {
    console.error(chalk.red('✗') + ' ' + message);
    if (details) {
      console.error(chalk.gray(JSON.stringify(details, null, 2)));
    }
  }
}

/**
 * Outputs a warning message
 */
export function warn(message: string): void {
  if (globalOutputFormat === 'json') {
    console.log(JSON.stringify({ warning: message }));
  } else {
    console.log(chalk.yellow('⚠') + ' ' + message);
  }
}

/**
 * Outputs an info message
 */
export function info(message: string): void {
  if (globalOutputFormat === 'json') {
    console.log(JSON.stringify({ info: message }));
  } else {
    console.log(chalk.blue('ℹ') + ' ' + message);
  }
}

/**
 * Formats a table from an array of objects
 */
export function table<T extends Record<string, unknown>>(
  data: T[],
  columns?: Array<{ key: keyof T; header: string; width?: number }>
): void {
  if (globalOutputFormat === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (data.length === 0) {
    console.log(chalk.gray('No data to display'));
    return;
  }

  // Auto-detect columns if not provided
  const cols: Array<{ key: keyof T; header: string; width?: number }> = columns ?? Object.keys(data[0]!).map((key) => ({
    key: key as keyof T,
    header: key.charAt(0).toUpperCase() + key.slice(1),
  }));

  // Calculate column widths
  const widths = cols.map((col) => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...data.map((row) => String(row[col.key] ?? '').length)
    );
    return col.width ?? Math.max(headerWidth, maxDataWidth, 4);
  });

  // Print header
  const header = cols
    .map((col, i) => col.header.padEnd(widths[i]!))
    .join('  ');
  console.log(chalk.bold(header));

  // Print separator
  console.log(widths.map((w) => '─'.repeat(w)).join('──'));

  // Print rows
  for (const row of data) {
    const line = cols
      .map((col, i) => {
        const value = String(row[col.key] ?? '');
        return value.padEnd(widths[i]!);
      })
      .join('  ');
    console.log(line);
  }
}

/**
 * Formats key-value pairs for display
 */
export function keyValue(data: Record<string, unknown>): void {
  if (globalOutputFormat === 'json') {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const maxKeyLength = Math.max(...Object.keys(data).map((k) => k.length));

  for (const [key, value] of Object.entries(data)) {
    const formattedKey = chalk.bold(key.padEnd(maxKeyLength));
    const formattedValue = formatValue(value);
    console.log(`${formattedKey}  ${formattedValue}`);
  }
}

/**
 * Formats a single value for display
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('(none)');
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('true') : chalk.red('false');
  }
  if (typeof value === 'number') {
    return chalk.cyan(String(value));
  }
  if (value instanceof Date) {
    return chalk.yellow(value.toISOString());
  }
  if (typeof value === 'object') {
    return chalk.gray(JSON.stringify(value));
  }
  return String(value);
}

/**
 * Formats a status badge
 */
export function statusBadge(status: string): string {
  const statusLower = status.toLowerCase();

  if (['running', 'healthy', 'active', 'ready'].includes(statusLower)) {
    return chalk.green(`●`) + ' ' + chalk.green(status);
  }
  if (['pending', 'scheduling', 'starting'].includes(statusLower)) {
    return chalk.yellow(`◐`) + ' ' + chalk.yellow(status);
  }
  if (['failed', 'error', 'unhealthy', 'dead'].includes(statusLower)) {
    return chalk.red(`●`) + ' ' + chalk.red(status);
  }
  if (['stopped', 'terminated', 'completed'].includes(statusLower)) {
    return chalk.gray(`○`) + ' ' + chalk.gray(status);
  }

  return chalk.blue(`●`) + ' ' + status;
}

/**
 * Formats a date relative to now
 */
export function relativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;

  return d.toLocaleDateString();
}

/**
 * Formats bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Truncates a string to a maximum length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
