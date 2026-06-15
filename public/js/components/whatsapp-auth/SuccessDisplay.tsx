/**
 * Success Display Component
 * Shows successful authentication message
 */

import styles from '../../routes/WhatsAppAuth.module.css';

export const SuccessDisplay = () => {
  // Derived from the URL during render — a `returnTo` param means we're about to
  // bounce back to the messaging page, so reflect that in the copy.
  const returnTo = new URLSearchParams(window.location.search).get('returnTo');
  const message = returnTo
    ? 'Redirecting you back to the messaging page...'
    : 'Your WhatsApp client is ready to send messages';

  return (
    <div className={styles.successSection}>
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
