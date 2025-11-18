/**
 * Global Toast Notification System
 * Provides toast notifications throughout the entire application
 * Replaces traditional alert() calls with modern, non-blocking notifications
 */

import React, { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext();

/**
 * Toast Component
 * Individual toast notification with auto-dismiss and manual close
 */
function Toast({ id, message, type = 'info', duration = 3000, onClose }) {
    const [isVisible, setIsVisible] = useState(true);

    React.useEffect(() => {
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(() => onClose(id), 300); // Wait for animation
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose, id]);

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(() => onClose(id), 300);
    };

    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    return (
        <div className={`toast toast-${type} ${isVisible ? 'toast-visible' : 'toast-hidden'}`}>
            <div className="toast-icon">{icons[type]}</div>
            <div className="toast-message">{message}</div>
            <button className="toast-close" onClick={handleClose} aria-label="Close">
                ×
            </button>
        </div>
    );
}

/**
 * Toast Container
 * Manages all active toast notifications
 */
function ToastContainer({ toasts, removeToast }) {
    return (
        <div className="toast-container">
            {toasts.map((toast) => (
                <Toast
                    key={toast.id}
                    id={toast.id}
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    onClose={removeToast}
                />
            ))}
        </div>
    );
}

/**
 * Toast Provider Component
 * Wraps the application and provides global toast functionality
 */
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = Date.now() + Math.random(); // Unique ID
        setToasts(prev => [...prev, { id, message, type, duration }]);
        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
    }, []);

    const success = useCallback((message, duration = 3000) => {
        return showToast(message, 'success', duration);
    }, [showToast]);

    const error = useCallback((message, duration = 4000) => {
        return showToast(message, 'error', duration);
    }, [showToast]);

    const warning = useCallback((message, duration = 3500) => {
        return showToast(message, 'warning', duration);
    }, [showToast]);

    const info = useCallback((message, duration = 3000) => {
        return showToast(message, 'info', duration);
    }, [showToast]);

    const value = {
        showToast,
        success,
        error,
        warning,
        info,
        removeToast
    };

    // Make toast functions globally available for non-React code
    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            window.toast = {
                show: showToast,
                success,
                error,
                warning,
                info
            };
        }

        return () => {
            if (typeof window !== 'undefined') {
                delete window.toast;
            }
        };
    }, [showToast, success, error, warning, info]);

    return (
        <ToastContext.Provider value={value}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

/**
 * Hook to access toast notifications
 * Usage: const toast = useToast();
 *        toast.success('Operation completed!');
 *        toast.error('Something went wrong!');
 */
export function useToast() {
    const context = useContext(ToastContext);

    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }

    return context;
}

export default ToastContext;
