// index.js - Enhanced with resource management, health checks, and graceful shutdown
import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import config from './config/config.js';
import { setupWebSocketServer } from './utils/websocket.js';
import { setupMiddleware } from './middlewares/index.js';
import apiRoutes from './routes/api.js';
import webRoutes from './routes/web.js';
import calendarRoutes from './routes/calendar.js';
import portalRoutes from './routes/portal.js';
import adminRoutes from './routes/admin.js';
import syncWebhookRoutes from './routes/sync-webhook.js';
import whatsappService from './services/messaging/whatsapp.js';
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

// Get current file and directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = config.server.port || 3000;

// Create HTTP server
const server = createServer(app);
console.log('🌐 HTTP server created');

// ===== ADDED: Enhanced startup sequence with error handling =====
async function initializeApplication() {
  try {
    console.log('🚀 Starting Shwan Orthodontics Application...');
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Port: ${port}`);

    // ===== ADDED: Test database connectivity with retry logic =====
    console.log('📊 Testing database connectivity...');
    const dbTest = await testConnectionWithRetry();
    if (!dbTest.success) {
      console.error('❌ Database connection failed after retries:', dbTest.error);
      console.log('💡 Please check your database configuration and ensure the server is running');
      console.log('🔄 Application will continue to retry database connection in background');
      // Start background retry mechanism
      startBackgroundDatabaseRetry();
    } else {
      console.log('✅ Database connection successful');
    }

    // Setup middleware
    console.log('⚙️  Setting up middleware...');
    setupMiddleware(app);

    // Setup static files
    console.log('📁 Setting up static file serving...');

    // IMPORTANT: Express server (port 3000) always serves built files from dist/
    // For development: Use Vite dev server at http://localhost:5173 (npm run dev)
    // For production: Use Express server at http://localhost:3000 (after npm run build)
    console.log('🚀 Serving built files from dist directory');
    app.use(express.static('./dist'));
    
    // Use path resolver for cross-platform compatibility
    const pathResolver = createPathResolver(config.fileSystem.machinePath);
    app.use('/DolImgs', express.static(pathResolver('working')));
    app.use('/assets', express.static(pathResolver('clinic1')));
    app.use('/photoswipe', express.static('./public/photoswipe/'));

    // Setup WebSocket
    console.log('🔌 Setting up WebSocket server...');
    const wsEmitter = setupWebSocketServer(server);

    // Inject WebSocket emitter into API routes to avoid circular imports
    const { setWebSocketEmitter } = await import('./routes/api.js');
    setWebSocketEmitter(wsEmitter);

    // Use routes
    console.log('🛣️  Setting up routes...');
    app.use('/api', apiRoutes);
    app.use('/api/calendar', calendarRoutes);
    app.use('/', syncWebhookRoutes); // Sync webhook endpoints (SQL Server ↔ Supabase)
    app.use('/', adminRoutes); // Admin routes
    app.use('/', portalRoutes); // Portal routes (includes auth middleware)
    app.use('/', webRoutes);

    // ===== ADDED: Initialize health monitoring =====
    console.log('🏥 Starting health monitoring...');
    HealthCheck.start();

    // Initialize Google Drive client
    console.log('📁 Initializing Google Drive client...');
    const driveInitialized = driveClient.initialize();
    if (driveInitialized) {
      console.log('✅ Google Drive client initialized successfully');
    } else {
      console.log('⚠️  Google Drive not configured. PDF upload will be disabled.');
      console.log('💡 To enable PDF uploads, configure Google Drive credentials in .env');
    }

    // Connect WhatsApp service to WebSocket emitter
    console.log('💬 Connecting WhatsApp service...');
    whatsappService.setEmitter(wsEmitter);

    // Set up comprehensive WhatsApp event handlers
    whatsappService.on('MessageSent', async (person) => {
        console.log("MessageSent event fired:", person);
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
            
            console.log("MessageSent processed successfully");
        } catch (error) {
            console.error("Error handling MessageSent event:", error);
        }
    });

    whatsappService.on('MessageFailed', async (person) => {
        console.log("MessageFailed event fired:", person);
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
            
            console.log("MessageFailed processed successfully");
        } catch (error) {
            console.error("Error handling MessageFailed event:", error);
        }
    });

    whatsappService.on('finishedSending', async () => {
        console.log("finishedSending event fired");
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
            console.error("Error handling finishedSending event:", error);
        }
    });

    whatsappService.on('ClientIsReady', async () => {
        console.log("ClientIsReady event fired");
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
            
            console.log("✅ WhatsApp client is ready and state updated");
        } catch (error) {
            console.error("❌ Error updating WhatsApp client ready state:", error);
        }
    });

    whatsappService.on('qr', async (qr) => {
        console.log("QR event fired");
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
            console.error("Error handling QR event:", error);
        }
    });

    // ===== ADDED: Enhanced error handling for startup =====
    // Handle uncaught exceptions gracefully during startup
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught Exception during startup:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled Rejection during startup at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });

    // Start server
    await startServer();

    // ===== ADDED: Automatic WhatsApp client initialization =====
    await initializeWhatsAppOnStartup();

    console.log('🎉 Application started successfully!');
    console.log(`🌐 Server running at http://localhost:${port}`);
    console.log(`🔒 HTTPS available via Caddy at https://clinic.local`);
    console.log(`📊 Health check available at http://localhost:${port}/api/health`);
    
    return { wsEmitter };

  } catch (error) {
    console.error('💥 Failed to initialize application:', error);
    console.log('🔄 Attempting graceful shutdown...');
    await gracefulShutdown('initialization-error');
    process.exit(1);
  }
}

