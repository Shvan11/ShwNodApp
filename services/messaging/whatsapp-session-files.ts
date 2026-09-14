/**
 * WhatsApp session-directory and Chrome-profile filesystem helpers.
 *
 * Split out of whatsapp.ts (S2/C6). Every function here was a `this`-free method on
 * `WhatsAppService` (or, for `ensureProfileUnlocked`, one that only called its two
 * `this`-free siblings), so the move is verbatim — the service now calls them as
 * plain functions.
 *
 * They are all about the LocalAuth profile on disk: judging whether the stored
 * session is usable, and guaranteeing no Chrome still holds the profile lock before
 * a (re)launch.
 */
import { log } from '../../utils/logger.js';
import type { SessionQuality } from './whatsapp-types.js';

/**
 * Guarantee the LocalAuth Chrome profile is free before (re)launching.
 *
 * Puppeteer refuses to launch on a profile another Chrome still owns and throws
 * "The browser is already running for <userDataDir>" — on Windows it detects a
 * leftover `<dir>\lockfile` plus Chrome's ProcessSingleton mutex held by a live
 * chrome.exe (BrowserLauncher.js). A bare destroy() can leave the old chrome.exe
 * still dying, and an unclean prior shutdown (e.g. the SIGHUP console-disconnect
 * path) can orphan one entirely. So we: (1) hard-kill the browser we had a handle
 * to and wait for it to actually exit, (2) on Windows kill any orphan chrome.exe
 * still bound to THIS profile (matched by command line, so the user's own Chrome
 * is never touched), then (3) delete the stale lock files.
 */
