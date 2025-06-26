/**
 * MessageSessionManager - Manages the lifecycle of all message sessions
 * 
 * Provides centralized management of MessageSession instances with automatic cleanup,
 * monitoring, and session isolation to prevent cross-date contamination.
 */

import { MessageSession } from './MessageSession.js';
import { logger } from '../core/Logger.js';

export class MessageSessionManager {
  constructor(options = {}) {
    this.activeSessions = new Map(); // date -> MessageSession
    this.sessionHistory = new Map(); // sessionId -> session stats
    this.maxHistorySize = options.maxHistorySize || 30;  // Reduced from 100 to 30
    this.keepHistory = options.keepHistory !== false;    // Allow disabling history completely
    
    // Memory leak protection - session limits (more realistic for medical practice)
    this.maxActiveSessions = options.maxActiveSessions || 25;  // Realistic limit for appointment dates
    this.maxMessagesPerSession = options.maxMessagesPerSession || 1000;  // Typical appointment volume per date
    
    // Time-based ACK tracking configuration
    this.ackTrackingWindow = options.ackTrackingWindow || (24 * 60 * 60 * 1000); // 24 hours default
    this.autoExpireEnabled = options.autoExpireEnabled !== false; // Default enabled
    
    // Auto-cleanup configuration
    this.cleanupInterval = options.cleanupInterval || (6 * 60 * 60 * 1000); // 6 hours (more frequent)
    this.maxSessionAge = options.maxSessionAge || (48 * 60 * 60 * 1000); // 48 hours for final cleanup
    
    // Start periodic cleanup
    this.startPeriodicCleanup();
    
    logger.whatsapp.info('MessageSessionManager initialized', {
      ackTrackingWindow: `${this.ackTrackingWindow / 1000}s`,
      cleanupInterval: `${this.cleanupInterval / 1000}s`,
      maxSessionAge: `${this.maxSessionAge / 1000}s`,
      autoExpireEnabled: this.autoExpireEnabled
    });
  }

  /**
   * Create or get active session for a date
   */
  getOrCreateSession(date, whatsappService) {
    // Normalize date to YYYY-MM-DD format
    const normalizedDate = date instanceof Date 
      ? date.toISOString().slice(0, 10)
      : date;

    // Check if we already have an active session for this date
    if (this.activeSessions.has(normalizedDate)) {
      const existingSession = this.activeSessions.get(normalizedDate);
      
      if (existingSession.isValid()) {
        logger.whatsapp.debug('Reusing existing session', {
          date: normalizedDate,
          sessionId: existingSession.sessionId
        });
        return existingSession;
      } else {
        // Clean up invalid session
        logger.whatsapp.warn('Cleaning up invalid session', {
          date: normalizedDate,
          sessionId: existingSession.sessionId,
          status: existingSession.status
        });
        this.completeSession(normalizedDate);
      }
    }

    // Memory leak protection: Check active session limit
    if (this.activeSessions.size >= this.maxActiveSessions) {
      logger.whatsapp.warn('Maximum active sessions reached, forcing cleanup', {
        currentSessions: this.activeSessions.size,
        maxSessions: this.maxActiveSessions
      });
      this.performPeriodicCleanup();
      
      // If still at limit after cleanup, remove oldest session
      if (this.activeSessions.size >= this.maxActiveSessions) {
        const oldestDate = this.activeSessions.keys().next().value;
        const oldestSession = this.activeSessions.get(oldestDate);
        this.completeSession(oldestDate);
        logger.whatsapp.warn('Forcibly removed oldest session to prevent memory leak', {
          removedDate: oldestDate,
          removedSessionId: oldestSession?.sessionId
        });
      }
    }

    // Create new session with time-based tracking configuration
    const sessionOptions = {
      ackTrackingWindow: this.ackTrackingWindow,
      autoExpireEnabled: this.autoExpireEnabled,
      maxMessages: this.maxMessagesPerSession  // Pass message limit to session
    };
    
    const session = new MessageSession(normalizedDate, whatsappService, sessionOptions);
    this.activeSessions.set(normalizedDate, session);
    
    logger.whatsapp.info('New MessageSession created', {
      date: normalizedDate,
      sessionId: session.sessionId,
      totalActiveSessions: this.activeSessions.size
    });

    return session;
  }

