// services/database/queries/messaging-queries.js
/**
 * Enhanced Messaging Queries Module with new infrastructure integration
 * Provides functions for WhatsApp and SMS messaging database operations
 */
import { Connection, Request, TYPES } from 'tedious';
import { executeQuery, executeStoredProcedure } from '../index.js';
import ConnectionPool from '../ConnectionPool.js';
import { createWebSocketMessage, MessageSchemas } from '../../messaging/schemas.js';
import { logger } from '../../core/Logger.js';

// Circuit breaker for database operations
class DatabaseCircuitBreaker {
  constructor(threshold = 3, timeout = 30000) {
    this.failureThreshold = threshold;
    this.timeout = timeout;
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  async execute(operation, operationName = 'database-operation') {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'HALF_OPEN';
        logger.message.info('Circuit breaker half-open', { operation: operationName });
      } else {
        throw new Error(`Circuit breaker is OPEN for ${operationName}`);
      }
    }

    try {
      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(operationName, error);
      throw error;
    }
  }

  onSuccess(operationName) {
    if (this.state === 'HALF_OPEN') {
      logger.message.info('Circuit breaker closed after success', { operation: operationName });
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure(operationName, error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    logger.message.error('Circuit breaker failure threshold approaching', { 
      operationName, 
      failureCount: this.failureCount, 
      failureThreshold: this.failureThreshold 
    }, error);
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      logger.message.error('Circuit breaker opened due to threshold exceeded', { operationName });
    }
  }

  isOpen() {
    return this.state === 'OPEN';
  }

  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime
    };
  }
}

const dbCircuitBreaker = new DatabaseCircuitBreaker();

/**
 * Helper function to execute stored procedure with existing connection
 */
