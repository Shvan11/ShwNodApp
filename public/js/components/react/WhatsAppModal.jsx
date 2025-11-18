/**
 * WhatsAppModal - WhatsApp messaging interface component
 *
 * Provides a modal interface for sending messages and images via WhatsApp
 */

import React, { useState } from 'react'
import { useToast } from '../../contexts/ToastContext.jsx';

const WhatsAppModal = ({ show, onClose, patientCode, patientName }) => {
    const toast = useToast();
    const [message, setMessage] = useState('');
    const [isSending, setIsSending] = useState(false);

    const handleSend = async () => {
        if (!message.trim()) return;
        
        setIsSending(true);
        try {
            const response = await fetch('/api/wa/send-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    patientCode: patientCode,
                    message: message,
                    imageData: 'canvas-screenshot' // This would be handled by the comparison component
                })
            });
            
            if (response.ok) {
                toast.success('Message sent successfully!');
                onClose();
                setMessage('');
            } else {
                toast.error('Failed to send message');
            }
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            toast.error('Error sending message');
        } finally {
            setIsSending(false);
        }
    };

    if (!show) return null;

    return (
        <div
            className="whatsapp-modal-overlay"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="whatsapp-modal">
                {/* Header */}
                <div className="whatsapp-modal-header">
                    <h3 className="whatsapp-modal-title">
                        Send to {patientName || patientCode}
                    </h3>

                    <button
                        onClick={onClose}
                        className="whatsapp-modal-close"
                    >
                        ×
                    </button>
                </div>

                {/* Message Input */}
                <div className="whatsapp-form-group">
                    <label className="whatsapp-form-label">
                        Message:
                    </label>

                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Enter your message..."
                        rows={4}
                        className="whatsapp-textarea"
                    />
                </div>

                {/* Action Buttons */}
                <div className="whatsapp-actions">
                    <button
                        onClick={onClose}
                        className="whatsapp-btn-cancel"
                    >
                        Cancel
                    </button>

                    <button
                        onClick={handleSend}
                        disabled={isSending || !message.trim()}
                        className="whatsapp-btn-send"
                    >
                        {isSending ? 'Sending...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppModal;