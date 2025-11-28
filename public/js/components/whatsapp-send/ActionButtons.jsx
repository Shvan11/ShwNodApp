/**
 * Action Buttons Component
 * Primary action buttons for starting messages or authentication
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

export default function ActionButtons({ clientReady, onStartSending, sendingInProgress, sendingProgress }) {
    const navigate = useNavigate();
    const location = useLocation();

    const handleLoginClick = () => {
        // Navigate to auth page with return path in state (cleaner than URL params)
        navigate('/auth', {
            state: {
                returnPath: location.pathname + location.search,
                timestamp: Date.now()
            }
        });
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
