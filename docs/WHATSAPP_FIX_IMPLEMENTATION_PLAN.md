# WhatsApp Web.js Fix Implementation Plan

**Based on:** WHATSAPP_AUDIT_REPORT.md
**Target Branch:** `claude/audit-whatsapp-web-js-016Do8bEUo6XVb1FCjSYUFEc`
**Estimated Timeline:** 2-3 weeks
**Priority:** HIGH

---

## Phase 1: Critical Memory Leak Fixes (Days 1-3)

### Task 1.1: Fix Event Listener Memory Leak

**File:** `services/messaging/whatsapp.js`

**Changes Required:**

1. **Add event handler storage to WhatsAppService constructor**
   ```javascript
   constructor() {
     super();
     this.clientState = new ClientStateManager();
     this.circuitBreaker = new EnhancedCircuitBreaker();

     // NEW: Store event handler references for cleanup
     this.eventHandlers = null;
     this.setupEventHandlerReferences();
   }
   ```

2. **Create event handler reference method**
   ```javascript
   setupEventHandlerReferences() {
     // Store all handlers as bound methods for proper cleanup
     this.eventHandlers = {
       onQR: this.handleQR.bind(this),
       onReady: this.handleReady.bind(this),
       onMessageAck: this.handleMessageAck.bind(this),
       onDisconnected: this.handleDisconnected.bind(this),
       onAuthFailure: this.handleAuthFailure.bind(this),
       onLoadingScreen: this.handleLoadingScreen.bind(this),
       onAuthenticated: this.handleAuthenticated.bind(this)
     };
   }
   ```

3. **Refactor existing event handlers into named methods**
   - Move `client.on('qr', async (qr) => {...})` → `async handleQR(qr) {...}`
   - Move `client.on('ready', async () => {...})` → `async handleReady() {...}`
   - Move `client.on('message_ack', async (msg, ack) => {...})` → `async handleMessageAck(msg, ack) {...}`
   - Move `client.on('disconnected', async (reason) => {...})` → `async handleDisconnected(reason) {...}`
   - Move `client.on('auth_failure', async (error) => {...})` → `async handleAuthFailure(error) {...}`
   - Move `client.on('loading_screen', (percent, message) => {...})` → `handleLoadingScreen(percent, message) {...}`

4. **Update setupClientEventHandlers to use references**
   ```javascript
   async setupClientEventHandlers(client) {
     logger.whatsapp.debug('Setting up event handlers');

     client.on('qr', this.eventHandlers.onQR);
     client.on('ready', this.eventHandlers.onReady);
     client.on('authenticated', this.eventHandlers.onAuthenticated);
     client.on('message_ack', this.eventHandlers.onMessageAck);
     client.on('disconnected', this.eventHandlers.onDisconnected);
     client.on('auth_failure', this.eventHandlers.onAuthFailure);
     client.on('loading_screen', this.eventHandlers.onLoadingScreen);
   }
   ```

5. **Create removeClientEventHandlers method**
   ```javascript
   removeClientEventHandlers(client) {
     if (!client || !this.eventHandlers) {
       logger.whatsapp.debug('No client or handlers to remove');
       return;
     }

     try {
       client.removeListener('qr', this.eventHandlers.onQR);
       client.removeListener('ready', this.eventHandlers.onReady);
       client.removeListener('authenticated', this.eventHandlers.onAuthenticated);
       client.removeListener('message_ack', this.eventHandlers.onMessageAck);
       client.removeListener('disconnected', this.eventHandlers.onDisconnected);
       client.removeListener('auth_failure', this.eventHandlers.onAuthFailure);
       client.removeListener('loading_screen', this.eventHandlers.onLoadingScreen);

       logger.whatsapp.debug('Event handlers removed successfully');
     } catch (error) {
       logger.whatsapp.error('Error removing event handlers', error);
     }
   }
   ```

6. **Update destroyClient to remove handlers FIRST**
   ```javascript
   async destroyClient(reason = 'manual') {
     logger.whatsapp.info(`Destroying WhatsApp client (reason: ${reason})`);
     this.clientState.destroyInProgress = true;

     try {
       // STEP 1: Remove event listeners FIRST (prevents memory leak)
       if (this.clientState.client) {
         this.removeClientEventHandlers(this.clientState.client);
       }

       // STEP 2: Attempt graceful logout/destroy
       if (this.clientState.client) {
         // ... existing destroy logic
       }
     } finally {
       this.clientState.destroyInProgress = false;
     }
   }
   ```

**Testing:**
- Restart client 50 times and verify no event listener accumulation
- Use `process.memoryUsage()` to track memory
- Check `client.listenerCount('qr')` stays at 1

---

### Task 1.2: Fix Puppeteer Browser Instance Leak

**File:** `services/messaging/whatsapp.js`

**Changes Required:**

1. **Add browser tracking to ClientStateManager**
   ```javascript
   class ClientStateManager {
     constructor() {
       // ... existing code
       this.client = null;
       this.browser = null;  // NEW: Track browser instance
       this.page = null;     // NEW: Track page instance
     }
   }
   ```

