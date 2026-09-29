import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import i18n from 'i18next';
import { useConfirm } from '../contexts/ConfirmContext';

/**
 * Route-level unsaved-work guard — the page-sized sibling of `<Modal unsavedGuard>`.
 *
 * While `dirty` is true:
 *  - an in-app navigation (the page's own Cancel/Back, the sidebar, the header
 *    tabs, browser Back) is held by React Router's `useBlocker` and put to the
 *    user through the shared `useConfirm` dialog, with the same `common:unsaved.*`
 *    wording the modal guard uses;
 *  - a reload or tab close gets the browser's native prompt.
 *
 * A navigation that stays on the same path + query (re-clicking the current
 * header tab) is never blocked — it discards nothing.
 *
 * Call the returned `allowNextNavigation()` right before the page's own
 * post-save `navigate()`: the dirty flag is still `true` in that tick (state
 * updates have not rendered yet), so without it the save's own redirect would
 * ask "discard your changes?" about changes that were just saved.
 */
export function useUnsavedRouteGuard(dirty: boolean): { allowNextNavigation: () => void } {
    const confirm = useConfirm();
    const bypassRef = useRef(false);

    const blocker = useBlocker(({ currentLocation, nextLocation }) => {
        if (!dirty || bypassRef.current) return false;
        return currentLocation.pathname !== nextLocation.pathname
            || currentLocation.search !== nextLocation.search;
    });

    useEffect(() => {
        if (blocker.state !== 'blocked') return;
        let settled = false;
        void confirm(i18n.t('unsaved.message'), {
            title: i18n.t('unsaved.title'),
            confirmText: i18n.t('unsaved.discard'),
            cancelText: i18n.t('unsaved.keepEditing'),
            danger: true,
        }).then((discard) => {
            if (settled) return;
            settled = true;
            if (discard) blocker.proceed();
            else blocker.reset();
        });
        return () => {
            settled = true;
        };
    }, [blocker, confirm]);

    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent): void => {
            if (bypassRef.current) return;
            e.preventDefault();
            // Chrome requires returnValue to be set for the prompt to appear.
            e.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    const allowNextNavigation = useCallback(() => {
        bypassRef.current = true;
    }, []);

    return { allowNextNavigation };
}
