/**
 * QR Code Display Component
 * Shows QR code for WhatsApp authentication
 */

import React from 'react';

export const QRCodeDisplay = ({ qrCode }) => {
  // QR code comes directly from WebSocket via props
  // No need to fetch from API - WebSocket already provides it!

  return (
    <div className="qr-section">
      <div className="qr-header">
        <h2>Scan QR Code</h2>
        <p>Open WhatsApp on your phone and scan this code</p>
      </div>

      <div className="qr-code-container">
        {!qrCode ? (
          <div className="qr-placeholder">
            <div className="qr-loading">
              <span className="loading-spinner"></span>
              <p>Generating QR Code...</p>
            </div>
          </div>
        ) : (
          <img
            src={qrCode}
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