2. **Store browser reference after client ready**
   ```javascript
   async handleReady() {
     logger.whatsapp.info('Client ready - broadcasting to frontend');

     // Store browser and page references for emergency cleanup
     if (this.clientState.client) {
       try {
         this.clientState.browser = this.clientState.client.pupBrowser;
         this.clientState.page = this.clientState.client.pupPage;
         logger.whatsapp.debug('Browser references stored', {
           hasBrowser: !!this.clientState.browser,
           hasPage: !!this.clientState.page
         });
       } catch (error) {
         logger.whatsapp.warn('Could not store browser references', error);
       }
     }

     // ... rest of ready handler
   }
   ```

3. **Add force browser close capability**
   ```javascript
   async forceCloseBrowser() {
     if (!this.clientState.browser) {
       logger.whatsapp.debug('No browser reference to close');
       return;
     }

     try {
       logger.whatsapp.warn('Force closing Puppeteer browser');

       // Get all pages and close them
       const pages = await this.clientState.browser.pages();
       await Promise.all(pages.map(page =>
         page.close().catch(err =>
           logger.whatsapp.error('Error closing page', err)
         )
       ));

       // Close the browser
       await Promise.race([
         this.clientState.browser.close(),
         new Promise((_, reject) =>
           setTimeout(() => reject(new Error('Browser close timeout')), 10000)
         )
       ]);

       logger.whatsapp.info('Browser force closed successfully');
     } catch (error) {
       logger.whatsapp.error('Error force closing browser', error);

       // Last resort: kill the process
       try {
         const browserProcess = this.clientState.browser.process();
         if (browserProcess) {
           browserProcess.kill('SIGKILL');
           logger.whatsapp.warn('Browser process killed with SIGKILL');
         }
       } catch (killError) {
         logger.whatsapp.error('Could not kill browser process', killError);
       }
     } finally {
       this.clientState.browser = null;
       this.clientState.page = null;
     }
   }
   ```

4. **Update destroyClient with browser force close fallback**
   ```javascript
   async destroyClient(reason = 'manual') {
     logger.whatsapp.info(`Destroying WhatsApp client (reason: ${reason})`);
     this.clientState.destroyInProgress = true;

     try {
       // Remove event listeners FIRST
       if (this.clientState.client) {
         this.removeClientEventHandlers(this.clientState.client);
       }

       // Try graceful destroy with timeout
       if (this.clientState.client) {
         try {
           await Promise.race([
             // Graceful destroy
             (async () => {
               if (reason !== 'restart') {
                 await this.clientState.client.logout();
               } else {
                 await this.clientState.client.destroy();
               }
             })(),
             // Timeout after 30 seconds
             new Promise((_, reject) =>
               setTimeout(() => reject(new Error('Client destroy timeout')), 30000)
             )
           ]);

           logger.whatsapp.info('Client destroyed gracefully');

         } catch (destroyError) {
           logger.whatsapp.error('Graceful destroy failed', destroyError);

           // FALLBACK: Force close the browser
           await this.forceCloseBrowser();
         }

         this.clientState.client = null;
       }

       // Final cleanup
       this.clientState.setState('DISCONNECTED');
       await this.messageState.setClientReady(false);

     } catch (error) {
       logger.whatsapp.error('Error destroying client', error);
       // Ensure browser is closed even on error
       await this.forceCloseBrowser();
     } finally {
       this.clientState.browser = null;
       this.clientState.page = null;
       this.clientState.destroyInProgress = false;
     }
   }
   ```

5. **Add initialization error cleanup**
   ```javascript
   async performInitialization(forceRestart = false) {
     // ... existing initialization code

     try {
       // ... existing try block

     } catch (error) {
       logger.whatsapp.error('Initialization failed', error);

       // IMPORTANT: Clean up browser if initialization fails
       if (this.clientState.client) {
         try {
           this.removeClientEventHandlers(this.clientState.client);
           await this.forceCloseBrowser();
           this.clientState.client = null;
         } catch (cleanupError) {
           logger.whatsapp.error('Error cleaning up after failed init', cleanupError);
         }
       }

       this.clientState.setState('ERROR', error);
       await this.messageState.setClientReady(false);

       // ... rest of error handling
     }
   }
   ```

**Testing:**
- Initialize and fail 20 times
- Check `ps aux | grep chrome` - should show 0 chrome processes
- Monitor memory with `htop` or Task Manager

---

### Task 1.3: Add Browser Process Monitoring

**New File:** `services/monitoring/BrowserMonitor.js`

