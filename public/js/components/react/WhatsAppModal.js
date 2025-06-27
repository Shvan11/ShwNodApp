// WhatsAppModal.js - React component for WhatsApp modal
const WhatsAppModal = ({ show, onClose, patientCode, patientName }) => {
    const [message, setMessage] = React.useState('');
    const [isSending, setIsSending] = React.useState(false);

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
                alert('Message sent successfully!');
                onClose();
                setMessage('');
            } else {
                alert('Failed to send message');
            }
        } catch (error) {
            console.error('Error sending WhatsApp message:', error);
            alert('Error sending message');
        } finally {
            setIsSending(false);
        }
    };

    if (!show) return null;

    return React.createElement('div', {
        className: 'whatsapp-modal-overlay',
        style: {
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
        },
        onClick: (e) => {
            if (e.target === e.currentTarget) onClose();
        }
    }, 
        React.createElement('div', {
            className: 'whatsapp-modal',
            style: {
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '20px',
                minWidth: '400px',
                maxWidth: '500px',
                maxHeight: '80vh',
                overflow: 'auto'
            }
        }, [
            // Header
            React.createElement('div', {
                key: 'header',
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px',
                    borderBottom: '1px solid #eee',
                    paddingBottom: '10px'
                }
            }, [
                React.createElement('h3', {
                    key: 'title',
                    style: { margin: 0, color: '#25d366' }
                }, `Send to ${patientName || patientCode}`),
                
                React.createElement('button', {
                    key: 'close',
                    onClick: onClose,
                    style: {
                        background: 'none',
                        border: 'none',
                        fontSize: '20px',
                        cursor: 'pointer',
                        padding: '5px'
                    }
                }, '×')
            ]),

            // Message Input
            React.createElement('div', {
                key: 'message-section',
                style: { marginBottom: '20px' }
            }, [
                React.createElement('label', {
                    key: 'label',
                    style: {
                        display: 'block',
                        marginBottom: '8px',
                        fontWeight: 'bold'
                    }
                }, 'Message:'),
                
                React.createElement('textarea', {
                    key: 'textarea',
                    value: message,
                    onChange: (e) => setMessage(e.target.value),
                    placeholder: 'Enter your message...',
                    rows: 4,
                    style: {
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #ddd',
                        borderRadius: '4px',
                        fontSize: '14px',
                        resize: 'vertical',
                        boxSizing: 'border-box'
                    }
                })
            ]),

            // Action Buttons
            React.createElement('div', {
                key: 'actions',
                style: {
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end'
                }
            }, [
                React.createElement('button', {
                    key: 'cancel',
                    onClick: onClose,
                    style: {
                        padding: '10px 20px',
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }
                }, 'Cancel'),
                
                React.createElement('button', {
                    key: 'send',
                    onClick: handleSend,
                    disabled: isSending || !message.trim(),
                    style: {
                        padding: '10px 20px',
                        backgroundColor: isSending || !message.trim() ? '#ccc' : '#25d366',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isSending || !message.trim() ? 'not-allowed' : 'pointer'
                    }
                }, isSending ? 'Sending...' : 'Send')
            ])
        ])
    );
};

// Export for use in other components
window.WhatsAppModal = WhatsAppModal;