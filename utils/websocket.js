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

    // Set up global event handlers
    setupGlobalEventHandlers(wsEmitter, connections, waStatusConnections);

    wss.on('connection', (ws, req) => {
        console.log('Client connected to WebSocket');

        try {
            // Parse query parameters to get screenID and date
            const url = new URL(req.url, 'http://localhost');
            const screenID = url.searchParams.get('screenID');
            const date = url.searchParams.get('PDate');
            const clientType = url.searchParams.get('clientType');

            console.log(`New connection: screenID=${screenID}, date=${date}, clientType=${clientType}`);

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
                
                // Send initial data immediately
                sendInitialData(ws, date);
            }

            // Handle messages from clients
            ws.on('message', async (message) => {
                try {
                    const messageStr = message.toString();
                    console.log(`Received message: ${messageStr}`);
                    
                    if (messageStr === 'updateMessage' && date) {
                        console.log(`Processing updateMessage request for date: ${date}`);
                        await sendAppointmentsData(ws, date);
                    } else if (messageStr === 'ping') {
                        // Respond to ping with pong
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify({ type: 'pong' }));
                        }
                    } else {
                        try {
                            // Try to parse as JSON
                            const jsonMsg = JSON.parse(messageStr);
                            if (jsonMsg.type === 'ping') {
                                // Respond to JSON ping with pong
                                if (ws.readyState === ws.OPEN) {
                                    ws.send(JSON.stringify({ type: 'pong' }));
                                }
                            }
                        } catch (jsonError) {
                            // Not a JSON message, ignore
                        }
                    }
                } catch (msgError) {
                    console.error('Error processing message:', msgError);
                }
            });

            // Clean up on disconnect
            ws.on('close', (code, reason) => {
                if (ws.isWaClient) {
                    waStatusConnections.delete(ws);
                    console.log(`WhatsApp status client disconnected. Code: ${code}, Reason: ${reason || 'unknown'}`);
                } else if (screenID) {
                    connections.delete(screenID);
                    console.log(`Screen ${screenID} disconnected. Code: ${code}, Reason: ${reason || 'unknown'}`);
                }
            });
            
            // Handle connection errors
            ws.on('error', (error) => {
                console.error('WebSocket connection error:', error);
                // Cleanup connection from maps
                if (ws.isWaClient) {
                    waStatusConnections.delete(ws);
                } else if (screenID) {
                    connections.delete(screenID);
                }
            });
        } catch (error) {
            console.error('Error setting up WebSocket connection:', error);
        }
    });

    // Helper function to send initial data to client
    async function sendInitialData(ws, date) {
        if (!date || ws.readyState !== ws.OPEN) return;
        
        console.log(`Sending initial data for date: ${date}`);
        try {
            await sendAppointmentsData(ws, date);
        } catch (error) {
            console.error('Error sending initial data:', error);
        }
    }

    // Helper function to send appointment data to a WebSocket
    async function sendAppointmentsData(ws, date) {
        if (!date || ws.readyState !== ws.OPEN) return;
        
        console.log(`Fetching appointments data for date: ${date}`);
        try {
            const result = await database.getPresentAps(date);
            console.log(`Got appointments data for date ${date}: ${result.appointments ? result.appointments.length : 0} appointments`);
            
            ws.send(JSON.stringify({
                messageType: 'updated',
                tableData: result
            }));
            console.log(`Sent appointments data to client for date: ${date}`);
        } catch (error) {
            console.error(`Error fetching appointment data for date ${date}:`, error);
        }
    }

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

    // Setup global event handlers that work for all connections
    function setupGlobalEventHandlers(emitter, connections, waStatusConnections) {
        // Handle appointment updates - broadcast to all matching connections
        emitter.on('updated', async (dateParam) => {
            console.log(`Received 'updated' event for date: ${dateParam}`);
            
            // Get appointment data once to reuse for all connections
            let appointmentData;
            try {
                appointmentData = await database.getPresentAps(dateParam);
                console.log(`Fetched appointment data for date ${dateParam}: ${appointmentData.appointments ? appointmentData.appointments.length : 0} appointments`);
            } catch (error) {
                console.error(`Error fetching appointment data for date ${dateParam}:`, error);
                return; // Exit if we can't get data
            }
            
            const message = JSON.stringify({
                messageType: 'updated',
                tableData: appointmentData
            });
            
            // Broadcast to all screen connections
            let updateCount = 0;
            for (const [screenId, client] of connections.entries()) {
                if (client.readyState === client.OPEN) {
                    try {
                        client.send(message);
                        updateCount++;
                        console.log(`Sent update to screen ${screenId}`);
                    } catch (sendError) {
                        console.error(`Error sending update to screen ${screenId}:`, sendError);
                    }
                }
            }
            
            console.log(`Broadcast appointment updates to ${updateCount} clients`);
        });

        // Handle patient loaded event
        emitter.on('patientLoaded', async (pid, targetScreenID) => {
            console.log(`Received 'patientLoaded' event for patient ${pid}, screen ${targetScreenID}`);
            
            const targetClient = connections.get(targetScreenID);
            if (!targetClient || targetClient.readyState !== targetClient.OPEN) {
                console.log(`Target screen ${targetScreenID} not found or not ready`);
                return;
            }
            
            try {
                // Get patient data
                const [images, latestVisit] = await Promise.all([
                    getPatientImages(pid),
                    database.getLatestVisitsSum(pid)
                ]);
                
                // Send to client
                targetClient.send(JSON.stringify({
                    messageType: 'patientLoaded',
                    pid,
                    images,
                    latestVisit
                }));
                
                console.log(`Sent patient data for ${pid} to screen ${targetScreenID}`);
            } catch (error) {
                console.error(`Error sending patient data for ${pid} to screen ${targetScreenID}:`, error);
            }
        });

        // Handle patient unloaded event
        emitter.on('patientUnLoaded', (targetScreenID) => {
            console.log(`Received 'patientUnLoaded' event for screen ${targetScreenID}`);
            
            const targetClient = connections.get(targetScreenID);
            if (!targetClient || targetClient.readyState !== targetClient.OPEN) {
                console.log(`Target screen ${targetScreenID} not found or not ready`);
                return;
            }
            
            try {
                targetClient.send(JSON.stringify({
                    messageType: 'patientunLoaded'
                }));
                
                console.log(`Sent patientunLoaded to screen ${targetScreenID}`);
            } catch (error) {
                console.error(`Error sending patientunLoaded to screen ${targetScreenID}:`, error);
            }
        });

        // Handle WhatsApp message updates
        emitter.on('wa_message_update', (messageId, status, date) => {
            console.log(`Received 'wa_message_update' event: messageId=${messageId}, status=${status}, date=${date}`);
            
            // Prepare data to send
            const updateData = JSON.stringify({
                messageType: 'messageAckUpdated',
                messageId,
                status,
                date
            });
            
            // Broadcast to WhatsApp status clients
            let updateCount = 0;
            for (const client of waStatusConnections) {
                if (client.readyState === client.OPEN) {
                    // If date is specified, only send to clients with matching date
                    if (date && client.waDate && client.waDate !== date) {
                        continue;
                    }
                    
                    try {
                        client.send(updateData);
                        updateCount++;
                    } catch (error) {
                        console.error('Error sending to WhatsApp client:', error);
                    }
                }
            }
            
            console.log(`Broadcast WhatsApp message update to ${updateCount} clients`);
        });
    }

    // Set up a periodic ping to keep connections alive
    setInterval(() => {
        const ping = JSON.stringify({ type: 'ping' });
        
        // Ping all connections
        for (const [screenId, client] of connections.entries()) {
            if (client.readyState === client.OPEN) {
                try {
                    client.send(ping);
                } catch (error) {
                    console.error(`Error pinging screen ${screenId}:`, error);
                }
            }
        }
        
        // Ping WhatsApp status connections
        for (const client of waStatusConnections) {
            if (client.readyState === client.OPEN) {
                try {
                    client.send(ping);
                } catch (error) {
                    console.error('Error pinging WhatsApp client:', error);
                }
            }
        }
    }, 30000); // Ping every 30 seconds

    // Set up a periodic check function to broadcast updates
    setupPeriodicUpdate(wsEmitter);

    return wsEmitter;
}

/**
 * Set up periodic updates to all clients
 * @param {EventEmitter} emitter - WebSocket event emitter
 */
function setupPeriodicUpdate(emitter) {
    // Check for updates every minute
    const updateInterval = 60000; // 1 minute
    
    setInterval(() => {
        // Get current date in YYYY-MM-DD format
        const now = new Date();
        const today = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
        
        // Emit update event for today's date
        console.log(`Triggering periodic update for date: ${today}`);
        emitter.emit('updated', today);
    }, updateInterval);
    
    console.log(`Set up periodic updates every ${updateInterval / 1000} seconds`);
}

export { setupWebSocketServer };