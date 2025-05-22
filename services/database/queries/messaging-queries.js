// services/database/queries/messaging-queries.js
/**
 * Enhanced Messaging Queries Module with new infrastructure integration
 * Provides functions for WhatsApp and SMS messaging database operations
 */
import { Connection, Request, TYPES } from 'tedious';
import { executeQuery, executeStoredProcedure } from '../index.js';
import TransactionManager from '../TransactionManager.js';
import ConnectionPool from '../ConnectionPool.js';
import { createWebSocketMessage, MessageSchemas } from '../../messaging/schemas.js';

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
        console.log(`Circuit breaker half-open for ${operationName}`);
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
      console.log(`Circuit breaker closed for ${operationName} after successful operation`);
    }
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  onFailure(operationName, error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    console.error(`Circuit breaker failure ${this.failureCount}/${this.failureThreshold} for ${operationName}:`, error.message);
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`Circuit breaker OPENED for ${operationName}`);
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
      console.warn(`Unknown WhatsApp status code: ${ack}`);
      return `UNKNOWN_${ack}`;
  }
}

/**
 * Enhanced updateWhatsAppDeliveryStatus with transaction management and circuit breaker
 */
export async function updateWhatsAppDeliveryStatus(messages) {
  const operationName = 'updateWhatsAppDeliveryStatus';
  
  return dbCircuitBreaker.execute(async () => {
    console.log(`Updating WhatsApp delivery status for ${messages.length} messages`);
    
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
    
    console.log(`Status distribution:`, statusGroups);

    const rows = messages.map(message => {
      const status = convertAckStatus(message.ack);
      return [
        message.id,           // AppointmentID
        null,                 // SentWa
        status,               // DeliveredWa
        null                  // WaMessageID
      ];
    });

    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SentWa', type: TYPES.Bit },
        { name: 'DeliveredWa', type: TYPES.NVarChar },
        { name: 'WaMessageID', type: TYPES.NVarChar }
      ],
      rows: rows
    };

    // Use transaction for atomic operation
    return TransactionManager.withTransaction([
      async (connection) => {
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
              console.log(`Status update summary: Total=${stats.totalUpdated}, Read=${stats.readCount}, Delivered=${stats.deliveredCount}, Server=${stats.serverCount}`);
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
      }
    ]);

  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Getting WhatsApp messages for date: ${date}`);
    
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
          const numbers = result.map(r => r.number);
          const messages = result.map(r => r.message);
          const ids = result.map(r => r.id);
          const names = result.map(r => r.name);
          
          console.log(`Retrieved ${result.length} WhatsApp messages for date ${date}`);
          
          if (result.length > 0) {
            // Log appointment time distribution for insights
            const timeGroups = {};
            result.forEach(r => {
              const hour = new Date(r.appTime).getHours();
              if (!timeGroups[hour]) timeGroups[hour] = 0;
              timeGroups[hour]++;
            });
            
            console.log(`Appointment distribution by hour:`, timeGroups);
            
            // Log sample messages for debugging
            const sampleCount = Math.min(3, result.length);
            for (let i = 0; i < sampleCount; i++) {
              const msgPreview = result[i].message.substring(0, 30) + '...';
              console.log(`Sample ${i + 1}: ID=${result[i].id}, Time=${new Date(result[i].appTime).toLocaleTimeString()}, Phone=${result[i].number}, Preview=${msgPreview}`);
            }
          }
          
          return [numbers, messages, ids, names];
        }
      );
    });
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
    return [[], [], [], []];
  });
}

/**
 * Enhanced updateWhatsAppStatus with transaction management
 */
export async function updateWhatsAppStatus(appointmentIds, messageIds) {
  const operationName = 'updateWhatsAppStatus';
  
  if (!appointmentIds || !appointmentIds.length) {
    console.log('No messages to update');
    return { success: true, updatedCount: 0 };
  }
  
  return dbCircuitBreaker.execute(async () => {
    console.log(`Updating WhatsApp status for ${appointmentIds.length} messages`);
    
    // Log sample IDs for debugging
    if (appointmentIds.length <= 5) {
      console.log(`Appointment IDs: ${appointmentIds.join(', ')}`);
      console.log(`Message IDs: ${messageIds.join(', ')}`);
    } else {
      console.log(`First few Appointment IDs: ${appointmentIds.slice(0, 3).join(', ')}... (${appointmentIds.length} total)`);
    }
    
    const rows = [];
    
    // Create table rows for the procedure
    for (let i = 0; i < appointmentIds.length; i++) {
      rows.push([
        appointmentIds[i],  // AppointmentID
        1,                  // SentWa - Set to 1 to mark as sent
        null,               // DeliveredWa - Not updated here
        messageIds[i]       // WaMessageID - Store the message ID
      ]);
    }

    // Table definition
    const tableDefinition = {
      columns: [
        { name: 'AppointmentID', type: TYPES.Int },
        { name: 'SentWa', type: TYPES.Bit },
        { name: 'DeliveredWa', type: TYPES.NVarChar },
        { name: 'WaMessageID', type: TYPES.NVarChar }
      ],
      rows: rows
    };

    // Execute with transaction
    return TransactionManager.withTransaction([
      async (connection) => {
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
            console.log(`Successfully updated ${updatedCount} message IDs in database`);
            
            return {
              success: true,
              updatedCount: updatedCount
            };
          }
        );
      }
    ]);
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Updating single message status: ${messageId} -> ${status}`);
    
    const statusText = convertAckStatus(status);
    
    return TransactionManager.withTransaction([
      async (connection) => {
        return executeStoredProcedureWithConnection(
          connection,
          'UpdateSingleMessageStatus',
          [
            ['MessageId', TYPES.NVarChar, messageId],
            ['Status', TYPES.NVarChar, statusText]
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
              console.log(`Successfully updated status for message ${messageId} (AppointmentID: ${appointment.appointmentId}, Patient: ${appointment.patientName})`);
              
              return {
                success: true,
                found: true,
                appointment
              };
            } else if (success) {
              console.log(`Successfully updated status for message ${messageId}`);
              return {
                success: true,
                found: true
              };
            } else {
              console.log(`Message ID ${messageId} not found in database`);
              return {
                success: true,
                found: false
              };
            }
          }
        );
      }
    ]);
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Getting WhatsApp delivery status for date: ${date}`);
    
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
          console.log(`Retrieved ${result.length} WhatsApp messages for status checking from date ${date}`);
          
          if (result.length > 0) {
            // Log the first few for debugging
            const sampleCount = Math.min(5, result.length);
            console.log(`Sample messages for status check (${sampleCount} of ${result.length}):`);
            for (let i = 0; i < sampleCount; i++) {
              console.log(`ID: ${result[i].id}, Message ID: ${result[i].wamid}`);
            }
          }
          
          return result;
        }
      );
    });
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Batch updating ${updates.length} message statuses`);
    
    // Group updates by status for insights
    const statusGroups = {};
    updates.forEach(update => {
      const status = convertAckStatus(update.status);
      if (!statusGroups[status]) statusGroups[status] = [];
      statusGroups[status].push(update);
    });

    console.log(`Batch update status distribution:`, Object.keys(statusGroups).reduce((acc, status) => {
      acc[status] = statusGroups[status].length;
      return acc;
    }, {}));

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
      console.log(`Broadcasted batch status update for ${updates.length} messages`);
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
    console.log(`Getting SMS messages for date: ${date}`);
    
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
        console.log(`Retrieved ${result.length} SMS messages for date ${date}`);
        return result;
      }
    );
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
    return [];
  });
}

export async function updateSmsIds(messages) {
  const operationName = 'updateSmsIds';
  
  return dbCircuitBreaker.execute(async () => {
    console.log(`Updating SMS IDs for ${messages.length} messages`);
    
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
        console.log(`Successfully updated SMS IDs for ${rows.length} messages`);
        return {
          success: true,
          updatedCount: rows.length
        };
      }
    );
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Getting SMS IDs for date: ${date}`);
    
    return executeStoredProcedure(
      'Procgetsids',
      [['ADate', TYPES.Date, date]],
      null,
      (columns) => ({
        id: columns[0].value,
        sid: columns[1].value
      }),
      (result) => {
        console.log(`Retrieved ${result.length} SMS IDs for status checking`);
        return result;
      }
    );
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
    return [];
  });
}

export async function updateSmsStatus(messages) {
  const operationName = 'updateSmsStatus';
  
  return dbCircuitBreaker.execute(async () => {
    console.log(`Updating SMS status for ${messages.length} messages`);
    
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
        console.log(`Successfully updated ${rows.length} SMS message statuses`);
        return {
          success: true,
          updatedCount: rows.length
        };
      }
    );
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
    console.log(`Getting message status summary for date: ${date}`);
    
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
        
        console.log(`Message status summary for ${date}: Total=${summary.total}, Sent=${summary.sent}, Read=${summary.read}`);
        
        return {
          date: date,
          summary: summary,
          messages: result
        };
      }
    );
    
  }, operationName).catch(error => {
    console.error(`Error in ${operationName}: ${error.message}`);
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
  console.log('Database circuit breaker has been manually reset');
  
  return {
    success: true,
    message: 'Circuit breaker reset successfully',
    newStatus: dbCircuitBreaker.getStatus()
  };
}