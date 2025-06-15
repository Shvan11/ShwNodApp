import chalk from 'chalk';

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4
};

const LOG_COLORS = {
  DEBUG: chalk.gray,
  INFO: chalk.blue,
  WARN: chalk.yellow,
  ERROR: chalk.red
};

const LOG_ICONS = {
  DEBUG: '🔍',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❌'
};

const CATEGORIES = {
  DATABASE: 'DB',
  WHATSAPP: 'WA',
  WEBSOCKET: 'WS',
  HEALTH: 'HP',
  MESSAGE: 'MSG',
  SYSTEM: 'SYS',
  AUTH: 'AUTH'
};

class Logger {
  constructor() {
    this.level = this.getLogLevel();
    this.enabledCategories = this.getEnabledCategories();
  }

  getLogLevel() {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    return LOG_LEVELS[envLevel] !== undefined ? LOG_LEVELS[envLevel] : LOG_LEVELS.INFO;
  }

  getEnabledCategories() {
    const envCategories = process.env.LOG_CATEGORIES;
    if (!envCategories) return null; // All categories enabled
    return new Set(envCategories.split(',').map(cat => cat.trim().toUpperCase()));
  }

  shouldLog(level, category) {
    if (LOG_LEVELS[level] < this.level) return false;
    if (this.enabledCategories && !this.enabledCategories.has(category)) return false;
    return true;
  }

  formatMessage(level, category, message, data = null) {
    const timestamp = new Date().toISOString().substr(11, 8);
    const colorFn = LOG_COLORS[level];
    const icon = LOG_ICONS[level];
    const categoryStr = category ? `[${category}]` : '';
    
    let formatted = `${chalk.gray(timestamp)} ${icon} ${colorFn(level.padEnd(5))} ${chalk.cyan(categoryStr)} ${message}`;
    
    if (data && this.level === LOG_LEVELS.DEBUG) {
      formatted += `\n${chalk.gray(JSON.stringify(data, null, 2))}`;
    }
    
    return formatted;
  }

  log(level, category, message, data = null) {
    if (!this.shouldLog(level, category)) return;
    console.log(this.formatMessage(level, category, message, data));
  }

  debug(category, message, data = null) {
    this.log('DEBUG', category, message, data);
  }

  info(category, message, data = null) {
    this.log('INFO', category, message, data);
  }

  warn(category, message, data = null) {
    this.log('WARN', category, message, data);
  }

  error(category, message, data = null) {
    this.log('ERROR', category, message, data);
  }

  // Convenience methods for common operations
  database = {
    debug: (msg, data) => this.debug(CATEGORIES.DATABASE, msg, data),
    info: (msg, data) => this.info(CATEGORIES.DATABASE, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.DATABASE, msg, data),
    error: (msg, data) => this.error(CATEGORIES.DATABASE, msg, data)
  };

  whatsapp = {
    debug: (msg, data) => this.debug(CATEGORIES.WHATSAPP, msg, data),
    info: (msg, data) => this.info(CATEGORIES.WHATSAPP, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.WHATSAPP, msg, data),
    error: (msg, data) => this.error(CATEGORIES.WHATSAPP, msg, data)
  };

  websocket = {
    debug: (msg, data) => this.debug(CATEGORIES.WEBSOCKET, msg, data),
    info: (msg, data) => this.info(CATEGORIES.WEBSOCKET, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.WEBSOCKET, msg, data),
    error: (msg, data) => this.error(CATEGORIES.WEBSOCKET, msg, data)
  };

  health = {
    debug: (msg, data) => this.debug(CATEGORIES.HEALTH, msg, data),
    info: (msg, data) => this.info(CATEGORIES.HEALTH, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.HEALTH, msg, data),
    error: (msg, data) => this.error(CATEGORIES.HEALTH, msg, data)
  };

  message = {
    debug: (msg, data) => this.debug(CATEGORIES.MESSAGE, msg, data),
    info: (msg, data) => this.info(CATEGORIES.MESSAGE, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.MESSAGE, msg, data),
    error: (msg, data) => this.error(CATEGORIES.MESSAGE, msg, data)
  };

  system = {
    debug: (msg, data) => this.debug(CATEGORIES.SYSTEM, msg, data),
    info: (msg, data) => this.info(CATEGORIES.SYSTEM, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.SYSTEM, msg, data),
    error: (msg, data) => this.error(CATEGORIES.SYSTEM, msg, data)
  };

  auth = {
    debug: (msg, data) => this.debug(CATEGORIES.AUTH, msg, data),
    info: (msg, data) => this.info(CATEGORIES.AUTH, msg, data),
    warn: (msg, data) => this.warn(CATEGORIES.AUTH, msg, data),
    error: (msg, data) => this.error(CATEGORIES.AUTH, msg, data)
  };
}

export const logger = new Logger();
export default logger;