/**
 * Finishes reporting a share whose dialog was closed while it was still running.
 *
 * LocalSend transfers and Telegram uploads run on the server and can take minutes
 * (a receiver's Accept prompt, a big file). Closing either dialog used to drop all
 * news of them: the user could not tell whether the patient got the files, and a
 * second send duplicated them (FE-F14-6). The dialogs now hand an unsettled share to
 * this module, which polls it — from a plain module, so it outlives the dialog — and
 * toasts how it ended, wherever the user is by then.
 *
 * A 404 is FINAL here, not transient: the server forgets a share after a restart or
 * once it has been settled for a while, and polling on would spin forever.
 */
import { fetchJSON, type HttpError } from '@/core/http';
import * as localsendContract from '@shared/contracts/localsend.contract';
import * as telegramContract from '@shared/contracts/telegram.contract';

const POLL_MS = 2000;
/** Give up (and say so) after this long. */
const MAX_WATCH_MS = 60 * 60 * 1000;

const watched = new Set<string>();

/** The message for a share the server no longer knows about. */
export const lostTrackMessage = (recipient: string): string =>
  `Lost track of the send to ${recipient} (the server may have restarted). Check with the recipient before sending again.`;

const is404 = (err: unknown): boolean => (err as HttpError)?.status === 404;

function poll(key: string, tick: () => Promise<boolean>): void {
  if (watched.has(key)) return;
  watched.add(key);
  const started = Date.now();
  const step = async (): Promise<void> => {
    let done: boolean;
    try {
      done = await tick();
    } catch {
      done = false; // a transport blip — try again
    }
    if (done || Date.now() - started > MAX_WATCH_MS) {
      watched.delete(key);
      return;
    }
    setTimeout(() => void step(), POLL_MS);
  };
  void step();
}

/** Report how a LocalSend transfer ends, after its dialog closed. */
export function watchLocalSendTransfer(id: string, deviceAlias: string): void {
  poll(`localsend:${id}`, async () => {
    try {
      const t = await fetchJSON<localsendContract.TransferStatus>(`/api/localsend/transfers/${encodeURIComponent(id)}`, {
        schema: localsendContract.transfer.response,
      });
      switch (t.status) {
        case 'completed':
          window.toast?.success(`Sent to ${t.deviceAlias}.`);
          return true;
        case 'declined':
          window.toast?.error(`${t.deviceAlias} declined the files.`);
          return true;
        case 'failed':
          window.toast?.error(`Sending to ${t.deviceAlias} failed: ${t.error || 'transfer error'}`, 10_000);
          return true;
        case 'canceled':
          return true;
        case 'pin-required':
          window.toast?.warning(`${t.deviceAlias} asked for a PIN — share again to enter it.`, 10_000);
          return true;
        default:
          return false;
      }
    } catch (err) {
      if (!is404(err)) throw err;
      window.toast?.warning(lostTrackMessage(deviceAlias), 10_000);
      return true;
    }
  });
}

/** Report how a Telegram upload ends, after its dialog closed. */
export function watchTelegramJob(jobId: string, recipient: string): void {
  poll(`telegram:${jobId}`, async () => {
    try {
      const p = await fetchJSON<telegramContract.ProgressResponse>(
        `/api/telegram/send/${encodeURIComponent(jobId)}`,
        { schema: telegramContract.progress.response }
      );
      if (p.status !== 'done') return false;
      if (p.errors.length === 0) {
        window.toast?.success(`Sent ${p.sent} file${p.sent === 1 ? '' : 's'} to ${recipient} on Telegram.`);
      } else {
        window.toast?.warning(
          `Telegram: sent ${p.sent} of ${p.total} to ${recipient}. ${p.errors.join(' · ')}`,
          10_000
        );
      }
      return true;
    } catch (err) {
      if (!is404(err)) throw err;
      window.toast?.warning(lostTrackMessage(recipient), 10_000);
      return true;
    }
  });
}
