/**
 * Progress Bar Component
 * Shows message sending progress
 */

import styles from '../../routes/WhatsAppSend.module.css';

export interface SendingProgress {
  started: boolean;
  finished: boolean;
  total: number;
  sent: number;
  failed: number;
}

interface ProgressBarProps {
  sendingProgress: SendingProgress;
}

export default function ProgressBar({ sendingProgress }: ProgressBarProps) {
  const { started, finished, total, sent } = sendingProgress;

  if (!started || finished || total === 0) {
    return null;
  }

  const percentage = Math.min((sent / total) * 100, 100);

  return (
    <div
      id="progressContainer"
      className={styles.sendingProgressContainer}
      role="progressbar"
      aria-label="Message sending progress"
      aria-valuenow={sent}
      aria-valuemin={0}
      aria-valuemax={total}
    >
      <div className={styles.sendingProgressHeader}>
        <span className={styles.sendingProgressTitle}>Sending Messages</span>
        <span id="progressStats" className={styles.sendingProgressStats}>
          {sent}/{total}
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
        {sent} of {total} messages delivered
      </div>
    </div>
  );
}
