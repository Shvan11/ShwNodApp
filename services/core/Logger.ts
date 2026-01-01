// services/core/Logger.ts
import chalk from 'chalk';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT';
type Category = 'DATABASE' | 'WHATSAPP' | 'WEBSOCKET' | 'HEALTH' | 'MESSAGE' | 'SYSTEM' | 'AUTH';
type CategoryAbbrev = 'DB' | 'WA' | 'WS' | 'HP' | 'MSG' | 'SYS' | 'AUTH';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

const LOG_COLORS: Record<Exclude<LogLevel, 'SILENT'>, (text: string) => string> = {
  DEBUG: chalk.gray,
  INFO: chalk.blue,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

const LOG_ICONS: Record<Exclude<LogLevel, 'SILENT'>, string> = {
  DEBUG: '🔍',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌',
};

const CATEGORIES: Record<Category, CategoryAbbrev> = {
  DATABASE: 'DB',
  WHATSAPP: 'WA',
  WEBSOCKET: 'WS',
  HEALTH: 'HP',
  MESSAGE: 'MSG',
  SYSTEM: 'SYS',
  AUTH: 'AUTH',
};

interface CategoryLogger {
  debug: (msg: string, data?: unknown) => void;
  info: (msg: string, data?: unknown) => void;
  warn: (msg: string, data?: unknown) => void;
  error: (msg: string, data?: unknown) => void;
}

class Logger {
  private level: number;
  private enabledCategories: Set<string> | null;

  public database: CategoryLogger;
  public whatsapp: CategoryLogger;
  public websocket: CategoryLogger;
  public health: CategoryLogger;
  public message: CategoryLogger;
  public system: CategoryLogger;
  public auth: CategoryLogger;

  constructor() {
    this.level = this.getLogLevel();
    this.enabledCategories = this.getEnabledCategories();

    // Initialize category loggers
    this.database = this.createCategoryLogger(CATEGORIES.DATABASE);
    this.whatsapp = this.createCategoryLogger(CATEGORIES.WHATSAPP);
    this.websocket = this.createCategoryLogger(CATEGORIES.WEBSOCKET);
    this.health = this.createCategoryLogger(CATEGORIES.HEALTH);
    this.message = this.createCategoryLogger(CATEGORIES.MESSAGE);
    this.system = this.createCategoryLogger(CATEGORIES.SYSTEM);
    this.auth = this.createCategoryLogger(CATEGORIES.AUTH);
  }

  private createCategoryLogger(category: CategoryAbbrev): CategoryLogger {
    return {
      debug: (msg: string, data?: unknown) => this.debug(category, msg, data),
      info: (msg: string, data?: unknown) => this.info(category, msg, data),
      warn: (msg: string, data?: unknown) => this.warn(category, msg, data),
      error: (msg: string, data?: unknown) => this.error(category, msg, data),
    };
  }

  private getLogLevel(): number {
    const envLevel = (process.env.LOG_LEVEL?.toUpperCase() || 'INFO') as LogLevel;
    return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO;
  }

  private getEnabledCategories(): Set<string> | null {
    const envCategories = process.env.LOG_CATEGORIES;
    if (!envCategories) return null; // All categories enabled
    return new Set(envCategories.split(',').map((cat) => cat.trim().toUpperCase()));
  }

  private shouldLog(level: Exclude<LogLevel, 'SILENT'>, category: string): boolean {
    if (LOG_LEVELS[level] < this.level) return false;
    if (this.enabledCategories && !this.enabledCategories.has(category)) return false;
    return true;
  }

  private formatMessage(
    level: Exclude<LogLevel, 'SILENT'>,
    category: string,
    message: string,
    data: unknown = null
  ): string {
    const timestamp = new Date().toISOString().substring(11, 19);
    const colorFn = LOG_COLORS[level];
    const icon = LOG_ICONS[level];
    const categoryStr = category ? `[${category}]` : '';

    let formatted = `${chalk.gray(timestamp)} ${icon} ${colorFn(level.padEnd(5))} ${chalk.cyan(categoryStr)} ${message}`;

    if (data && this.level === LOG_LEVELS.DEBUG) {
      formatted += `\n${chalk.gray(JSON.stringify(data, null, 2))}`;
    }

    return formatted;
  }

  log(level: Exclude<LogLevel, 'SILENT'>, category: string, message: string, data: unknown = null): void {
    if (!this.shouldLog(level, category)) return;
    console.log(this.formatMessage(level, category, message, data));
  }

  debug(category: string, message: string, data: unknown = null): void {
    this.log('DEBUG', category, message, data);
  }

  info(category: string, message: string, data: unknown = null): void {
    this.log('INFO', category, message, data);
  }

  warn(category: string, message: string, data: unknown = null): void {
    this.log('WARN', category, message, data);
  }

  error(category: string, message: string, data: unknown = null): void {
    this.log('ERROR', category, message, data);
  }
}

export const logger = new Logger();
export default logger;
