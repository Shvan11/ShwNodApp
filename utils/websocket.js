// utils/websocket.js
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import * as database from '../services/database/queries/index.js';

/**
 * Setup WebSocket server and event handling
 * @param {Object} server - HTTP server instance
 * @returns {EventEmitter} - Event emitter for WebSocket events
 */
function setupWebSocketServer(server) {
    const wsEmitter = new EventEmitter();
    const wss = new WebSocketServer({ server });

    // Map to store screen ID to WebSocket connections
    const connections = new Map();
    // Add a new map to track connections interested in WhatsApp statuses
    const waStatusConnections = new Set();

    wss.on('connection', (ws, req) => {
        console.log('Client connected to WebSocket');

        // Parse query parameters to get screenID and date
        const url = new URL(req.url, 'http://localhost');
        const screenID = url.searchParams.get('screenID');
        const date = url.searchParams.get('PDate');
        const clientType = url.searchParams.get('clientType');

        // Store connection based on type
        if (clientType === 'waStatus') {
            // This is a WhatsApp status client (send.html)
            waStatusConnections.add(ws);
            ws.waDate = date; // Store the date for filtering updates
            ws.isWaClient = true; // Simple flag to identify client type
            console.log('WhatsApp status client connected');
        } else if (screenID) {
            // This is a regular appointment screen (existing code)
            connections.set(screenID, ws);
            console.log(`Screen ${screenID} connected`);
        }

        // Handle messages from clients
        ws.on('message', async (message) => {
            const messageStr = message.toString();
            if (messageStr === 'updateMessage' && date) {
                try {
                    const result = await database.getPresentAps(date);
                    if (ws.readyState === ws.OPEN) {
                        ws.send(JSON.stringify({
                            messageType: 'updated',
                            tableData: result
                        }));
                    }
                } catch (error) {
                    console.error('Error fetching appointment data:', error);
                }
            }
        });

        // Listen for specific events and send them to the client
        wsEmitter.on('patientLoaded', (pid, targetScreenID) => {
            if (screenID === targetScreenID && ws.readyState === ws.OPEN) {
                // Get patient images and latest visit information
                Promise.all([
                    getPatientImages(pid),
                    database.getLatestVisitsSum(pid)
                ]).then(([images, latestVisit]) => {
                    ws.send(JSON.stringify({
                        messageType: 'patientLoaded',
                        pid,
                        images,
                        latestVisit
                    }));
                }).catch(error => {
                    console.error('Error preparing patient data:', error);
                });
            }
        });

        wsEmitter.on('patientUnLoaded', (targetScreenID) => {
            if (screenID === targetScreenID && ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                    messageType: 'patientunLoaded'
                }));
            }
        });

        // Send appointment updates to all connected clients
        wsEmitter.on('updated', async (dateParam) => {
            if (ws.readyState === ws.OPEN) {
                try {
                    const result = await database.getPresentAps(dateParam || date);
                    ws.send(JSON.stringify({
                        messageType: 'updated',
                        tableData: result
                    }));
                } catch (error) {
                    console.error('Error fetching updated appointment data:', error);
                }
            }
        });



        // Clean up on disconnect
        ws.on('close', () => {
            if (ws.isWaClient) {
                waStatusConnections.delete(ws);
                console.log('WhatsApp status client disconnected');
            } else if (screenID) {
                connections.delete(screenID);
                console.log(`Screen ${screenID} disconnected`);
            }
        });
    });

    // Helper function to get patient images
    async function getPatientImages(pid) {
        try {
            const tp = "0"; // Default timepoint
            const images = await database.getTimePointImgs(pid, tp);
            // Transform image names to proper format
            return images.map(code => {
                const name = `${pid}0${tp}.i${code}`;
                return { name };
            });
        } catch (error) {
            console.error('Error getting patient images:', error);
            return [];
        }
    }
    // Function to broadcast to WhatsApp status clients only
    function broadcastWaStatus(data) {
        waStatusConnections.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                try {
                    // If date is specified, only send to clients with matching date
                    if (data.date && client.waDate && client.waDate !== data.date) {
                        return;
                    }

                    client.send(JSON.stringify({
                        messageType: 'messageAckUpdated',
                        ...data
                    }));
                } catch (error) {
                    console.error('Error sending to WhatsApp client:', error);
                }
            }
        });
    }

    // Add new event for WhatsApp updates
    wsEmitter.on('wa_message_update', (messageId, status, date) => {
        broadcastWaStatus({ messageId, status, date });
    });

    return wsEmitter;
}

export { setupWebSocketServer };