```javascript
import { logger } from '../core/Logger.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class BrowserMonitor {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 60000; // 1 minute
    this.maxProcesses = options.maxProcesses || 2;
    this.timer = null;
    this.enabled = options.enabled !== false;
  }

  start() {
    if (!this.enabled) {
      logger.whatsapp.debug('Browser monitoring disabled');
      return;
    }

    this.timer = setInterval(() => {
      this.checkBrowserProcesses();
    }, this.checkInterval);

    logger.whatsapp.info('Browser monitoring started', {
      interval: `${this.checkInterval / 1000}s`,
      maxProcesses: this.maxProcesses
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.whatsapp.info('Browser monitoring stopped');
    }
  }

  async checkBrowserProcesses() {
    try {
      const platform = process.platform;
      let command;

      if (platform === 'win32') {
        command = 'tasklist /FI "IMAGENAME eq chrome.exe" /FO CSV /NH';
      } else {
        command = 'ps aux | grep -E "chrome|chromium" | grep -v grep';
      }

      const { stdout } = await execAsync(command);
      const lines = stdout.trim().split('\n').filter(line => line.length > 0);
      const processCount = lines.length;

      if (processCount > this.maxProcesses) {
        logger.whatsapp.warn('Excessive browser processes detected', {
          count: processCount,
          max: this.maxProcesses,
          processes: platform === 'win32' ? lines : lines.slice(0, 5)
        });

        // Emit warning event
        this.emit('excessive_processes', { count: processCount });
      }

      // Track memory usage
      if (processCount > 0) {
        this.trackMemoryUsage();
      }

    } catch (error) {
      // Non-critical - don't spam logs
      logger.whatsapp.debug('Browser process check failed', { error: error.message });
    }
  }

  async trackMemoryUsage() {
    const usage = process.memoryUsage();
    const mb = (bytes) => Math.round(bytes / 1024 / 1024);

    logger.whatsapp.debug('Memory usage', {
      rss: `${mb(usage.rss)} MB`,
      heapUsed: `${mb(usage.heapUsed)} MB`,
      heapTotal: `${mb(usage.heapTotal)} MB`,
      external: `${mb(usage.external)} MB`
    });

    // Alert if RSS > 1GB
    if (usage.rss > 1024 * 1024 * 1024) {
      logger.whatsapp.warn('High memory usage detected', {
        rss: `${mb(usage.rss)} MB`
      });
    }
  }
}

export const browserMonitor = new BrowserMonitor({
  checkInterval: 60000, // Check every minute
  maxProcesses: 2,
  enabled: process.env.BROWSER_MONITORING !== 'false'
});
```

**Integration in `services/messaging/whatsapp.js`:**

```javascript
import { browserMonitor } from '../monitoring/BrowserMonitor.js';

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    // ... existing code

    // Start browser monitoring
    browserMonitor.start();
  }

  async gracefulShutdown(signal = 'manual') {
    // ... existing code

    // Stop monitoring
    browserMonitor.stop();
  }
}
```

---

## Phase 2: Session Management Improvements (Days 4-6)

### Task 2.1: Improve Session Validation

**File:** `services/messaging/whatsapp.js`

**Replace `checkExistingSession()` method:**

```javascript
/**
 * Check if a valid WhatsApp session exists
 * Returns: { exists: boolean, valid: boolean, reason: string, details: object }
 */
async checkExistingSession() {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const crypto = await import('crypto');

    const result = {
      exists: false,
      valid: false,
      reason: 'unknown',
      details: {}
    };

    const sessionPath = '.wwebjs_auth/session-client/Default';
    const localStoragePath = path.default.join(sessionPath, 'Local Storage/leveldb');
    const indexedDBPath = path.default.join(sessionPath, 'IndexedDB');

    // Check 1: Directories exist
    if (!fs.default.existsSync(localStoragePath)) {
      result.reason = 'local_storage_missing';
      return result;
    }

    if (!fs.default.existsSync(indexedDBPath)) {
      result.reason = 'indexed_db_missing';
      return result;
    }

    result.exists = true;

    // Check 2: Has data files
    const localStorageFiles = fs.default.readdirSync(localStoragePath);
    const dataFiles = localStorageFiles.filter(f =>
      f.endsWith('.ldb') || f.endsWith('.log')
    );

    if (dataFiles.length === 0) {
      result.reason = 'no_data_files';
      result.details.fileCount = 0;
      return result;
    }

    result.details.fileCount = dataFiles.length;

    // Check 3: Files are not too old (30 days)
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let oldestFile = null;
    let newestFile = null;

    for (const file of dataFiles) {
      const filePath = path.default.join(localStoragePath, file);
      const stats = fs.default.statSync(filePath);
      const age = now - stats.mtimeMs;

      if (!oldestFile || age > (now - oldestFile.mtime)) {
        oldestFile = { name: file, mtime: stats.mtimeMs, age };
      }

      if (!newestFile || age < (now - newestFile.mtime)) {
        newestFile = { name: file, mtime: stats.mtimeMs, age };
      }

      if (age > maxAge) {
        result.reason = 'session_too_old';
        result.details.oldestFile = {
          name: file,
          ageDays: Math.round(age / 1000 / 60 / 60 / 24)
        };
        return result;
      }
    }

    result.details.oldestFile = oldestFile;
    result.details.newestFile = newestFile;

    // Check 4: Files are not empty or corrupted
    let totalSize = 0;
    const corruptedFiles = [];

    for (const file of dataFiles) {
      const filePath = path.default.join(localStoragePath, file);
      const stats = fs.default.statSync(filePath);

      if (stats.size === 0) {
        corruptedFiles.push({ file, reason: 'empty' });
        continue;
      }

      // Check if file is readable
      try {
        fs.default.accessSync(filePath, fs.constants.R_OK);
        totalSize += stats.size;
      } catch (accessError) {
        corruptedFiles.push({ file, reason: 'not_readable' });
      }
    }

    if (corruptedFiles.length > 0) {
      result.reason = 'corrupted_files';
      result.details.corruptedFiles = corruptedFiles;
      return result;
    }

    // Check 5: Reasonable total size (at least 1KB, max 100MB)
    if (totalSize < 1024) {
      result.reason = 'session_too_small';
      result.details.totalSize = totalSize;
      return result;
    }

    if (totalSize > 100 * 1024 * 1024) {
      result.reason = 'session_too_large';
      result.details.totalSize = totalSize;
      logger.whatsapp.warn('Session files unusually large', {
        size: `${Math.round(totalSize / 1024 / 1024)} MB`
      });
    }

    result.details.totalSize = totalSize;

    // All checks passed
    result.valid = true;
    result.reason = 'valid';

    logger.whatsapp.debug('Session validation passed', {
      fileCount: dataFiles.length,
      totalSize: `${Math.round(totalSize / 1024)} KB`,
      age: `${Math.round((now - newestFile.mtime) / 1000 / 60)} minutes`
    });

    return result;

  } catch (error) {
    logger.whatsapp.error('Error validating session', error);
    return {
      exists: false,
      valid: false,
      reason: 'validation_error',
      details: { error: error.message }
    };
  }
}
```

