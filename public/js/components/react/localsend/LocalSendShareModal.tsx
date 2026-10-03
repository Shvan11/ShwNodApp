/**
 * LocalSend share modal — pick a LAN device, then push the given file(s) to it.
 *
 * Rendered by every share entry point (the photo lightbox, Files, Compare) through
 * `ShareSheet`, driven entirely off a `ShareSource[]` so single + batch are one code
 * path. The server does the discovery/upload; this modal lists devices, fires the
 * transfer, and polls its status. All I/O goes through the core/http funnel
 * (reads carry `{ schema }`; mutations get CSRF for free).
 *
 * The device list is a React Query read, made the moment the dialog mounts. It used
 * to be started by an adjust-during-render block keyed on a change of `open` — and
 * ShareSheet mounts this modal already open, so it never ran: every share opened on
 * "No devices found yet" until Rescan (FE-F14-1, a regression from 2026-06-15).
 *
 * Closing the dialog does NOT stop a transfer; `services/share-watch.ts` then
 * reports how it ended (FE-F14-6). Cancel is the button that stops one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { fetchJSON, postJSON, httpErrorMessage, type HttpError } from '@/core/http';
import { qk } from '@/query/keys';
import { localsendDevicesQuery } from '@/query/queries';
import { lostTrackMessage, watchLocalSendTransfer } from '@/services/share-watch';
import * as localsend from '@shared/contracts/localsend.contract';
import type {
  LocalSendDevice,
  TransferStatus,
  SendFileRef,
} from '@shared/contracts/localsend.contract';
import styles from './LocalSendShareModal.module.css';

export type ShareSource = SendFileRef;

interface Props {
  open: boolean;
  sources: ShareSource[];
  onClose: () => void;
}

const TERMINAL: ReadonlyArray<TransferStatus['status']> = [
  'completed',
  'declined',
  'failed',
  'canceled',
];

function deviceIcon(type?: string): string {
  switch (type) {
    case 'mobile':
      return 'fa-mobile-screen';
    case 'desktop':
      return 'fa-display';
    case 'web':
      return 'fa-globe';
    case 'server':
      return 'fa-server';
    case 'headless':
      return 'fa-terminal';
    default:
      return 'fa-laptop';
  }
}

const LocalSendShareModal = ({ open, sources, onClose }: Props) => {
  const toast = useToast();
  const queryClient = useQueryClient();

  const devicesQ = useQuery({ ...localsendDevicesQuery(), enabled: open });
  const enabled = devicesQ.data?.enabled ?? true;
  const [probed, setProbed] = useState<LocalSendDevice[]>([]);
  const devices: LocalSendDevice[] = [
    ...probed,
    ...(devicesQ.data?.devices ?? []).filter((d) => !probed.some((p) => p.fingerprint === d.fingerprint)),
  ];
  const [rescanning, setRescanning] = useState(false);
  const loadingDevices = devicesQ.isFetching || rescanning;
  const [ip, setIp] = useState('');
  const [probing, setProbing] = useState(false);

  // Active transfer (null until a device is picked).
  const [transfer, setTransfer] = useState<TransferStatus | null>(null);
  // The server no longer knows the transfer (restart, or pruned) — final.
  const [lost, setLost] = useState(false);
  const [pendingDevice, setPendingDevice] = useState<LocalSendDevice | null>(null);
  const [pin, setPin] = useState('');
  const transferIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (devicesQ.error) toast.error(httpErrorMessage(devicesQ.error, 'Could not load LAN devices'));
  }, [devicesQ.error, toast]);

  // Rescan: solicit fresh announcements, then read once more a moment later — the
  // `?rescan=1` answer comes back before the new announce has its replies.
  const rescan = useCallback(async (): Promise<void> => {
    setRescanning(true);
    try {
      const res = await fetchJSON<localsend.DevicesResponse>('/api/localsend/devices?rescan=1', {
        schema: localsend.devices.response,
      });
      queryClient.setQueryData(qk.localsend.devices(), res);
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: qk.localsend.devices() }), 1500);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not load LAN devices'));
    } finally {
      setRescanning(false);
    }
  }, [queryClient, toast]);

  // Poll the active transfer ~every second until it settles. `pin-required` is
  // settled server-side too — a PIN retry starts a NEW transfer — so don't keep
  // polling. A 404 is final: the server has forgotten the transfer (FE-F14-6b).
  useEffect(() => {
    const id = transferIdRef.current;
    if (!id || lost) return;
    if (transfer && (TERMINAL.includes(transfer.status) || transfer.status === 'pin-required'))
      return;

    const tick = async (): Promise<void> => {
      try {
        const status = await fetchJSON<TransferStatus>(`/api/localsend/transfers/${id}`, {
          schema: localsend.transfer.response,
        });
        setTransfer(status);
      } catch (err) {
        if ((err as HttpError)?.status === 404) setLost(true);
        /* anything else is transient — keep polling */
      }
    };
    const handle = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(handle);
  }, [transfer, lost]);

  const startTransfer = useCallback(
    async (device: LocalSendDevice, withPin?: string): Promise<void> => {
      setPendingDevice(device);
      try {
        const { transferId } = await postJSON<{ transferId: string }>(
          '/api/localsend/send',
          { deviceId: device.fingerprint, pin: withPin, files: sources },
          { schema: localsend.send.response }
        );
        transferIdRef.current = transferId;
        // Seed an initial "pending" status so the poll effect engages.
        setTransfer({
          id: transferId,
          status: 'pending',
          deviceAlias: device.alias,
          files: sources.map((s) => ({
            name: s.displayName || s.ref,
            status: 'pending',
            sentBytes: 0,
            totalBytes: 0,
          })),
        });
      } catch (err) {
        setPendingDevice(null);
        toast.error(httpErrorMessage(err, 'Failed to start transfer'));
      }
    },
    [sources, toast]
  );

  const handleProbe = useCallback(async (): Promise<void> => {
    const target = ip.trim();
    if (!target) return;
    setProbing(true);
    try {
      const { device } = await postJSON<{ device: LocalSendDevice }>(
        '/api/localsend/probe',
        { ip: target },
        { schema: localsend.probe.response }
      );
      setProbed((prev) => [device, ...prev.filter((d) => d.fingerprint !== device.fingerprint)]);
      setIp('');
      toast.success(`Added ${device.alias}`);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Could not reach that device'));
    } finally {
      setProbing(false);
    }
  }, [ip, toast]);

  const cancelTransfer = useCallback(async (): Promise<void> => {
    const id = transferIdRef.current;
    if (!id) return;
    try {
      await postJSON('/api/localsend/transfers/' + id + '/cancel', {}, { schema: localsend.cancel.response });
    } catch {
      /* best effort */
    }
    transferIdRef.current = null;
    setTransfer(null);
    setPendingDevice(null);
  }, []);

  // Surface a settled transfer as a toast; on a full (100%) success, let the
  // user see the ✓ for a beat, then auto-close (the toast persists as proof).
  useEffect(() => {
    if (!transfer) return;
    if (transfer.status === 'completed') {
      toast.success(`Sent to ${transfer.deviceAlias}`);
      const handle = window.setTimeout(onClose, 1200);
      return () => window.clearTimeout(handle);
    }
    if (transfer.status === 'declined') toast.error(`${transfer.deviceAlias} declined the files`);
    else if (transfer.status === 'failed') toast.error(transfer.error || 'Transfer failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.status]);

  const inTransfer = transfer !== null;
  const settled = lost || (transfer ? TERMINAL.includes(transfer.status) : false);

  // Closing never cancels (Cancel does): a transfer still in flight is handed to the
  // background watcher, which reports how it ends.
  const handleClose = (): void => {
    const id = transferIdRef.current;
    if (id && transfer && !settled && transfer.status !== 'pin-required') {
      watchLocalSendTransfer(id, transfer.deviceAlias);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <Modal
      isOpen
      onClose={handleClose}
      ariaLabelledBy="localsend-title"
      contentClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <ModalHeader
        variant="info"
        titleId="localsend-title"
        icon={<i className="fas fa-share-nodes" aria-hidden="true" />}
        title="Share to device"
        onClose={handleClose}
      />

      {!enabled && (
        <p className={styles.notice}>
          LocalSend is disabled on the server. Set <code>LOCALSEND_ENABLED=true</code> to use it.
        </p>
      )}

      {/* ── Device picker ── */}
      {enabled && !inTransfer && (
        <>
          <div className={styles.pickerHeader}>
            <span className={styles.subtle}>
              {sources.length === 1 ? '1 file' : `${sources.length} files`}
            </span>
            <button
              type="button"
              className={styles.linkButton}
              onClick={() => void rescan()}
              disabled={loadingDevices}
            >
              <i className="fas fa-rotate" aria-hidden="true" /> Rescan
            </button>
          </div>

          <ul className={styles.deviceList}>
            {devices.length === 0 && (
              <li className={styles.empty}>
                {loadingDevices ? 'Scanning…' : 'No devices found yet. Try Rescan or Add by IP.'}
              </li>
            )}
            {devices.map((d) => (
              <li key={d.fingerprint}>
                <button
                  type="button"
                  className={styles.deviceRow}
                  onClick={() => void startTransfer(d)}
                >
                  <i className={`fas ${deviceIcon(d.deviceType)}`} aria-hidden="true" />
                  <span className={styles.deviceName}>{d.alias}</span>
                  <span className={styles.deviceMeta}>{d.ip}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className={styles.ipRow}>
            <input
              className={styles.ipInput}
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleProbe();
              }}
              placeholder="Add by IP (e.g. 192.168.1.42)"
              aria-label="Device IP address"
              inputMode="decimal"
            />
            <button
              type="button"
              className={styles.toolButton}
              onClick={() => void handleProbe()}
              disabled={probing || !ip.trim()}
            >
              {probing ? 'Adding…' : 'Add'}
            </button>
          </div>
        </>
      )}

      {/* ── Transfer progress ── */}
      {enabled && inTransfer && transfer && (
        <div className={styles.transfer}>
          {transfer.status === 'pin-required' ? (
            <>
              <p>{transfer.deviceAlias} needs a PIN.</p>
              <div className={styles.ipRow}>
                <input
                  className={styles.ipInput}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="PIN"
                  aria-label={`PIN for ${transfer.deviceAlias}`}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => pendingDevice && void startTransfer(pendingDevice, pin)}
                  disabled={!pin.trim() || !pendingDevice}
                >
                  Send
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.transferHead} role="status" aria-live="polite">
                {lost
                  ? lostTrackMessage(transfer.deviceAlias)
                  : <>
                      {transfer.status === 'pending' && `Waiting for ${transfer.deviceAlias} to accept…`}
                      {transfer.status === 'sending' && `Sending to ${transfer.deviceAlias}…`}
                      {transfer.status === 'completed' && `Sent to ${transfer.deviceAlias} ✓`}
                      {transfer.status === 'declined' && `${transfer.deviceAlias} declined`}
                      {transfer.status === 'failed' && `Failed: ${transfer.error || 'transfer error'}`}
                      {transfer.status === 'canceled' && 'Canceled'}
                    </>}
              </p>
              <ul className={styles.fileList}>
                {transfer.files.map((f, i) => {
                  const pct = f.totalBytes
                    ? Math.min(100, Math.round((f.sentBytes / f.totalBytes) * 100))
                    : f.status === 'completed'
                      ? 100
                      : 0;
                  return (
                    <li key={i} className={styles.fileRow}>
                      <span className={styles.fileName}>{f.name}</span>
                      <span
                        className={styles.progressTrack}
                        role="progressbar"
                        aria-label={f.name}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                      >
                        <span className={styles.progressBar} style={{ width: `${pct}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              {!settled && (
                <p className={styles.subtle}>Closing this window doesn't stop the transfer — you'll be told how it ends.</p>
              )}
            </>
          )}

          <div className={styles.transferActions}>
            {!settled && transfer.status !== 'pin-required' && (
              <button type="button" className={styles.toolButton} onClick={() => void cancelTransfer()}>
                Cancel
              </button>
            )}
            {(settled || transfer.status === 'pin-required') && (
              <button type="button" className={styles.toolButton} onClick={handleClose}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {(!enabled || (!inTransfer && enabled)) && (
        <div className={styles.footer}>
          <button type="button" className={styles.toolButton} onClick={handleClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
};

export default LocalSendShareModal;