async function executeStoredProcedureWithConnection(connection, procedureName, params, beforeExec, rowMapper, resultMapper) {
  return new Promise((resolve, reject) => {
    const request = new Request(procedureName, (err) => {
      if (err) {
        reject(err);
        return;
      }
    });

    // Add parameters
    (params || []).forEach((param) => {
      request.addParameter(param[0], param[1], param[2]);
    });

    // Execute beforeExec callback
    if (beforeExec) {
      try {
        beforeExec(request);
      } catch (error) {
        reject(error);
        return;
      }
    }

    const result = [];
    const outParams = [];

    request.on('row', (columns) => {
      try {
        result.push(rowMapper ? rowMapper(columns) : columns);
      } catch (error) {
        reject(error);
      }
    });

    request.on('returnValue', (parameterName, value) => {
      outParams.push({ parameterName, value });
    });

    request.on('requestCompleted', () => {
      try {
        resolve(resultMapper ? resultMapper(result, outParams) : result);
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', (error) => {
      reject(error);
    });

    // Execute the stored procedure
    connection.callProcedure(request);
  });
}

/**
 * Helper function to convert WhatsApp acknowledgment status codes to text
 */
function convertAckStatus(ack) {
  switch (ack) {
    case -1:
      return 'ERROR';
    case 0:
      return 'PENDING';
    case 1:
      return 'SERVER';
    case 2:
      return 'DEVICE';
    case 3:
      return 'READ';
    case 4:
      return 'PLAYED';
    default:
      logger.message.warn('Unknown WhatsApp status code encountered', { statusCode: ack });
      return `UNKNOWN_${ack}`;
  }
}

/**
 * Enhanced updateWhatsAppDeliveryStatus with transaction management and circuit breaker
 */
export async function updateWhatsAppDeliveryStatus(messages) {
  const operationName = 'updateWhatsAppDeliveryStatus';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Starting WhatsApp delivery status update', { messageCount: messages.length });
    
    if (!messages || messages.length === 0) {
      return { success: true, updatedCount: 0 };
    }

    // Group messages by status for better logging
    const statusGroups = {};
    messages.forEach(msg => {
      const status = convertAckStatus(msg.ack);
      if (!statusGroups[status]) statusGroups[status] = 0;
      statusGroups[status]++;
    });
    
    logger.message.debug('WhatsApp status distribution', { statusGroups });
    logger.message.debug('Processing message batch data', { 
      messages: messages.map(m => ({ 
        id: m.id, 
        ack: m.ack, 
        whatsappMessageId: m.whatsappMessageId 
      })) 
    });

    const rows = messages.map(message => {
      const status = convertAckStatus(message.ack);
      const waMessageId = message.whatsappMessageId || '';
      logger.message.debug('Processing individual message', { 
        appointmentId: message.id, 
        whatsappMessageId: waMessageId, 
        status 
      });
      
      return [
        message.id,                           // AppointmentID
        null,                                 // SentWa (bit) - null for status updates
        status,                               // DeliveredWa (nvarchar 50)
        waMessageId,                          // WaMessageID (nvarchar 255) - store WhatsApp message ID
        new Date(),                           // LastUpdated (datetime)
        null                                  // SentTimestamp (datetime) - null for delivery status updates
      ];
    });

    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SentWa', type: TYPES.Bit },
        { name: 'DeliveredWa', type: TYPES.NVarChar },
        { name: 'WaMessageID', type: TYPES.NVarChar },
        { name: 'LastUpdated', type: TYPES.DateTime },
        { name: 'SentTimestamp', type: TYPES.DateTime }
      ],
      rows: rows
    };

    // Use direct connection to avoid transaction conflicts
    return ConnectionPool.withConnection(async (connection) => {
      return executeStoredProcedureWithConnection(
        connection,
        'UpdateWhatsAppDeliveryStatus',
        [['AIDS', TYPES.TVP, tableDefinition]],
          null,
          (columns) => {
            if (columns.length >= 4) {
              return {
                totalUpdated: columns[0].value,
                readCount: columns[1].value,
                deliveredCount: columns[2].value,
                serverCount: columns[3].value
              };
            }
            return null;
          },
          (result) => {
            if (result && result.length > 0) {
              const stats = result[0];
              logger.message.info('WhatsApp status update completed', { 
                totalUpdated: stats.totalUpdated, 
                readCount: stats.readCount, 
                deliveredCount: stats.deliveredCount, 
                serverCount: stats.serverCount 
              });
              return {
                success: true,
                updatedCount: stats.totalUpdated,
                stats: stats
              };
            }
            
            return {
              success: true,
              updatedCount: rows.length,
              stats: null
            };
          }
        );
      });

  }, operationName).catch(error => {
    logger.message.error('WhatsApp delivery status update failed', { operationName }, error);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Enhanced getWhatsAppMessages with connection pooling and circuit breaker
 */
export async function getWhatsAppMessages(date) {
  const operationName = 'getWhatsAppMessages';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.debug('Retrieving WhatsApp messages', { date });
    
    return ConnectionPool.withConnection(async (connection) => {
      return executeStoredProcedureWithConnection(
        connection,
        'GetWhatsAppMessagesToSend',
        [['ADate', TYPES.Date, date]],
        null,
        (columns) => {
          if (columns.length >= 5) {
            return {
              id: columns[0].value,
              number: columns[1].value,
              name: columns[2].value,
              message: columns[3].value,
              appTime: columns[4].value
            };
          }
          return null;
        },
        (result) => {
          const numbers = result.map(r => r.number || '');
          const messages = result.map(r => r.message || '');
          const ids = result.map(r => r.id || '');
          const names = result.map(r => r.name || '');
          
          logger.message.debug('WhatsApp messages retrieved successfully', {
            messageCount: result.length,
            date
          });
          
          if (result.length > 0) {
            // Log appointment time distribution for insights
            const timeGroups = {};
            result.forEach(r => {
              const hour = new Date(r.appTime).getHours();
              if (!timeGroups[hour]) timeGroups[hour] = 0;
              timeGroups[hour]++;
            });
            
            logger.message.debug('Appointment time distribution analysis', { timeGroups });
            
            // Log sample messages for debugging
            const sampleCount = Math.min(3, result.length);
            for (let i = 0; i < sampleCount; i++) {
              const message = result[i].message || '';
              const msgPreview = message.length > 30 ? message.substring(0, 30) + '...' : message;
              logger.message.debug('Sample message preview', { 
                sampleNumber: i + 1, 
                appointmentId: result[i].id, 
                appointmentTime: new Date(result[i].appTime).toLocaleTimeString(), 
                phoneNumber: result[i].number, 
                messagePreview: msgPreview 
              });
            }
          }
          
          return [numbers, messages, ids, names];
        }
      );
    });
    
  }, operationName).catch(error => {
    logger.message.error('Failed to retrieve WhatsApp messages', { operationName }, error);
    return [[], [], [], []];
  });
}