  /**
   * Start a session for message sending
   */
  startSession(date, whatsappService) {
    const session = this.getOrCreateSession(date, whatsappService);
    
    if (session.status === 'CREATED') {
      session.start();
    }
    
    return session;
  }

  /**
   * Get appointment ID for a message across all active sessions
   */
  getAppointmentIdForMessage(messageId) {
    // Search through active sessions
    for (const [date, session] of this.activeSessions) {
      const appointmentId = session.getAppointmentId(messageId);
      if (appointmentId) {
        logger.whatsapp.debug('Message found in session', {
          messageId,
          appointmentId,
          sessionDate: date,
          sessionId: session.sessionId
        });
        return {
          appointmentId,
          sessionDate: date,
          sessionId: session.sessionId
        };
      }
    }

    logger.whatsapp.debug('Message not found in any active session', {
      messageId,
      activeSessionCount: this.activeSessions.size,
      activeDates: Array.from(this.activeSessions.keys())
    });
    
    return null;
  }

  /**
   * Record delivery status update with session validation
   */
  recordDeliveryStatusUpdate(messageId, status) {
    const messageInfo = this.getAppointmentIdForMessage(messageId);
    
    if (!messageInfo) {
      logger.whatsapp.warn('Cannot record delivery status: message not in any active session', {
        messageId,
        status
      });
      return null;
    }

    const session = this.activeSessions.get(messageInfo.sessionDate);
    if (session && session.isValid()) {
      session.recordDeliveryStatusUpdate(messageId, status);
      return messageInfo;
    }

    logger.whatsapp.warn('Cannot record delivery status: session no longer valid', {
      messageId,
      status,
      sessionId: messageInfo.sessionId
    });
    
    return null;
  }

  /**
   * Complete a session for a specific date
   */
  completeSession(date) {
    const normalizedDate = date instanceof Date 
      ? date.toISOString().slice(0, 10)
      : date;

    const session = this.activeSessions.get(normalizedDate);
    if (!session) {
      logger.whatsapp.debug('No active session to complete', { date: normalizedDate });
      return;
    }

    // Complete the session
    session.complete();
    
    // Move to history (only if history is enabled)
    if (this.keepHistory) {
      this.sessionHistory.set(session.sessionId, session.getStats());
    }
    
    // Remove from active sessions
    this.activeSessions.delete(normalizedDate);
    
    // Cleanup session resources
    session.cleanup();
    
    logger.whatsapp.info('Session completed and moved to history', {
      date: normalizedDate,
      sessionId: session.sessionId,
      stats: session.getStats()
    });

    // Maintain history size limit
    this.trimHistory();
  }

  /**
   * Complete all active sessions
   */
  completeAllSessions() {
    const dates = Array.from(this.activeSessions.keys());
    
    logger.whatsapp.info('Completing all active sessions', {
      sessionCount: dates.length,
      dates
    });

    dates.forEach(date => {
      this.completeSession(date);
    });
  }

  /**
   * Get statistics for all sessions
   */
  getAllStats() {
    const activeStats = Array.from(this.activeSessions.values()).map(session => session.getStats());
    const historyStats = Array.from(this.sessionHistory.values());
    
    return {
      active: activeStats,
      history: historyStats,
      summary: {
        activeSessions: this.activeSessions.size,
        historicalSessions: this.sessionHistory.size,
        totalSessions: this.activeSessions.size + this.sessionHistory.size
      }
    };
  }

  /**
   * Start periodic cleanup of old sessions
   */
  startPeriodicCleanup() {
    this.cleanupTimer = setInterval(() => {
      this.performPeriodicCleanup();
    }, this.cleanupInterval);

    logger.whatsapp.debug('Periodic cleanup started', {
      interval: `${this.cleanupInterval / 1000}s`,
      maxAge: `${this.maxSessionAge / 1000}s`
    });
  }

