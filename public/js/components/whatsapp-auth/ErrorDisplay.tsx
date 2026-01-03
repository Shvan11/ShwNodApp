/**
 * Error Display Component
 * Shows error messages
 */

import styles from '../../routes/WhatsAppAuth.module.css';

interface ErrorDisplayProps {
  error: string | null;
}

export const ErrorDisplay = ({ error }: ErrorDisplayProps) => {
  return (
    <div className={styles.errorSection}>
      <div className={styles.errorIconContainer}>
        <span className={styles.errorIcon} aria-hidden="true">
          ❌
        </span>
      </div>
      <div className={styles.errorContent}>
        <h2>Connection Error</h2>
        <p>{error || 'Unable to connect to WhatsApp client'}</p>
      </div>
    </div>
  );
};
