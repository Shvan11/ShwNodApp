// services/state/messageState.js
import stateEvents from './stateEvents.js';
import StateManager from './StateManager.js';
import { MessageSchemas } from '../messaging/schemas.js';

class MessageStateManager {
  constructor() {
    this.stateKeys = {
      CLIENT_STATUS: 'client_status',
      MESSAGE_STATS: 'message_stats',
      PERSONS: 'persons',
      MESSAGE_STATUSES: 'message_statuses',
      QR_STATUS: 'qr_status'
    };

    this.initializeState();
    this.setupEventHandlers();
  }

  initializeState() {
    // Initialize all state keys
    StateManager.atomicOperation(this.stateKeys.CLIENT_STATUS, () => ({
      ready: false,
      initializing: false,
      lastActivity: Date.now(),
      manualDisconnect: false
    }));

    StateManager.atomicOperation(this.stateKeys.MESSAGE_STATS, () => ({
      sent: 0,
      failed: 0,
      finished: false,
      finishReport: false
    }));

    StateManager.atomicOperation(this.stateKeys.PERSONS, () => []);
    StateManager.atomicOperation(this.stateKeys.MESSAGE_STATUSES, () => new Map());
    StateManager.atomicOperation(this.stateKeys.QR_STATUS, () => ({
      qr: null,
      activeViewers: 0,
      generationActive: false,
      lastRequested: null
    }));
  }

  setupEventHandlers() {
    // Listen for cleanup events
    stateEvents.on('qr_cleanup_required', () => {
      this.cleanupQR();
    });

    stateEvents.on('client_disconnected', () => {
      this.handleClientDisconnect();
    });
  }

  /**
   * Get client ready status
   */
  get clientReady() {
    return StateManager.get(this.stateKeys.CLIENT_STATUS)?.ready || false;
  }

  /**
   * Set client ready status atomically
   */
  async setClientReady(ready) {
    return StateManager.atomicOperation(this.stateKeys.CLIENT_STATUS, (current) => ({
      ...current,
      ready,
      lastActivity: Date.now()
    }));
  }

  /**
   * Update message status atomically with rollback capability
   */
  async updateMessageStatus(messageId, status, dbOperation = null) {
    const rollbackData = {
      messageId,
      oldStatus: null,
      newStatus: status
    };

    try {
      // Get current status for rollback
      const currentStatuses = StateManager.get(this.stateKeys.MESSAGE_STATUSES);
      rollbackData.oldStatus = currentStatuses.get(messageId);

      // Only update if status is higher or first time
      if (rollbackData.oldStatus !== undefined && rollbackData.oldStatus >= status) {
        return false;
      }

      // Update memory state
      await StateManager.atomicOperation(this.stateKeys.MESSAGE_STATUSES, (statuses) => {
        const newStatuses = new Map(statuses);
        newStatuses.set(messageId, status);
        return newStatuses;
      });

      // Execute database operation if provided
      if (dbOperation) {
        await dbOperation();
      }

      // Update persons array
      await this.updatePersonStatus(messageId, status);

      // Emit success event
      stateEvents.emit('message_status_updated', { messageId, status });
      
      return true;

    } catch (error) {
      // Rollback memory state on database failure
      if (rollbackData.oldStatus !== null) {
        await StateManager.atomicOperation(this.stateKeys.MESSAGE_STATUSES, (statuses) => {
          const newStatuses = new Map(statuses);
          newStatuses.set(messageId, rollbackData.oldStatus);
          return newStatuses;
        });
      }

      console.error(`Failed to update message status for ${messageId}:`, error);
      stateEvents.emit('message_status_error', { messageId, error: error.message });
      throw error;
    }
  }

  /**
   * Update person status in persons array
   */
  async updatePersonStatus(messageId, status) {
    await StateManager.atomicOperation(this.stateKeys.PERSONS, (persons) => {
      const newPersons = [...persons];
      const personIndex = newPersons.findIndex(p => p.messageId === messageId);
      
      if (personIndex >= 0) {
        newPersons[personIndex] = {
          ...newPersons[personIndex],
          status,
          lastUpdated: Date.now()
        };
      }
      
      return newPersons;
    });
  }

