/**
 * WhatsApp service with persistent client
 * Manages a single client instance across multiple operations
 */
import qrcode from "qrcode";
import whatsapp from "whatsapp-web.js";
import { EventEmitter } from "events";
import { getWhatsAppMessages, updateWhatsAppStatus, getWhatsAppDeliveryStatus, updateWhatsAppDeliveryStatus } from "../database/queries/messaging-queries.js";
import messageState from '../state/messageState.js';

const { Client, LocalAuth } = whatsapp;

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.clientState = 'idle'; // idle, initializing, ready, busy, error
    this.operationQueue = [];
    this.processingQueue = false;
    this.lastActivity = Date.now();
    this.initializationPromise = null;
    this.initializationPromiseResolve = null;
    this.initializationPromiseReject = null;
    this.messageAckTracking = new Map(); // Track message delivery status

    // Set up auto-disconnect timer to save resources
    setInterval(() => this.checkInactivity(), 300000); // Check every 5 minutes
  }

  /**
 * Set the WebSocket event emitter for real-time status updates
 * @param {EventEmitter} emitter - The event emitter to use
 */
  setEmitter(emitter) {
    console.log("Setting WebSocket emitter for WhatsApp service");
    this.wsEmitter = emitter;
  }


  /**
   * Get or create a client instance
   * @returns {Promise<Object>} - The WhatsApp client
   */
  async getClient() {
    // If client exists and is ready, return it
    if (this.client && this.clientState === 'ready') {
      this.lastActivity = Date.now();
      return this.client;
    }

    // If client is initializing, wait for it
    if (this.clientState === 'initializing' && this.initializationPromise) {
      try {
        await this.initializationPromise;
        return this.client;
      } catch (error) {
        console.error("Client initialization failed, retrying:", error);
        return this.initializeClient();
      }
    }

    // Otherwise, initialize a new client
    return this.initializeClient();
  }

  /**
   * Initialize the WhatsApp client
   * @returns {Promise<Object>} - The initialized client
   */
  async initializeClient() {
    // Set state to initializing
    this.clientState = 'initializing';

    // Clean up any existing initialization promise
    if (this.initializationPromiseReject) {
      this.initializationPromiseReject(new Error('New initialization started'));
    }

    // Create a promise to track initialization
    this.initializationPromise = new Promise((resolve, reject) => {
      this.initializationPromiseResolve = resolve;
      this.initializationPromiseReject = reject;

      // Add a timeout to prevent hanging
      setTimeout(() => {
        if (this.clientState === 'initializing') {
          this.clientState = 'error';
          reject(new Error('Client initialization timed out'));
        }
      }, 60000); // 60 seconds timeout
    });

    try {
      // Clean up any existing client
      if (this.client) {
        try {
          await this.client.destroy();
          console.log("Previous client destroyed");
        } catch (error) {
          console.warn("Error destroying previous client:", error);
        }
        this.client = null;
      }

      // Create a new client
      console.log("Creating new WhatsApp client...");
      this.client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu'
          ]
        }
      });

      // Set up event handlers
      this.setupClientEvents();

      // Initialize the client
      await this.client.initialize();
      console.log("Client initialization started");
    } catch (error) {
      this.clientState = 'error';
      console.error("Error initializing client:", error);

      if (this.initializationPromiseReject) {
        this.initializationPromiseReject(error);
      }
    }

    return this.initializationPromise;
  }

  /**
   * Set up client event handlers
   */
  setupClientEvents() {
    // QR code event
    this.client.on('qr', async (qr) => {
      try {
        console.log("QR code received");
        const myqr = await qrcode.toDataURL(qr);
        this.emit("qr", myqr);
      } catch (error) {
        console.error("Error generating QR code:", error);
      }
    });

    // Authentication event
    this.client.on('authenticated', () => {
      console.log('AUTHENTICATED');
      this.emit("Authenticated");
    });

    // Authentication failure event
    this.client.on('auth_failure', (msg) => {
      console.error('AUTH FAILURE:', msg);
      this.clientState = 'error';
      this.emit("AuthFailure", msg);

      if (this.initializationPromiseReject) {
        this.initializationPromiseReject(new Error(`Authentication failed: ${msg}`));
        this.initializationPromiseReject = null;
      }
    });

    // Client ready event
    this.client.on('ready', () => {
      console.log('Client is ready!');
      this.clientState = 'ready';
      this.lastActivity = Date.now();
      this.emit("ClientIsReady");

      if (this.initializationPromiseResolve) {
        this.initializationPromiseResolve(this.client);
        this.initializationPromiseResolve = null;
        this.initializationPromiseReject = null;
      }
    });

    // Disconnected event
    this.client.on('disconnected', (reason) => {
      console.log('Client disconnected:', reason);
      this.clientState = 'error';
      this.client = null;
      this.emit("ClientDisconnected", reason);

      if (this.initializationPromiseReject) {
        this.initializationPromiseReject(new Error(`Client disconnected: ${reason}`));
        this.initializationPromiseReject = null;
      }
    });

    // Replace the entire message_ack event handler with this corrected version
    this.client.on('message_ack', (msg, ack) => {
      console.log(`Message ${msg.id.id} ack status: ${ack}`);

      // If we're tracking this message, update its status
      if (this.messageAckTracking.has(msg.id.id)) {
        const { dbId, date } = this.messageAckTracking.get(msg.id.id);
 // Update status in our shared messageState
 messageState.updateMessageStatus(msg.id.id, ack);
       
  

        // Update the status in the database
        updateWhatsAppStatus([dbId], [msg.id.id], ack)
          .then(() => {
            // Emit event for WebSocket server to broadcast
            if (this.wsEmitter) {
              this.wsEmitter.emit('wa_message_update', msg.id.id, ack, date);
            } else {
              console.warn("wsEmitter not available, status updates won't be broadcasted");
            }

            // If we have a resolve function and this is a final state, resolve it
            const { resolve } = this.messageAckTracking.get(msg.id.id);
            if (resolve && (ack >= 3 || ack === -1)) {
              resolve(ack);
              this.messageAckTracking.delete(msg.id.id);
            }
          })
          .catch(error => console.error(`Error updating ack status for message ${msg.id.id}:`, error));
      }
    });
  }

  /**
   * Queue an operation to be executed when the client is available
   * @param {Function} operation - The operation function to queue
   * @param {number} [timeout=30000] - Operation timeout in ms
   * @param {number} [retries=3] - Number of retries for failed operations
   * @returns {Promise<any>} - Result of the operation
   */
  async queueOperation(operation, timeout = 30000, retries = 3) {
    return new Promise((resolve, reject) => {
      // Add operation to queue with metadata
      this.operationQueue.push({
        operation,
        resolve,
        reject,
        timeout,
        retries,
        retryCount: 0
      });

      // Process queue if not already processing
      if (!this.processingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process the operation queue
   */
  async processQueue() {
    if (this.operationQueue.length === 0) {
      this.processingQueue = false;
      return;
    }

    this.processingQueue = true;

    // Get the next operation
    const { operation, resolve, reject, timeout, retries, retryCount } = this.operationQueue.shift();

    // Create a timeout promise
    const timeoutPromise = new Promise((_, timeoutReject) => {
      setTimeout(() => timeoutReject(new Error('Operation timed out')), timeout);
    });

    try {
      // Set state to busy
      this.clientState = 'busy';

      // Get client
      const client = await this.getClient();

      // Execute operation with timeout
      const result = await Promise.race([
        operation(client),
        timeoutPromise
      ]);

      // Reset state to ready
      this.clientState = 'ready';

      // Update last activity
      this.lastActivity = Date.now();

      // Resolve promise
      resolve(result);
    } catch (error) {
      console.error("Error executing operation:", error);

      // Check if we should retry
      if (retryCount < retries) {
        console.log(`Retrying operation (${retryCount + 1}/${retries})...`);
        this.operationQueue.unshift({
          operation,
          resolve,
          reject,
          timeout,
          retries,
          retryCount: retryCount + 1
        });

        // If client error, try to reinitialize
        if (this.clientState === 'error') {
          try {
            await this.initializeClient();
          } catch (initError) {
            console.error("Error reinitializing client:", initError);
          }
        }
      } else {
        // Set state to error if this was the last retry
        this.clientState = 'error';

        // Reject promise
        reject(error);

        // Try to reinitialize client
        try {
          await this.initializeClient();
        } catch (initError) {
          console.error("Error reinitializing client:", initError);
        }
      }
    } finally {
      // Process next operation in queue
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  /**
   * Check client inactivity and disconnect if idle too long
   */
  async checkInactivity() {
    const inactiveTime = Date.now() - this.lastActivity;

    // If client is idle for more than 30 minutes and no operations are queued, disconnect
    if (this.client && this.clientState === 'ready' && inactiveTime > 1800000 && this.operationQueue.length === 0) {
      console.log("Disconnecting client due to inactivity");
      try {
        await this.client.destroy();
        this.client = null;
        this.clientState = 'idle';

        // Clear message tracking map
        this.messageAckTracking.clear();
      } catch (error) {
        console.error("Error disconnecting client:", error);
      }
    }
  }

  /**
   * Send WhatsApp messages
   * @param {string} date - Date to send messages for
   * @returns {Promise<void>} - Promise that resolves when complete
   */
  async send(date) {
    return this.queueOperation(async (client) => {
      try {
        // Get messages to send
        const [numbers, messages, ids, names] = await getWhatsAppMessages(date);
        const successCount = 0;
        const failCount = 0;

        // Create tracking for batch progress
        const total = numbers.length;
        const sendPromises = [];

        // Send each message
        for (let i = 0; i < numbers.length; i++) {
          if (!numbers[i]) continue;

          // Create promise for each message send
          const sendPromise = new Promise((resolve) => {
            this.sendMessageWithTracking(numbers[i], messages[i], ids[i], names[i], date)
              .then(result => {
                if (result.success) {
                  this.emit("MessageSent", {
                    name: names[i],
                    number: numbers[i],
                    messageId: result.messageId,
                    progress: {
                      current: i + 1,
                      total,
                      successCount: successCount + 1,
                      failCount
                    }
                  });
                } else {
                  this.emit("MessageFailed", {
                    name: names[i],
                    number: numbers[i],
                    error: result.error,
                    progress: {
                      current: i + 1,
                      total,
                      successCount,
                      failCount: failCount + 1
                    }
                  });
                }
                resolve();
              })
              .catch(error => {
                this.emit("MessageFailed", {
                  name: names[i],
                  number: numbers[i],
                  error: error.message,
                  progress: {
                    current: i + 1,
                    total,
                    successCount,
                    failCount: failCount + 1
                  }
                });
                resolve();
              });
          });

          sendPromises.push(sendPromise);
        }

        // Wait for all messages to be processed
        await Promise.all(sendPromises);

        this.emit("finishedSending", {
          total,
          successCount,
          failCount,
          date
        });

        return {
          success: true,
          total,
          successCount,
          failCount
        };
      } catch (error) {
        console.error("Error in send operation:", error);
        throw error;
      }
    }, 120000, 2); // 2 minute timeout, 2 retries
  }

  /**
   * Send a single message with tracking
   * @param {string} number - Recipient number
   * @param {string} message - Message content
   * @param {string} dbId - Database ID for this message
   * @param {string} name - Recipient name
   * @param {string} date - Date for this message
   * @returns {Promise<Object>} - Send result
   */
  async sendMessageWithTracking(number, message, dbId, name, date) {
    try {
      const client = await this.getClient();

      // Validate number format (add any validation logic here)
      if (!number.includes('@c.us')) {
        // If number doesn't include WhatsApp suffix, try to get number ID
        const numberDetails = await client.getNumberId(number);
        if (!numberDetails) {
          console.log(`${number} is not registered on WhatsApp`);
          return {
            success: false,
            error: 'Number not registered on WhatsApp'
          };
        }

        // Use the serialized number
        number = numberDetails._serialized;
      }

      // Send the message
      const messageData = await client.sendMessage(number, message);
      const messageId = messageData.id.id;

      // Create a promise for delivery tracking
      const deliveryPromise = new Promise((resolve) => {
        // Set up a timeout for delivery tracking (10 minutes)
        setTimeout(() => {
          if (this.messageAckTracking.has(messageId)) {
            // If still tracking after timeout, consider it sent but not confirmed
            resolve(1); // 1 = sent to server but not delivered
            this.messageAckTracking.delete(messageId);
          }
        }, 600000);
      });

      // Store message tracking info with the date
      this.messageAckTracking.set(messageId, {
        dbId,
        number,
        name,
        sent: Date.now(),
        resolve: (ack) => deliveryPromise.resolve?.(ack),
        date // Store the date for use in status updates
      });

      // Update database with initial send status
      await updateWhatsAppStatus([dbId], [messageId], 1); // 1 = message sent to server

      return {
        success: true,
        messageId,
        deliveryPromise
      };
    } catch (error) {
      console.error(`Error sending message to ${number}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate delivery report using message_ack events
   * @param {string} date - Date to report on
   * @returns {Promise<Object>} - Report results
   */
  async report(date) {
    return this.queueOperation(async (client) => {
      try {
        // Get messages to check
        const messages = await getWhatsAppDeliveryStatus(date);
        let updated = 0;
        let notFound = 0;

        // Process each message
        for (const message of messages) {
          try {
            // Skip messages without a WhatsApp message ID
            if (!message.wamid) {
              message.ack = -1;
              notFound++;
              continue;
            }

            // Try to find chat by number
            const id = await client.getNumberId(message.num);
            if (!id) {
              console.log(`Number not found: ${message.num}`);
              message.ack = -1;
              notFound++;
              continue;
            }

            // Get chat and messages
            const chat = await client.getChatById(id._serialized);
            if (!chat) {
              console.log("No chat found for number:", message.num);
              message.ack = -1;
              notFound++;
              continue;
            }

            // Fetch messages and find the one with matching ID
            const msgs = await chat.fetchMessages({ limit: 30 }); // Optimize by limiting number of messages
            let found = false;

            for (const msg of msgs) {
              if (msg.id.id === message.wamid) {
                message.ack = msg.ack;
                updated++;
                found = true;
                break;
              }
            }

            if (!found) {
              message.ack = -1;
              notFound++;
            }
          } catch (error) {
            console.error(`Error processing ${message.num}:`, error);
            message.ack = -1;
            notFound++;
          }
        }

        // Update delivery status
        await updateWhatsAppDeliveryStatus(messages);

        const result = {
          date,
          total: messages.length,
          updated,
          notFound
        };

        this.emit("finish_report", result);

        return result;
      } catch (error) {
        console.error("Error in report operation:", error);
        throw error;
      }
    }, 300000, 1); // 5 minute timeout, 1 retry
  }

  /**
   * Clear all chats
   * @returns {Promise<Object>} - Success status
   */
  async clear() {
    return this.queueOperation(async (client) => {
      try {
        const chats = await client.getChats();
        let clearedCount = 0;

        await Promise.all(chats.map(async (chat) => {
          try {
            await chat.clearMessages();
            clearedCount++;
          } catch (error) {
            console.error(`Error clearing chat ${chat.name}:`, error);
          }
        }));

        return {
          success: true,
          totalChats: chats.length,
          clearedCount
        };
      } catch (error) {
        console.error("Error clearing chats:", error);
        return {
          success: false,
          error: error.message
        };
      }
    }, 60000, 1); // 1 minute timeout, 1 retry
  }

  /**
   * Get the status of the WhatsApp client
   * @returns {Object} Client status information
   */
  getStatus() {
    return {
      state: this.clientState,
      queueLength: this.operationQueue.length,
      lastActivity: this.lastActivity,
      connected: this.client !== null && this.clientState === 'ready',
      trackedMessages: this.messageAckTracking.size
    };
  }
}

// Export a singleton instance
export default new WhatsAppService();

// Add these backward compatibility exports to the end of services/messaging/whatsapp.js

/**
 * Legacy compatibility function for sending images
 * @param {string} number - Recipient phone number
 * @param {string} base64Image - Base64-encoded image data
 * @returns {Promise<string>} - "OK" if successful, "ERROR" otherwise
 */
export async function sendImg_(number, base64Image) {
  try {
    // Create a message media object
    const media = new MessageMedia("image/png", base64Image);
    
    // Use the service's queue operation functionality
    return WhatsAppService.queueOperation(async (client) => {
      try {
        // Validate number format
        let targetNumber = number;
        if (!targetNumber.includes('@c.us')) {
          const numberDetails = await client.getNumberId(targetNumber);
          if (!numberDetails) {
            console.log(targetNumber, "Mobile number is not registered");
            return "ERROR";
          }
          targetNumber = numberDetails._serialized;
        }
        
        // Send the message
        await client.sendMessage(targetNumber, media);
        return "OK";
      } catch (error) {
        console.error("Error sending image:", error);
        return "ERROR";
      }
    });
  } catch (error) {
    console.error("Error in sendImg_:", error);
    return "ERROR";
  }
}

/**
 * Legacy compatibility function for sending X-ray files
 * @param {string} number - Recipient phone number
 * @param {string} file - Path to the file
 * @returns {Promise<Object>} - Result object { result: "OK" } or { result: "ERROR", error: "message" }
 */
export async function sendXray_(number, file) {
  try {
    return WhatsAppService.queueOperation(async (client) => {
      try {
        // Create message media from file
        const media = MessageMedia.fromFilePath(file);
        
        // Validate number format
        let targetNumber = number;
        if (!targetNumber.includes('@c.us')) {
          const numberDetails = await client.getNumberId(targetNumber);
          if (!numberDetails) {
            console.log(targetNumber, "Mobile number is not registered");
            return { "result": "ERROR", "error": "Mobile number is not registered" };
          }
          targetNumber = numberDetails._serialized;
        }
        
        // Send the message
        await client.sendMessage(targetNumber, media);
        return { "result": "OK" };
      } catch (error) {
        console.error("Error sending X-ray:", error);
        return { "result": "ERROR", "error": error.message };
      }
    });
  } catch (error) {
    console.error("Error in sendXray_:", error);
    return { "result": "ERROR", "error": error.message };
  }
}

// Export the client for backward compatibility
export const client = WhatsAppService.client;