**Update initialization logic to use validation result:**

```javascript
async performInitialization(forceRestart = false) {
  logger.whatsapp.info('Starting initialization', { forceRestart });

  try {
    // Clean up existing client if restarting
    if (forceRestart && this.clientState.client) {
      await this.destroyClient('restart');
    }

    // Check for existing sessions with detailed validation
    if (!forceRestart && !this.clientState.client) {
      const sessionCheck = await this.checkExistingSession();

      if (sessionCheck.exists && sessionCheck.valid) {
        logger.whatsapp.info('Valid session found', sessionCheck.details);
      } else if (sessionCheck.exists && !sessionCheck.valid) {
        logger.whatsapp.warn('Invalid session detected - will clean up', {
          reason: sessionCheck.reason,
          details: sessionCheck.details
        });
        // Clean up invalid session
        await this.cleanupInvalidSession();
      } else {
        logger.whatsapp.info('No existing session found - will create new', {
          reason: sessionCheck.reason
        });
      }
    }

    // ... rest of initialization
  }
}
```

---

### Task 2.2: Improve Session Cleanup with Retry Logic

**File:** `services/messaging/whatsapp.js`

**Replace `cleanupInvalidSession()` method:**

```javascript
/**
 * Clean up invalid or corrupted session with retry logic
 * Handles locked files on Windows by retrying with delays
 */
async cleanupInvalidSession(maxRetries = 3) {
  const fs = await import('fs');
  const sessionPath = '.wwebjs_auth/session-client';

  if (!fs.default.existsSync(sessionPath)) {
    logger.whatsapp.debug('No session directory to clean up');
    return { success: true, reason: 'no_session' };
  }

  // Try to backup session before deletion (for debugging)
  try {
    const backupPath = `.wwebjs_auth/session-client-backup-${Date.now()}`;
    await fs.promises.rename(sessionPath, backupPath);
    logger.whatsapp.info('Session backed up before cleanup', { backupPath });

    // Delete backup after a delay (keep for 1 hour)
    setTimeout(() => {
      fs.default.rmSync(backupPath, { recursive: true, force: true });
      logger.whatsapp.debug('Session backup deleted', { backupPath });
    }, 60 * 60 * 1000);

    return { success: true, reason: 'backed_up_and_removed' };

  } catch (renameError) {
    // Backup failed, try direct deletion with retry
    logger.whatsapp.warn('Could not backup session, attempting direct deletion', {
      error: renameError.message
    });
  }

  // Retry deletion with exponential backoff
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.whatsapp.info(`Attempting session cleanup (attempt ${attempt}/${maxRetries})`);

      // Use force option to handle permissions issues
      fs.default.rmSync(sessionPath, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 1000
      });

      logger.whatsapp.info('Session cleaned up successfully', { attempt });
      return { success: true, reason: 'deleted', attempt };

    } catch (error) {
      logger.whatsapp.error(`Session cleanup attempt ${attempt} failed`, {
        error: error.message,
        code: error.code
      });

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        const delay = 1000 * Math.pow(2, attempt - 1);
        logger.whatsapp.info(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.whatsapp.error('Session cleanup failed after all retries', {
          maxRetries,
          error: error.message
        });
        return { success: false, reason: 'cleanup_failed', error: error.message };
      }
    }
  }

  return { success: false, reason: 'max_retries_exceeded' };
}
```

---

### Task 2.3: Add Session Health Monitoring

**New File:** `services/monitoring/SessionMonitor.js`

