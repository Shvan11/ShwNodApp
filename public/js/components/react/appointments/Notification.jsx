import React, { useEffect } from 'react';

/**
 * Notification Component
 * Shows success/error/info messages with optional undo functionality
 */
const Notification = ({ message, type = 'info', onClose, onUndo, undoData, autoClose = true }) => {
    useEffect(() => {
        if (autoClose && !onUndo) {
            // Auto-close after 3 seconds for regular notifications
            const timer = setTimeout(() => {
                onClose();
            }, 3000);

            return () => clearTimeout(timer);
        } else if (autoClose && onUndo) {
            // Auto-close after 5 seconds for notifications with undo
            const timer = setTimeout(() => {
                onClose();
            }, 5000);

            return () => clearTimeout(timer);
        }
    }, [autoClose, onUndo, onClose]);

    const getIcon = () => {
        switch (type) {
            case 'success':
                return 'fa-check-circle';
            case 'error':
                return 'fa-exclamation-circle';
            default:
                return 'fa-info-circle';
        }
    };

    const handleUndo = () => {
        if (onUndo && undoData) {
            onUndo(undoData);
        }
        onClose();
    };

    return (
        <div className={`notification notification-${type}`}>
            <i className={`fas ${getIcon()}`}></i>
            <span>{message}</span>
            {onUndo && (
                <button className="notification-undo" onClick={handleUndo}>
                    <i className="fas fa-undo"></i>
                    Undo
                </button>
            )}
            <button className="notification-close" onClick={onClose}>
                <i className="fas fa-times"></i>
            </button>
        </div>
    );
};

export default Notification;
