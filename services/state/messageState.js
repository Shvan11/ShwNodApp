// Add import at the top
import stateEvents from './stateEvents.js';
// services/state/messageState.js
class MessageState {
  constructor() {
    this.sentMessages = 0;
    this.failedMessages = 0;
    this.finishedSending = false;
    this.finishReport = false;
    this.clientReady = false;
    this.change = true; // Start as true to force initial update
    this.persons = [];
    this.qr = null;
    this.gturbo = false;
    this.messageStatuses = new Map();
    this.manualDisconnect = false; // Flag to prevent auto-reconnect when manually disconnected
    this.lastActivity = Date.now(); // Track when the client was last active
    this.activeQRViewers = 0;
    this.qrGenerationActive = false;
    this.qrLastRequested = null;
    this.qrTimeoutDuration = 5 * 60 * 1000; // 5 minutes
    this.registeredViewerIds = new Set();
    this.qrCleanupTimer = null;
  }



  /**
   * Reset the message state
   */
  reset() {
    this.sentMessages = 0;
    this.failedMessages = 0;
    this.finishedSending = false;
    this.finishReport = false;
    this.qr = null;
    this.clientReady = false;
    this.change = true;
    this.persons = [];
    this.messageStatuses.clear();
      // Clear any cleanup timer
  if (this.qrCleanupTimer) {
    clearTimeout(this.qrCleanupTimer);
    this.qrCleanupTimer = null;
  }
    // Don't reset manualDisconnect here - it's managed separately

    // Log the reset for debugging
    console.log("Message state reset");
  }

  /**
  * Update message status and track changes
  * @param {string} messageId - The message ID
  * @param {number} status - The new status
  * @returns {boolean} - Whether the update was successful
  */
  updateMessageStatus(messageId, status) {
    // Don't update if status is lower than current status
    const currentStatus = this.messageStatuses.get(messageId);
    if (currentStatus !== undefined && currentStatus >= status) {
      return false;
    }

    // Store in our status map
    this.messageStatuses.set(messageId, status);
    this.change = true;
    this.lastActivity = Date.now();

    // Also update in persons array if exists
    for (const person of this.persons) {
      if (person.messageId === messageId) {
        person.status = status;
        break;
      }
    }

    return true;
  }

  getStatusUpdates() {
    return Array.from(this.messageStatuses.entries()).map(([messageId, status]) => ({
      messageId,
      status
    }));
  }

  addPerson(p) {
    console.log("Adding person to messageState:", p);
    this.change = true;
    this.persons.push(p);
    this.sentMessages += 1;
    return true;
  }

  /**
   * Get a dump of the current state
   * @param {boolean} [detailed=false] - Whether to include detailed status info
   * @returns {Object} - State dump
   */
  dump(detailed = false) {
    const baseDump = {
      sentMessages: this.sentMessages,
      failedMessages: this.failedMessages,
      finishedSending: this.finishedSending,
      clientReady: this.clientReady,
      personsCount: this.persons.length,
      statusUpdatesCount: this.messageStatuses.size,
      lastActivity: this.lastActivity,
      manualDisconnect: this.manualDisconnect,
      inactiveFor: this.getInactivityTime()
    };

    if (detailed) {
      // Add detailed status information for debugging
      baseDump.persons = this.persons;
      baseDump.statusMap = Array.from(this.messageStatuses.entries());
    }

    return baseDump;
  }
  /**
   * Update last activity timestamp
   * @param {string} [activity='generic'] - Activity description
   */
  updateActivity(activity = 'generic') {
    this.lastActivity = Date.now();
    // Optional: log activity for debugging
    // console.log(`Activity: ${activity} at ${new Date(this.lastActivity).toISOString()}`);
  }

  /**
   * Get time since last activity
   * @returns {number} - Milliseconds since last activity
   */
  getInactivityTime() {
    return Date.now() - this.lastActivity;
  }

  /**
   * Check if client is inactive beyond threshold
   * @param {number} threshold - Inactivity threshold in ms
   * @returns {boolean} - Whether client is inactive
   */
  isInactive(threshold) {
    return this.getInactivityTime() > threshold;
  }

  /**
   * Get status updates since a timestamp
   * @param {number} since - Timestamp to get updates since
   * @returns {Array} - Array of status updates
   */
  getStatusUpdatesSince(since) {
    const updates = [];
    for (const [messageId, status] of this.messageStatuses.entries()) {
      // You would need to track when each status was updated
      // This is a simplified version
      updates.push({ messageId, status });
    }
    return updates;
  }

