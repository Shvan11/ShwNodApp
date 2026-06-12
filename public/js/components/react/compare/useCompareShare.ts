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

// Sync conversion from data URI to Blob — preserves the user gesture chain
// through navigator.share().
export function dataURItoBlob(dataURI: string): Blob {
    const [header, data] = dataURI.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const binary = atob(data);
    const array = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
    return new Blob([array], { type: mime });
}

export function useCompareShare(engine: ComparisonEngine | null, personId?: number | null) {
    const toast = useToast();
    const isSharingRef = useRef(false);
    const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);
    const [staging, setStaging] = useState(false);

    const buildExportFileName = (): string => {
        const ts = formatISODate();
        return personId ? `comparison_${personId}_${ts}.png` : `comparison_${ts}.png`;
    };

    const handleSave = () => {
        if (!engine) return;
        try {
            const dataURI = engine.toDataURL();
            const a = document.createElement('a');
            a.href = dataURI;
            a.download = buildExportFileName();
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast.success('Comparison saved');
        } catch (err) {
            toast.error('Failed to save: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    // IMPORTANT: Must be synchronous until navigator.share() to preserve user gesture.
    const handleNativeShare = (engineInstance: ComparisonEngine) => {
        if (isSharingRef.current) return;
        if (!canNativeShare) {
            toast.warning('Sharing is not supported on this device');
            return;
        }
        isSharingRef.current = true;
        try {
            const dataURI = engineInstance.toDataURL();
            const blob = dataURItoBlob(dataURI);
            const file = new File([blob], buildExportFileName(), { type: 'image/png' });
            if (!navigator.canShare({ files: [file] })) {
                toast.warning('Cannot share this file type');
                isSharingRef.current = false;
                return;
            }
            navigator.share({ files: [file] })
                .catch((err: Error) => {
                    if (err.name !== 'AbortError') {
                        toast.error('Failed to share comparison');
                    }
                })
                .finally(() => {
                    isSharingRef.current = false;
                });
        } catch (err) {
            toast.error('Failed to share: ' + (err instanceof Error ? err.message : 'Unknown error'));
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
            handleNativeShare(engine);
            return;
        }
        if (!personId) {
            toast.error('No patient selected');
            return;
        }
        try {
            setStaging(true);
            const blob = dataURItoBlob(engine.toDataURL());
            const fileName = buildExportFileName();
            const fd = new FormData();
            fd.append('image', blob, fileName);
            fd.append('personId', String(personId));
            fd.append('displayName', fileName);
            const staged = await postFormData<shareContract.StageResponse>(
                '/api/share/stage',
                fd,
                { schema: shareContract.stage.response },
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
