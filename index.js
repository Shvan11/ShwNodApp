// index.js - Enhanced with resource management, health checks, and graceful shutdown
import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from './config/config.js';
import { setupWebSocketServer } from './utils/websocket.js';
import { setupMiddleware } from './middleware/index.js';
import apiRoutes from './routes/api/index.js';
import webRoutes from './routes/web.js';
import calendarRoutes from './routes/calendar.js';
import adminRoutes from './routes/admin.js';
import syncWebhookRoutes from './routes/sync-webhook.js';
import emailApiRoutes from './routes/email-api.js';
import authRoutes from './routes/auth.js';
import userManagementRoutes from './routes/user-management.js';
import costPresetRoutes from './routes/api/cost-preset.routes.js';
import lookupRoutes from './routes/api/lookup.routes.js';
import lookupAdminRoutes from './routes/api/lookup-admin.routes.js';
import holidayRoutes from './routes/api/holiday.routes.js';
import whatsappService from './services/messaging/whatsapp.js';
import session from 'express-session';
import SQLiteStore from 'connect-sqlite3';
import driveClient from './services/google-drive/google-drive-client.js';
import messageState from './services/state/messageState.js';
import { createWebSocketMessage, MessageSchemas } from './services/messaging/schemas.js';

// ===== ADDED: Import new infrastructure components =====
import ResourceManager from './services/core/ResourceManager.js';
import HealthCheck from './services/monitoring/HealthCheck.js';
import ConnectionPool from './services/database/ConnectionPool.js';
import { testConnection, testConnectionWithRetry } from './services/database/index.js';
import { createPathResolver } from './utils/path-resolver.js';
import queueProcessor from './services/sync/queue-processor.js';
import { startPeriodicPolling, stopPeriodicPolling } from './services/sync/reverse-sync-poller.js';
import { log } from './utils/logger.js';
import { requestTimeout, TIMEOUTS } from './middleware/timeout.js';

// Get current file and directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables (silent mode - config is loaded by config.js)
dotenv.config({ debug: false });

// Create Express app
const app = express();
const port = config.server.port || 3000;

// Create HTTP server
const server = createServer(app);
log.info('🌐 HTTP server created');

