/**
 * MessageSession - Manages the lifecycle of a WhatsApp messaging session for a specific date
 *
 * This class provides proper isolation and lifecycle management for message operations,
 * preventing cross-date contamination and ensuring data integrity.
 */

import { logger } from '../core/Logger.js';

// ===========================================
// SESSION TYPES
// ===========================================

/**
 * Session status lifecycle
 */
export type SessionStatus = 'CREATED' | 'ACTIVE' | 'COMPLETED' | 'CLEANUP' | 'EXPIRED';

/**
 * Session configuration options
 */
export interface MessageSessionOptions {
  /** ACK tracking window in milliseconds (default: 24 hours) */
  ackTrackingWindow?: number;
  /** Enable automatic expiration (default: true) */
  autoExpireEnabled?: boolean;
  /** Maximum messages per session (default: 1000) */
  maxMessages?: number;
}

/**
 * Delivery status update entry
 */
export interface DeliveryUpdate {
  status: string;
  updatedAt: Date;
}

/**
 * Message mapping entry
 */
export interface MessageMapping {
  appointmentId: number;
  appointmentDate: string;
  registeredAt: Date;
  sessionId: string;
  sentAt?: Date;
  failedAt?: Date;
  error?: string;
  deliveryUpdates?: DeliveryUpdate[];
}

/**
 * Session statistics
 */
export interface SessionStats {
  totalMessages: number;
  sentMessages: number;
  failedMessages: number;
  deliveryStatusUpdates: number;
  sessionId?: string;
  date?: string;
  status?: SessionStatus;
  startTime?: Date;
  endTime?: Date | null;
  expiresAt?: Date;
  ackTrackingWindow?: number;
  isExpired?: boolean;
  canAcceptAcks?: boolean;
  timeUntilExpiry?: number;
  duration?: number;
  activeMessages?: number;
}

/**
 * Mapping debug info
 */
export interface MappingDebugInfo {
  messageId: string;
  appointmentId: number;
  appointmentDate: string;
  registeredAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  deliveryUpdates: DeliveryUpdate[];
}

/**
 * Session debug information
 */
export interface SessionDebugInfo {
  sessionId: string;
  date: string;
  status: SessionStatus;
  startTime: Date;
  endTime: Date | null;
  stats: SessionStats;
  activeMappings: MappingDebugInfo[];
}

/**
 * WhatsApp service interface (minimal for dependency)
 */
export interface WhatsAppServiceInterface {
  // Placeholder for WhatsApp service methods - empty interface allows any object
}

// ===========================================
// MESSAGE SESSION CLASS
// ===========================================

export class MessageSession {
  public readonly sessionId: string;
  public readonly date: string;
  public status: SessionStatus;
  public startTime: Date;
  public endTime: Date | null;
  public readonly expiresAt: Date;
  public readonly ackTrackingWindow: number;
  public readonly autoExpireEnabled: boolean;
  public readonly maxMessages: number;

  private whatsappService: WhatsAppServiceInterface;
  private messageIdToAppointmentMap: Map<string, MessageMapping>;
  private appointmentIdToMessageMap: Map<number, string>;
  private processedAppointments: Set<number>;
  private stats: SessionStats;

  constructor(
    date: string,
    whatsappService: WhatsAppServiceInterface,
    options: MessageSessionOptions = {}
  ) {
    this.sessionId = `msg_session_${date}_${Date.now()}`;
    this.date = date;
    this.whatsappService = whatsappService;
    this.startTime = new Date();
    this.endTime = null;
    this.status = 'CREATED';

    // Time-based ACK tracking configuration
    this.ackTrackingWindow = options.ackTrackingWindow || 24 * 60 * 60 * 1000; // 24 hours default
    this.expiresAt = new Date(this.startTime.getTime() + this.ackTrackingWindow);
    this.autoExpireEnabled = options.autoExpireEnabled !== false; // Default enabled

    // Memory leak protection - message limits
    this.maxMessages = options.maxMessages || 1000; // Realistic limit for daily appointments

    // Message tracking for this session only
    this.messageIdToAppointmentMap = new Map();
    this.appointmentIdToMessageMap = new Map();
    this.processedAppointments = new Set();

    // Statistics
    this.stats = {
      totalMessages: 0,
      sentMessages: 0,
      failedMessages: 0,
      deliveryStatusUpdates: 0,
    };

    logger.whatsapp.info('MessageSession created', {
      sessionId: this.sessionId,
      date: this.date,
      startTime: this.startTime.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      ackTrackingWindow: `${this.ackTrackingWindow / 1000}s`,
    });
  }

  /**
   * Check if the session has expired for ACK tracking
   */
  isExpired(): boolean {
    if (!this.autoExpireEnabled) {
      return false;
    }
    return Date.now() > this.expiresAt.getTime();
  }

  /**
   * Check if session can accept new ACKs
   */
  canAcceptAcks(): boolean {
    if (this.status === 'CLEANUP' || this.status === 'EXPIRED') {
      return false;
    }

    if (this.isExpired()) {
      this.expire();
      return false;
    }

    return this.status === 'ACTIVE' || this.status === 'COMPLETED';
  }

