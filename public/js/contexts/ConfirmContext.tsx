import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import ConfirmDialog from '../components/react/ConfirmDialog';

export interface ConfirmOptions {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm {
    message: string;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);

    const confirm = useCallback((message: string, options: ConfirmOptions = {}): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setPending({ message, options, resolve });
        });
    }, []);

    const handleConfirm = useCallback(() => {
        pending?.resolve(true);
        setPending(null);
    }, [pending]);

    const handleCancel = useCallback(() => {
        pending?.resolve(false);
        setPending(null);
    }, [pending]);

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <ConfirmDialog
                isOpen={pending !== null}
                title={pending?.options.title ?? 'Confirm'}
                message={pending?.message ?? ''}
                isDangerous={pending?.options.danger ?? false}
                confirmText={pending?.options.confirmText}
                cancelText={pending?.options.cancelText}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
            />
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmFn {
    const fn = useContext(ConfirmContext);
    if (!fn) throw new Error('useConfirm must be used within ConfirmProvider');
    return fn;
}
