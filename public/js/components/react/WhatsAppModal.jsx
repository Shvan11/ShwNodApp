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
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div 
                className="whatsapp-modal"
                style={{
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    padding: '20px',
                    minWidth: '400px',
                    maxWidth: '500px',
                    maxHeight: '80vh',
                    overflow: 'auto'
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    borderBottom: '1px solid #eee',
                    paddingBottom: '10px'
                }}>
                    <h3 style={{ margin: 0, color: '#25d366' }}>
                        Send to {patientName || patientCode}
                    </h3>
                    
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '20px',
                            cursor: 'pointer',
                            padding: '5px'
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Message Input */}
                <div style={{ marginBottom: '20px' }}>
                    <label style={{
                        display: 'block',
                        marginBottom: '8px',
                        fontWeight: 'bold'
                    }}>
                        Message:
                    </label>
                    
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Enter your message..."
                        rows={4}
                        style={{
                            width: '100%',
                            padding: '10px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            fontSize: '14px',
                            resize: 'vertical',
                            boxSizing: 'border-box'
                        }}
                    />
                </div>

                {/* Action Buttons */}
                <div style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end'
                }}>
                    <button
                        onClick={onClose}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        Cancel
                    </button>
                    
                    <button
                        onClick={handleSend}
                        disabled={isSending || !message.trim()}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: isSending || !message.trim() ? '#ccc' : '#25d366',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: isSending || !message.trim() ? 'not-allowed' : 'pointer'
                        }}
                    >
                        {isSending ? 'Sending...' : 'Send'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppModal;