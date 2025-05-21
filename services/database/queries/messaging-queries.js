/**
 * Messaging Queries Module
 * Provides functions for WhatsApp and SMS messaging database operations
 */
import { Connection, Request, TYPES } from 'tedious';

import { executeQuery, executeStoredProcedure } from '../index.js';

/**
 * Updates WhatsApp delivery status
 * @param {Array<Object>} messages - Array of message objects with id, ack properties
 * @returns {Promise<Object>} - A promise that resolves with results of the update operation
 */
export function updateWhatsAppDeliveryStatus(messages) {
  // Add detailed logging
  console.log(`Updating WhatsApp delivery status for ${messages.length} messages`);
  
  // Log individual message IDs at debug level
  if (messages.length <= 10) {
    console.log(`Message IDs: ${messages.map(m => m.id).join(', ')}`);
  } else {
    console.log(`First few message IDs: ${messages.slice(0, 5).map(m => m.id).join(', ')}... (${messages.length} total)`);
  }

  const rows = messages.map(message => {
    const status = convertAckStatus(message.ack);
    console.log(`Message ${message.id}: Status ${message.ack} → "${status}"`);
    
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

  // Call the new optimized stored procedure
  return executeStoredProcedure(
    'UpdateWhatsAppDeliveryStatus',  // New optimized procedure
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
      } else {
        console.log(`Successfully updated ${rows.length} message statuses`);
      }
      
      return {
        success: true,
        updatedCount: rows.length,
        stats: result && result.length > 0 ? result[0] : null
      };
    }
  ).catch(error => {
    console.error(`Error updating WhatsApp delivery status: ${error.message}`);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Helper function to convert WhatsApp acknowledgment status codes to text
 * @param {number} ack - The acknowledgment status code
 * @returns {string} - The text representation of the status
 */
function convertAckStatus(ack) {
  // Based on your ProcDeliveredWa procedure
  switch (ack) {
    case -1:
      return 'ERROR';     // Error state
    case 0:
      return 'PENDING';   // Message pending
    case 1:
      return 'SERVER';    // Message received by server
    case 2:
      return 'DEVICE';    // Message received by device
    case 3:
      return 'READ';      // Message read
    case 4:
      return 'PLAYED';    // Message played (for voice messages)
    default:
      console.warn(`Unknown WhatsApp status code: ${ack}`);
      return `UNKNOWN_${ack}`;
  }
}

/**
 * Gets WhatsApp messages to send for a specific date
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of [numbers, messages, ids, names]
 */
export function getWhatsAppMessages(date) {
  console.log(`Getting WhatsApp messages for date: ${date}`);
  
  // Call the new optimized stored procedure
  return executeStoredProcedure(
    'GetWhatsAppMessagesToSend',  // New procedure 
    [['ADate', TYPES.Date, date]],
    null,
    (columns) => {
      if (columns.length >= 5) {
        return {
          id: columns[0].value,
          number: columns[1].value,
          name: columns[2].value,
          message: columns[3].value,
          appTime: columns[4].value  // New field for better logging
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
        // Group by appointment hour for better scheduling insights
        const timeGroups = {};
        result.forEach(r => {
          const hour = new Date(r.appTime).getHours();
          if (!timeGroups[hour]) timeGroups[hour] = 0;
          timeGroups[hour]++;
        });
        
        console.log(`Appointment distribution by hour: ${JSON.stringify(timeGroups)}`);
        
        // Log sample messages
        const sampleCount = Math.min(3, result.length);
        for (let i = 0; i < sampleCount; i++) {
          const msgPreview = result[i].message.substring(0, 30) + '...';
          console.log(`ID: ${result[i].id}, Time: ${new Date(result[i].appTime).toLocaleTimeString()}, Phone: ${result[i].number}, Preview: ${msgPreview}`);
        }
      }
      
      return [numbers, messages, ids, names];
    }
  ).catch(error => {
    console.error(`Error getting WhatsApp messages for date ${date}: ${error.message}`);
    return [[], [], [], []];
  });
}

/**
 * Updates WhatsApp message status after sending
 * @param {Array<number>} appointmentIds - Array of appointment IDs
 * @param {Array<string>} messageIds - Array of WhatsApp message IDs
 * @returns {Promise<Object>} - A promise that resolves with results
 */
export function updateWhatsAppStatus(appointmentIds, messageIds) {
  if (!appointmentIds || !appointmentIds.length) {
    console.log('No messages to update');
    return Promise.resolve({ success: true, updatedCount: 0 });
  }
  
  console.log(`Updating WhatsApp status for ${appointmentIds.length} messages`);
  
  // Log the first few IDs for debugging
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

  // Execute the stored procedure (using the enhanced version)
  return executeStoredProcedure(
    'UpdateWhatsAppStatus',  // Enhanced version of ProcWAResult
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
  ).catch(error => {
    console.error(`Error updating WhatsApp status: ${error.message}`);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Update delivery status for a single message
 * @param {string} messageId - WhatsApp message ID
 * @param {number} status - Status code
 * @returns {Promise<Object>} - A promise that resolves with update result
 */
export function updateSingleMessageStatus(messageId, status) {
  console.log(`Updating single message status: ${messageId} -> ${status}`);
  
  const statusText = convertAckStatus(status);
  
  return executeStoredProcedure(
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
  ).catch(error => {
    console.error(`Error updating single message status: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  });
}

/**
 * Get message status information for a specific date
 * @param {string} date - The date to get status for (YYYY-MM-DD format)
 * @returns {Promise<Object>} - A promise that resolves with status information
 */
export function getMessageStatusByDate(date) {
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
  ).catch(error => {
    console.error(`Error getting message status for date ${date}: ${error.message}`);
    return {
      date: date,
      error: error.message,
      summary: { total: 0, sent: 0, delivered: 0, read: 0, failed: 0 },
      messages: []
    };
  });
}

/**
 * Get delivery status analytics for a date range
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format (default: today)
 * @returns {Promise<Object>} - A promise that resolves with analytics data
 */
export function getDeliveryStatusAnalytics(startDate, endDate = new Date().toISOString().split('T')[0]) {
  console.log(`Getting delivery status analytics from ${startDate} to ${endDate}`);
  
  return executeStoredProcedure(
    'GetMessageStatusAnalytics',
    [
      ['StartDate', TYPES.Date, startDate],
      ['EndDate', TYPES.Date, endDate]
    ],
    null,
    null,
    (resultSets) => {
      if (!resultSets || resultSets.length < 2) {
        return {
          success: false,
          error: 'Incomplete analytics data received'
        };
      }
      
      const overallStats = resultSets[0][0]; // First result set, first row
      const dailyStats = resultSets[1];      // Second result set
      
      console.log(`Analytics summary: Messages=${overallStats.TotalMessages}, Sent=${overallStats.SentCount}, Read=${overallStats.ReadCount} (${overallStats.ReadPercentage}%)`);
      
      return {
        success: true,
        dateRange: {
          start: startDate,
          end: endDate
        },
        overall: overallStats,
        daily: dailyStats
      };
    }
  ).catch(error => {
    console.error(`Error getting delivery status analytics: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  });
}

/**
 * Gets WhatsApp messages for delivery status checking
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of WhatsApp message objects
 */
export function getWhatsAppDeliveryStatus(date) {
  console.log(`Getting WhatsApp delivery status for date: ${date}`);
  
  // Call the ProcFetch stored procedure
  return executeStoredProcedure(
    'ProcFetch',  // Using the existing procedure
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
  ).catch(error => {
    console.error(`Error getting WhatsApp delivery status for date ${date}: ${error.message}`);
    return [];
  });
}

/**
 * Gets SMS messages to send for a specific date
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of SMS message objects
 */
export function getSmsMessages(date) {
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
  ).catch(error => {
    console.error(`Error getting SMS messages for date ${date}: ${error.message}`);
    return [];
  });
}

/**
 * Updates SMS message IDs after sending
 * @param {Array<Object>} messages - Array of message objects with id, sid properties
 * @returns {Promise<Object>} - A promise that resolves when the update is complete
 */
export function updateSmsIds(messages) {
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
  ).catch(error => {
    console.error(`Error updating SMS IDs: ${error.message}`);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}

/**
 * Gets SMS message IDs for status checking
 * @param {Date} date - The date to get SMS IDs for
 * @returns {Promise<Array>} - A promise that resolves with an array of SMS ID objects
 */
export function getSmsIds(date) {
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
  ).catch(error => {
    console.error(`Error getting SMS IDs for date ${date}: ${error.message}`);
    return [];
  });
}

/**
 * Updates SMS message status after checking
 * @param {Array<Object>} messages - Array of message objects with id, status properties
 * @returns {Promise<Object>} - A promise that resolves when the update is complete
 */
export function updateSmsStatus(messages) {
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
  ).catch(error => {
    console.error(`Error updating SMS status: ${error.message}`);
    return {
      success: false,
      error: error.message,
      updatedCount: 0
    };
  });
}