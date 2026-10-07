/**
 * `LOG_LEVEL` → a level Winston knows.
 *
 * Winston's levels are lower-case, and a level it does not know is not an error: the
 * logger then writes NOTHING, at any level. `.env` here has always said
 * `LOG_LEVEL=INFO`; that went unnoticed only because the logger never read `.env`
 * (see config/early-env.ts). So the value is matched without regard to case, and
 * anything unrecognised falls back to `info` instead of silencing the service.
 */
export const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

export function resolveLogLevel(raw: string | undefined): LogLevel {
  const level = raw?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(level ?? '') ? (level as LogLevel) : DEFAULT_LOG_LEVEL;
}