/**
 * Enhanced updateWhatsAppStatus with transaction management
 */
export async function updateWhatsAppStatus(appointmentIds, messageIds) {
  const operationName = 'updateWhatsAppStatus';
  
  if (!appointmentIds || !appointmentIds.length) {
    logger.message.debug('No WhatsApp messages to update');
    return { success: true, updatedCount: 0 };
  }
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Starting WhatsApp status update', { messageCount: appointmentIds.length });
    
    // Log sample IDs for debugging
    if (appointmentIds.length <= 5) {
      logger.message.debug('WhatsApp appointment IDs to update', { appointmentIds });
      logger.message.debug('WhatsApp message IDs to update', { messageIds });
    } else {
      logger.message.debug('WhatsApp appointment IDs sample', { 
        sampleIds: appointmentIds.slice(0, 3), 
        totalCount: appointmentIds.length 
      });
    }
    
    const rows = [];
    
    // Create table rows for the procedure (6 columns to match WhatsTableType)
    for (let i = 0; i < appointmentIds.length; i++) {
      rows.push([
        appointmentIds[i],  // AppointmentID
        1,                  // SentWa - Set to 1 to mark as sent
        null,               // DeliveredWa - Not updated here
        messageIds[i],      // WaMessageID - Store the message ID
        new Date(),         // LastUpdated
        new Date()          // SentTimestamp - When message was sent
      ]);
    }

    // Table definition (6 columns to match WhatsTableType)
    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SentWa', type: TYPES.Bit },
        { name: 'DeliveredWa', type: TYPES.NVarChar },
        { name: 'WaMessageID', type: TYPES.NVarChar },
        { name: 'LastUpdated', type: TYPES.DateTime },
        { name: 'SentTimestamp', type: TYPES.DateTime }
      ],
      rows: rows
    };

    // Execute with direct connection to avoid transaction conflicts
    return ConnectionPool.withConnection(async (connection) => {
      return executeStoredProcedureWithConnection(
        connection,
        'UpdateWhatsAppStatus',
        [['AIDS', TYPES.TVP, tableDefinition]],
          null,
          (columns) => {
            if (columns.length >= 1) {
              return { updatedCount: columns[0].value };
            }
            return null;
          },
          (result) => {
            const updatedCount = result && result.length > 0 ? result[0].updatedCount : rows.length;
            logger.message.info('WhatsApp status update completed successfully', { updatedCount });
            
            return {
              success: true,
              updatedCount: updatedCount
            };
          }
        );
      });
    
  }, operationName).catch(error => {
    logger.message.error('WhatsApp status update failed', { operationName }, error);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Enhanced updateSingleMessageStatus with better error handling and transactions
 */
export async function updateSingleMessageStatus(messageId, status) {
  const operationName = 'updateSingleMessageStatus';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Updating single message status', { messageId, status });
    
    const statusText = convertAckStatus(status);
    const currentTimestamp = new Date();
    
    return executeStoredProcedure(
      'UpdateSingleMessageStatus',
      [
        ['MessageId', TYPES.NVarChar, messageId],
        ['Status', TYPES.NVarChar, statusText],
        ['LastUpdated', TYPES.DateTime, currentTimestamp]
      ],
      (request) => {
        request.addOutputParameter('Result', TYPES.Int);
      },
      (columns) => {
        if (columns.length >= 5) {
          return {
            appointmentId: columns[0].value,
            patientName: columns[1].value,
            phone: columns[2].value,
            status: columns[3].value,
            lastUpdated: columns[4].value
          };
        }
        return null;
      },
      (result, outParams) => {
        const success = outParams && outParams.length > 0 && outParams[0].value === 1;
        
        if (success && result && result.length > 0) {
          const appointment = result[0];
          logger.message.info('Single message status updated successfully', { 
            messageId, 
            appointmentId: appointment.appointmentId, 
            patientName: appointment.patientName 
          });
          
          return {
            success: true,
            found: true,
            appointment
          };
        } else if (success) {
          logger.message.info('Single message status updated successfully', { messageId });
          return {
            success: true,
            found: true
          };
        } else {
          logger.message.warn('Message ID not found in database', { messageId });
          return {
            success: true,
            found: false
          };
        }
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('Single message status update failed', { operationName }, error);
    return {
      success: false,
      error: error.message
    };
  });
}

/**
 * Enhanced getWhatsAppDeliveryStatus with connection pooling
 */
export async function getWhatsAppDeliveryStatus(date) {
  const operationName = 'getWhatsAppDeliveryStatus';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Retrieving WhatsApp delivery status', { date });
    
    return ConnectionPool.withConnection(async (connection) => {
      return executeStoredProcedureWithConnection(
        connection,
        'ProcFetch',
        [['ADate', TYPES.Date, date]],
        null,
        (columns) => ({
          id: columns[0].value,        // appointmentID
          number: columns[1].value,    // Phone number with @c.us
          wamid: columns[2].value      // WaMessageID
        }),
        (result) => {
          logger.message.info('WhatsApp messages retrieved for status checking', { 
            messageCount: result.length, 
            date 
          });
          
          if (result.length > 0) {
            // Log the first few for debugging
            const sampleCount = Math.min(5, result.length);
            logger.message.debug('Sample messages for status check', { 
              sampleCount, 
              totalCount: result.length 
            });
            for (let i = 0; i < sampleCount; i++) {
              logger.message.debug('Status check message sample', { 
                appointmentId: result[i].id, 
                messageId: result[i].wamid 
              });
            }
          }
          
          return result;
        }
      );
    });
    
  }, operationName).catch(error => {
    logger.message.error('Failed to retrieve WhatsApp delivery status', { operationName }, error);
    return [];
  });
}

