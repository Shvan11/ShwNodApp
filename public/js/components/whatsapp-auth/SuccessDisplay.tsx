/**
 * Success Display Component
 * Shows successful authentication message
 */

import styles from '../../routes/WhatsAppAuth.module.css';

interface SuccessDisplayProps {
  /** Where the page goes next: a path, 'close' (a popup closes itself), or null (it stays). */
  afterPairing: string | null;
}

export const SuccessDisplay = ({ afterPairing }: SuccessDisplayProps) => {
  // The copy follows what the page will actually do. It used to key on a
  // `?returnTo` param nothing sets, so the 2 s redirect ran under "ready to send
  // messages" (FE-F16-13).
  const message =
    afterPairing === 'close'
      ? 'This window will close in a moment.'
      : afterPairing
        ? 'Taking you back in a moment…'
        : 'Your WhatsApp client is ready to send messages';

  return (
    <div className={styles.successSection} role="status" aria-live="polite">
      <div className={styles.successIconContainer}>
        <span className={styles.successIcon} aria-hidden="true">
          ✅
        </span>
      </div>
      <div className={styles.successContent}>
        <h2>WhatsApp Connected!</h2>
        <p>{message}</p>
      </div>
    </div>
  );
};
