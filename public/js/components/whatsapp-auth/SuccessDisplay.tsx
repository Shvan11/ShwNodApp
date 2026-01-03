/**
 * Success Display Component
 * Shows successful authentication message
 */

import { useEffect, useState } from 'react';
import styles from '../../routes/WhatsAppAuth.module.css';

export const SuccessDisplay = () => {
  const [message, setMessage] = useState('Your WhatsApp client is ready to send messages');

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const returnTo = urlParams.get('returnTo');

    if (returnTo) {
      setMessage('Redirecting you back to the messaging page...');
    }
  }, []);

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