// ===== ADDED: Enhanced startup sequence with error handling =====
async function initializeApplication() {
  try {
    log.info('🚀 Starting Shwan Orthodontics Application...');
    log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    log.info(`Port: ${port}`);

    // ===== ADDED: Test database connectivity with retry logic =====
    log.info('📊 Testing database connectivity...');
    const dbTest = await testConnectionWithRetry();
    if (!dbTest.success) {
      log.error('❌ Database connection failed after retries:', dbTest.error);
      log.info('💡 Please check your database configuration and ensure the server is running');
      log.info('🔄 Application will continue to retry database connection in background');
      // Start background retry mechanism
      startBackgroundDatabaseRetry();
    } else {
      log.info('✅ Database connection successful');
    }

    // Setup middleware
    log.info('⚙️  Setting up middleware...');
    setupMiddleware(app);

    // ===== ADDED: Session configuration for authentication =====
    log.info('🔐 Setting up session management...');
    const SQLiteStoreSession = SQLiteStore(session);

    app.use(session({
      store: new SQLiteStoreSession({
        db: 'sessions.db',
        dir: './data'
      }),
      secret: process.env.SESSION_SECRET || 'shwan-orthodontics-secret-change-in-production',
      resave: false,
      saveUninitialized: false,
      rolling: true, // Reset expiration on every request
      cookie: {
        httpOnly: true,
        secure: false, // Allow HTTP for local development
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default
        sameSite: 'lax',
        path: '/' // Ensure cookie is sent for all paths
      },
      name: 'shwan.sid' // Custom cookie name
    }));

    log.info('✅ Session management configured');

    // ===== ADDED: Request timeout configuration =====
    log.info('⏱️  Setting up request timeout middleware...');
    // Set global timeout for all requests (30 seconds default)
    app.use(requestTimeout(TIMEOUTS.DEFAULT));
    log.info(`✅ Global request timeout set to ${TIMEOUTS.DEFAULT}ms (30 seconds)`);

    // Setup static files (MUST BE AFTER AUTHENTICATION to protect routes)
    log.info('📁 Setting up static file serving...');

    // Use path resolver for cross-platform compatibility
    const pathResolver = createPathResolver(config.fileSystem.machinePath);

    // Custom MIME types for Dolphin Imaging files (extensions: .i10, .i12, .i13, .i20, .i21, .i22, .i23, .i24)
    // These are JPEG images with non-standard extensions
    app.use('/DolImgs', express.static(pathResolver('working'), {
        setHeaders: (res, filePath) => {
            // Check if file has Dolphin Imaging extension (.iXX)
            if (/\.i\d+$/i.test(filePath)) {
                res.setHeader('Content-Type', 'image/jpeg');
            }
        }
    }));
    app.use('/clinic-assets', express.static(pathResolver('clinic1'))); // Changed from /assets to avoid conflict with Vite built assets
    app.use('/photoswipe', express.static('./public/photoswipe/'));
    app.use('/data', express.static('./data')); // Serve data directory for template files
    app.use('/images', express.static('./public/images')); // Serve images directory for production mode

    // Setup WebSocket
    log.info('🔌 Setting up WebSocket server...');
    const wsEmitter = setupWebSocketServer(server);

    // Inject WebSocket emitter into API routes to avoid circular imports
    const { setWebSocketEmitter } = await import('./routes/api/index.js');
    setWebSocketEmitter(wsEmitter);

    // Use routes
    log.info('🛣️  Setting up routes...');

    // ===== AUTHENTICATION MIDDLEWARE (MUST BE BEFORE ROUTES) =====
    // Public routes - NO authentication required
    app.use('/api/auth', authRoutes);
    app.use('/api', costPresetRoutes); // Cost preset routes (public - no auth needed)
    app.use('/api', lookupRoutes); // Lookup routes (public - no auth needed)

    // Serve login page BEFORE auth check (public access)
    app.get('/login.html', (req, res) => {
      res.sendFile(path.join(process.cwd(), './public/login.html'));
    });

    if (process.env.AUTHENTICATION_ENABLED === 'true') {
      log.info('🔐 Authentication ENABLED - Protecting routes');
      const { authenticate, authenticateWeb } = await import('./middleware/auth.js');

      // Protect API routes (returns 401 JSON)
      app.use('/api', authenticate);

      // Protect web routes (redirects to /login.html)
      app.use('/', authenticateWeb);
    } else {
      log.info('⚠️  Authentication DISABLED - All routes are public');
    }

    // ===== MOUNT ROUTES (AFTER AUTHENTICATION) =====
    app.use('/api', apiRoutes);
    app.use('/api/calendar', calendarRoutes);
    app.use('/api/email', emailApiRoutes);
    app.use('/api/users', userManagementRoutes); // User management (admin only)
    app.use('/api/admin', lookupAdminRoutes); // Lookup table admin routes
    app.use('/api/holidays', holidayRoutes); // Holiday management routes
    app.use('/', syncWebhookRoutes);
    app.use('/', adminRoutes);

    // Serve built SPA files (AFTER auth check, so protected)
    app.use(express.static('./dist'));

    // Final catch-all for SPA routing
    app.use('/', webRoutes);

    // ===== ADDED: Initialize health monitoring =====
    log.info('🏥 Starting health monitoring...');
    HealthCheck.start();

    // Initialize Google Drive client
    log.info('📁 Initializing Google Drive client...');
    const driveInitialized = driveClient.initialize();
    if (driveInitialized) {
      log.info('✅ Google Drive client initialized successfully');
    } else {
      log.info('⚠️  Google Drive not configured. PDF upload will be disabled.');
      log.info('💡 To enable PDF uploads, configure Google Drive credentials in .env');
    }

    // Connect WhatsApp service to WebSocket emitter
    console.log('💬 DEBUG: About to connect WhatsApp service...');
    log.info('💬 Connecting WhatsApp service...');
    whatsappService.setEmitter(wsEmitter);
    console.log('✅ DEBUG: WhatsApp service connected');

    // Set up comprehensive WhatsApp event handlers
    whatsappService.on('MessageSent', async (person) => {
        log.info("MessageSent event fired:", person);
        try {
            await messageState.addPerson(person);
            
            // Broadcast via WebSocket using proper WebSocket message creation
            if (wsEmitter) {
                const message = createWebSocketMessage(
                    MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
                    {
                        messageId: person.messageId,
                        status: MessageSchemas.MessageStatus.SERVER,
                        patientName: person.name,
                        phone: person.number,
                        timeSent: new Date().toISOString(),
                        message: '', // Will be populated from database if needed
                        appointmentId: person.appointmentId
                    }
                );
                wsEmitter.emit('broadcast_message', message);
                
                // Also emit progress update using proper message creation
                const stats = messageState.dump();
                const progressMessage = createWebSocketMessage(
                    'whatsapp_sending_progress',
                    {
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        finished: stats.finishedSending
                    }
                );
                wsEmitter.emit('broadcast_message', progressMessage);
            }
            
            log.info("MessageSent processed successfully");
        } catch (error) {
            log.error("Error handling MessageSent event:", error);
        }
    });

    whatsappService.on('MessageFailed', async (person) => {
        log.info("MessageFailed event fired:", person);
        try {
            person.success = '&times;';
            await messageState.addPerson(person);
            
            // Broadcast failure using proper WebSocket message creation
            if (wsEmitter) {
                const message = createWebSocketMessage(
                    MessageSchemas.WebSocketMessage.MESSAGE_STATUS,
                    {
                        messageId: person.messageId || `failed_${Date.now()}`,
                        status: MessageSchemas.MessageStatus.ERROR,
                        patientName: person.name,
                        phone: person.number,
                        timeSent: null,
                        message: '',
                        error: person.error,
                        appointmentId: person.appointmentId
                    }
                );
                wsEmitter.emit('broadcast_message', message);
                
                // Also emit progress update using proper message creation
                const stats = messageState.dump();
                const progressMessage = createWebSocketMessage(
                    'whatsapp_sending_progress', // This might need to be added to WebSocketEvents
                    {
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        finished: stats.finishedSending
                    }
                );
                wsEmitter.emit('broadcast_message', progressMessage);
            }
            
            log.info("MessageFailed processed successfully");
        } catch (error) {
            log.error("Error handling MessageFailed event:", error);
        }
    });

    whatsappService.on('finishedSending', async () => {
        log.info("finishedSending event fired");
        try {
            await messageState.setFinishedSending(true);
            
            // Broadcast completion using proper WebSocket message creation
            if (wsEmitter) {
                const stats = messageState.dump();
                const message = createWebSocketMessage(
                    'whatsapp_sending_finished', // Use the correct constant
                    { 
                        finished: true, 
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        total: stats.sentMessages + stats.failedMessages
                    }
                );
                wsEmitter.emit('broadcast_message', message);
            }
        } catch (error) {
            log.error("Error handling finishedSending event:", error);
        }
    });

    whatsappService.on('ClientIsReady', async () => {
        log.info("ClientIsReady event fired");
        try {
            await messageState.setClientReady(true);
            
            // Broadcast client ready using proper WebSocket message creation
            if (wsEmitter) {
                const message = createWebSocketMessage(
                    MessageSchemas.WebSocketMessage.CLIENT_READY,
                    { clientReady: true }
                );
                wsEmitter.emit('broadcast_message', message);
            }
            
            log.info("✅ WhatsApp client is ready and state updated");
        } catch (error) {
            log.error("❌ Error updating WhatsApp client ready state:", error);
        }
    });

    whatsappService.on('qr', async (qr) => {
        log.info("QR event fired");
        try {
            await messageState.setQR(qr);
            
            // Only broadcast if there are active viewers
            if (messageState.activeQRViewers > 0 && wsEmitter) {
                const message = createWebSocketMessage(
                    MessageSchemas.WebSocketMessage.QR_UPDATE,
                    { qr, clientReady: false }
                );
                wsEmitter.emit('broadcast_message', message);
            }
        } catch (error) {
            log.error("Error handling QR event:", error);
        }
    });

    // ===== ADDED: Enhanced error handling for startup =====
    // Handle uncaught exceptions gracefully during startup
    process.on('uncaughtException', (error) => {
      log.error('💥 Uncaught Exception during startup:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      log.error('💥 Unhandled Rejection during startup at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

    // Start server
    console.log('🚀 DEBUG: About to start HTTP server...');
    log.info('🚀 About to start HTTP server...');
    await startServer();
    console.log('✅ DEBUG: startServer() completed');

    // ===== ADDED: Automatic WhatsApp client initialization =====
    await initializeWhatsAppOnStartup();

    log.info('🎉 Application started successfully!');
    log.info(`🌐 Server running at http://localhost:${port}`);
    log.info(`🔒 HTTPS available via Caddy at https://clinic.local`);
    log.info(`📊 Health check available at http://localhost:${port}/api/health`);
    
    return { wsEmitter };

  } catch (error) {
    log.error('💥 Failed to initialize application:', error);
    log.info('🔄 Attempting graceful shutdown...');
    await gracefulShutdown('initialization-error');
    process.exit(1);
  }
}

// ===== ADDED: Promisified server startup =====
function startServer() {
  return new Promise((resolve, reject) => {
    const serverInstance = server.listen(port, (error) => {
      console.log('🔥 DEBUG: server.listen callback fired, error=', error);
      if (error) {
        reject(error);
      } else {
        console.log('🔥 DEBUG: No error, about to log "Server listening"');
        console.log(`✅ Server listening on port: ${port}`);
        log.info(`✅ Server listening on port: ${port}`);

        // Start SQL Server → PostgreSQL sync (webhook-based, zero polling)
        try {
          queueProcessor.start();
          log.info('✅ Queue processor started - Webhook-based sync enabled (SQL Server → Supabase)');
          log.info('   Real-time: SQL Server triggers webhook on data changes');
          log.info('   Reverse sync: Supabase webhooks handle doctor edits (see routes/sync-webhook.js)');
        } catch (error) {
          log.warn('⚠️  Queue processor failed to start:', error.message);
          log.info('   Sync will not be available. Check Supabase credentials.');
        }

        // Start reverse sync poller (Supabase → SQL Server)
        // Catches missed changes when server was offline + periodic hourly checks
        try {
          startPeriodicPolling(); // Uses env config or defaults to 60 min
          log.info('✅ Reverse sync poller started (Supabase → SQL Server)');
          log.info('   Startup: Catches changes missed while server was offline');
          log.info('   Periodic: Hourly checks as fallback for webhook failures');
        } catch (error) {
          log.warn('⚠️  Reverse sync poller failed to start:', error.message);
          log.info('   Missed changes will not be recovered. Check Supabase configuration.');
        }

        resolve(serverInstance);
      }
    });

    // Handle server errors
    serverInstance.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        log.error(`❌ Port ${port} is already in use`);
        log.info('💡 Please check if another instance is running or use a different port');
      } else {
        log.error('❌ Server error:', error);
      }
      reject(error);
    });
  });
}

