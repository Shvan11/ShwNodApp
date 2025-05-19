// services/database/queries/messaging-queries.js
import { executeQuery, executeStoredProcedure, TYPES } from '../index.js';

/**
 * Gets WhatsApp messages to send for a specific date
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of [numbers, messages, ids, names]
 */
export function getWhatsAppMessages(date) {
  return executeStoredProcedure(
    'ProcWhatsAPP',
    [['ADate', TYPES.Date, date]],
    null,
    (columns) => ({
      id: columns[0].value,
      number: columns[1].value,
      name: columns[2].value,
      message: columns[3].value
    }),
    (result) => {
      // Transform the results into the expected format
      const numbers = result.map(r => r.number);
      const messages = result.map(r => r.message);
      const ids = result.map(r => r.id);
      const names = result.map(r => r.name);
      return [numbers, messages, ids, names];
    }
  );
}

/**
 * Updates WhatsApp message status
 * @param {Array<number>} appointmentIds - Array of appointment IDs
 * @param {Array<string>} messageIds - Array of WhatsApp message IDs
 * @returns {Promise<void>} - A promise that resolves when the update is complete
 */
export function updateWhatsAppStatus(appointmentIds, messageIds) {
  const rows = [];
  
  // Create table rows
  for (let i = 0; i < appointmentIds.length; i++) {
    rows.push([
      appointmentIds[i],  // AppointmentID
      1,                  // SentWa
      null,               // DeliveredWa
      messageIds[i]       // WaMessageID
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

  // Execute the stored procedure
  return executeStoredProcedure(
    'ProcWAResult',
    [['AIDS', TYPES.TVP, tableDefinition]],
    null,
    null,
    () => {} // Just resolve with no data
  );
}

/**
 * Gets WhatsApp messages for delivery status checking
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of WhatsApp message objects
 */
export function getWhatsAppDeliveryStatus(date) {
  return executeStoredProcedure(
    'ProcFetch',
    [['ADate', TYPES.Date, date]],
    null,
    (columns) => ({
      id: columns[0].value,
      num: columns[1].value,
      wamid: columns[2].value
    })
  );
}

/**
 * Updates WhatsApp delivery status
 * @param {Array<Object>} messages - Array of message objects with id, ack properties
 * @returns {Promise<void>} - A promise that resolves when the update is complete
 */
export function updateWhatsAppDeliveryStatus(messages) {
  const rows = messages.map(message => [
    message.id,           // AppointmentID
    null,                 // SentWa
    convertAckStatus(message.ack), // DeliveredWa
    null                  // WaMessageID
  ]);

  const tableDefinition = {
    columns: [
      { name: 'AppointmentID', type: TYPES.Int },
      { name: 'SentWa', type: TYPES.Bit },
      { name: 'DeliveredWa', type: TYPES.NVarChar },
      { name: 'WaMessageID', type: TYPES.NVarChar }
    ],
    rows: rows
  };

  return executeStoredProcedure(
    'ProcDeliveredWa',
    [['AIDS', TYPES.TVP, tableDefinition]],
    null,
    null,
    () => {}
  );
}

/**
 * Gets SMS messages to send for a specific date
 * @param {Date} date - The date to get messages for
 * @returns {Promise<Array>} - A promise that resolves with an array of SMS message objects
 */
export function getSmsMessages(date) {
  return executeStoredProcedure(
    'ProcSMS',
    [['ADate', TYPES.Date, date]],
    null,
    (columns) => ({
      id: columns[0].value,
      to: columns[1].value,
      body: columns[2].value
    })
  );
}

/**
 * Updates SMS message IDs after sending
 * @param {Array<Object>} messages - Array of message objects with id, sid properties
 * @returns {Promise<void>} - A promise that resolves when the update is complete
 */
export function updateSmsIds(messages) {
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
    () => {}
  );
}

/**
 * Gets SMS message IDs for status checking
 * @param {Date} date - The date to get SMS IDs for
 * @returns {Promise<Array>} - A promise that resolves with an array of SMS ID objects
 */
export function getSmsIds(date) {
  return executeStoredProcedure(
    'Procgetsids',
    [['ADate', TYPES.Date, date]],
    null,
    (columns) => ({
      id: columns[0].value,
      sid: columns[1].value
    })
  );
}

/**
 * Updates SMS message status after checking
 * @param {Array<Object>} messages - Array of message objects with id, status properties
 * @returns {Promise<void>} - A promise that resolves when the update is complete
 */
export function updateSmsStatus(messages) {
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
    () => {}
  );
}

/**
 * Helper function to convert WhatsApp acknowledgment status codes to text
 * @param {number} ack - The acknowledgment status code
 * @returns {string} - The text representation of the status
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
      return ack.toString();
  }
}