// ===== ADDED: Promisified server startup =====
function startServer() {
  return new Promise((resolve, reject) => {
    const serverInstance = server.listen(port, (error) => {
      if (error) {
        reject(error);
      } else {
        console.log(`✅ Server listening on port: ${port}`);

        // Start SQL Server → PostgreSQL sync (webhook-based, zero polling)
        try {
          queueProcessor.start();
          console.log('✅ Queue processor started - Webhook-based sync enabled (SQL Server → Supabase)');
          console.log('   Real-time: SQL Server triggers webhook on data changes');
          console.log('   Reverse sync: Supabase webhooks handle doctor edits (see routes/sync-webhook.js)');
        } catch (error) {
          console.warn('⚠️  Queue processor failed to start:', error.message);
          console.log('   Sync will not be available. Check Supabase credentials.');
        }

        // Start reverse sync poller (Supabase → SQL Server)
        // Catches missed changes when server was offline + periodic hourly checks
        try {
          startPeriodicPolling(); // Uses env config or defaults to 60 min
          console.log('✅ Reverse sync poller started (Supabase → SQL Server)');
          console.log('   Startup: Catches changes missed while server was offline');
          console.log('   Periodic: Hourly checks as fallback for webhook failures');
        } catch (error) {
          console.warn('⚠️  Reverse sync poller failed to start:', error.message);
          console.log('   Missed changes will not be recovered. Check Supabase configuration.');
        }

        resolve(serverInstance);
      }
    });

    // Handle server errors
    serverInstance.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} is already in use`);
        console.log('💡 Please check if another instance is running or use a different port');
      } else {
        console.error('❌ Server error:', error);
      }
      reject(error);
    });
  });
}

// ===== ADDED: Comprehensive graceful shutdown =====
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Graceful shutdown initiated by ${signal}`);
  
  try {
    // Stop accepting new connections
    if (server) {
      console.log('🔌 Closing HTTP server...');
      server.close(() => {
        console.log('✅ HTTP server closed');
      });
    }

    // Stop health monitoring
    console.log('🏥 Stopping health monitoring...');
    HealthCheck.stop();

    // Stop reverse sync poller
    console.log('🔄 Stopping reverse sync poller...');
    stopPeriodicPolling();

    // Clean up WhatsApp service
    if (whatsappService) {
      console.log('💬 Shutting down WhatsApp service...');
      await whatsappService.gracefulShutdown();
    }

    // Clean up message state
    if (messageState) {
      console.log('📊 Cleaning up message state...');
      await messageState.cleanup();
    }

    // Close database connections
    console.log('🗄️  Closing database connections...');
    await ConnectionPool.cleanup();

    // Final resource cleanup via Resource Manager
    console.log('🧹 Final resource cleanup...');
    // ResourceManager will handle its own cleanup via process handlers

    console.log('✅ Graceful shutdown completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// ===== ADDED: Enhanced process signal handlers =====
// Handle termination signals
process.on('SIGTERM', () => {
  console.log('\n📡 Received SIGTERM signal');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('\n📡 Received SIGINT signal (Ctrl+C)');
  gracefulShutdown('SIGINT');
});

// Handle Windows specific signals
if (process.platform === 'win32') {
  process.on('SIGHUP', () => {
    console.log('\n📡 Received SIGHUP signal');
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
    console.log('📱 WhatsApp auto-initialization disabled via WHATSAPP_AUTO_INIT=false');
    return;
  }

  console.log('📱 Starting automatic WhatsApp client initialization...');
  
  try {
    // Add a small delay to ensure all services are ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if WhatsApp service is ready
    if (!whatsappService) {
      console.log('⚠️  WhatsApp service not available, skipping auto-initialization');
      return;
    }

    // Check current state
    const currentState = whatsappService.getStatus();
    console.log(`📱 Current WhatsApp state: ${currentState.state || 'unknown'}`);
    
    // Only initialize if client is disconnected
    if (currentState.state === 'DISCONNECTED' || currentState.state === 'ERROR') {
      // Check for existing session first
      const hasExistingSession = await whatsappService.checkExistingSession();
      
      if (hasExistingSession) {
        console.log('📱 Found existing session - initializing WhatsApp client...');
      } else {
        console.log('📱 No existing session - initializing WhatsApp client (will require QR scan)...');
      }
      
      // Initialize with a timeout
      const initPromise = whatsappService.initialize();
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Initialization timeout')), 60000) // Increased timeout for session restoration
      );
      
      await Promise.race([initPromise, timeoutPromise]);
      
      if (hasExistingSession) {
        console.log('✅ WhatsApp client initialization completed - session should be restored');
      } else {
        console.log('✅ WhatsApp client initialization started - waiting for QR scan');
      }
      
    } else if (currentState.state === 'CONNECTED') {
      console.log('✅ WhatsApp client already connected');
    } else if (currentState.state === 'INITIALIZING') {
      console.log('📱 WhatsApp client already initializing');
    } else {
      console.log(`📱 WhatsApp client in state: ${currentState.state}, skipping initialization`);
    }
    
  } catch (error) {
    // Don't fail the entire application if WhatsApp initialization fails
    console.warn('⚠️  WhatsApp auto-initialization failed (application will continue):', error.message);
    console.log('💡 WhatsApp can be initialized manually later via the web interface');
  }
}

export { wsEmitter };

// ===== ADDED: Simple background database retry mechanism =====
function startBackgroundDatabaseRetry() {
  const retryInterval = setInterval(async () => {
    try {
      const dbTest = await testConnection();
      if (dbTest.success) {
        console.log('✅ Database connection restored!');
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
console.log('🎯 Application initialization complete - ready to serve requests');
console.log(`📋 Available endpoints:
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
    console.log(`📊 Performance: Memory ${Math.round(usage.heapUsed / 1024 / 1024)}MB, Uptime ${Math.floor(uptime)}s`);
  }, 30000);
}