// services/state/messageState.ts
import stateEvents from './stateEvents.js';
import StateManager from './StateManager.js';
import { MessageSchemas, MessageStatus } from '../messaging/schemas.js';
import { log } from '../../utils/logger.js';

/**
 * State key constants
 */
const STATE_KEYS = {
  CLIENT_STATUS: 'client_status',
  MESSAGE_STATS: 'message_stats',
  PERSONS: 'persons',
  MESSAGE_STATUSES: 'message_statuses',
  QR_STATUS: 'qr_status',
} as const;

type StateKey = (typeof STATE_KEYS)[keyof typeof STATE_KEYS];

/**
 * Client status interface
 */
interface ClientStatus {
  ready: boolean;
  initializing: boolean;
  lastActivity: number;
  manualDisconnect: boolean;
}

/**
 * Message stats interface
 */
interface MessageStats {
  sent: number;
  failed: number;
  finished: boolean;
  finishReport: boolean;
}

/**
 * Person interface
 */
export interface Person {
  messageId: string;
  status?: number;
  success?: string;
  addedAt?: number;
  lastUpdated?: number;
  phone?: string;
  name?: string;
  number?: string;
  patientId?: number;
  appointmentId?: number;
  errorMessage?: string;
  error?: string;
}

/**
 * QR status interface
 */
interface QRStatus {
  qr: string | null;
  activeViewers: number;
  generationActive: boolean;
  lastRequested: number | null;
  lastVerified?: number;
}

/**
 * State dump interface
 */
export interface StateDump {
  clientReady: boolean;
  sentMessages: number;
  failedMessages: number;
  finishedSending: boolean;
  personsCount: number;
  statusUpdatesCount: number;
  activeQRViewers: number;
  lastActivity: number;
  persons?: Person[];
  messageStatuses?: Array<[string, number]>;
  qrStatus?: QRStatus;
}

class MessageStateManager {
  private stateKeys = STATE_KEYS;
  private initialized = false;

  constructor() {
    // Use setTimeout to ensure StateManager is fully initialized
    setTimeout(() => {
      this.initializeState();
      this.setupEventHandlers();
    }, 0);
  }

  private initializeState(): void {
    if (this.initialized) return;

    try {
      // Initialize all state keys using the singleton instance
      StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, () => ({
        ready: false,
        initializing: false,
        lastActivity: Date.now(),
        manualDisconnect: false,
      }));

      StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, () => ({
        sent: 0,
        failed: 0,
        finished: false,
        finishReport: false,
      }));

