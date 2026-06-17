/**
 * Telegram Routes — share patient files/images to a contact via Telegram.
 *
 * Auth-gated (mounted on the post-auth aggregator) and follows the shared-contract
 * pattern: `validate(...)` against the contract schemas, then `sendData(res,
 * <action>.response, data)`. The actual MTProto upload lives in the messaging
 * service (`services/messaging/telegram.ts`); these handlers resolve the client
 * `SendFileRef`s to safe disk paths (shared with LocalSend) and fan the recipient
 * phone out across them. Degrades cleanly when Telegram isn't configured.
 */
import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import config from '../../config/config.js';
import { ErrorResponses, sendData } from '../../utils/error-response.js';
import { validate } from '../../middleware/validate.js';
import { resolveShareRef } from '../../services/files/share-ref.js';
import { sendgramfile, getGramSession } from '../../services/messaging/telegram.js';
import { PhoneFormatter } from '../../utils/phoneFormatter.js';
import * as telegram from '../../shared/contracts/telegram.contract.js';

const router = Router();

/**
 * In-memory store of running/finished send jobs. A big-file upload can take
 * minutes — far past the global 30s request timeout — so the POST handler
 * starts the upload as a detached job and returns its id immediately; the
 * client polls GET /send/:jobId for per-file progress. Jobs live only in this
 * process (single Express instance) and are dropped after a short TTL once
 * finished (or an absolute backstop), so the map can't grow unbounded. Lost on
 * restart by design — same trade-off as the chair-display patient map.
 */
interface SendJob extends telegram.ProgressResponse {
  /** When the job was created — drives the absolute-age backstop sweep. */
  startedAt: number;
}

const sendJobs = new Map<string, SendJob>();
/** Hold a finished job this long so the final poll lands, then drop it. */
const JOB_TTL_MS = 60_000;
/** Absolute backstop so a stalled job can never leak its entry forever. */
const JOB_MAX_AGE_MS = 30 * 60_000;

/** Run the send loop for a job, updating it in place as each file uploads. */
async function runSendJob(
  jobId: string,
  job: SendJob,
  phone: string,
  files: telegram.SendBody['files']
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const ref = files[i];
    job.index = i + 1;
    job.fileProgress = 0;
    const fallbackName = ref.displayName || ref.ref;
    job.name = fallbackName;
    try {
      const { abs, name, size, fileType } = await resolveShareRef(ref);
      job.name = name;
      const result = await sendgramfile(phone, abs, {
        displayName: name,
        mimeType: fileType,
        size,
        onProgress: (fraction) => {
          job.fileProgress = Math.max(0, Math.min(1, fraction));
        },
      });
      if (result.result === 'OK') {
        job.sent += 1;
        job.fileProgress = 1;
      } else {
        job.errors.push(`${name}: ${result.error || 'send failed'}`);
      }
    } catch (err) {
      job.errors.push(`${fallbackName}: ${(err as Error).message}`);
    }
  }

  job.status = 'done';
  log.info('[Telegram] share complete', {
    phone,
    total: job.total,
    sent: job.sent,
    failed: job.errors.length,
  });
  setTimeout(() => sendJobs.delete(jobId), JOB_TTL_MS).unref();
}

/**
 * Telegram file-send needs the app credentials + a (runtime-managed) user
 * session. The session is re-authenticated from Settings → Integrations and
 * persisted in the `options` table, so check that — not the static env var.
 */
async function telegramEnabled(): Promise<boolean> {
  if (!config.telegram.apiId || !config.telegram.apiHash) return false;
  return Boolean(await getGramSession());
}

// GET /api/telegram/status — whether the server can send via Telegram.
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  sendData(res, telegram.status.response, { enabled: await telegramEnabled() });
});

// POST /api/telegram/send — start a background job to push the file(s) to one
// recipient phone, returning its id immediately (the upload is decoupled from
// the request so it isn't bound by the 30s request timeout).
router.post(
  '/send',
  validate({ body: telegram.send.body }),
  async (req: Request<object, object, telegram.SendBody>, res: Response): Promise<void> => {
    if (!(await telegramEnabled())) {
      ErrorResponses.badRequest(res, 'Telegram is not configured on the server');
      return;
    }

    const { phone, files } = req.body;
    const formattedPhone = PhoneFormatter.forTelegram(phone);
    if (!formattedPhone) {
      ErrorResponses.badRequest(res, 'A valid phone number is required');
      return;
    }

    // Sweep any jobs that overstayed their absolute backstop before adding one.
    const now = Date.now();
    for (const [id, j] of sendJobs) {
      if (now - j.startedAt > JOB_MAX_AGE_MS) sendJobs.delete(id);
    }

    const jobId = randomUUID();
    const job: SendJob = {
      status: 'running',
      total: files.length,
      sent: 0,
      index: 0,
      name: '',
      fileProgress: 0,
      errors: [],
      startedAt: now,
    };
    sendJobs.set(jobId, job);
    setTimeout(() => sendJobs.delete(jobId), JOB_MAX_AGE_MS).unref();

    // Detached: failures are captured into the job, never an unhandled rejection.
    void runSendJob(jobId, job, formattedPhone, files);

    sendData(res, telegram.send.response, { enabled: true, jobId, total: files.length });
  }
);

// GET /api/telegram/send/:jobId — current progress snapshot of a send job.
router.get(
  '/send/:jobId',
  validate({ params: telegram.progress.params }),
  (req: Request<telegram.ProgressParams>, res: Response): void => {
    const job = sendJobs.get(req.params.jobId);
    if (!job) {
      ErrorResponses.notFound(res, 'Send job');
      return;
    }
    sendData(res, telegram.progress.response, {
      status: job.status,
      total: job.total,
      sent: job.sent,
      index: job.index,
      name: job.name,
      fileProgress: job.fileProgress,
      errors: job.errors,
    });
  }
);

export default router;