```javascript
import { logger } from '../core/Logger.js';
import fs from 'fs';
import path from 'path';

export class SessionMonitor {
  constructor() {
    this.sessionPath = '.wwebjs_auth/session-client/Default';
    this.stats = {
      lastCheck: null,
      fileCount: 0,
      totalSize: 0,
      oldestFile: null,
      newestFile: null
    };
  }

  async checkHealth() {
    try {
      const localStoragePath = path.join(this.sessionPath, 'Local Storage/leveldb');

      if (!fs.existsSync(localStoragePath)) {
        return { healthy: false, reason: 'session_missing' };
      }

      const files = fs.readdirSync(localStoragePath);
      const dataFiles = files.filter(f => f.endsWith('.ldb') || f.endsWith('.log'));

      let totalSize = 0;
      let oldestMtime = Date.now();
      let newestMtime = 0;

      for (const file of dataFiles) {
        const filePath = path.join(localStoragePath, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        oldestMtime = Math.min(oldestMtime, stats.mtimeMs);
        newestMtime = Math.max(newestMtime, stats.mtimeMs);
      }

      this.stats = {
        lastCheck: new Date(),
        fileCount: dataFiles.length,
        totalSize,
        oldestFile: new Date(oldestMtime),
        newestFile: new Date(newestMtime)
      };

      return {
        healthy: true,
        stats: this.stats
      };

    } catch (error) {
      logger.whatsapp.error('Session health check failed', error);
      return { healthy: false, reason: 'check_error', error: error.message };
    }
  }

  getStats() {
    return this.stats;
  }
}
```

---

## Phase 3: Puppeteer Configuration & QR Handling (Days 7-9)

### Task 3.1: Safer Puppeteer Configuration

**File:** `services/messaging/whatsapp.js`

**Add environment detection helper:**

```javascript
/**
 * Detect runtime environment and determine safe Puppeteer args
 */
function detectEnvironment() {
  const isDocker = fs.existsSync('/.dockerenv');
  const isRoot = process.getuid && process.getuid() === 0;
  const isWindows = process.platform === 'win32';
  const isWSL = !isWindows && process.env.WSL_DISTRO_NAME !== undefined;

  return { isDocker, isRoot, isWindows, isWSL };
}

/**
 * Get safe Puppeteer configuration based on environment
 */
function getPuppeteerConfig() {
  const env = detectEnvironment();

  logger.whatsapp.debug('Environment detected', env);

  const baseArgs = [
    '--disable-gpu',        // Required for headless
    '--no-first-run',       // Skip first-run wizards
    '--no-zygote',          // Disable zygote process
  ];

  // Only add sandbox flags if necessary
  if (env.isDocker && env.isRoot) {
    logger.whatsapp.warn('Running in Docker as root - disabling sandbox');
    baseArgs.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  // Add dev-shm-usage flag for containerized environments
  if (env.isDocker) {
    baseArgs.push('--disable-dev-shm-usage');
  }

  return {
    headless: 'new', // Use new headless mode
    userDataDir: './.wwebjs_cache/puppeteer_profile',
    args: baseArgs,
    timeout: 60000, // Browser launch timeout
    // Explicitly set executable path if needed
    ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
    })
  };
}
```

**Update client creation:**

```javascript
async createAndInitializeClient() {
  logger.whatsapp.debug('Creating client instance');

  // Check if aborted
  if (this.clientState.initializationAbortController?.signal.aborted) {
    throw new Error('Initialization aborted due to timeout');
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: "client",
      dataPath: './.wwebjs_auth' // Explicit data path
    }),
    puppeteer: getPuppeteerConfig(),
    // Add timeouts
    authTimeoutMs: 60000,     // 60 seconds for auth
    qrMaxRetries: 5,          // Max 5 QR refreshes
    // Handle takeover gracefully
    takeoverOnConflict: true,
    takeoverTimeoutMs: 10000
  });

  // ... rest of method
}
```

---

### Task 3.2: Simplify QR Code Handling (Remove Race Condition)

**File:** `services/messaging/whatsapp.js`

**Create simplified event handlers:**

```javascript
/**
 * Handle QR code generation
 * Simple approach: always show QR when received
 * If session is valid, 'authenticated' event will fire instead
 */
async handleQR(qr) {
  logger.whatsapp.info('QR code received');

  // Client is definitely not ready when QR is shown
  if (this.messageState.clientReady) {
    await this.messageState.setClientReady(false);
  }

  // Store QR code in state
  await this.messageState.setQR(qr);
  this.emit('qr', qr);

  // Broadcast to WebSocket clients
  if (this.wsEmitter) {
    try {
      const qrImageUrl = await qrcode.toDataURL(qr, {
        margin: 4,
        scale: 6,
        errorCorrectionLevel: 'M'
      });

      const message = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.QR_UPDATE,
        {
          qr: qrImageUrl,
          clientReady: false,
          message: 'Please scan QR code with WhatsApp mobile app'
        }
      );
      this.broadcastToClients(message);

      logger.whatsapp.debug('QR code broadcasted to clients');
    } catch (error) {
      logger.whatsapp.error('Failed to convert QR code to data URL:', error);
    }
  }
}

/**
 * Handle successful authentication
 * Fired when session is restored or QR is scanned
 */
async handleAuthenticated() {
  logger.whatsapp.info('Client authenticated successfully');

  // Clear QR code since we're authenticated
  await this.messageState.setQR(null);

  // Broadcast authentication success
  if (this.wsEmitter) {
    const message = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.CLIENT_READY,
      {
        clientReady: false, // Not ready yet, just authenticated
        state: 'authenticated',
        message: 'Authentication successful, loading WhatsApp...'
      }
    );
    this.broadcastToClients(message);
  }
}

/**
 * Handle client ready
 * Fired when client is fully initialized and ready to use
 */
async handleReady() {
  logger.whatsapp.info('Client ready');

  // Store browser references for cleanup
  if (this.clientState.client) {
    try {
      this.clientState.browser = this.clientState.client.pupBrowser;
      this.clientState.page = this.clientState.client.pupPage;
    } catch (error) {
      logger.whatsapp.warn('Could not store browser references', error);
    }
  }

  // Update state
  this.clientState.setState('CONNECTED');
  await this.messageState.setClientReady(true);
  await this.messageState.setQR(null);

  this.emit('ClientIsReady');

  // Broadcast to clients
  if (this.wsEmitter) {
    const message = createWebSocketMessage(
      MessageSchemas.WebSocketMessage.CLIENT_READY,
      {
        clientReady: true,
        state: 'ready',
        message: 'WhatsApp client is ready!'
      }
    );
    this.broadcastToClients(message);
  }
}
```