  /**
   * Batch update message statuses
   * @param {Array} updates - Array of {messageId, status} objects
   * @returns {number} - Number of updates processed
   */
  batchUpdateStatuses(updates) {
    let updateCount = 0;

    for (const { messageId, status } of updates) {
      if (this.updateMessageStatus(messageId, status)) {
        updateCount++;
      }
    }

    return updateCount;
  }
  // Modify the unregisterQRViewer method
unregisterQRViewer(viewerId) {
  // If viewer isn't registered, do nothing
  if (!this.registeredViewerIds.has(viewerId)) {
    console.log(`QR viewer ${viewerId} not registered, can't unregister`);
    return false;
  }
  
  // Unregister the viewer
  this.registeredViewerIds.delete(viewerId);
  if (this.activeQRViewers > 0) {
    this.activeQRViewers--;
  }
  this.qrLastRequested = Date.now();
  console.log(`QR viewer ${viewerId} unregistered. Active viewers: ${this.activeQRViewers}`);
  
  // If this was the last viewer, start cleanup timer
  if (this.activeQRViewers === 0 && !this.clientReady) {
    // Clear any existing timer
    if (this.qrCleanupTimer) {
      clearTimeout(this.qrCleanupTimer);
    }
    
    // Set cleanup timer for 60 seconds
    console.log("Starting QR cleanup timer (60 seconds)");
    this.qrCleanupTimer = setTimeout(() => {
      if (this.activeQRViewers === 0 && !this.clientReady) {
        console.log("No viewers for 60 seconds, stopping QR generation");
        
        // Emit event instead of direct import
        stateEvents.emit('qr_cleanup_required');
      }
    }, 60000); // 60 seconds timeout
  }
  
  return true;
}

// Also update the registerQRViewer to cancel any cleanup timer
registerQRViewer(viewerId) {
  // If viewer is already registered, do nothing
  if (this.registeredViewerIds.has(viewerId)) {
    console.log(`QR viewer ${viewerId} already registered`);
    return false;
  }
  
  // Register new viewer
  this.registeredViewerIds.add(viewerId);
  this.activeQRViewers++;
  this.qrGenerationActive = true;
  this.qrLastRequested = Date.now();
  console.log(`QR viewer ${viewerId} registered. Active viewers: ${this.activeQRViewers}`);
  this.updateActivity('qr-viewer-registered');
  
  // Cancel any cleanup timer
  if (this.qrCleanupTimer) {
    console.log("Cancelling QR cleanup timer due to new viewer");
    clearTimeout(this.qrCleanupTimer);
    this.qrCleanupTimer = null;
  }
  
  // Emit event to initialize WhatsApp client if needed
  if (this.activeQRViewers === 1) {
    stateEvents.emit('qr_viewer_connected');
  }
  
  return true;
}

scheduleQRDeactivation() {
  // Set a timeout to deactivate QR generation if no viewers
  setTimeout(() => {
    // Only deactivate if still no viewers and client isn't ready yet
    if (this.activeQRViewers === 0 && !this.clientReady) {
      this.qrGenerationActive = false;
      this.qr = null;
      console.log("QR generation deactivated due to inactivity");
    }
  }, this.qrTimeoutDuration);
}

shouldGenerateQR() {
  // Only generate QR codes if we have active viewers
  return this.activeQRViewers > 0;
}
// Add this method to periodically verify the actual count

verifyQRViewerCount(actualIdsArray) {
  const actualIds = new Set(actualIdsArray);
  
  // Find IDs that are registered but no longer connected
  const staleIds = [...this.registeredViewerIds].filter(id => !actualIds.has(id));
  
  // Remove any stale registrations
  if (staleIds.length > 0) {
    console.log(`Found ${staleIds.length} stale QR viewer registrations to clean up`);
    staleIds.forEach(id => this.unregisterQRViewer(id));
  }
  
  // Update the count to match actual connections
  if (this.activeQRViewers !== actualIds.size) {
    console.log(`Correcting QR viewer count from ${this.activeQRViewers} to ${actualIds.size}`);
    this.activeQRViewers = actualIds.size;
    this.registeredViewerIds = new Set(actualIds);
  }
}
}

// Export a true singleton
const messageState = new MessageState();
export default messageState;