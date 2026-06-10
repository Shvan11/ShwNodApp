/**
 * Background photo-render watchdog — toasts the outcome of a photo-editor save
 * wherever the user is in the app. The save itself is a 202 + server-side
 * background render announced over the appointments SSE channel as
 * `photos_rendered`; GridComponent only refetches on that event (it deliberately
 * does NOT toast), so without this module a user who navigated anywhere else —
 * or whose render partially failed — would never hear the outcome.
 *
 * Plain module, not a React component: `window.toast` is installed by the
 * always-mounted ToastProvider, and the SSE singleton is refcounted, so a
 * connection is held only while a job is pending (one ensureConnected/release
 * pair per job). A server restart mid-render emits nothing — the per-job
 * timeout turns that into a "check the photos grid" warning instead of silence.
 */
import sseAppointments from './sse-appointments';

interface RenderJob {
  personId: string;
  tpCode: string;
  /** Slot count submitted — the toast's total when the event omits `total`. */
  slots: number;
  timer: ReturnType<typeof setTimeout>;
  done: boolean;
}

const jobs = new Set<RenderJob>();
let listenerAttached = false;

/** Idempotent per-job teardown (event and timeout can race). */
function settle(job: RenderJob): void {
  if (job.done) return;
  job.done = true;
  clearTimeout(job.timer);
  jobs.delete(job);
  sseAppointments.release();
  if (jobs.size === 0 && listenerAttached) {
    sseAppointments.off('photos_rendered', onPhotosRendered);
    listenerAttached = false;
  }
}

function onPhotosRendered(payload: unknown): void {
  const p = payload as {
    personId?: number | string;
    tpCode?: number | string;
    tp_code?: number | string;
    written?: number;
    warnings?: number;
    total?: number;
  };
  const pid = String(p.personId);
  const tp = String(p.tpCode ?? p.tp_code);
  for (const job of [...jobs]) {
    if (job.personId !== pid || job.tpCode !== tp) continue;
    settle(job);
    const total = typeof p.total === 'number' ? p.total : job.slots;
    const written = typeof p.written === 'number' ? p.written : total;
    const warnings = typeof p.warnings === 'number' ? p.warnings : 0;
    if (warnings > 0 || written < total) {
      window.toast?.warning(
        `Photos saved with issues: ${written}/${total} saved` +
          (warnings > 0 ? `, ${warnings} photo(s) had problems.` : '.')
      );
    } else {
      window.toast?.success(`${written} photo${written === 1 ? '' : 's'} saved.`);
    }
  }
}

/**
 * Track one background render (call right after the /render 202). Toasts
 * success/warning when its `photos_rendered` event arrives, or a fallback
 * warning if nothing arrives within the (generous) per-job deadline.
 */
export function watchRenderJob(opts: {
  personId: number | string;
  tpCode: number | string;
  slots: number;
}): void {
  const job: RenderJob = {
    personId: String(opts.personId),
    tpCode: String(opts.tpCode),
    slots: opts.slots,
    done: false,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
  };
  job.timer = setTimeout(() => {
    if (job.done) return;
    window.toast?.warning('Photo save is taking longer than expected — check the photos grid.');
    settle(job);
  }, 90_000 + 15_000 * opts.slots);

  // Register + subscribe BEFORE awaiting the connection — small renders can
  // finish within a couple of seconds of the 202.
  jobs.add(job);
  if (!listenerAttached) {
    sseAppointments.on('photos_rendered', onPhotosRendered);
    listenerAttached = true;
  }
  // One refcount per job (released in settle). A failed connect is fine — the
  // timeout above then provides the fallback outcome.
  void sseAppointments.ensureConnected().catch(() => {});
}