  /**
   * Expire the session for ACK tracking
   */
  expire(): void {
    if (this.status === 'EXPIRED' || this.status === 'CLEANUP') {
      return; // Already expired or cleaned up
    }

    const previousStatus = this.status;
    this.status = 'EXPIRED';

    const age = Date.now() - this.startTime.getTime();
    logger.whatsapp.info('MessageSession expired - no longer accepting ACKs', {
      sessionId: this.sessionId,
      date: this.date,
      previousStatus,
      age: `${Math.round(age / 1000)}s`,
      ackTrackingWindow: `${this.ackTrackingWindow / 1000}s`,
      mappingCount: this.messageIdToAppointmentMap.size,
    });
  }

  /**
   * Get time until expiry
   */
  getTimeUntilExpiry(): number {
    if (!this.autoExpireEnabled) {
      return Infinity;
    }
    return Math.max(0, this.expiresAt.getTime() - Date.now());
  }

  /**
   * Start the messaging session
   */
  start(): void {
    if (this.status !== 'CREATED') {
      throw new Error(`Cannot start session in status: ${this.status}`);
    }

    this.status = 'ACTIVE';
    this.startTime = new Date();

    logger.whatsapp.info('MessageSession started', {
      sessionId: this.sessionId,
      date: this.date,
    });
  }

  /**
   * Register a message mapping with validation
   */
  registerMessage(
    messageId: string,
    appointmentId: number,
    appointmentDate: Date | string
  ): boolean {
    if (this.status !== 'ACTIVE') {
      throw new Error(`Cannot register message in session status: ${this.status}`);
    }

    // Validate that appointment belongs to this session's date
    const appointmentDateStr =
      appointmentDate instanceof Date
        ? appointmentDate.toISOString().slice(0, 10)
        : appointmentDate;

    if (appointmentDateStr !== this.date) {
      const error = new Error(
        `Date mismatch: Session for ${this.date}, appointment for ${appointmentDateStr}`
      );
      logger.whatsapp.error('MessageSession date validation failed', {
        sessionId: this.sessionId,
        sessionDate: this.date,
        appointmentDate: appointmentDateStr,
        appointmentId,
        messageId,
      });
      throw error;
    }

    // Memory leak protection: Check message limit
    if (this.messageIdToAppointmentMap.size >= this.maxMessages) {
      logger.whatsapp.error('Session message limit reached, rejecting new message', {
        sessionId: this.sessionId,
        currentMessages: this.messageIdToAppointmentMap.size,
        maxMessages: this.maxMessages,
        rejectedMessageId: messageId,
        rejectedAppointmentId: appointmentId,
      });
      return false;
    }

    // Prevent duplicate registrations
    if (this.messageIdToAppointmentMap.has(messageId)) {
      const existing = this.messageIdToAppointmentMap.get(messageId);
      logger.whatsapp.warn('Duplicate message ID registration attempted', {
        sessionId: this.sessionId,
        messageId,
        existingAppointmentId: existing?.appointmentId,
        newAppointmentId: appointmentId,
      });
      return false;
    }

    if (this.processedAppointments.has(appointmentId)) {
      logger.whatsapp.warn('Appointment already processed in this session', {
        sessionId: this.sessionId,
        appointmentId,
        existingMessageId: this.appointmentIdToMessageMap.get(appointmentId),
        newMessageId: messageId,
      });
      return false;
    }

    // Register the mappings
    this.messageIdToAppointmentMap.set(messageId, {
      appointmentId,
      appointmentDate: appointmentDateStr,
      registeredAt: new Date(),
      sessionId: this.sessionId,
    });

    this.appointmentIdToMessageMap.set(appointmentId, messageId);
    this.processedAppointments.add(appointmentId);
    this.stats.totalMessages++;

    logger.whatsapp.debug('Message registered in session', {
      sessionId: this.sessionId,
      messageId,
      appointmentId,
      appointmentDate: appointmentDateStr,
    });

    return true;
  }

  /**
   * Get appointment ID for a message with validation and expiry check
   */
  getAppointmentId(messageId: string): number | null {
    // Check if session can still accept ACKs
    if (!this.canAcceptAcks()) {
      logger.whatsapp.debug('Session cannot accept ACKs - message lookup rejected', {
        sessionId: this.sessionId,
        messageId,
        status: this.status,
        isExpired: this.isExpired(),
        timeUntilExpiry: this.getTimeUntilExpiry(),
      });
      return null;
    }

    const mapping = this.messageIdToAppointmentMap.get(messageId);

    if (!mapping) {
      logger.whatsapp.debug('Message ID not found in session', {
        sessionId: this.sessionId,
        messageId,
        status: this.status,
      });
      return null;
    }

    // Additional validation
    if (mapping.sessionId !== this.sessionId) {
      logger.whatsapp.error('Session ID mismatch in mapping', {
        sessionId: this.sessionId,
        mappingSessionId: mapping.sessionId,
        messageId,
      });
      return null;
    }

    return mapping.appointmentId;
  }

