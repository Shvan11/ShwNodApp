/**
 * MessageSessionManager - Manages the lifecycle of all message sessions
 *
 * Provides centralized management of MessageSession instances with automatic cleanup,
 * monitoring, and session isolation to prevent cross-date contamination.
 */

import { MessageSession } from './MessageSession.js';
import ResourceManager from '../../utils/resource-manager.js';
import { log } from '../../utils/logger.js';
import { toDateOnly } from '../../utils/date.js';

// ===========================================
// MANAGER TYPES
// ===========================================

/**
 * Manager configuration options
 */
export interface MessageSessionManagerOptions {
  /** Maximum active sessions (default: 25) */
  maxActiveSessions?: number;
  /** Maximum messages per session (default: 1000) */
  maxMessagesPerSession?: number;
  /** ACK tracking window in ms (default: 24 hours) */
  ackTrackingWindow?: number;
  /** Enable automatic expiration (default: true) */
  autoExpireEnabled?: boolean;
  /** Cleanup interval in ms (default: 6 hours) */
  cleanupInterval?: number;
  /** Maximum session age in ms (default: 48 hours) */
  maxSessionAge?: number;
}

/**
 * Message lookup result
 */
export interface MessageLookupResult {
  appointmentId: number;
  sessionDate: string;
  sessionId: string;
}

// ===========================================
// MESSAGE SESSION MANAGER CLASS
// ===========================================

export class MessageSessionManager {
  private activeSessions: Map<string, MessageSession>;
  private cleanupTimer: NodeJS.Timeout | null;

  public readonly maxActiveSessions: number;
  public readonly maxMessagesPerSession: number;
  public readonly ackTrackingWindow: number;
  public readonly autoExpireEnabled: boolean;
  public readonly cleanupInterval: number;
  public readonly maxSessionAge: number;

  constructor(options: MessageSessionManagerOptions = {}) {
    this.activeSessions = new Map();
    this.cleanupTimer = null;

    // Memory leak protection - session limits
    this.maxActiveSessions = options.maxActiveSessions || 25;
    this.maxMessagesPerSession = options.maxMessagesPerSession || 1000;

    // Time-based ACK tracking configuration
    this.ackTrackingWindow = options.ackTrackingWindow || 24 * 60 * 60 * 1000;
    this.autoExpireEnabled = options.autoExpireEnabled !== false;

    // Auto-cleanup configuration
    this.cleanupInterval = options.cleanupInterval || 6 * 60 * 60 * 1000;
    this.maxSessionAge = options.maxSessionAge || 48 * 60 * 60 * 1000;

    // Start periodic cleanup
    this.startPeriodicCleanup();

    // So graceful shutdown actually stops the interval instead of relying on
    // process.exit() to take it down with the process.
    ResourceManager.register('message-session-manager', this, () => this.stop());

    log.info('MessageSessionManager initialized', {
      ackTrackingWindow: `${this.ackTrackingWindow / 1000}s`,
      cleanupInterval: `${this.cleanupInterval / 1000}s`,
      maxSessionAge: `${this.maxSessionAge / 1000}s`,
      autoExpireEnabled: this.autoExpireEnabled,
    });
  }

  /**
   * Create or get active session for a date
   */
  getOrCreateSession(date: Date | string): MessageSession {
    // Normalize date to YYYY-MM-DD format
    const normalizedDate = date instanceof Date ? toDateOnly(date) : date;

    // Check if we already have an active session for this date
    if (this.activeSessions.has(normalizedDate)) {
      const existingSession = this.activeSessions.get(normalizedDate)!;

      if (existingSession.isValid()) {
        log.debug('Reusing existing session', {
          date: normalizedDate,
          sessionId: existingSession.sessionId,
        });
        return existingSession;
      } else {
        // Clean up invalid session
        log.warn('Cleaning up invalid session', {
          date: normalizedDate,
          sessionId: existingSession.sessionId,
          status: existingSession.status,
        });
        this.completeSession(normalizedDate);
      }
    }

    // Memory leak protection: Check active session limit
    if (this.activeSessions.size >= this.maxActiveSessions) {
      log.warn('Maximum active sessions reached, forcing cleanup', {
        currentSessions: this.activeSessions.size,
        maxSessions: this.maxActiveSessions,
      });
      this.performPeriodicCleanup();

      // If still at limit after cleanup, remove oldest session
      if (this.activeSessions.size >= this.maxActiveSessions) {
        const oldestDate = this.activeSessions.keys().next().value;
        if (oldestDate) {
          const oldestSession = this.activeSessions.get(oldestDate);
          this.completeSession(oldestDate);
          log.warn('Forcibly removed oldest session to prevent memory leak', {
            removedDate: oldestDate,
            removedSessionId: oldestSession?.sessionId,
          });
        }
      }
    }

    // Create new session with time-based tracking configuration
    const sessionOptions = {
      ackTrackingWindow: this.ackTrackingWindow,
      autoExpireEnabled: this.autoExpireEnabled,
      maxMessages: this.maxMessagesPerSession,
    };

    const session = new MessageSession(normalizedDate, sessionOptions);
    this.activeSessions.set(normalizedDate, session);

    log.info('New MessageSession created', {
      date: normalizedDate,
      sessionId: session.sessionId,
      totalActiveSessions: this.activeSessions.size,
    });

    return session;
  }

  /**
   * Start a session for message sending
   */
  startSession(date: Date | string): MessageSession {
    const session = this.getOrCreateSession(date);

    if (session.status === 'CREATED') {
      session.start();
    }

    return session;
  }