export async function ensureProfileUnlocked(
  trackedProc: { kill?: (signal: string) => void; pid?: number } | null = null
): Promise<void> {
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const sessionDir = pathMod.default.resolve('.wwebjs_auth', 'session-client');

  if (trackedProc?.pid) {
    await killPidAndWait(trackedProc.pid);
  }

  if (process.platform === 'win32') {
    await killWindowsChromeForProfile(sessionDir);
  }

  for (const name of ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      fsMod.default.rmSync(pathMod.default.join(sessionDir, name), {
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    } catch (err) {
      log.debug(`Profile unlock: could not remove ${name}`, {
        error: (err as Error).message,
      });
    }
  }
}

/** SIGKILL a PID, then poll (signal 0) until it's actually gone or we time out. */
export async function killPidAndWait(pid: number, timeoutMs = 8000): Promise<void> {
  try {
    process.kill(pid, 'SIGKILL');
    log.info('Killed leftover WhatsApp Chrome process', { pid });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') return; // already gone
    log.debug('killPidAndWait: initial kill failed', {
      pid,
      error: (err as Error).message,
    });
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0); // probe: throws ESRCH once the process is gone
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  log.warn('Leftover Chrome process still alive after kill timeout', { pid });
}

/**
 * Kill any chrome.exe whose command line references THIS LocalAuth profile dir.
 * Targeted on purpose — it must never close the staff member's personal Chrome,
 * only the orphaned WhatsApp-Web browser bound to our --user-data-dir.


/**
 * Kill any chrome.exe whose command line references THIS LocalAuth profile dir.
 * Targeted on purpose — it must never close the staff member's personal Chrome,
 * only the orphaned WhatsApp-Web browser bound to our --user-data-dir.
 */
export async function killWindowsChromeForProfile(sessionDir: string): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const run = promisify(execFile);

    const needle = sessionDir.replace(/'/g, "''"); // escape single quotes for PS
    const script =
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | ` +
      `Where-Object { $_.CommandLine -and $_.CommandLine -like '*${needle}*' } | ` +
      `ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; $_.ProcessId } catch {} }`;

    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 10000, windowsHide: true, encoding: 'utf8' }
    );
    const pids = String(stdout).trim();
    if (pids) {
      log.warn('Killed orphan Chrome bound to the WhatsApp profile', {
        pids: pids.split(/\s+/),
      });
    }
  } catch (err) {
    log.debug('Orphan-Chrome scan failed (non-fatal)', {
      error: (err as Error).message,
    });
  }
}

/**
 * Generate the daily appointments PDF (the same report the email path builds)
 * and post it to the staff WhatsApp group named {@link APPOINTMENTS_GROUP_NAME}.
 *
 * Best-effort: any failure (PDF gen, group not found, send error) is logged and
 * swallowed so it can never interrupt the per-patient notification batch.
 */

export async function validateSessionQuality(): Promise<SessionQuality> {
  try {
    // Async fs so a large/bloated Chrome profile dir doesn't block the event
    // loop — this runs on init AND on every QR event (handleQR).
    const fsp = (await import('fs/promises')).default;
    const path = await import('path');

    const exists = async (p: string): Promise<boolean> => {
      try {
        await fsp.access(p);
        return true;
      } catch {
        return false;
      }
    };

    const sessionPath = '.wwebjs_auth/session-client/Default';

    if (!(await exists(sessionPath))) {
      log.debug('Session quality: none (path does not exist)');
      return 'none';
    }

    try {
      const sessionStats = await fsp.stat(sessionPath);
      const sessionAgeMs = Date.now() - sessionStats.birthtimeMs;

      if (sessionAgeMs < 10000) {
        log.debug(
          `Session quality: new (session created ${Math.floor(sessionAgeMs / 1000)}s ago, assuming valid)`
        );
        return 'valid';
      }
    } catch {
      log.debug('Could not determine session age, continuing validation');
    }

    const indexedDBPath = path.default.join(sessionPath, 'IndexedDB');
    const indexedDBWhatsAppPath = path.default.join(
      indexedDBPath,
      'https_web.whatsapp.com_0.indexeddb.leveldb'
    );

    if (!(await exists(indexedDBPath))) {
      try {
        const parentStats = await fsp.stat(sessionPath);
        const parentAgeMs = Date.now() - parentStats.mtimeMs;

        if (parentAgeMs < 30000) {
          log.debug(
            `Session quality: initializing (modified ${Math.floor(parentAgeMs / 1000)}s ago, waiting for IndexedDB)`
          );
          return 'valid';
        }
      } catch {
        // Can't determine age, continue
      }

      log.debug('Session quality: empty (IndexedDB directory missing after 30s)');
      return 'empty';
    }

    let indexedDBDataFileCount = 0;
    if (await exists(indexedDBWhatsAppPath)) {
      try {
        const indexedDBFiles = await fsp.readdir(indexedDBWhatsAppPath);
        indexedDBDataFileCount = indexedDBFiles.filter((f) => f.endsWith('.ldb')).length;

        log.debug(
          `IndexedDB contains ${indexedDBDataFileCount} WhatsApp data files`
        );

        // LevelDB needs a MANIFEST file pointed to by CURRENT. If Chromium
        // was killed mid-MANIFEST-rewrite, CURRENT can reference a file that
        // never finished being written. Chromium will then fail to open the
        // database with "Internal error opening backing store", WA Web will
        // log out, and every restore retry hits the same wall.
        const currentPath = path.default.join(indexedDBWhatsAppPath, 'CURRENT');
        if (await exists(currentPath)) {
          const manifestName = (await fsp.readFile(currentPath, 'utf8')).trim();
          if (manifestName) {
            const manifestPath = path.default.join(indexedDBWhatsAppPath, manifestName);
            if (!(await exists(manifestPath))) {
              log.warn(
                `Session quality: corrupted (CURRENT references missing ${manifestName})`
              );
              return 'corrupted';
            }
          }
        }
      } catch (error) {
        log.warn('Session quality: corrupted (IndexedDB read error)', {
          error: (error as Error).message,
        });
        return 'corrupted';
      }
    }

    const leveldbPath = path.default.join(sessionPath, 'Local Storage/leveldb');

    if (await exists(leveldbPath)) {
      try {
        const leveldbFiles = await fsp.readdir(leveldbPath);
        log.debug(`Local Storage contains ${leveldbFiles.length} files`);
      } catch (error) {
        log.warn('Session quality: corrupted (leveldb read error)', {
          error: (error as Error).message,
        });
        return 'corrupted';
      }
    }

    let totalSize = 0;
    const calculateDirSize = async (dirPath: string): Promise<void> => {
      try {
        const files = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.default.join(dirPath, file.name);
          try {
            if (file.isDirectory()) {
              await calculateDirSize(filePath);
            } else {
              const stats = await fsp.stat(filePath);
              totalSize += stats.size;
            }
          } catch {
            log.debug(`Skipping file in size calculation: ${filePath}`);
          }
        }
      } catch {
        log.debug(`Skipping directory in size calculation: ${dirPath}`);
      }
    };

    await calculateDirSize(sessionPath);

    if (totalSize > 1024 * 1024) {
      // Mature session by total size, but the WA Web auth keys live
      // exclusively in IndexedDB. If Chrome was killed mid-write and
      // wiped the .ldb files, the session is unrecoverable even though
      // Local Storage / cookies remain.
      if (indexedDBDataFileCount === 0) {
        log.warn(
          `Session quality: corrupted (size ${Math.floor(totalSize / 1024)}KB but 0 IndexedDB data files - auth keys gone)`
        );
        return 'corrupted';
      }
      log.info(
        `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, mature session)`
      );
      return 'valid';
    }

    if (totalSize > 100 * 1024 && indexedDBDataFileCount >= 5) {
      log.info(
        `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files)`
      );
      return 'valid';
    }

    if (totalSize > 10 * 1024 && indexedDBDataFileCount > 0) {
      log.info(
        `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, ${indexedDBDataFileCount} IndexedDB files, fresh session)`
      );
      return 'valid';
    }

    if (totalSize < 10 * 1024) {
      log.debug(`Session quality: empty (size ${totalSize} bytes < 10KB after 10s)`);
      return 'empty';
    }

    if (indexedDBDataFileCount === 0) {
      log.debug(`Session quality: empty (no IndexedDB data files after 10s)`);
      return 'empty';
    }

    log.info(
      `Session quality: valid (size ${Math.floor(totalSize / 1024)}KB, assuming valid by default)`
    );
    return 'valid';
  } catch (error) {
    log.error('Error validating session quality', {
      error: (error as Error).message,
    });
    return 'corrupted';
  }
}

export async function checkExistingSession(): Promise<boolean> {
  const quality = await validateSessionQuality();
  return quality === 'valid';
}