      StateManager.atomicOperation<Person[]>(this.stateKeys.PERSONS, () => []);
      StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        () => new Map()
      );
      StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, () => ({
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      }));

      this.initialized = true;
      log.info('MessageStateManager initialized successfully');
    } catch (error) {
      log.error('Error initializing MessageStateManager:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private setupEventHandlers(): void {
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
  get clientReady(): boolean {
    const status = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS);
    return status?.ready || false;
  }

  /**
   * Set client ready status atomically
   */
  async setClientReady(ready: boolean): Promise<ClientStatus> {
    return StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (current) => ({
      ...(current as ClientStatus),
      ready,
      lastActivity: Date.now(),
    }));
  }

  /**
   * Update message status atomically with rollback capability
   */
  async updateMessageStatus(
    messageId: string,
    status: number,
    dbOperation: (() => Promise<void>) | null = null
  ): Promise<boolean> {
    const rollbackData = {
      messageId,
      oldStatus: null as number | null,
      newStatus: status,
    };

    try {
      // Get current status for rollback
      const currentStatuses = StateManager.get<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES
      );
      rollbackData.oldStatus = currentStatuses?.get(messageId) ?? null;

      // Only update if status is higher or first time
      if (rollbackData.oldStatus !== null && rollbackData.oldStatus >= status) {
        return false;
      }

      // Update memory state
      await StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        (statuses) => {
          const newStatuses = new Map(statuses || new Map());
          newStatuses.set(messageId, status);
          return newStatuses;
        }
      );

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
        await StateManager.atomicOperation<Map<string, number>>(
          this.stateKeys.MESSAGE_STATUSES,
          (statuses) => {
            const newStatuses = new Map(statuses || new Map());
            newStatuses.set(messageId, rollbackData.oldStatus!);
            return newStatuses;
          }
        );
      }

      log.error(`Failed to update message status for ${messageId}:`, { error: error instanceof Error ? error.message : String(error) });
      stateEvents.emit('message_status_error', {
        messageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update person status in persons array
   */
  async updatePersonStatus(messageId: string, status: number): Promise<void> {
    await StateManager.atomicOperation<Person[]>(this.stateKeys.PERSONS, (persons) => {
      const newPersons = [...(persons || [])];
      const personIndex = newPersons.findIndex((p) => p.messageId === messageId);

      if (personIndex >= 0) {
        newPersons[personIndex] = {
          ...newPersons[personIndex],
          status,
          lastUpdated: Date.now(),
        };
      }

      return newPersons;
    });
  }

  /**
   * Add person atomically with deduplication
   */
  async addPerson(person: Person): Promise<boolean> {
    let wasNewMessage = false;

    await StateManager.atomicOperation<Person[]>(this.stateKeys.PERSONS, (persons) => {
      const existingPersons = persons || [];

      // Check if this message has already been processed
      const existingIndex = existingPersons.findIndex((p) => p.messageId === person.messageId);

      if (existingIndex >= 0) {
        // Update existing person instead of adding duplicate
        const updatedPersons = [...existingPersons];
        updatedPersons[existingIndex] = {
          ...updatedPersons[existingIndex],
          ...person,
          lastUpdated: Date.now(),
        };
        return updatedPersons;
      } else {
        // New message - add to array
        wasNewMessage = true;
        return [
          ...existingPersons,
          {
            ...person,
            addedAt: Date.now(),
            status: MessageStatus.PENDING,
          },
        ];
      }
    });

    // Only increment counters for new messages
    if (wasNewMessage) {
      if (person.success === '&#10004;') {
        await StateManager.atomicOperation<MessageStats>(
          this.stateKeys.MESSAGE_STATS,
          (stats) => ({
            ...(stats || { sent: 0, failed: 0, finished: false, finishReport: false }),
            sent: (stats?.sent || 0) + 1,
          })
        );
      } else if (person.success === '&times;') {
        // Increment failed count for failed messages
        await StateManager.atomicOperation<MessageStats>(
          this.stateKeys.MESSAGE_STATS,
          (stats) => ({
            ...(stats || { sent: 0, failed: 0, finished: false, finishReport: false }),
            failed: (stats?.failed || 0) + 1,
          })
        );
      }
    }

    return true;
  }

  /**
   * Handle QR viewer registration
   */
  async registerQRViewer(viewerId?: string): Promise<QRStatus> {
    const result = await StateManager.atomicOperation<QRStatus>(
      this.stateKeys.QR_STATUS,
      (qrStatus) => {
        const current = qrStatus || {
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        };
        return {
          ...current,
          activeViewers: (current.activeViewers || 0) + 1,
          generationActive: true,
          lastRequested: Date.now(),
        };
      }
    );

    // Emit the event when viewers connect
    stateEvents.emit('qr_viewer_connected');

    log.info(
      `QR viewer ${viewerId || 'unknown'} registered. Active viewers: ${result.activeViewers}`
    );
    return result;
  }

  /**
   * Handle QR viewer unregistration
   */
  async unregisterQRViewer(viewerId?: string): Promise<boolean> {
    const result = await StateManager.atomicOperation<QRStatus>(
      this.stateKeys.QR_STATUS,
      (qrStatus) => {
        const current = qrStatus || {
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        };
        const newViewers = Math.max(0, (current.activeViewers || 0) - 1);
        return {
          ...current,
          activeViewers: newViewers,
          lastRequested: Date.now(),
        };
      }
    );

    // Schedule cleanup if no viewers
    if (result.activeViewers === 0 && !this.clientReady) {
      setTimeout(() => {
        const current = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
        if (current && current.activeViewers === 0) {
          stateEvents.emit('qr_cleanup_required');
        }
      }, 60000);
    }

    log.info(`QR viewer ${viewerId || 'unknown'} unregistered.`);
    return true;
  }

  /**
   * Set QR code
   */
  async setQR(qr: string | null): Promise<QRStatus> {
    return StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...(qrStatus || {
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      }),
      qr,
      lastRequested: Date.now(),
    }));
  }

  /**
   * Get QR code
   */
  get qr(): string | null {
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
    return qrStatus?.qr || null;
  }

  /**
   * Get active QR viewers count
   */
  get activeQRViewers(): number {
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS);
    return qrStatus?.activeViewers || 0;
  }

  /**
   * Verify QR viewer count matches actual connections
   */
  async verifyQRViewerCount(activeViewerIds: string[] = []): Promise<QRStatus> {
    const result = await StateManager.atomicOperation<QRStatus>(
      this.stateKeys.QR_STATUS,
      (qrStatus) => {
        const current = qrStatus || {
          qr: null,
          activeViewers: 0,
          generationActive: false,
          lastRequested: null,
        };
        const expectedCount = activeViewerIds.length;
        const actualCount = current.activeViewers || 0;

        if (expectedCount !== actualCount) {
          log.warn(`QR viewer count mismatch - Expected: ${expectedCount}, Actual: ${actualCount}`);
          // Correct the count
          return {
            ...current,
            activeViewers: expectedCount,
            lastVerified: Date.now(),
          };
        }

        return current;
      }
    );

    if (result.activeViewers !== activeViewerIds.length) {
      log.info(`Corrected QR viewer count to ${activeViewerIds.length}`);
    }

    return result;
  }

  /**
   * Set finish report status
   */
  async setFinishReport(finished: boolean): Promise<MessageStats> {
    return StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...(stats || { sent: 0, failed: 0, finished: false, finishReport: false }),
      finishReport: finished,
    }));
  }

  get finishReport(): boolean {
    const stats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS);
    return stats?.finishReport || false;
  }

  /**
   * Get manual disconnect status
   */
  get manualDisconnect(): boolean {
    const status = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS);
    return status?.manualDisconnect || false;
  }

  /**
   * Set manual disconnect status
   */
  set manualDisconnect(value: boolean) {
    StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (current) => ({
      ...(current as ClientStatus),
      manualDisconnect: value,
    }));
  }

  /**
   * Reset all state
   */
  async reset(): Promise<void> {
    log.info('Resetting message state');

    await Promise.all([
      StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, () => ({
        ready: false,
        initializing: false,
        lastActivity: Date.now(),
        manualDisconnect: false,
      })),

      StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, () => ({
        sent: 0,
        failed: 0,
        finished: false,
        finishReport: false,
      })),

      StateManager.atomicOperation<Person[]>(this.stateKeys.PERSONS, () => []),
      StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        () => new Map()
      ),

      StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, () => ({
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      })),
    ]);

    stateEvents.emit('state_reset');
  }

  /**
   * Get current state dump
   */
  dump(detailed = false): StateDump {
    const clientStatus = StateManager.get<ClientStatus>(this.stateKeys.CLIENT_STATUS) || {
      ready: false,
      initializing: false,
      lastActivity: Date.now(),
      manualDisconnect: false,
    };
    const messageStats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS) || {
      sent: 0,
      failed: 0,
      finished: false,
      finishReport: false,
    };
    const persons = StateManager.get<Person[]>(this.stateKeys.PERSONS) || [];
    const messageStatuses =
      StateManager.get<Map<string, number>>(this.stateKeys.MESSAGE_STATUSES) || new Map();
    const qrStatus = StateManager.get<QRStatus>(this.stateKeys.QR_STATUS) || {
      qr: null,
      activeViewers: 0,
      generationActive: false,
      lastRequested: null,
    };

    const dump: StateDump = {
      clientReady: clientStatus.ready || false,
      sentMessages: messageStats.sent || 0,
      failedMessages: messageStats.failed || 0,
      finishedSending: messageStats.finished || false,
      personsCount: persons.length || 0,
      statusUpdatesCount: messageStatuses.size || 0,
      activeQRViewers: qrStatus.activeViewers || 0,
      lastActivity: clientStatus.lastActivity || Date.now(),
    };

    if (detailed) {
      dump.persons = persons;
      dump.messageStatuses = Array.from(messageStatuses.entries());
      dump.qrStatus = qrStatus;
    }

    return dump;
  }

  /**
   * Get persons array
   */
  get persons(): Person[] {
    return StateManager.get<Person[]>(this.stateKeys.PERSONS) || [];
  }

  /**
   * Get message stats
   */
  get sentMessages(): number {
    const stats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS);
    return stats?.sent || 0;
  }

  get failedMessages(): number {
    const stats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS);
    return stats?.failed || 0;
  }

  get finishedSending(): boolean {
    const stats = StateManager.get<MessageStats>(this.stateKeys.MESSAGE_STATS);
    return stats?.finished || false;
  }

  async setFinishedSending(finished: boolean): Promise<MessageStats> {
    return StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, (stats) => ({
      ...(stats || { sent: 0, failed: 0, finished: false, finishReport: false }),
      finished,
    }));
  }

  // Cleanup methods
  cleanupQR(): void {
    log.info('Cleaning up QR code');
    StateManager.atomicOperation<QRStatus>(this.stateKeys.QR_STATUS, (qrStatus) => ({
      ...(qrStatus || {
        qr: null,
        activeViewers: 0,
        generationActive: false,
        lastRequested: null,
      }),
      qr: null,
      generationActive: false,
    }));
  }

  handleClientDisconnect(): void {
    StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (status) => ({
      ...(status || { ready: false, initializing: false, lastActivity: Date.now(), manualDisconnect: false }),
      ready: false,
      lastActivity: Date.now(),
    }));
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    StateManager.cleanup();
    stateEvents.removeAllListeners();
  }
}

// Create singleton instance
const messageStateManagerInstance = new MessageStateManager();

// Export singleton
export default messageStateManagerInstance;
