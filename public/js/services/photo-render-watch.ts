/**
 * Background photo-render watchdog — toasts the outcome of a photo-editor save
 * wherever the user is in the app. The save itself is a 202 + server-side
 * background render announced over the appointments SSE channel as
 * `photos_rendered`; GridComponent only refetches on that event (it deliberately
 * does NOT toast), so without this module a user who navigated anywhere else —
 * or whose render partially failed — would never hear the outcome.
 *
 * A job is matched by the id the CLIENT made and sent with the render (the server
 * echoes it in the event), and is registered BEFORE the request leaves: a render
 * whose slots all fail at once announces before the 202 is even parsed, and used to
 * be dropped and reported 105 s later as "taking longer than expected" (FE-F14-4).
 * The event names each photo that did not render and why; the toast says so.
 *
 * Plain module, not a React component: `window.toast` is installed by the
 * always-mounted ToastProvider, and the SSE singleton is refcounted, so a
 * connection is held only while a job is pending (one ensureConnected/release
 * pair per job). A server restart mid-render emits nothing — the per-job
 * timeout turns that into a "check the photos grid" warning instead of silence.
 */
import sseAppointments from './sse-appointments';
import { renderedEvent } from '@shared/contracts/photo-editor.contract';
import { invalidatePatientPhotos } from '@/query/photos';
import { viewLabel } from '@shared/photo-views';

interface RenderJob {
  jobId: string;
  personId: string;
  /** Slot count submitted — the toast's total when the event omits `total`. */
  slots: number;
  timer?: ReturnType<typeof setTimeout>;
  done: boolean;
}

const jobs = new Map<string, RenderJob>();
let listenerAttached = false;

/** How long `ready` may hold a save while the SSE stream opens. */
const CONNECT_WAIT_MS = 3000;

/** A job id the server accepts (`[A-Za-z0-9_-]{1,64}`). */
export function newRenderJobId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Idempotent per-job teardown (event, timeout and cancel can race). */
function settle(job: RenderJob): void {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timer);
  jobs.delete(job.jobId);
  sseAppointments.release();
  if (jobs.size === 0 && listenerAttached) {
    sseAppointments.off('photos_rendered', onPhotosRendered);
    listenerAttached = false;
  }
}

function onPhotosRendered(payload: unknown): void {
  const parsed = renderedEvent.safeParse(payload);
  if (!parsed.success) return;
  const p = parsed.data;
  const job = p.jobId ? jobs.get(p.jobId) : undefined;
  if (!job) return;
  settle(job);
  // Every screen showing this patient's photos (grid, Compare, slideshow, editor).
  void invalidatePatientPhotos(job.personId);
  const total = typeof p.total === 'number' ? p.total : job.slots;
  const written = typeof p.written === 'number' ? p.written : total;
  const problems = p.problems ?? [];
  if (written === 0) {
    window.toast?.error(
      `No photos were saved. ${problems.map((x) => `${viewLabel(x.view)}: ${x.reason}.`).join(' ')}`.trim(),
      10_000
    );
  } else if (problems.length > 0 || written < total) {
    window.toast?.warning(
      `Saved ${written} of ${total} photos. ${problems.map((x) => `${viewLabel(x.view)}: ${x.reason}.`).join(' ')}`.trim(),
      10_000
    );
  } else {
    window.toast?.success(`${written} photo${written === 1 ? '' : 's'} saved.`);
  }
}

/**
 * Track one background render. Call it BEFORE the /render request, with the same
 * `jobId` the request carries; `await ready` (bounded) so the SSE stream is open
 * when the request leaves, and `cancel()` if the request itself fails.
 */
export function watchRenderJob(opts: {
  jobId: string;
  personId: number | string;
  tpCode: number | string;
  slots: number;
}): { ready: Promise<void>; cancel: () => void } {
  const job: RenderJob = {
    jobId: opts.jobId,
    personId: String(opts.personId),
    slots: opts.slots,
    done: false,
  };
  job.timer = setTimeout(() => {
    if (job.done) return;
    window.toast?.warning('Photo save is taking longer than expected — check the photos grid.');
    settle(job);
    void invalidatePatientPhotos(job.personId);
  }, 90_000 + 15_000 * opts.slots);

  jobs.set(job.jobId, job);
  if (!listenerAttached) {
    sseAppointments.on('photos_rendered', onPhotosRendered);
    listenerAttached = true;
  }
  // One refcount per job (released in settle). A failed connect is fine — the
  // timeout above then provides the fallback outcome.
  const connected = sseAppointments.ensureConnected().catch(() => {});
  const ready = Promise.race([
    connected,
    new Promise<void>((resolve) => setTimeout(resolve, CONNECT_WAIT_MS)),
  ]);
  return { ready, cancel: () => settle(job) };
}