/**
 * Enhanced batch status update with WebSocket broadcasting
 */
export async function batchUpdateMessageStatuses(updates, wsEmitter = null) {
  const operationName = 'batchUpdateMessageStatuses';
  
  if (!updates || updates.length === 0) {
    return { success: true, updatedCount: 0 };
  }

  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Starting batch message status update', { updateCount: updates.length });
    
    // Group updates by status for insights
    const statusGroups = {};
    updates.forEach(update => {
      const status = convertAckStatus(update.status);
      if (!statusGroups[status]) statusGroups[status] = [];
      statusGroups[status].push(update);
    });

    logger.message.debug('Batch update status distribution', { 
      statusDistribution: Object.keys(statusGroups).reduce((acc, status) => { 
        acc[status] = statusGroups[status].length; 
        return acc; 
      }, {}) 
    });

    // Execute database update
    const result = await updateWhatsAppDeliveryStatus(updates);

    // Broadcast status updates if WebSocket emitter provided
    if (wsEmitter && result.success) {
      const message = createWebSocketMessage(
        MessageSchemas.WebSocketMessage.BATCH_STATUS,
        {
          statusUpdates: updates,
          timestamp: Date.now(),
          stats: result.stats
        }
      );
      
      wsEmitter.emit('broadcast_message', message);
      logger.message.info('Batch status update broadcasted via WebSocket', { messageCount: updates.length });
    }

    return result;
    
  }, operationName);
}

/**
 * Enhanced SMS functions with circuit breaker protection
 */
export async function getSmsMessages(date) {
  const operationName = 'getSmsMessages';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Retrieving SMS messages', { date });
    
    return executeStoredProcedure(
      'ProcSMS',
      [['ADate', TYPES.Date, date]],
      null,
      (columns) => ({
        id: columns[0].value,
        to: columns[1].value,
        body: columns[2].value
      }),
      (result) => {
        logger.message.info('SMS messages retrieved successfully', { 
          messageCount: result.length, 
          date 
        });
        return result;
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('Failed to retrieve SMS messages', { operationName }, error);
    return [];
  });
}

