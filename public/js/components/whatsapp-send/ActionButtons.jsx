/**
 * Action Buttons Component
 * Primary action buttons for starting messages or authentication
 */
import React from 'react';

export default function ActionButtons({ clientReady, onStartSending, sendingInProgress, sendingProgress }) {
    const handleLoginClick = () => {
        // Build the authentication URL with return parameters
        const currentUrl = new URL(window.location);
        const authUrl = new URL('/auth', window.location.origin);

        // Add return URL so auth page can redirect back
        authUrl.searchParams.set('returnTo', encodeURIComponent(currentUrl.pathname + currentUrl.search));

        // Add a timestamp to force refresh after auth
        authUrl.searchParams.set('timestamp', Date.now().toString());

        // Perform the redirect
        window.location.href = authUrl.toString();
    };

    const getButtonText = () => {
        if (sendingInProgress) {
            return `Sending ${sendingProgress.sent}/${sendingProgress.total}`;
        }
        return 'Start Sending Messages';
    };

    return (
        <div className="action-section">
            {clientReady ? (
                <button
                    id="startButton"
                    className="btn btn-primary primary-action"
                    onClick={onStartSending}
                    disabled={sendingInProgress}
                    aria-describedby="send-instructions"
                >
                    <span className="btn-icon" aria-hidden="true">📱</span>
                    <span>{getButtonText()}</span>
                </button>
            ) : (
                <button
                    id="authButton"
                    className="btn btn-secondary"
                    onClick={handleLoginClick}
                    aria-label="Go to WhatsApp Authentication"
                >
                    <span className="btn-icon" aria-hidden="true">🔐</span>
                    <span>Go to Authentication</span>
                </button>
            )}
            <p id="send-instructions" className="help-text sr-only">
                Click to begin sending WhatsApp messages to selected date appointments
            </p>
        </div>
    );
}