  /**
   * Record message sent successfully
   */
  recordMessageSent(messageId: string): void {
    const mapping = this.messageIdToAppointmentMap.get(messageId);
    if (mapping) {
      mapping.sentAt = new Date();
      this.stats.sentMessages++;

      logger.whatsapp.debug('Message sent recorded', {
        sessionId: this.sessionId,
        messageId,
        appointmentId: mapping.appointmentId,
      });
    }
  }

  /**
   * Record message failed
   */
  recordMessageFailed(messageId: string, error: string): void {
    const mapping = this.messageIdToAppointmentMap.get(messageId);
    if (mapping) {
      mapping.failedAt = new Date();
      mapping.error = error;
      this.stats.failedMessages++;

      logger.whatsapp.debug('Message failure recorded', {
        sessionId: this.sessionId,
        messageId,
        appointmentId: mapping.appointmentId,
        error: error,
      });
    }
  }

  /**
   * Record delivery status update with expiry validation
   */
  recordDeliveryStatusUpdate(messageId: string, status: string): boolean {
    // Check if session can still accept ACKs
    if (!this.canAcceptAcks()) {
      logger.whatsapp.debug('Session cannot accept ACKs - delivery status update rejected', {
        sessionId: this.sessionId,
        messageId,
        status,
        sessionStatus: this.status,
        isExpired: this.isExpired(),
        timeUntilExpiry: this.getTimeUntilExpiry(),
      });
      return false;
    }

    const mapping = this.messageIdToAppointmentMap.get(messageId);
    if (mapping) {
      if (!mapping.deliveryUpdates) {
        mapping.deliveryUpdates = [];
      }

      mapping.deliveryUpdates.push({
        status,
        updatedAt: new Date(),
      });

      this.stats.deliveryStatusUpdates++;

      logger.whatsapp.debug('Delivery status update recorded', {
        sessionId: this.sessionId,
        messageId,
        appointmentId: mapping.appointmentId,
        status,
        timeUntilExpiry: this.getTimeUntilExpiry(),
      });

      return true;
    }

    return false;
  }

  /**
   * Complete the session
   */
  complete(): void {
    if (this.status !== 'ACTIVE') {
      logger.whatsapp.warn('Attempting to complete session in invalid status', {
        sessionId: this.sessionId,
        currentStatus: this.status,
      });
      return;
    }

    this.status = 'COMPLETED';
    this.endTime = new Date();
    const duration = this.endTime.getTime() - this.startTime.getTime();

    logger.whatsapp.info('MessageSession completed', {
      sessionId: this.sessionId,
      date: this.date,
      duration: `${duration}ms`,
      stats: this.stats,
      endTime: this.endTime.toISOString(),
    });
  }

  /**
   * Get session statistics
   */
  getStats(): SessionStats {
    return {
      ...this.stats,
      sessionId: this.sessionId,
      date: this.date,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      expiresAt: this.expiresAt,
      ackTrackingWindow: this.ackTrackingWindow,
      isExpired: this.isExpired(),
      canAcceptAcks: this.canAcceptAcks(),
      timeUntilExpiry: this.getTimeUntilExpiry(),
      duration: this.endTime
        ? this.endTime.getTime() - this.startTime.getTime()
        : Date.now() - this.startTime.getTime(),
      activeMessages: this.messageIdToAppointmentMap.size,
    };
  }

  /**
   * Cleanup session resources
   */
  cleanup(): void {
    if (this.status === 'CLEANUP') {
      return; // Already cleaned up
    }

    const previousStatus = this.status;
    this.status = 'CLEANUP';

    // Clear all mappings
    const messageCount = this.messageIdToAppointmentMap.size;
    this.messageIdToAppointmentMap.clear();
    this.appointmentIdToMessageMap.clear();
    this.processedAppointments.clear();

    logger.whatsapp.info('MessageSession cleaned up', {
      sessionId: this.sessionId,
      previousStatus,
      clearedMessages: messageCount,
      finalStats: this.stats,
    });
  }

  /**
   * Check if session is valid for operations
   */
  isValid(): boolean {
    return this.status === 'ACTIVE';
  }

  /**
   * Get detailed session information for debugging
   */
  getDebugInfo(): SessionDebugInfo {
    return {
      sessionId: this.sessionId,
      date: this.date,
      status: this.status,
      startTime: this.startTime,
      endTime: this.endTime,
      stats: this.stats,
      activeMappings: Array.from(this.messageIdToAppointmentMap.entries()).map(
        ([messageId, mapping]) => ({
          messageId,
          appointmentId: mapping.appointmentId,
          appointmentDate: mapping.appointmentDate,
          registeredAt: mapping.registeredAt,
          sentAt: mapping.sentAt || null,
          failedAt: mapping.failedAt || null,
          deliveryUpdates: mapping.deliveryUpdates || [],
        })
      ),
    };
  }
}
