/**
 * Connection Status Component
 * Displays connection and client status
 */
import React from 'react';
import { UI_STATES } from '../../utils/whatsapp-send-constants.js';

export default function ConnectionStatus({ connectionStatus, clientReady, sendingProgress }) {
    const getStatusText = () => {
        // Show sending progress if actively sending
        if (sendingProgress.started && !sendingProgress.finished && sendingProgress.total > 0) {
            return `📤 Sending messages... ${sendingProgress.sent}/${sendingProgress.total}`;
        }

        // Show completion message
        if (sendingProgress.finished && sendingProgress.total > 0) {
            return `✅ Completed! ${sendingProgress.sent} delivered, ${sendingProgress.failed} failed`;
        }

        // Show client status
        if (clientReady) {
            return '✅ WhatsApp client is ready!';
        } else if (connectionStatus === UI_STATES.ERROR) {
            return '❌ Connection error';
        } else if (connectionStatus === UI_STATES.CONNECTING) {
            return '🔄 Connecting...';
        } else if (connectionStatus === UI_STATES.DISCONNECTED) {
            return '🔌 Disconnected from server';
        } else {
            return '🔐 WhatsApp authentication required';
        }
    };

    const getStatusClass = () => {
        if (sendingProgress.started && !sendingProgress.finished) {
            return 'connection-status-sending';
        }
        if (connectionStatus === UI_STATES.CONNECTED || clientReady) {
            return 'connection-status-connected';
        }
        if (connectionStatus === UI_STATES.ERROR) {
            return 'connection-status-error';
        }
        return 'connection-status-disconnected';
    };

    return (
        <div
            id="state"
            className={`status-panel ${getStatusClass()}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <span className="status-icon" aria-hidden="true"></span>
            <span>{getStatusText()}</span>
        </div>
    );
}