**Remove complex QR session restoration logic (lines 642-710):**

Delete the entire complex promise-based session restoration check. The new approach is simpler:
- If session exists and is valid → `authenticated` event fires → `ready` event fires
- If session doesn't exist or invalid → `qr` event fires → user scans → `authenticated` → `ready`

---

## Phase 4: Lifecycle Simplification (Days 10-12)

### Task 4.1: Consolidate Destruction Methods

**File:** `services/messaging/whatsapp.js`

**Replace three methods with one unified method:**

```javascript
/**
 * Unified client destruction method
 *
 * @param {Object} options - Destruction options
 * @param {boolean} options.logout - If true, logout from WhatsApp (clears auth)
 * @param {string} options.reason - Reason for destruction (for logging)
 * @param {boolean} options.force - If true, force close browser without waiting
 * @returns {Promise<Object>} Result object with success status
 */
async destroy(options = {}) {
  const {
    logout = false,
    reason = 'manual',
    force = false
  } = options;

  logger.whatsapp.info('Destroying WhatsApp client', {
    logout,
    reason,
    force
  });

  this.clientState.destroyInProgress = true;
  this.messageState.manualDisconnect = true;

  const result = {
    success: false,
    method: logout ? 'logout' : 'destroy',
    authPreserved: !logout,
    errors: []
  };

  try {
    // STEP 1: Remove all event listeners
    if (this.clientState.client) {
      try {
        this.removeClientEventHandlers(this.clientState.client);
        logger.whatsapp.debug('Event handlers removed');
      } catch (error) {
        logger.whatsapp.error('Error removing event handlers', error);
        result.errors.push({ step: 'remove_handlers', error: error.message });
      }
    }

    // STEP 2: Logout or destroy client
    if (this.clientState.client) {
      try {
        if (force) {
          // Force mode: skip graceful logout/destroy
          logger.whatsapp.warn('Force mode: skipping graceful client cleanup');
        } else {
          // Graceful mode with timeout
          const cleanupPromise = logout
            ? this.clientState.client.logout()
            : this.clientState.client.destroy();

          await Promise.race([
            cleanupPromise,
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Client cleanup timeout')), 30000)
            )
          ]);

          logger.whatsapp.info(`Client ${logout ? 'logged out' : 'destroyed'} gracefully`);
        }
      } catch (cleanupError) {
        logger.whatsapp.error('Graceful cleanup failed', cleanupError);
        result.errors.push({ step: 'client_cleanup', error: cleanupError.message });

        // Don't throw - continue to force browser close
      }

      this.clientState.client = null;
    }

    // STEP 3: Force close browser if needed
    if (force || result.errors.length > 0) {
      try {
        await this.forceCloseBrowser();
        logger.whatsapp.info('Browser force closed');
      } catch (browserError) {
        logger.whatsapp.error('Force browser close failed', browserError);
        result.errors.push({ step: 'force_close_browser', error: browserError.message });
      }
    }

    // STEP 4: Clean up state
    this.clientState.cleanup();
    this.clientState.setState('DISCONNECTED');
    await this.messageState.setClientReady(false);
    await this.messageState.setQR(null);

    // STEP 5: Complete all message sessions
    messageSessionManager.completeAllSessions();

    // STEP 6: Reset circuit breaker
    this.circuitBreaker.reset();

    result.success = result.errors.length === 0;

    if (result.success) {
      result.message = logout
        ? 'Client logged out successfully - authentication cleared'
        : 'Client destroyed successfully - authentication preserved';
    } else {
      result.message = 'Client destroyed with errors';
    }

    logger.whatsapp.info('Destruction completed', result);
    return result;

  } catch (error) {
    logger.whatsapp.error('Destruction failed', error);
    result.success = false;
    result.message = 'Destruction failed: ' + error.message;
    result.errors.push({ step: 'overall', error: error.message });
    return result;

  } finally {
    this.clientState.destroyInProgress = false;
    this.messageState.manualDisconnect = false;
    this.clientState.browser = null;
    this.clientState.page = null;
  }
}

// Convenience methods that call the unified destroy
async simpleDestroy() {
  return this.destroy({ logout: false, reason: 'simple_destroy' });
}

async completeLogout() {
  return this.destroy({ logout: true, reason: 'logout' });
}

async forceDestroy() {
  return this.destroy({ logout: false, reason: 'force', force: true });
}

// Keep old destroyClient for backward compatibility
async destroyClient(reason = 'manual') {
  const logout = reason !== 'restart';
  return this.destroy({ logout, reason });
}
```

