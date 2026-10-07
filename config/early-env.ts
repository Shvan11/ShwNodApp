/**
 * A setting for a module that is evaluated BEFORE `config.ts` has loaded the env
 * files into `process.env`.
 *
 * `config.ts` imports the logger, and ESM evaluates an import before the importing
 * module's body, so `utils/logger.ts` built its transports while `.env` was still
 * unread: `LOG_LEVEL` and `LOG_DIR` written there were ignored on every boot (the
 * level was always the default, whatever `.env` said), and only a value exported in
 * the shell or the service definition took effect.
 *
 * `earlyEnv()` answers with the value `process.env` WILL hold once config.ts has run,
 * by reading the same two files with the same precedence, and without writing to
 * `process.env` itself: loading every key here would hand `.env` to each test that
 * merely imports the logger, and the gate (which has no `.env`) would stop agreeing
 * with a developer's machine.
 *
 * Precedence, as `dotenv.config()` + the development override in config.ts produce it:
 *   1. `.env.development`, when NODE_ENV is 'development' (it overrides everything)
 *   2. the process environment
 *   3. `.env`
 */
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

/** The shared configuration file every launch reads. */
export const ENV_FILE = '.env';
/** Per-machine development overrides, read only when NODE_ENV is 'development'. */
export const DEV_ENV_FILE = '.env.development';

export type EnvFiles = { base: Record<string, string>; development: Record<string, string> };

function parseEnvFile(file: string): Record<string, string> {
  try {
    return dotenv.parse(fs.readFileSync(file));
  } catch {
    return {}; // no such file (CI, a fresh checkout): nothing to add
  }
}

/** Parse the env files under `dir` the way config.ts will load them for `nodeEnv`. */
export function readEnvFiles(dir: string, nodeEnv: string | undefined): EnvFiles {
  return {
    base: parseEnvFile(path.join(dir, ENV_FILE)),
    development: nodeEnv === 'development' ? parseEnvFile(path.join(dir, DEV_ENV_FILE)) : {},
  };
}

/** The precedence rule on its own, for the tests. */
export function resolveEarlyEnv(
  name: string,
  processEnv: Record<string, string | undefined>,
  files: EnvFiles
): string | undefined {
  if (Object.hasOwn(files.development, name)) return files.development[name];
  // dotenv never replaces a key the process already has, even an empty one.
  if (processEnv[name] !== undefined) return processEnv[name];
  return files.base[name];
}

let cached: EnvFiles | null = null;

/** The value `process.env[name]` will have once config.ts has loaded the env files. */
export function earlyEnv(name: string): string | undefined {
  cached ??= readEnvFiles(process.cwd(), process.env.NODE_ENV);
  return resolveEarlyEnv(name, process.env, cached);
}
