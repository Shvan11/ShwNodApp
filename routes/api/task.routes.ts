/**
 * Task routes — the app-wide header surface of the `alerts` table.
 *
 * Reads (GET /api/tasks) return the header list (push tasks + escalated context
 * alerts). Creates (POST /api/tasks) insert a `surface_mode='push'` row, with the
 * owning patient + category optional. Edit / status / snooze are handled by the
 * shared `/api/alerts/:alertId*` endpoints in patient.routes.ts (they key on
 * alert_id, surface-agnostic). See shared/contracts/task.contract.ts.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ErrorResponses, sendSuccess, sendData } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as taskContract from '../../shared/contracts/task.contract.js';
import { getHeaderTasks, getAllTasks, createAlert, deleteTask } from '../../services/database/queries/alert-queries.js';
import { employeeIsActive } from '../../services/database/queries/employee-queries.js';
import { notifyTaskAssignment } from '../../services/messaging/task-notify.js';

const router = Router();

/**
 * GET /api/tasks — the header task list.
 */
router.get('/tasks', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const tasks = await getHeaderTasks();
    sendData(res, taskContract.tasks.response, tasks);
  } catch (error) {
    log.error('Error fetching header tasks:', error);
    ErrorResponses.internalError(res, 'Failed to fetch tasks', error as Error);
  }
});

/**
 * GET /api/tasks/history — the full task log: every push task in any state
 * (active/snoozed/done/dismissed). Lifecycle actions reuse the shared
 * PUT /api/alerts/:id/status; delete reuses DELETE /api/tasks/:id.
 */
router.get('/tasks/history', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const history = await getAllTasks();
    sendData(res, taskContract.tasksHistory.response, history);
  } catch (error) {
    log.error('Error fetching task log:', error);
    ErrorResponses.internalError(res, 'Failed to fetch task log', error as Error);
  }
});

/**
 * POST /api/tasks — create a header (push) task.
 */
router.post(
  '/tasks',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  validate({ body: taskContract.createTask.body }),
  async (
    req: Request<Record<string, never>, unknown, taskContract.CreateTaskBody>,
    res: Response
  ): Promise<void> => {
    try {
      const { personId, alertTypeId, alertSeverity, alertDetails, expiresAt, snoozedUntil, assignedTo } = req.body;

      // Quit employees can't be assigned new tasks — they're hidden everywhere
      // but Settings, so the picker won't offer them; this guards a stale/forged id.
      if (assignedTo != null && !(await employeeIsActive(assignedTo))) {
        ErrorResponses.badRequest(res, 'Cannot assign a task to an inactive (quit) employee');
        return;
      }

      await createAlert({
        person_id: personId ?? null,
        alert_type_id: alertTypeId ?? null,
        alert_severity: alertSeverity,
        alert_details: alertDetails,
        surface_mode: 'push',
        expires_at: expiresAt,
        snoozed_until: snoozedUntil,
        assigned_to: assignedTo ?? null,
      });

      // Notify the assignee over WhatsApp (fire-and-forget; never blocks/fails the create).
      if (assignedTo != null) {
        void notifyTaskAssignment(assignedTo, alertDetails);
      }

      sendSuccess(res, null, 'Task created successfully', 201);
    } catch (error) {
      log.error('Error creating task:', error);
      ErrorResponses.internalError(res, 'Failed to create task', error as Error);
    }
  }
);

/**
 * DELETE /api/tasks/:alertId — permanently delete a finished task from history.
 * Hard delete (CDC-propagated); the query refuses to touch status='active' rows.
 */
router.delete(
  '/tasks/:alertId',
  authenticate,
  authorize(['admin', 'secretary', 'doctor']),
  validate({ params: taskContract.deleteTask.params }),
  async (req: Request<{ alertId: string }>, res: Response): Promise<void> => {
    try {
      await deleteTask(parseInt(req.params.alertId, 10));
      sendSuccess(res, null, 'Task deleted');
    } catch (error) {
      log.error('Error deleting task:', error);
      ErrorResponses.internalError(res, 'Failed to delete task', error as Error);
    }
  }
);

export default router;