  /**
   * Get the still-valid active session for a date, if any. Used by the ad-hoc
   * resend path to register the new message id for live ack tracking.
   */
  getActiveSession(date: Date | string): MessageSession | null {
    const normalizedDate = date instanceof Date ? toDateOnly(date) : date;
    const session = this.activeSessions.get(normalizedDate);
    return session && session.isValid() ? session : null;
  }

  /**
   * Get appointment ID for a message across all active sessions
   */
  getAppointmentIdForMessage(messageId: string): MessageLookupResult | null {
    // Search through active sessions
    for (const [date, session] of this.activeSessions) {
      const appointmentId = session.getAppointmentId(messageId);
      if (appointmentId !== null) {
        log.debug('Message found in session', {
          messageId,
          appointmentId,
          sessionDate: date,
          sessionId: session.sessionId,
        });
        return {
          appointmentId,
          sessionDate: date,
          sessionId: session.sessionId,
        };
      }
    }

    log.debug('Message not found in any active session', {
      messageId,
      activeSessionCount: this.activeSessions.size,
      activeDates: Array.from(this.activeSessions.keys()),
    });

    return null;
  }

  /**
   * Record delivery status update with session validation
   */
  recordDeliveryStatusUpdate(messageId: string, status: string): MessageLookupResult | null {
    const messageInfo = this.getAppointmentIdForMessage(messageId);

    if (!messageInfo) {
      log.warn('Cannot record delivery status: message not in any active session', {
        messageId,
        status,
      });
      return null;
    }

    const session = this.activeSessions.get(messageInfo.sessionDate);
    if (session && session.isValid()) {
      session.recordDeliveryStatusUpdate(messageId, status);
      return messageInfo;
    }

    log.warn('Cannot record delivery status: session no longer valid', {
      messageId,
      status,
      sessionId: messageInfo.sessionId,
    });

    return null;
  }

  /**
   * Complete a session for a specific date
   */
  completeSession(date: Date | string): void {
    const normalizedDate = date instanceof Date ? toDateOnly(date) : date;

    const session = this.activeSessions.get(normalizedDate);
    if (!session) {
      log.debug('No active session to complete', { date: normalizedDate });
      return;
    }

    // Complete the session
    session.complete();

    // Final stats must be read BEFORE cleanup() clears the mappings.
    const finalStats = session.getStats();

    // Remove from active sessions
    this.activeSessions.delete(normalizedDate);

    // Cleanup session resources
    session.cleanup();

    log.info('Session completed', {
      date: normalizedDate,
      sessionId: session.sessionId,
      stats: finalStats,
    });
  }

  /**
   * Complete all active sessions
   */
  completeAllSessions(): void {
    const dates = Array.from(this.activeSessions.keys());

    log.info('Completing all active sessions', {
      sessionCount: dates.length,
      dates,
    });

    dates.forEach((date) => {
      this.completeSession(date);
    });
  }

  /**
   * Start periodic cleanup of old sessions
   */
  private startPeriodicCleanup(): void {
    const timer = setInterval(() => {
      this.performPeriodicCleanup();
    }, this.cleanupInterval);
    // Housekeeping only — it must never be the reason the process stays alive.
    if (typeof timer.unref === 'function') timer.unref();
    this.cleanupTimer = timer;

    log.debug('Periodic cleanup started', {
      interval: `${this.cleanupInterval / 1000}s`,
      maxAge: `${this.maxSessionAge / 1000}s`,
    });
  }

  /**
   * Stop the housekeeping timer and release every active session (graceful
   * shutdown; wired through ResourceManager in the constructor). Idempotent.
   */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.completeAllSessions();
  }

  /**
   * Perform periodic cleanup of old and expired sessions
   */
  performPeriodicCleanup(): void {
    const now = Date.now();
    const cutoffTime = now - this.maxSessionAge;
    let expiredCount = 0;
    let cleanedCount = 0;

    // First pass: expire sessions that exceeded ACK tracking window
    for (const [, session] of this.activeSessions) {
      if (session.isExpired() && session.status !== 'EXPIRED') {
        session.expire();
        expiredCount++;
      }
    }

    // Second pass: clean up very old sessions completely
    const sessionsToClean: string[] = [];
    for (const [date, session] of this.activeSessions) {
      if (session.startTime.getTime() < cutoffTime) {
        sessionsToClean.push(date);
      }
    }

    for (const date of sessionsToClean) {
      const session = this.activeSessions.get(date);
      log.info('Auto-completing old session', {
        date,
        sessionId: session?.sessionId,
        age: `${Math.round((now - (session?.startTime.getTime() || 0)) / 1000)}s`,
        status: session?.status,
      });

      this.completeSession(date);
      cleanedCount++;
    }

    if (expiredCount > 0 || cleanedCount > 0) {
      log.info('Periodic cleanup completed', {
        expiredSessions: expiredCount,
        cleanedSessions: cleanedCount,
        remainingActive: this.activeSessions.size,
      });
    }
  }
}

// Export singleton instance with memory-optimized defaults for production
export const messageSessionManager = new MessageSessionManager({
  ackTrackingWindow: 24 * 60 * 60 * 1000, // 24 hours (sufficient for most status updates)
  cleanupInterval: 6 * 60 * 60 * 1000, // 6 hours (original cleanup frequency)
  maxSessionAge: 48 * 60 * 60 * 1000, // 48 hours (original session lifetime)
});