  /**
   * Perform periodic cleanup of old and expired sessions
   */
  performPeriodicCleanup() {
    const now = Date.now();
    const cutoffTime = now - this.maxSessionAge;
    let expiredCount = 0;
    let cleanedCount = 0;
    let historyTrimmed = 0;

    // First pass: expire sessions that exceeded ACK tracking window
    for (const [date, session] of this.activeSessions) {
      if (session.isExpired() && session.status !== 'EXPIRED') {
        session.expire();
        expiredCount++;
      }
    }

    // Second pass: clean up very old sessions completely
    for (const [date, session] of this.activeSessions) {
      if (session.startTime.getTime() < cutoffTime) {
        logger.whatsapp.info('Auto-completing old session', {
          date,
          sessionId: session.sessionId,
          age: `${Math.round((now - session.startTime.getTime()) / 1000)}s`,
          status: session.status
        });
        
        this.completeSession(date);
        cleanedCount++;
      }
    }

    // Third pass: aggressively trim history on every cleanup (if history is enabled)
    const historyBefore = this.sessionHistory.size;
    if (this.keepHistory) {
      this.trimHistory();
    } else {
      // Clear all history if disabled
      this.sessionHistory.clear();
    }
    historyTrimmed = historyBefore - this.sessionHistory.size;

    if (expiredCount > 0 || cleanedCount > 0 || historyTrimmed > 0) {
      logger.whatsapp.info('Periodic cleanup completed', {
        expiredSessions: expiredCount,
        cleanedSessions: cleanedCount,
        historyTrimmed: historyTrimmed,
        remainingActive: this.activeSessions.size,
        remainingHistory: this.sessionHistory.size
      });
    }
  }

  /**
   * Trim history to maintain size limit
   */
  trimHistory() {
    if (this.sessionHistory.size <= this.maxHistorySize) {
      return;
    }

    // Convert to array, sort by date, keep most recent
    const entries = Array.from(this.sessionHistory.entries());
    entries.sort((a, b) => new Date(b[1].startTime) - new Date(a[1].startTime));
    
    // Keep only the most recent entries
    const toKeep = entries.slice(0, this.maxHistorySize);
    const toRemove = entries.slice(this.maxHistorySize);
    
    this.sessionHistory.clear();
    toKeep.forEach(([sessionId, stats]) => {
      this.sessionHistory.set(sessionId, stats);
    });

    logger.whatsapp.debug('Session history trimmed', {
      removed: toRemove.length,
      remaining: this.sessionHistory.size
    });
  }

  /**
   * Get expired sessions count
   */
  getExpiredSessionsCount() {
    let expiredCount = 0;
    for (const [date, session] of this.activeSessions) {
      if (session.isExpired()) {
        expiredCount++;
      }
    }
    return expiredCount;
  }

  /**
   * Get debug information for all sessions
   */
  getDebugInfo() {
    const activeSessions = {};
    let expiredCount = 0;
    let acceptingAcksCount = 0;
    
    for (const [date, session] of this.activeSessions) {
      activeSessions[date] = session.getDebugInfo();
      if (session.isExpired()) expiredCount++;
      if (session.canAcceptAcks()) acceptingAcksCount++;
    }

    return {
      activeSessions,
      sessionHistory: Object.fromEntries(this.sessionHistory),
      managerStats: {
        activeSessionCount: this.activeSessions.size,
        expiredSessionCount: expiredCount,
        acceptingAcksCount: acceptingAcksCount,
        historySize: this.sessionHistory.size,
        ackTrackingWindow: this.ackTrackingWindow,
        autoExpireEnabled: this.autoExpireEnabled,
        cleanupInterval: this.cleanupInterval,
        maxSessionAge: this.maxSessionAge,
        maxHistorySize: this.maxHistorySize
      }
    };
  }

  /**
   * Cleanup all resources
   */
  destroy() {
    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Complete all active sessions
    this.completeAllSessions();

    // Clear history
    this.sessionHistory.clear();

    logger.whatsapp.info('MessageSessionManager destroyed');
  }
}

// Export singleton instance with memory-optimized defaults for production
export const messageSessionManager = new MessageSessionManager({
  maxHistorySize: 10,        // Keep only 10 days of history
  keepHistory: true,         // Keep minimal history for debugging
  ackTrackingWindow: 24 * 60 * 60 * 1000,  // 24 hours (sufficient for most status updates)
  cleanupInterval: 6 * 60 * 60 * 1000,     // 6 hours (original cleanup frequency)
  maxSessionAge: 48 * 60 * 60 * 1000       // 48 hours (original session lifetime)
});