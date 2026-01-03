/**
 * QR Code Display Component
 * Shows QR code for WhatsApp authentication
 */

import styles from '../../routes/WhatsAppAuth.module.css';

interface QRCodeDisplayProps {
  qrCode: string | null;
}

export const QRCodeDisplay = ({ qrCode }: QRCodeDisplayProps) => {
  return (
    <div className={styles.qrSection}>
      <div className={styles.qrHeader}>
        <h2>Scan QR Code</h2>
        <p>Open WhatsApp on your phone and scan this code</p>
      </div>

      <div className={styles.qrCodeContainer}>
        {!qrCode ? (
          <div className={styles.qrPlaceholder}>
            <div className={styles.qrLoading}>
              <span className={styles.loadingSpinner}></span>
              <p>Generating QR Code...</p>
            </div>
          </div>
        ) : (
          <img
            src={qrCode}
            className={styles.qrCode}
            alt="WhatsApp QR Code for authentication"
          />
        )}
      </div>

      <div className={styles.qrInstructions}>
        <ol>
          <li>Open WhatsApp on your phone</li>
          <li>Tap Menu (⋮) → Linked Devices</li>
          <li>Tap "Link a Device"</li>
          <li>Scan this QR code</li>
        </ol>
      </div>
    </div>
  );
};
