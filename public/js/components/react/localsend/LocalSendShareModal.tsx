/**
 * LocalSend share modal — pick a LAN device, then push the given file(s) to it.
 *
 * Rendered by both share entry points (the photo lightbox and the Files page),
 * driven entirely off a `ShareSource[]` so single + batch are one code path.
 * The server does the discovery/upload; this modal lists devices, fires the
 * transfer, and polls its status. All I/O goes through the core/http funnel
 * (reads carry `{ schema }`; mutations get CSRF for free).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from '../Modal';
import { useToast } from '@/contexts/ToastContext';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';
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

  const [enabled, setEnabled] = useState(true);
  const [devices, setDevices] = useState<LocalSendDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [ip, setIp] = useState('');
  const [probing, setProbing] = useState(false);

  // Active transfer (null until a device is picked).
  const [transfer, setTransfer] = useState<TransferStatus | null>(null);
  const [pendingDevice, setPendingDevice] = useState<LocalSendDevice | null>(null);
  const [pin, setPin] = useState('');
  const transferIdRef = useRef<string | null>(null);

  const loadDevices = useCallback(
    async (rescan: boolean): Promise<void> => {
      setLoadingDevices(true);
      try {
        const res = await fetchJSON<localsend.DevicesResponse>(
          `/api/localsend/devices${rescan ? '?rescan=1' : ''}`,
          { schema: localsend.devices.response }
        );
        setEnabled(res.enabled);
        setDevices(res.devices);
      } catch (err) {
        toast.error(httpErrorMessage(err, 'Could not load LAN devices'));
      } finally {
        setLoadingDevices(false);
      }
    },
    [toast]
  );

  // Reset + initial load whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    transferIdRef.current = null;
    setTransfer(null);
    setPendingDevice(null);
    setPin('');
    setIp('');
    void loadDevices(true);
  }, [open, loadDevices]);

  // Poll the active transfer ~every second until it settles.
  useEffect(() => {
    const id = transferIdRef.current;
    if (!id) return;
    if (transfer && TERMINAL.includes(transfer.status)) return;

    const tick = async (): Promise<void> => {
      try {
        const status = await fetchJSON<TransferStatus>(`/api/localsend/transfers/${id}`, {
          schema: localsend.transfer.response,
        });
        setTransfer(status);
      } catch {
        /* transient — keep polling */
      }
    };
    const handle = window.setInterval(() => void tick(), 1000);
    return () => window.clearInterval(handle);
  }, [transfer]);

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
      setDevices((prev) => {
        const without = prev.filter((d) => d.fingerprint !== device.fingerprint);
        return [device, ...without];
      });
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

  // Surface a completed/declined transfer as a toast.
  useEffect(() => {
    if (!transfer) return;
    if (transfer.status === 'completed') toast.success(`Sent to ${transfer.deviceAlias}`);
    else if (transfer.status === 'declined') toast.error(`${transfer.deviceAlias} declined the files`);
    else if (transfer.status === 'failed') toast.error(transfer.error || 'Transfer failed');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transfer?.status]);

  if (!open) return null;

  const inTransfer = transfer !== null;
  const settled = transfer ? TERMINAL.includes(transfer.status) : false;

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="localsend-title"
      contentClassName={styles.modal}
      overlayClassName={styles.overlay}
    >
      <h3 id="localsend-title" className={styles.title}>
        <i className="fas fa-share-nodes" aria-hidden="true" /> Share to device
      </h3>

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
              onClick={() => void loadDevices(true)}
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
              <p className={styles.transferHead}>
                {transfer.status === 'pending' && `Waiting for ${transfer.deviceAlias} to accept…`}
                {transfer.status === 'sending' && `Sending to ${transfer.deviceAlias}…`}
                {transfer.status === 'completed' && `Sent to ${transfer.deviceAlias} ✓`}
                {transfer.status === 'declined' && `${transfer.deviceAlias} declined`}
                {transfer.status === 'failed' && `Failed: ${transfer.error || 'transfer error'}`}
                {transfer.status === 'canceled' && 'Canceled'}
              </p>
              <ul className={styles.fileList}>
                {transfer.files.map((f, i) => (
                  <li key={i} className={styles.fileRow}>
                    <span className={styles.fileName}>{f.name}</span>
                    <span className={styles.progressTrack}>
                      <span
                        className={styles.progressBar}
                        style={{
                          width: f.totalBytes
                            ? `${Math.min(100, Math.round((f.sentBytes / f.totalBytes) * 100))}%`
                            : f.status === 'completed'
                              ? '100%'
                              : '0%',
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className={styles.transferActions}>
            {!settled && transfer.status !== 'pin-required' && (
              <button type="button" className={styles.toolButton} onClick={() => void cancelTransfer()}>
                Cancel
              </button>
            )}
            {(settled || transfer.status === 'pin-required') && (
              <button type="button" className={styles.toolButton} onClick={onClose}>
                Close
              </button>
            )}
          </div>
        </div>
      )}

      {(!enabled || (!inTransfer && enabled)) && (
        <div className={styles.footer}>
          <button type="button" className={styles.toolButton} onClick={onClose}>
            Close
          </button>
        </div>
      )}
    </Modal>
  );
};

export default LocalSendShareModal;
