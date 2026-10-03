/**
 * Telegram share modal — pick a contact (or type a phone), then push the given
 * file(s) to it over Telegram.
 *
 * Mirrors the Send Message screen's recipient picker (patients' phones, staff, the
 * Google contact accounts from `shared/google-contacts-accounts.ts` + a searchable
 * dropdown + free-text phone), but is driven off a `ShareSource[]` like the
 * LocalSend modal so single + batch share are one code path.
 *
 * Big files upload for minutes, so the send is a BACKGROUND JOB: we POST to
 * start it (returns instantly with a job id, dodging the 30s request timeout),
 * then poll `/api/telegram/send/:jobId` to drive a per-file progress bar until
 * the job reports `done`. The poll keeps running in a hidden tab, and a 404 is
 * final (the server has forgotten the job); closing mid-upload hands the job to
 * `services/share-watch.ts`, which reports how it ends (FE-F14-6). All I/O goes
 * through the core/http funnel (reads carry `{ schema }`); the poll is
 * React-Query-managed, not local `useState`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Select, { type SingleValue, type StylesConfig } from 'react-select';
import { useQuery } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { GOOGLE_CONTACT_ACCOUNTS } from '@shared/google-contacts-accounts';
import { lostTrackMessage, watchTelegramJob } from '@/services/share-watch';
import {
  patientPhonesQuery,
  googleContactsQuery,
  employeesQuery,
  telegramStatusQuery,
  telegramSendProgressQuery,
} from '@/query/queries';
import * as telegram from '@shared/contracts/telegram.contract';
import type { ShareSource } from '../localsend/LocalSendShareModal';
import styles from './TelegramShareModal.module.css';

interface Props {
  open: boolean;
  sources: ShareSource[];
  onClose: () => void;
}

interface ContactData {
  id?: string | number;
  phone?: string;
  name?: string;
  text?: string;
  [key: string]: unknown;
}

interface ContactOption {
  value: string | number;
  label: string;
  phone: string;
}

/** 'pat' | 'emp', or a Google contact account id from the registry. */
type Source = string;

// The account labels come from the registry, not a copy here (FE-F14-11).
const SOURCES: ReadonlyArray<{ id: Source; label: string }> = [
  { id: 'pat', label: "Patients' Phones" },
  { id: 'emp', label: 'Employee Phones' },
  ...GOOGLE_CONTACT_ACCOUNTS.map((a) => ({ id: a.id, label: a.label })),
];

const selectStyles: StylesConfig<ContactOption, false> = {
  menu: (provided) => ({ ...provided, zIndex: 9999 }),
};

