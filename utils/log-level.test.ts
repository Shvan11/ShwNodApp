/**
 * @vitest-environment node
 */
import { Writable } from 'node:stream';
import winston from 'winston';
import { describe, expect, it } from 'vitest';
import { resolveLogLevel } from './log-level.js';

/** How many of an error + an info + a debug line a logger at `level` writes. */
async function linesWritten(level: string): Promise<number> {
  let lines = 0;
  const stream = new Writable({
    write(_chunk, _enc, done) {
      lines++;
      done();
    },
  });
  const logger = winston.createLogger({ level, transports: [new winston.transports.Stream({ stream })] });
  logger.error('e');
  logger.info('i');
  logger.debug('d');
  await new Promise((resolve) => setTimeout(resolve, 20));
  return lines;
}

describe('resolveLogLevel', () => {
  it('accepts a level in any case — .env says LOG_LEVEL=INFO', () => {
    expect(resolveLogLevel('INFO')).toBe('info');
    expect(resolveLogLevel(' Debug ')).toBe('debug');
    expect(resolveLogLevel('warn')).toBe('warn');
  });

  it('falls back to info for a missing or unknown value', () => {
    expect(resolveLogLevel(undefined)).toBe('info');
    expect(resolveLogLevel('')).toBe('info');
    expect(resolveLogLevel('loud')).toBe('info');
  });

  it('exists because Winston goes silent on a level it does not know', async () => {
    // The value as written in .env, handed to Winston untouched: nothing is logged.
    expect(await linesWritten('INFO')).toBe(0);
    // Through resolveLogLevel: the error and the info line.
    expect(await linesWritten(resolveLogLevel('INFO'))).toBe(2);
    expect(await linesWritten(resolveLogLevel('debug'))).toBe(3);
  });
});
