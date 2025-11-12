/**
 * QR Code Display Component
 * Shows QR code for WhatsApp authentication
 */

import React, { useState, useEffect } from 'react';

export const QRCodeDisplay = ({ qrCode, onFetchQR }) => {
  const [qrImage, setQrImage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchQR = async () => {
      setLoading(true);
      try {
        const qr = await onFetchQR();
        setQrImage(qr);
      } catch (error) {
        console.error('Failed to fetch QR:', error);
        setQrImage(null);
      } finally {
        setLoading(false);
      }
    };

    fetchQR();
  }, [qrCode, onFetchQR]);

  return (
    <div className="qr-section">
      <div className="qr-header">
        <h2>Scan QR Code</h2>
        <p>Open WhatsApp on your phone and scan this code</p>
      </div>

      <div className="qr-code-container">
        {loading || !qrImage ? (
          <div className="qr-placeholder">
            <div className="qr-loading">
              <span className="loading-spinner"></span>
              <p>Generating QR Code...</p>
            </div>
          </div>
        ) : (
          <img
            src={qrImage}
            className="qr-code"
            alt="WhatsApp QR Code for authentication"
          />
        )}
      </div>

      <div className="qr-instructions">
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
