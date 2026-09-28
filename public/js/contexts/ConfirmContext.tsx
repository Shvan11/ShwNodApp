import { useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import ConfirmDialog from '../components/react/ConfirmDialog';
import { ConfirmContext, type ConfirmOptions, type ConfirmFn } from './confirm-context';

// The context object itself lives in `confirm-context.ts` so `Modal` can read it
// without importing this module (which renders ConfirmDialog → Modal). Re-exported
// here so every existing consumer keeps its single import site.
export type { ConfirmOptions, ConfirmFn } from './confirm-context';

interface PendingConfirm {
    message: string;
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
    const [pending, setPending] = useState<PendingConfirm | null>(null);
    // Mirrors `pending` for the replace-an-open-dialog path below. A state updater
    // must be PURE (React may call it twice, and does under StrictMode), so the
    // previous promise is settled here rather than inside setPending.
    const pendingRef = useRef<PendingConfirm | null>(null);

    const confirm = useCallback((message: string, options: ConfirmOptions = {}): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            // If a confirm is already awaiting an answer, resolve it as cancelled
            // before replacing it — otherwise its promise would leak unresolved.
            pendingRef.current?.resolve(false);
            const next = { message, options, resolve };
            pendingRef.current = next;
            setPending(next);
        });
    }, []);

    const handleConfirm = useCallback(() => {
        pending?.resolve(true);
        pendingRef.current = null;
        setPending(null);
    }, [pending]);

    const handleCancel = useCallback(() => {
        pending?.resolve(false);
        pendingRef.current = null;
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