**Update routes to use new API:**

```javascript
// routes/api/whatsapp.routes.js

router.post('/destroy', async (req, res) => {
  const result = await whatsapp.destroy({
    logout: false,
    reason: 'user_requested'
  });
  res.json(result);
});

router.post('/logout', async (req, res) => {
  const result = await whatsapp.destroy({
    logout: true,
    reason: 'user_requested'
  });
  res.json(result);
});

router.post('/force-destroy', async (req, res) => {
  const result = await whatsapp.destroy({
    logout: false,
    reason: 'user_requested',
    force: true
  });
  res.json(result);
});
```

---

## Phase 5: Testing & Validation (Days 13-15)

### Task 5.1: Memory Leak Testing Script

**New File:** `tests/whatsapp-memory-test.js`

```javascript
import whatsapp from '../services/messaging/whatsapp.js';
import { logger } from '../services/core/Logger.js';

const MB = 1024 * 1024;

function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: Math.round(usage.rss / MB),
    heapUsed: Math.round(usage.heapUsed / MB),
    heapTotal: Math.round(usage.heapTotal / MB),
    external: Math.round(usage.external / MB)
  };
}

async function testMemoryLeak(iterations = 50) {
  console.log(`\n🧪 WhatsApp Memory Leak Test - ${iterations} iterations\n`);

  const initialMemory = getMemoryUsage();
  console.log('Initial memory:', initialMemory);

  const results = [];

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n--- Iteration ${i}/${iterations} ---`);

    try {
      // Initialize
      console.log('Initializing...');
      await whatsapp.initialize();
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Destroy
      console.log('Destroying...');
      await whatsapp.destroy({ logout: false, reason: 'test' });
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const currentMemory = getMemoryUsage();
      const delta = {
        rss: currentMemory.rss - initialMemory.rss,
        heapUsed: currentMemory.heapUsed - initialMemory.heapUsed
      };

      results.push({ iteration: i, memory: currentMemory, delta });

      console.log('Current memory:', currentMemory);
      console.log('Delta from start:', delta);

      // Alert if memory growing rapidly
      if (delta.rss > 500) {
        console.warn('⚠️  WARNING: Memory increase > 500MB');
      }

    } catch (error) {
      console.error(`❌ Error in iteration ${i}:`, error.message);
    }
  }

  const finalMemory = getMemoryUsage();
  const totalDelta = {
    rss: finalMemory.rss - initialMemory.rss,
    heapUsed: finalMemory.heapUsed - initialMemory.heapUsed
  };

  console.log('\n📊 Test Results:');
  console.log('Initial memory:', initialMemory);
  console.log('Final memory:', finalMemory);
  console.log('Total delta:', totalDelta);
  console.log('Average delta per iteration:', {
    rss: Math.round(totalDelta.rss / iterations),
    heapUsed: Math.round(totalDelta.heapUsed / iterations)
  });

  // Pass/fail criteria
  const passed = totalDelta.rss < 200; // Less than 200MB growth
  console.log(`\n${passed ? '✅ PASSED' : '❌ FAILED'}`);

  return { passed, results, totalDelta };
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testMemoryLeak(50).then(({ passed }) => {
    process.exit(passed ? 0 : 1);
  });
}

export { testMemoryLeak };
```

**Run with:**
```bash
node --expose-gc tests/whatsapp-memory-test.js
```

---

### Task 5.2: Session Management Testing

**New File:** `tests/whatsapp-session-test.js`

```javascript
import whatsapp from '../services/messaging/whatsapp.js';
import fs from 'fs';
import path from 'path';

async function testSessionManagement() {
  console.log('\n🧪 WhatsApp Session Management Test\n');

  // Test 1: No session scenario
  console.log('Test 1: No existing session');
  await cleanupSession();
  const check1 = await whatsapp.checkExistingSession();
  console.log('Result:', check1);
  console.assert(!check1.exists, 'Should not find session');
  console.assert(!check1.valid, 'Should not be valid');

  // Test 2: Create client (will create session)
  console.log('\nTest 2: Initialize client (creates session)');
  await whatsapp.initialize();
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test 3: Check session exists
  console.log('\nTest 3: Check session exists after initialization');
  const check2 = await whatsapp.checkExistingSession();
  console.log('Result:', check2);
  console.assert(check2.exists, 'Session should exist');

  // Test 4: Destroy and verify session persists
  console.log('\nTest 4: Destroy client (preserve session)');
  await whatsapp.destroy({ logout: false });
  const check3 = await whatsapp.checkExistingSession();
  console.log('Result:', check3);
  console.assert(check3.exists, 'Session should still exist after destroy');

  // Test 5: Logout and verify session removed
  console.log('\nTest 5: Logout (remove session)');
  await whatsapp.initialize();
  await new Promise(resolve => setTimeout(resolve, 5000));
  await whatsapp.destroy({ logout: true });
  await new Promise(resolve => setTimeout(resolve, 2000));
  const check4 = await whatsapp.checkExistingSession();
  console.log('Result:', check4);
  console.assert(!check4.exists || !check4.valid, 'Session should be removed after logout');

  console.log('\n✅ All session tests passed!');
}

