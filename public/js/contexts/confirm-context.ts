/**
 * The confirm CONTEXT OBJECT, split out of `ConfirmContext.tsx`.
 *
 * `ConfirmContext.tsx` renders `ConfirmDialog`, which renders the shared
 * `<Modal>` — and `Modal` itself now needs to raise a confirm (the unsaved-work
 * guard). Importing the provider module from `Modal` would close that loop
 * (Modal → ConfirmContext → ConfirmDialog → Modal). Every use is deferred to
 * render time so a bundler would survive it today, but a cycle through a
 * `export default` is the shape that turns into a TDZ crash the moment someone
 * evaluates something at module scope. This module has no JSX and no imports of
 * its own, so there is no loop to survive.
 *
 * Consumers keep importing `useConfirm` from `ConfirmContext`; only `Modal`
 * reads the raw context (it must NOT throw when there is no provider — it is
 * usable outside `RootLayout`).
 */
import { createContext } from 'react';

export interface ConfirmOptions {
    title?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
}

export type ConfirmFn = (message: string, options?: ConfirmOptions) => Promise<boolean>;

export const ConfirmContext = createContext<ConfirmFn | null>(null);
