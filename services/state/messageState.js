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
  }

  reset() {
    this.sentMessages = 0;
    this.failedMessages = 0;
    this.finishedSending = false;
    this.qr = null;
    this.clientReady = false;
    this.change = true;
    this.persons = [];
  }

  updateMessageStatus(messageId, status) {
    // Store in our status map
    this.messageStatuses.set(messageId, status);
    this.change = true;

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

  dump() {
    return {
      sentMessages: this.sentMessages,
      failedMessages: this.failedMessages,
      finishedSending: this.finishedSending,
      clientReady: this.clientReady,
      persons: this.persons.length,
       // Add this line to see status updates in logs:
    statusUpdatesCount: this.messageStatuses ? this.messageStatuses.size : 0
    };
  }
}

// Export a true singleton
const messageState = new MessageState();
export default messageState;