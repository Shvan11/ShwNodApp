/**
 * Progress Bar Component
 * Shows the running batch's progress.
 */

import type { SendingProgress } from '../../hooks/useWhatsAppSync';
import styles from '../../routes/WhatsAppSend.module.css';

interface ProgressBarProps {
  sendingProgress: SendingProgress;
}

export default function ProgressBar({ sendingProgress }: ProgressBarProps) {
  const { started, finished, total, sent, failed } = sendingProgress;

  if (!started || finished || total === 0) {
    return null;
  }

  // A failure is an attempted recipient too: counting only `sent` stalled the
  // bar short of 100 % on every batch with a bad number (FE-F16-11).
  const attempted = sent + failed;
  const percentage = Math.min((attempted / total) * 100, 100);

  return (
    <div
      id="progressContainer"
      className={styles.sendingProgressContainer}
      role="progressbar"
      aria-label="Message sending progress"
      aria-valuenow={attempted}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className={styles.sendingProgressHeader}>
        <span className={styles.sendingProgressTitle}>Sending Messages</span>
        <span id="progressStats" className={styles.sendingProgressStats}>
          {attempted}/{total}
        </span>
      </div>
      <div className={styles.sendingProgressBarContainer}>
        <div
          id="progressBarFill"
          className={styles.sendingProgressBarFill}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
      <div id="progressText" className={styles.sendingProgressText}>
        {sent} handed to WhatsApp{failed > 0 ? `, ${failed} failed` : ''} — {total - attempted} to go
      </div>
    </div>
  );
}