const TelegramShareModal = ({ open, sources, onClose }: Props) => {
  const toast = useToast();

  const [source, setSource] = useState<Source>('pat');
  const [selected, setSelected] = useState<ContactOption | null>(null);
  const [phone, setPhone] = useState('');
  const [starting, setStarting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  // Remembers the last job whose completion we already handled, so the repeated
  // progress polls don't re-toast/re-close. Job ids are unique (server uuid), so
  // a fresh send always differs from this — no reset needed across opens.
  const finalizedRef = useRef<string | null>(null);

  // Telegram availability — a status hiccup shouldn't block the UI, so a failed
  // read falls back to "enabled".
  const statusResult = useQuery({ ...telegramStatusQuery(), enabled: open });
  const enabled = statusResult.data?.enabled ?? true;

  // Poll the running job for per-file progress; stop once it reports `done`, or once
  // the server answers 404 (it has forgotten the job — final, not transient). The
  // poll keeps going in a hidden tab: React Query pauses it otherwise, and the server
  // dropped a finished job before the user came back (FE-F14-6a).
  const progressResult = useQuery({
    ...telegramSendProgressQuery(jobId ?? ''),
    enabled: !!jobId,
    retry: (count, err) => (err as HttpError)?.status !== 404 && count < 2,
    refetchInterval: (query) =>
      query.state.data?.status === 'done' || (query.state.error as HttpError | null)?.status === 404
        ? false
        : 800,
    refetchIntervalInBackground: true,
  });
  const progress = jobId ? progressResult.data : undefined;
  const done = progress?.status === 'done';
  const lost = !!jobId && (progressResult.error as HttpError | null)?.status === 404;

  // Contacts come from the patients' phone book (`pat`), the staff roster (`emp`),
  // or a Google contact group (`shw`/`cli`); only the active source fetches while
  // the modal is open.
  const phonesResult = useQuery({ ...patientPhonesQuery(), enabled: open && source === 'pat' });
  const employeesResult = useQuery({ ...employeesQuery(), enabled: open && source === 'emp' });
  const googleResult = useQuery({
    ...googleContactsQuery(source),
    enabled: open && source !== 'pat' && source !== 'emp',
  });
  const activeResult =
    source === 'pat' ? phonesResult : source === 'emp' ? employeesResult : googleResult;
  // Employees come back wrapped in `{ employees: [...] }` with `employee_name`;
  // the other sources are bare ContactData[] arrays — normalize to one shape.
  const contacts: ContactData[] =
    source === 'emp'
      ? (employeesResult.data?.employees ?? []).map((e) => ({
          id: e.id,
          name: e.employee_name,
          phone: e.phone ?? undefined,
        }))
      : ((activeResult.data ?? []) as ContactData[]);
  const options: ContactOption[] = contacts
    .filter((c) => c.phone)
    .map((c) => ({
      value: c.id ?? (c.phone as string),
      label: `${c.name || c.text || ''} - ${c.phone}`,
      phone: c.phone as string,
    }));

  // Reset all recipient + job state whenever the modal opens. Adjust-during-render
  // keyed on the open state so a fresh open re-seeds the picker without a
  // setState-in-effect bailout.
  const [openedKey, setOpenedKey] = useState(open);
  if (open !== openedKey) {
    setOpenedKey(open);
    if (open) {
      setSource('pat');
      setSelected(null);
      setPhone('');
      setStarting(false);
      setJobId(null);
    }
  }

  // Surface a contact-load failure (the status read intentionally stays silent).
  useEffect(() => {
    if (activeResult.isError) {
      toast.error(httpErrorMessage(activeResult.error, 'Failed to load contacts'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeResult.isError, activeResult.error]);

  // Fire once when a job finishes: a clean full success toasts + closes; a
  // partial/total failure stays on screen with its error list (handled below).
  useEffect(() => {
    if (!jobId || !done || !progress) return;
    if (finalizedRef.current === jobId) return;
    finalizedRef.current = jobId;
    if (progress.sent === progress.total) {
      toast.success(`Sent ${progress.sent} file(s) via Telegram`);
      onClose();
    }
  }, [jobId, done, progress, toast, onClose]);

  const handleSourceChange = (src: Source): void => {
    setSource(src);
    setSelected(null);
    setPhone('');
  };

  // Prefill the phone input with the contact's number AS STORED: the server's
  // formatter normalises every form (07…, 7…, +964…, 00964…). Prefixing '964' here
  // turned a stored `07…` into `9640750…`, which the server then kept (FE-F14-11).
  const handleSelect = (opt: SingleValue<ContactOption>): void => {
    setSelected(opt);
    setPhone(opt?.phone ?? '');
  };

  const handleSend = useCallback(async (): Promise<void> => {
    if (!phone.trim() || sources.length === 0 || starting || jobId) return;
    setStarting(true);
    try {
      const { jobId: id } = await postJSON<telegram.SendResponse>(
        '/api/telegram/send',
        { phone: phone.trim(), files: sources },
        { schema: telegram.send.response }
      );
      setJobId(id);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Telegram send failed'));
    } finally {
      setStarting(false);
    }
  }, [phone, sources, starting, jobId, toast]);

  // Back to the form to retry after a partial/failed send.
  const handleRetry = (): void => {
    setJobId(null);
    setStarting(false);
  };

  // Closing mid-upload does not stop it: the job is handed to the background watcher,
  // which toasts how it ends.
  const handleClose = (): void => {
    if (jobId && !done && !lost) watchTelegramJob(jobId, phone.trim() || 'the recipient');
    onClose();
  };

  if (!open) return null;

  const phase: 'form' | 'uploading' | 'result' | 'lost' =
    lost ? 'lost' : done && progress ? 'result' : jobId || starting ? 'uploading' : 'form';
  const pct = Math.round((progress?.fileProgress ?? 0) * 100);
  const index = Math.min(progress?.index || 1, progress?.total || sources.length);
  const total = progress?.total ?? sources.length;

  return (
    <Modal
      isOpen
      onClose={handleClose}
      ariaLabelledBy="telegram-share-title"
      contentClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <ModalHeader
        variant="info"
        titleId="telegram-share-title"
        icon={<i className="fab fa-telegram" aria-hidden="true" />}
        title="Share via Telegram"
        onClose={handleClose}
      />

      <div className={styles.body}>
        {phase === 'form' && (
          <>
            {!enabled && (
              <p className={styles.notice}>
                Telegram is not configured on the server. Set the Telegram API credentials and
                session to use it.
              </p>
            )}

            <span className={styles.subtle}>
              {sources.length === 1 ? '1 file' : `${sources.length} files`}
            </span>

            {/* Recipient source */}
            <select
              className={styles.sourceSelect}
              value={source}
              onChange={(e) => handleSourceChange(e.target.value)}
              disabled={!enabled}
              aria-label="Contacts from"
            >
              {SOURCES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>

            {/* Contact picker */}
            <Select<ContactOption, false>
              value={selected}
              onChange={handleSelect}
              options={options}
              isSearchable
              isClearable
              isDisabled={!enabled}
              placeholder="Search and select a contact…"
              aria-label="Contact"
              noOptionsMessage={() => 'No contacts found'}
              classNamePrefix="react-select"
              styles={selectStyles}
            />

            {/* Phone (editable, prefilled from the contact) */}
            <input
              className={styles.phoneInput}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number (e.g. 07XX XXX XXXX)"
              aria-label="Phone number"
              inputMode="tel"
              disabled={!enabled}
            />

            <div className={styles.footer}>
              <button type="button" className={styles.toolButton} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void handleSend()}
                disabled={!enabled || starting || !phone.trim()}
              >
                Send
              </button>
            </div>
          </>
        )}

        {phase === 'uploading' && (
          <>
            <div className={styles.progressWrap}>
              <div className={styles.progressTop}>
                <span className={styles.progressLabel}>
                  {total > 1 ? `Sending file ${index} of ${total}` : 'Sending file'}
                </span>
                <span className={styles.progressPct}>{pct}%</span>
              </div>
              <div className={styles.progressName} title={progress?.name}>
                {progress?.name || 'Preparing…'}
              </div>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label={progress?.name || 'Sending'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div className={styles.progressBar} style={{ width: `${pct}%` }} />
              </div>
              {(progress?.errors.length ?? 0) > 0 && (
                <span className={styles.progressErrors}>
                  {progress?.errors.length} failed so far
                </span>
              )}
              <span className={styles.subtle}>
                Closing this window doesn't stop the upload — you'll be told how it ends.
              </span>
            </div>

            <div className={styles.footer}>
              <button type="button" className={styles.toolButton} onClick={handleClose}>
                Close
              </button>
              <button type="button" className={styles.primaryButton} disabled>
                Sending…
              </button>
            </div>
          </>
        )}

        {phase === 'lost' && (
          <>
            <p className={styles.resultSummary} role="status">
              {lostTrackMessage(phone.trim() || 'the recipient')}
            </p>
            <div className={styles.footer}>
              <button type="button" className={styles.toolButton} onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}

        {phase === 'result' && progress && (
          <>
            <p className={styles.resultSummary} role="status">
              Sent {progress.sent} of {progress.total} file(s).
            </p>
            {progress.errors.length > 0 && (
              <ul className={styles.errorList}>
                {progress.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            <div className={styles.footer}>
              <button type="button" className={styles.toolButton} onClick={onClose}>
                Close
              </button>
              <button type="button" className={styles.primaryButton} onClick={handleRetry}>
                Try again
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default TelegramShareModal;
