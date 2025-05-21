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


}

// Export a true singleton
const messageState = new MessageState();
export default messageState;