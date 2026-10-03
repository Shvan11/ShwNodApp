/**
 * Save / share plumbing for the compare canvas.
 *
 * Mobile → OS share sheet (preserving the user-gesture chain through
 * navigator.share, pattern lifted from GridComponent); desktop → the montage
 * is uploaded to the staging endpoint and handed to the in-app ShareSheet
 * (LocalSend / Telegram), matching the Files page.
 */

import { useRef, useState } from 'react';
import { formatISODate } from '@/core/utils';
import { postFormData, httpErrorMessage } from '@/core/http';
import { useToast } from '@/contexts/ToastContext';
import * as shareContract from '@shared/contracts/share.contract';
import type { ShareSource } from '../localsend/LocalSendShareModal';
import type { ComparisonEngine } from './ComparisonEngine';

const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator && 'canShare' in navigator;
// Web Share exists on Windows desktop Chrome/Edge too (it opens the OS share
// charm), so feature detection alone can't tell a phone from a desktop. Gate
// native share on an actual touch/mobile device; desktop falls through to the
// in-app ShareSheet (LocalSend / Telegram), matching the Files page.
const isMobileDevice = typeof navigator !== 'undefined'
    && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 0
            && typeof window !== 'undefined'
            && window.matchMedia('(pointer: coarse)').matches));
export const nativeSharePreferred = canNativeShare && isMobileDevice;

export function useCompareShare(engine: ComparisonEngine | null, personId?: number | null) {
    const toast = useToast();
    const isSharingRef = useRef(false);
    const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);
    const [staging, setStaging] = useState(false);

    // A JPEG (see ComparisonEngine#exportBlob — the PNG was 30–45 MB, FE-F13-6).
    const buildExportFileName = (): string => {
        const ts = formatISODate();
        return personId ? `comparison_${personId}_${ts}.jpg` : `comparison_${ts}.jpg`;
    };

    const handleSave = async () => {
        if (!engine) return;
        try {
            const url = URL.createObjectURL(await engine.exportBlob());
            const a = document.createElement('a');
            a.href = url;
            a.download = buildExportFileName();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
            toast.success('Comparison saved');
        } catch (err) {
            toast.error('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    // The JPEG encode is asynchronous but short (the canvas is capped at 4,096 px), well
    // inside the browser's transient-activation window for navigator.share().
    const handleNativeShare = async (engineInstance: ComparisonEngine) => {
        if (isSharingRef.current) return;
        if (!canNativeShare) {
            toast.warning('Sharing is not supported on this device');
            return;
        }
        isSharingRef.current = true;
        try {
            const blob = await engineInstance.exportBlob();
            const file = new File([blob], buildExportFileName(), { type: 'image/jpeg' });
            if (!navigator.canShare({ files: [file] })) {
                toast.warning('Cannot share this file type');
                return;
            }
            await navigator.share({ files: [file] });
        } catch (err) {
            if ((err as Error)?.name !== 'AbortError') toast.error('Failed to share comparison');
        } finally {
            isSharingRef.current = false;
        }
    };

    // Single share entry point. The desktop transports resolve files by an
    // on-disk path, so the canvas montage is first uploaded to the staging
    // endpoint and shared by the returned ref.
    const handleShareClick = async () => {
        if (!engine || engine.getSnapshot().imageCount < 2) {
            toast.warning('Select two timepoints and a photo type first');
            return;
        }
        if (nativeSharePreferred) {
            await handleNativeShare(engine);
            return;
        }
        if (!personId) {
            toast.error('No patient selected');
            return;
        }
        try {
            setStaging(true);
            const blob = await engine.exportBlob();
            const fileName = buildExportFileName();
            const fd = new FormData();
            fd.append('image', blob, fileName);
            fd.append('personId', String(personId));
            fd.append('displayName', fileName);
            // An upload, not an API call: off the LAN, the funnel's 30 s default cut it
            // ("Request timed out after 30000ms" at 10 Mbit/s — FE-F13-6). The server
            // side grants the long tier too.
            const staged = await postFormData<shareContract.StageResponse>(
                '/api/share/stage',
                fd,
                { schema: shareContract.stage.response, timeoutMs: 120_000 },
            );
            setShareSources([{ source: 'staged', personId, ref: staged.ref, displayName: staged.displayName }]);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to prepare the image for sharing'));
        } finally {
            setStaging(false);
        }
    };

    return {
        handleSave,
        handleShareClick,
        staging,
        shareSources,
        closeShareSheet: () => setShareSources(null),
    };
}
