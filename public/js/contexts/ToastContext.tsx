/**
 * Global Toast Notification System
 * Provides toast notifications throughout the entire application
 * Replaces traditional alert() calls with modern, non-blocking notifications
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';

/**
 * Toast type variants
 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/**
 * Toast data structure
 */
export interface ToastData {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

/**
 * Toast context value
 */
export interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => number;
  success: (message: string, duration?: number) => number;
  error: (message: string, duration?: number) => number;
  warning: (message: string, duration?: number) => number;
  info: (message: string, duration?: number) => number;
  removeToast: (id: number) => void;
}

/**
 * Toast props
 */
interface ToastProps {
  id: number;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Toast Component
 * Individual toast notification with auto-dismiss and manual close
 */
function Toast({ id, message, type = 'info', duration = 3000, onClose }: ToastProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onClose(id), 300); // Wait for animation
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose, id]);

  const handleClose = (): void => {
    setIsVisible(false);
    setTimeout(() => onClose(id), 300);
  };

  const icons: Record<ToastType, string> = {
    success: '\u2713',
    error: '\u2715',
    warning: '\u26A0',
    info: '\u2139',
  };

  return (
    <div className={`toast toast-${type} ${isVisible ? 'toast-visible' : 'toast-hidden'}`}>
      <div className="toast-icon">{icons[type]}</div>
      <div className="toast-message">{message}</div>
      <button className="toast-close" onClick={handleClose} aria-label="Close">
        {'\u00D7'}
      </button>
    </div>
  );
}

/**
 * Toast Container props
 */
interface ToastContainerProps {
  toasts: ToastData[];
  removeToast: (id: number) => void;
}

/**
 * Toast Container
 * Manages all active toast notifications
 */
function ToastContainer({ toasts, removeToast }: ToastContainerProps) {
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
 * Toast Provider props
 */
interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Window with toast
 */
declare global {
  interface Window {
    toast?: {
      show: (message: string, type?: ToastType, duration?: number) => number;
      success: (message: string, duration?: number) => number;
      error: (message: string, duration?: number) => number;
      warning: (message: string, duration?: number) => number;
      info: (message: string, duration?: number) => number;
    };
  }
}

/**
 * Toast Provider Component
 * Wraps the application and provides global toast functionality
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'info', duration = 3000): number => {
    const id = Date.now() + Math.random(); // Unique ID
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    return id;
  }, []);

  const removeToast = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const success = useCallback(
    (message: string, duration = 3000): number => {
      return showToast(message, 'success', duration);
    },
    [showToast]
  );

  const error = useCallback(
    (message: string, duration = 4000): number => {
      return showToast(message, 'error', duration);
    },
    [showToast]
  );

  const warning = useCallback(
    (message: string, duration = 3500): number => {
      return showToast(message, 'warning', duration);
    },
    [showToast]
  );

  const info = useCallback(
    (message: string, duration = 3000): number => {
      return showToast(message, 'info', duration);
    },
    [showToast]
  );

  const value: ToastContextValue = {
    showToast,
    success,
    error,
    warning,
    info,
    removeToast,
  };

  // Make toast functions globally available for non-React code
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.toast = {
        show: showToast,
        success,
        error,
        warning,
        info,
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
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }

  return context;
}

export default ToastContext;
