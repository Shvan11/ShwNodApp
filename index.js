// index.js - Updated to use the new modular structure
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

// Get current file and directory name for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const port = config.server.port || 80;
const server = createServer(app);

// Setup middleware
setupMiddleware(app);

// Setup static files
app.use(express.static('./public'));
app.use('/DolImgs', express.static('\\\\' + config.fileSystem.machinePath + '\\working'));
app.use('/assets', express.static('\\\\' + config.fileSystem.machinePath + '\\clinic1'));
app.use('/photoswipe', express.static('photoswipe/'));

// Setup WebSocket
const wsEmitter = setupWebSocketServer(server);

// Use routes
app.use('/api', apiRoutes);
app.use('/', webRoutes);

// Start server
server.listen(port, function () {
  console.log('Server listening on port: ' + port);
});

// Export WebSocket emitter for other modules
export { wsEmitter };

// Connect the emitter to the WhatsApp service

whatsappService.setEmitter(wsEmitter);

whatsappService.on('ClientIsReady', () => {
  messageState.clientReady = true;
  console.log("Set messageState.clientReady = true");
});