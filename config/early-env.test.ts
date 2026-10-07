/**
 * @vitest-environment node
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import dotenv from 'dotenv';
import { DEV_ENV_FILE, ENV_FILE, readEnvFiles, resolveEarlyEnv } from './early-env.js';

describe('earlyEnv — what process.env will hold once config.ts has loaded the env files', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'early-env-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (file: string, body: string) => writeFileSync(path.join(dir, file), body);

  it('reads a setting from .env — the case the logger used to miss', () => {
    write(ENV_FILE, 'LOG_LEVEL=debug\nLOG_DIR="/var/log/clinic"\n');
    const files = readEnvFiles(dir, 'production');
    expect(resolveEarlyEnv('LOG_LEVEL', {}, files)).toBe('debug');
    expect(resolveEarlyEnv('LOG_DIR', {}, files)).toBe('/var/log/clinic');
  });

  it('lets the process environment win over .env, as dotenv does', () => {
    write(ENV_FILE, 'LOG_DIR=/var/log/clinic\n');
    const files = readEnvFiles(dir, 'production');
    expect(resolveEarlyEnv('LOG_DIR', { LOG_DIR: '/tmp/probe' }, files)).toBe('/tmp/probe');
    // An empty value in the environment is still "set": dotenv does not replace it.
    expect(resolveEarlyEnv('LOG_DIR', { LOG_DIR: '' }, files)).toBe('');
  });

  it('lets .env.development override both, in development only', () => {
    write(ENV_FILE, 'LOG_LEVEL=info\n');
    write(DEV_ENV_FILE, 'LOG_LEVEL=debug\n');
    expect(resolveEarlyEnv('LOG_LEVEL', { LOG_LEVEL: 'warn' }, readEnvFiles(dir, 'development'))).toBe('debug');
    expect(resolveEarlyEnv('LOG_LEVEL', { LOG_LEVEL: 'warn' }, readEnvFiles(dir, 'production'))).toBe('warn');
    expect(resolveEarlyEnv('LOG_LEVEL', {}, readEnvFiles(dir, 'production'))).toBe('info');
  });

  it('is undefined with no files and nothing exported (the CI gate)', () => {
    expect(resolveEarlyEnv('LOG_LEVEL', {}, readEnvFiles(dir, 'production'))).toBeUndefined();
  });

  it('agrees with what dotenv itself leaves in the environment', () => {
    write(ENV_FILE, 'A=from-env\nB=from-env\nC=from-env\n');
    write(DEV_ENV_FILE, 'B=from-dev\n');
    for (const nodeEnv of ['development', 'production']) {
      // The two calls config.ts makes, on a scratch environment.
      const processEnv: Record<string, string> = { C: 'from-shell' };
      dotenv.config({ path: path.join(dir, ENV_FILE), processEnv, quiet: true });
      if (nodeEnv === 'development') {
        dotenv.config({ path: path.join(dir, DEV_ENV_FILE), processEnv, override: true, quiet: true });
      }
      const files = readEnvFiles(dir, nodeEnv);
      for (const key of ['A', 'B', 'C', 'D']) {
        expect(resolveEarlyEnv(key, { C: 'from-shell' }, files), `${key} in ${nodeEnv}`).toBe(processEnv[key]);
      }
    }
  });
});
