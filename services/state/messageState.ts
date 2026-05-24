// services/state/messageState.ts
import stateEvents from './stateEvents.js';
import StateManager from './StateManager.js';
import { MessageStatus } from '../messaging/message-status.js';
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
    // Defer to next tick so the StateManager singleton is fully initialized,
    // then set up event handlers only once the initial state is in place.
    setTimeout(() => {
      this.initializeState()
        .then(() => this.setupEventHandlers())
        .catch((error) =>
          log.error('Error during MessageStateManager startup:', {
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }, 0);
  }

  private async initializeState(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize all state keys using the singleton instance
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
        StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, () => new Map()),
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
    // Captured *inside* the locked closure below so the monotonic compare and the
    // write are one atomic critical section — two rapid acks for the same messageId
    // can no longer both read a stale value and let the lower status win.
    let applied = false;
    let oldStatus: number | null = null;

    try {
      await StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        (statuses) => {
          const current = statuses || new Map<string, number>();
          oldStatus = current.get(messageId) ?? null;

          // Monotonic: only advance, never regress.
          if (oldStatus !== null && oldStatus >= status) {
            applied = false;
            return current; // unchanged
          }

          // Mutate in place under the lock (O(1), not O(n) clone) — safe because the
          // closure is a synchronous critical section and all readers snapshot via
          // Array.from(), so none can observe a half-written map.
          current.set(messageId, status);
          applied = true;
          return current;
        }
      );

      if (!applied) {
        return false;
      }

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
      // Rollback the in-memory bump on failure, restoring the exact prior state
      // (delete the key if there was no status before this call).
      if (applied) {
        await StateManager.atomicOperation<Map<string, number>>(
          this.stateKeys.MESSAGE_STATUSES,
          (statuses) => {
            const current = statuses || new Map<string, number>();
            if (oldStatus !== null) {
              current.set(messageId, oldStatus);
            } else {
              current.delete(messageId);
            }
            return current;
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
    await StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, (persons) => {
      const current = persons || new Map<string, Person>();
      const existing = current.get(messageId);
      if (!existing) return current; // unknown message — unchanged
      // O(1) in-place upsert under the lock (see updateMessageStatus for why this is safe).
      current.set(messageId, { ...existing, status, lastUpdated: Date.now() });
      return current;
    });
  }

  /**
   * Add person atomically with deduplication
   */
  async addPerson(person: Person): Promise<boolean> {
    let wasNewMessage = false;

    await StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, (persons) => {
      const current = persons || new Map<string, Person>();
      const existing = current.get(person.messageId);

      if (existing) {
        // Update existing person instead of adding duplicate (O(1) in-place).
        current.set(person.messageId, {
          ...existing,
          ...person,
          lastUpdated: Date.now(),
        });
      } else {
        // New message — insert. Map preserves insertion order, so the array views
        // (persons getter / dump) keep the same ordering the array append produced.
        wasNewMessage = true;
        current.set(person.messageId, {
          ...person,
          addedAt: Date.now(),
          status: MessageStatus.PENDING,
        });
      }
      return current;
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
    })).catch((error) =>
      log.error('Failed to set manualDisconnect:', { error: error instanceof Error ? error.message : String(error) })
    );
  }

  /**
   * Reset the message-send session: send stats, per-message persons, and ack
   * statuses. Used between send batches (restart() and the manual clear()).
   *
   * Deliberately does NOT touch CLIENT_STATUS or QR_STATUS. Client readiness is
   * lifecycle state owned by the ready/disconnected handlers, and activeViewers
   * is the live SSE QR-viewer count owned by register/unregisterQRViewer —
   * neither is part of a send session. Clearing them here used to backfire:
   * restart() calls reset() *after* the client has already reconnected and
   * fired `ready`, so resetting CLIENT_STATUS flipped clientReady back to false
   * (server reporting not-ready while actually connected) and zeroed the viewer
   * count out from under still-open streams. restart() already clears
   * clientReady/qr explicitly before re-init, so reset() owes them nothing.
   */
  async reset(): Promise<void> {
    log.info('Resetting message-send session state');

    await Promise.all([
      StateManager.atomicOperation<MessageStats>(this.stateKeys.MESSAGE_STATS, () => ({
        sent: 0,
        failed: 0,
        finished: false,
        finishReport: false,
      })),

      StateManager.atomicOperation<Map<string, Person>>(this.stateKeys.PERSONS, () => new Map()),
      StateManager.atomicOperation<Map<string, number>>(
        this.stateKeys.MESSAGE_STATUSES,
        () => new Map()
      ),
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
    const personsMap =
      StateManager.get<Map<string, Person>>(this.stateKeys.PERSONS) || new Map<string, Person>();
    const persons = Array.from(personsMap.values());
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
    const map = StateManager.get<Map<string, Person>>(this.stateKeys.PERSONS);
    return map ? Array.from(map.values()) : [];
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
    })).catch((error) =>
      log.error('Failed to clean up QR code:', { error: error instanceof Error ? error.message : String(error) })
    );
  }

  handleClientDisconnect(): void {
    StateManager.atomicOperation<ClientStatus>(this.stateKeys.CLIENT_STATUS, (status) => ({
      ...(status || { ready: false, initializing: false, lastActivity: Date.now(), manualDisconnect: false }),
      ready: false,
      lastActivity: Date.now(),
    })).catch((error) =>
      log.error('Failed to handle client disconnect:', { error: error instanceof Error ? error.message : String(error) })
    );
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