export async function updateSmsIds(messages) {
  const operationName = 'updateSmsIds';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Starting SMS ID update', { messageCount: messages.length });
    
    const rows = messages.map(message => [
      message.id,   // AppointmentID
      null,         // SMSStatus
      message.sid   // sms_sid
    ]);

    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SMSStatus', type: TYPES.NVarChar },
        { name: 'sms_sid', type: TYPES.NVarChar }
      ],
      rows: rows
    };

    return executeStoredProcedure(
      'ProcUpdatesms1',
      [['status', TYPES.TVP, tableDefinition]],
      null,
      null,
      () => {
        logger.message.info('SMS IDs updated successfully', { updatedCount: rows.length });
        return {
          success: true,
          updatedCount: rows.length
        };
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('SMS ID update failed', { operationName }, error);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

export async function getSmsIds(date) {
  const operationName = 'getSmsIds';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Retrieving SMS IDs for status checking', { date });
    
    return executeStoredProcedure(
      'Procgetsids',
      [['ADate', TYPES.Date, date]],
      null,
      (columns) => ({
        id: columns[0].value,
        sid: columns[1].value
      }),
      (result) => {
        logger.message.info('SMS IDs retrieved for status checking', { idCount: result.length });
        return result;
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('Failed to retrieve SMS IDs', { operationName }, error);
    return [];
  });
}

export async function updateSmsStatus(messages) {
  const operationName = 'updateSmsStatus';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.info('Starting SMS status update', { messageCount: messages.length });
    
    const rows = messages.map(message => [
      message.id,        // AppointmentID
      message.status,    // SMSStatus
      null               // sms_sid
    ]);

    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SMSStatus', type: TYPES.NVarChar },
        { name: 'sms_sid', type: TYPES.NVarChar }
      ],
      rows: rows
    };

    return executeStoredProcedure(
      'ProcUpdatesms2',
      [['status', TYPES.TVP, tableDefinition]],
      null,
      null,
      () => {
        logger.message.info('SMS status update completed successfully', { updatedCount: rows.length });
        return {
          success: true,
          updatedCount: rows.length
        };
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('SMS status update failed', { operationName }, error);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Additional enhanced functions for monitoring and analytics
 */
export async function getMessageStatusByDate(date) {
  const operationName = 'getMessageStatusByDate';
  
  return dbCircuitBreaker.execute(async () => {
    logger.message.debug('Retrieving message status summary', { date });

    return executeStoredProcedure(
      'GetMessageStatusByDate',
      [['Date', TYPES.Date, date]],
      null,
      (columns) => {
        if (columns.length >= 8) {
          return {
            appointmentId: columns[0].value,
            patientName: columns[1].value,
            phone: columns[2].value,
            sentStatus: columns[3].value ? true : false,
            deliveryStatus: columns[4].value,
            messageId: columns[5].value,
            sentTimestamp: columns[6].value,
            lastUpdated: columns[7].value
          };
        }
        return null;
      },
      (result) => {
        // Group by status for summary
        const summary = {
          total: result.length,
          sent: result.filter(r => r.sentStatus).length,
          pending: result.filter(r => r.sentStatus && !r.deliveryStatus).length,
          delivered: result.filter(r => r.deliveryStatus === 'DEVICE' || r.deliveryStatus === 'SERVER').length,
          read: result.filter(r => r.deliveryStatus === 'READ' || r.deliveryStatus === 'PLAYED').length,
          failed: result.filter(r => r.deliveryStatus === 'ERROR').length
        };
        
        logger.message.debug('Message status summary retrieved', {
          date,
          total: summary.total,
          sent: summary.sent,
          read: summary.read
        });
        
        return {
          date: date,
          summary: summary,
          messages: result
        };
      }
    );
    
  }, operationName).catch(error => {
    logger.message.error('Failed to retrieve message status summary', { operationName }, error);
    return {
      date: date,
      error: error.message,
      summary: { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
      messages: []
    };
  });
}

/**
 * Get circuit breaker status for monitoring
 */
export function getCircuitBreakerStatus() {
  return {
    database: dbCircuitBreaker.getStatus(),
    timestamp: Date.now()
  };
}

/**
 * Reset circuit breaker (for manual recovery)
 */
export function resetCircuitBreaker() {
  dbCircuitBreaker.failureCount = 0;
  dbCircuitBreaker.state = 'CLOSED';
  dbCircuitBreaker.lastFailureTime = null;
  logger.message.info('Database circuit breaker manually reset');
  
  return {
    success: true,
    message: 'Circuit breaker reset successfully',
    newStatus: dbCircuitBreaker.getStatus()
  };
}