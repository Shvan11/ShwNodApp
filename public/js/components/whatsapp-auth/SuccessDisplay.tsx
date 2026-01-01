/**
 * Success Display Component
 * Shows successful authentication message
 */

import { useEffect, useState } from 'react';

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
    <div className="success-section">
      <div className="success-icon-container">
        <span className="success-icon" aria-hidden="true">
          ✅
        </span>
      </div>
      <div className="success-content">
        <h2>WhatsApp Connected!</h2>
        <p>{message}</p>
      </div>
    </div>
  );
};