  /**
   * Add person atomically
   */
  async addPerson(person) {
    await StateManager.atomicOperation(this.stateKeys.PERSONS, (persons) => {
      return [...persons, {
        ...person,
        addedAt: Date.now(),
        status: MessageSchemas.MessageStatus.PENDING
      }];
    });

    await StateManager.atomicOperation(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...stats,
      sent: stats.sent + 1
    }));

    return true;
  }

  /**
   * Handle QR viewer registration
   */
  async registerQRViewer(viewerId) {
    return StateManager.atomicOperation(this.stateKeys.QR_STATUS, (qrStatus) => {
      return {
        ...qrStatus,
        activeViewers: qrStatus.activeViewers + 1,
        generationActive: true,
        lastRequested: Date.now()
      };
    });
  }

  /**
   * Handle QR viewer unregistration
   */
  async unregisterQRViewer(viewerId) {
    const result = await StateManager.atomicOperation(this.stateKeys.QR_STATUS, (qrStatus) => {
      const newViewers = Math.max(0, qrStatus.activeViewers - 1);
      return {
        ...qrStatus,
        activeViewers: newViewers,
        lastRequested: Date.now()
      };
    });

    // Schedule cleanup if no viewers
    if (result.activeViewers === 0 && !this.clientReady) {
      setTimeout(() => {
        const current = StateManager.get(this.stateKeys.QR_STATUS);
        if (current.activeViewers === 0) {
          stateEvents.emit('qr_cleanup_required');
        }
      }, 60000);
    }

    return true;
  }

  /**
   * Set QR code
   */
  async setQR(qr) {
    return StateManager.atomicOperation(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...qrStatus,
      qr,
      lastRequested: Date.now()
    }));
  }

  /**
   * Get QR code
   */
  get qr() {
    return StateManager.get(this.stateKeys.QR_STATUS)?.qr;
  }

  /**
   * Get active QR viewers count
   */
  get activeQRViewers() {
    return StateManager.get(this.stateKeys.QR_STATUS)?.activeViewers || 0;
  }

  /**
   * Reset all state
   */
  async reset() {
    console.log("Resetting message state");
    
    await Promise.all([
      StateManager.atomicOperation(this.stateKeys.CLIENT_STATUS, () => ({
        ready: false,
        initializing: false,
        lastActivity: Date.now(),
        manualDisconnect: false
      })),
      
      StateManager.atomicOperation(this.stateKeys.MESSAGE_STATS, () => ({
        sent: 0,
        failed: 0,
        finished: false,
        finishReport: false
      })),
      
      StateManager.atomicOperation(this.stateKeys.PERSONS, () => []),
      StateManager.atomicOperation(this.stateKeys.MESSAGE_STATUSES, () => new Map()),
      
      StateManager.atomicOperation(this.stateKeys.QR_STATUS, () => ({
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null
      }))
    ]);

    stateEvents.emit('state_reset');
  }

  /**
   * Get current state dump
   */
  dump(detailed = false) {
    const clientStatus = StateManager.get(this.stateKeys.CLIENT_STATUS);
    const messageStats = StateManager.get(this.stateKeys.MESSAGE_STATS);
    const persons = StateManager.get(this.stateKeys.PERSONS);
    const messageStatuses = StateManager.get(this.stateKeys.MESSAGE_STATUSES);
    const qrStatus = StateManager.get(this.stateKeys.QR_STATUS);

    const dump = {
      clientReady: clientStatus?.ready || false,
      sentMessages: messageStats?.sent || 0,
      failedMessages: messageStats?.failed || 0,
      finishedSending: messageStats?.finished || false,
      personsCount: persons?.length || 0,
      statusUpdatesCount: messageStatuses?.size || 0,
      activeQRViewers: qrStatus?.activeViewers || 0,
      lastActivity: clientStatus?.lastActivity || Date.now()
    };

    if (detailed) {
      dump.persons = persons;
      dump.messageStatuses = Array.from(messageStatuses?.entries() || []);
      dump.qrStatus = qrStatus;
    }

    return dump;
  }

  /**
   * Get persons array
   */
  get persons() {
    return StateManager.get(this.stateKeys.PERSONS) || [];
  }

  /**
   * Get message stats
   */
  get sentMessages() {
    return StateManager.get(this.stateKeys.MESSAGE_STATS)?.sent || 0;
  }

  get failedMessages() {
    return StateManager.get(this.stateKeys.MESSAGE_STATS)?.failed || 0;
  }

  get finishedSending() {
    return StateManager.get(this.stateKeys.MESSAGE_STATS)?.finished || false;
  }

  async setFinishedSending(finished) {
    return StateManager.atomicOperation(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...stats,
      finished
    }));
  }

  // Cleanup methods
  cleanupQR() {
    console.log("Cleaning up QR code");
    StateManager.atomicOperation(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...qrStatus,
      qr: null,
      generationActive: false
    }));
  }

  handleClientDisconnect() {
    StateManager.atomicOperation(this.stateKeys.CLIENT_STATUS, (status) => ({
      ...status,
      ready: false,
      lastActivity: Date.now()
    }));
  }

  /**
   * Clean up all resources
   */
  cleanup() {
    StateManager.cleanup();
    stateEvents.removeAllListeners();
  }
}

// Export singleton
export default new MessageStateManager();