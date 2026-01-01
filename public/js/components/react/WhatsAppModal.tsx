/**
 * WhatsAppModal - WhatsApp messaging interface component
 *
 * Provides a modal interface for sending messages and images via WhatsApp
 */

import { useState } from 'react';
import type { MouseEvent, ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';

interface WhatsAppModalProps {
    show: boolean;
    onClose: () => void;
    patientCode: string | number;
    patientName?: string;
}

const WhatsAppModal = ({ show, onClose, patientCode, patientName }: WhatsAppModalProps) => {
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

    const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) onClose();
    };

    const handleMessageChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
        setMessage(e.target.value);
    };

    return (
        <div
            className="whatsapp-modal-overlay"
            onClick={handleOverlayClick}
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
                        onChange={handleMessageChange}
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
