/**
 * Notify an assigned employee of a new task/alert over WhatsApp (fire-and-forget).
 *
 * Called from the task + alert routes the moment a row is freshly assigned to an
 * active employee. Looks up the employee's phone, formats it for WhatsApp, and
 * sends a short message. It NEVER throws and is not meant to be awaited in the
 * request path: a missing phone, a disconnected WhatsApp client, or a send failure
 * is logged and swallowed so task creation is never blocked or failed by messaging.
 */
import whatsapp from './whatsapp.js';
import PhoneFormatter from '../../utils/phoneFormatter.js';
import { getEmployeeContact } from '../database/queries/employee-queries.js';
import { log } from '../../utils/logger.js';

export async function notifyTaskAssignment(
  employeeId: number,
  taskDetails: string
): Promise<void> {
  try {
    const employee = await getEmployeeContact(employeeId);
    if (!employee) {
      log.warn('Task assignment: employee not found, skipping WhatsApp', { employeeId });
      return;
    }

    if (!employee.phone || employee.phone.trim() === '') {
      log.warn('Task assignment: employee has no phone, skipping WhatsApp', { employeeId });
      return;
    }

    if (!whatsapp.isReady()) {
      log.warn('Task assignment: WhatsApp not connected, skipping notification', { employeeId });
      return;
    }

    const phoneNumber = PhoneFormatter.forWhatsApp(employee.phone, '964');
    if (!PhoneFormatter.isValid(phoneNumber, '964')) {
      log.warn('Task assignment: invalid employee phone, skipping WhatsApp', {
        employeeId,
        phone: employee.phone,
      });
      return;
    }

    const message = `Shwan Orthodontics

A new task has been assigned to you:
${taskDetails}`;

    const result = await whatsapp.sendMessage(phoneNumber, message, employee.employee_name);
    if (result.success) {
      log.info('Task assignment WhatsApp sent', { employeeId, messageId: result.messageId });
    } else {
      log.warn('Task assignment WhatsApp failed', { employeeId, error: result.error });
    }
  } catch (error) {
    log.error('Task assignment notification error', {
      employeeId,
      error: (error as Error).message,
    });
  }
}