function cleanupSession() {
  const sessionPath = '.wwebjs_auth/session-client';
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true });
    console.log('Session cleaned up');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testSessionManagement().catch(console.error);
}

export { testSessionManagement };
```

---

## Phase 6: Documentation & Monitoring (Days 13-15)

### Task 6.1: Add Configuration Documentation

**New File:** `docs/WHATSAPP_CONFIGURATION.md`

```markdown
# WhatsApp Client Configuration Guide

## Environment Variables

### Required
- None - WhatsApp client works with defaults

### Optional
- `PUPPETEER_EXECUTABLE_PATH` - Custom Chrome/Chromium path
- `BROWSER_MONITORING` - Enable/disable browser monitoring (default: true)
- `WHATSAPP_AUTO_INIT` - Auto-initialize on startup (default: false)

## Puppeteer Configuration

The client auto-detects the environment and configures Puppeteer safely:

### Docker Environment
- Detects `/.dockerenv` file
- Adds `--no-sandbox` only if running as root
- Adds `--disable-dev-shm-usage` for memory management

### Windows/WSL Environment
- Uses minimal flags for security
- No sandbox disabling

### Custom Configuration
Edit `services/messaging/whatsapp.js` → `getPuppeteerConfig()`

## Session Management

### Session Location
- Path: `.wwebjs_auth/session-client/`
- Type: LocalAuth with clientId "client"
- Persists between restarts

### Session Validation
Sessions are validated for:
1. Directory existence
2. Data files present (*.ldb, *.log)
3. File age < 30 days
4. Files not empty or corrupted
5. Reasonable total size (1KB - 100MB)

### Manual Session Cleanup
```bash
# Remove session (will require QR scan)
rm -rf .wwebjs_auth/session-client

# Or via API
POST /api/wa/logout
```

## Client Lifecycle

### Initialization
```javascript
await whatsapp.initialize();
```

### Destruction Options
```javascript
// Preserve authentication
await whatsapp.destroy({ logout: false });

// Clear authentication
await whatsapp.destroy({ logout: true });

// Force close (emergency)
await whatsapp.destroy({ force: true });
```

## Monitoring

### Browser Process Monitoring
- Runs every 60 seconds
- Alerts if > 2 Chrome processes found
- Tracks memory usage

### Memory Alerts
- Warning at 512MB RSS
- Critical at 1GB RSS

### Session Health
- Check via `GET /api/wa/detailed-status`
- Returns session file stats
```

---

## Success Criteria

### Phase 1 ✅
- [ ] Event listeners properly removed on destroy
- [ ] Browser instances cleaned up even on errors
- [ ] Memory usage stays flat after 50 restart cycles
- [ ] No zombie Chrome processes after testing

### Phase 2 ✅
- [ ] Session validation detects corrupted sessions
- [ ] Invalid sessions automatically cleaned up
- [ ] Session cleanup handles locked files (Windows)
- [ ] Detailed session health reporting

### Phase 3 ✅
- [ ] Puppeteer uses minimal safe flags
- [ ] No `--no-sandbox` unless in Docker as root
- [ ] QR code handling has no race conditions
- [ ] Clear user feedback for each state

### Phase 4 ✅
- [ ] Single unified `destroy()` method
- [ ] All routes use new API
- [ ] Backward compatibility maintained
- [ ] Clear documentation of options

### Phase 5 ✅
- [ ] Memory leak test passes (< 200MB growth over 50 cycles)
- [ ] Session management tests pass
- [ ] Browser monitoring works
- [ ] All manual testing scenarios pass

### Phase 6 ✅
- [ ] Configuration documented
- [ ] Troubleshooting guide created
- [ ] Monitoring dashboard (optional)
- [ ] Code comments added

---

## Rollback Plan

If issues arise:

1. **Immediate Rollback**
   ```bash
   git revert <commit-hash>
   git push
   ```

2. **Partial Rollback**
   - Revert specific commits
   - Keep session validation improvements
   - Roll back event handler changes if issues

3. **Feature Flags**
   - Add `USE_NEW_DESTROY_METHOD` env var
   - Add `USE_SESSION_VALIDATION` env var
   - Allow gradual rollout

---

## Post-Implementation Tasks

1. **Week 1 After Deployment**
   - Monitor memory usage daily
   - Check error logs for new issues
   - Verify no QR code complaints from users

2. **Week 2-4 After Deployment**
   - Analyze session health metrics
   - Track browser process counts
   - Measure restart success rates

3. **Month 2**
   - Review and optimize timeouts
   - Consider adding Prometheus metrics
   - Plan for WhatsApp Web.js upgrade

---

## Contact & Support

For questions or issues during implementation:
- Check audit report: `docs/WHATSAPP_AUDIT_REPORT.md`
- Review this plan: `docs/WHATSAPP_FIX_IMPLEMENTATION_PLAN.md`
- Test thoroughly before production deployment
