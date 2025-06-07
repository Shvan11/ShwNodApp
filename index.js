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
import whatsappService from './services/messaging/whatsapp.js';
import messageState from './services/state/messageState.js';
import { createWebSocketMessage, MessageSchemas } from './services/messaging/schemas.js';

// ===== ADDED: Import new infrastructure components =====
import ResourceManager from './services/core/ResourceManager.js';
import HealthCheck from './services/monitoring/HealthCheck.js';
import ConnectionPool from './services/database/ConnectionPool.js';
import { testConnection, testConnectionWithRetry } from './services/database/index.js';

// Get current file and directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = config.server.port || 80;
const server = createServer(app);

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
    app.use(express.static('./public'));
    app.use('/DolImgs', express.static('\\\\' + config.fileSystem.machinePath + '\\working'));
    app.use('/assets', express.static('\\\\' + config.fileSystem.machinePath + '\\clinic1'));
    app.use('/photoswipe', express.static('photoswipe/'));

    // Setup WebSocket
    console.log('🔌 Setting up WebSocket server...');
    const wsEmitter = setupWebSocketServer(server);

    // Use routes
    console.log('🛣️  Setting up routes...');
    app.use('/api', apiRoutes);
    app.use('/', webRoutes);

    // ===== ADDED: Initialize health monitoring =====
    console.log('🏥 Starting health monitoring...');
    HealthCheck.start();

    // Connect WhatsApp service to WebSocket emitter
    console.log('💬 Connecting WhatsApp service...');
    whatsappService.setEmitter(wsEmitter);

    // Set up comprehensive WhatsApp event handlers
    whatsappService.on('MessageSent', async (person) => {
        console.log("MessageSent event fired:", person);
        try {
            person.success = '&#10004;';
            await messageState.addPerson(person);
            
            // Broadcast via WebSocket using correct event name
            if (wsEmitter) {
                const message = {
                    type: 'whatsapp_message_status',
                    data: {
                        messageId: person.messageId,
                        status: 1, // MessageSchemas.MessageStatus.SERVER
                        patientName: person.name,
                        phone: person.number,
                        timeSent: new Date().toISOString(),
                        message: '', // Will be populated from database if needed
                        appointmentId: person.appointmentId
                    },
                    timestamp: Date.now()
                };
                wsEmitter.emit('broadcast_message', message);
                
                // Also emit progress update
                const stats = messageState.dump();
                const progressMessage = {
                    type: 'whatsapp_sending_progress',
                    data: {
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        finished: stats.finishedSending
                    },
                    timestamp: Date.now()
                };
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
            
            // Broadcast failure using correct event name
            if (wsEmitter) {
                const message = {
                    type: 'whatsapp_message_status',
                    data: {
                        messageId: person.messageId || `failed_${Date.now()}`,
                        status: -1, // MessageSchemas.MessageStatus.ERROR
                        patientName: person.name,
                        phone: person.number,
                        timeSent: null,
                        message: '',
                        error: person.error,
                        appointmentId: person.appointmentId
                    },
                    timestamp: Date.now()
                };
                wsEmitter.emit('broadcast_message', message);
                
                // Also emit progress update
                const stats = messageState.dump();
                const progressMessage = {
                    type: 'whatsapp_sending_progress',
                    data: {
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        finished: stats.finishedSending
                    },
                    timestamp: Date.now()
                };
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
            
            // Broadcast completion using correct event name
            if (wsEmitter) {
                const stats = messageState.dump();
                const message = {
                    type: 'whatsapp_sending_finished',
                    data: { 
                        finished: true, 
                        sent: stats.sentMessages,
                        failed: stats.failedMessages,
                        total: stats.sentMessages + stats.failedMessages
                    },
                    timestamp: Date.now()
                };
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
            
            // Broadcast client ready using correct event name
            if (wsEmitter) {
                const message = {
                    type: 'whatsapp_client_ready',
                    data: { clientReady: true },
                    timestamp: Date.now()
                };
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
                const message = {
                    type: 'whatsapp_qr_updated',
                    data: { qr, clientReady: false },
                    timestamp: Date.now()
                };
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

    console.log('🎉 Application started successfully!');
    console.log(`🌐 Server running at http://localhost:${port}`);
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
  • Main Application: http://localhost:${port}
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