// ===== ADDED: Comprehensive graceful shutdown =====
async function gracefulShutdown(signal) {
  log.info(`\n🛑 Graceful shutdown initiated by ${signal}`);
  
  try {
    // Stop accepting new connections
    if (server) {
      log.info('🔌 Closing HTTP server...');
      server.close(() => {
        log.info('✅ HTTP server closed');
      });
    }

    // Stop health monitoring
    log.info('🏥 Stopping health monitoring...');
    HealthCheck.stop();

    // Stop reverse sync poller
    log.info('🔄 Stopping reverse sync poller...');
    stopPeriodicPolling();

    // Clean up WhatsApp service
    if (whatsappService) {
      log.info('💬 Shutting down WhatsApp service...');
      await whatsappService.gracefulShutdown();
    }

    // Clean up message state
    if (messageState) {
      log.info('📊 Cleaning up message state...');
      await messageState.cleanup();
    }

    // Close database connections
    log.info('🗄️  Closing database connections...');
    await ConnectionPool.cleanup();

    // Final resource cleanup via Resource Manager
    log.info('🧹 Final resource cleanup...');
    // ResourceManager will handle its own cleanup via process handlers

    log.info('✅ Graceful shutdown completed successfully');
    process.exit(0);

  } catch (error) {
    log.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// ===== ADDED: Enhanced process signal handlers =====
// Handle termination signals
process.on('SIGTERM', () => {
  log.info('\n📡 Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  log.info('\n📡 Received SIGINT signal (Ctrl+C)');
  gracefulShutdown('SIGINT');
});

// Handle Windows specific signals
if (process.platform === 'win32') {
  process.on('SIGHUP', () => {
    log.info('\n📡 Received SIGHUP signal');
    gracefulShutdown('SIGHUP');
  });
}

// ===== ADDED: Application health endpoint for monitoring =====
app.get('/health/basic', (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  
  res.json({
    status: 'healthy',
    uptime: Math.floor(uptime),
    memory: {
      used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      total: Math.round(memoryUsage.heapTotal / 1024 / 1024)
    },
    timestamp: Date.now(),
    version: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// ===== ADDED: Initialize and start the application =====
// Start the application
const { wsEmitter } = await initializeApplication();

// Export WebSocket emitter for other modules (maintain existing functionality)
// ===== ADDED: Automatic WhatsApp initialization function =====
/**
 * Initialize WhatsApp client automatically on startup
 * Can be controlled via WHATSAPP_AUTO_INIT environment variable
 */
async function initializeWhatsAppOnStartup() {
  // Check if auto-initialization is enabled (default: true)
  const autoInit = process.env.WHATSAPP_AUTO_INIT !== 'false';
  
  if (!autoInit) {
    log.info('📱 WhatsApp auto-initialization disabled via WHATSAPP_AUTO_INIT=false');
    return;
  }

  log.info('📱 Starting automatic WhatsApp client initialization...');
  
  try {
    // Add a small delay to ensure all services are ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if WhatsApp service is ready
    if (!whatsappService) {
      log.info('⚠️  WhatsApp service not available, skipping auto-initialization');
      return;
    }

    // Check current state
    const currentState = whatsappService.getStatus();
    log.info(`📱 Current WhatsApp state: ${currentState.state || 'unknown'}`);
    
    // Only initialize if client is disconnected
    if (currentState.state === 'DISCONNECTED' || currentState.state === 'ERROR') {
      // Check for existing session first
      const hasExistingSession = await whatsappService.checkExistingSession();
      
      if (hasExistingSession) {
        log.info('📱 Found existing session - initializing WhatsApp client...');
      } else {
        log.info('📱 No existing session - initializing WhatsApp client (will require QR scan)...');
      }
      
      // Initialize with a timeout
      const initPromise = whatsappService.initialize();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Initialization timeout')), 60000) // Increased timeout for session restoration
      );
      
      await Promise.race([initPromise, timeoutPromise]);
      
      if (hasExistingSession) {
        log.info('✅ WhatsApp client initialization completed - session should be restored');
      } else {
        log.info('✅ WhatsApp client initialization started - waiting for QR scan');
      }
      
    } else if (currentState.state === 'CONNECTED') {
      log.info('✅ WhatsApp client already connected');
    } else if (currentState.state === 'INITIALIZING') {
      log.info('📱 WhatsApp client already initializing');
    } else {
      log.info(`📱 WhatsApp client in state: ${currentState.state}, skipping initialization`);
    }
    
  } catch (error) {
    // Don't fail the entire application if WhatsApp initialization fails
    log.warn('⚠️  WhatsApp auto-initialization failed (application will continue):', error.message);
    log.info('💡 WhatsApp can be initialized manually later via the web interface');
  }
}

export { wsEmitter };

// ===== ADDED: Simple background database retry mechanism =====
function startBackgroundDatabaseRetry() {
  const retryInterval = setInterval(async () => {
    try {
      const dbTest = await testConnection();
      if (dbTest.success) {
        log.info('✅ Database connection restored!');
        clearInterval(retryInterval);
      }
    } catch (error) {
      // Silent retry - only log success
    }
  }, 60000); // Check every 60 seconds
}

// ===== ADDED: Export graceful shutdown for external use =====
export { gracefulShutdown };

// ===== ADDED: Log application readiness =====
log.info('🎯 Application initialization complete - ready to serve requests');
log.info(`📋 Available endpoints:
  • Main Application: http://localhost:${port} (via Caddy: https://clinic.local)
  • API Health Check: http://localhost:${port}/api/health
  • Basic Health: http://localhost:${port}/health/basic
  • WhatsApp Status: http://localhost:${port}/api/wa/status
`);

// ===== ADDED: Optional performance monitoring =====
if (process.env.NODE_ENV === 'development') {
  // Log memory usage every 30 seconds in development
  setInterval(() => {
    const usage = process.memoryUsage();
    const uptime = process.uptime();
    log.info(`📊 Performance: Memory ${Math.round(usage.heapUsed / 1024 / 1024)}MB, Uptime ${Math.floor(uptime)}s`);
  }, 30000);
}