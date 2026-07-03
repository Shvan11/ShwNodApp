import React, { useState, useEffect, useRef, MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { reportClientError, describeHttpError } from '@/core/error-reporter';
import { qk } from '@/query/keys';
import { timepointsQuery, galleryQuery, photoVisibilityQuery } from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import * as utilityContract from '@shared/contracts/utility.contract';
import tpStyles from './TimePointsSelector.module.css';
import styles from './GridComponent.module.css';
import EditTimepointModal from './EditTimepointModal';
import DeleteTimepointModal from './DeleteTimepointModal';
import TimepointActionsMenu, { type DeleteScope, type FolderState } from './TimepointActionsMenu';
import ShareSheet from './share/ShareSheet';
import type { ShareSource } from './localsend/LocalSendShareModal';
import { encodeRelPath, buildWorkingContentUrl } from './files/fileHelpers';
import type { PhotoViewCode } from '@shared/photo-views';
import sseAppointments from '../../services/sse-appointments';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import type { PhotoSwipe as PhotoSwipeInstance } from 'photoswipe/lightbox';
import 'photoswipe/style.css';

interface Props {
    personId?: number | null;
    tpCode?: string;
}

// One rendered gallery view (name + pixel size + mtime), keyed by view code in the
// API payload — see patient.contract.ts `gallery`.
type GalleryView = patientContract.GalleryView;

interface Timepoint {
    tp_code: string;
    tp_description: string;
    tp_date_time: string;
}

// Legacy shape expected by EditTimepointModal / DeleteTimepointModal (not in this file's edit scope)
interface LegacyTimepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

const toLegacyTp = (tp: Timepoint): LegacyTimepoint => ({
    tpCode: tp.tp_code,
    tpDescription: tp.tp_description,
    tpDateTime: tp.tp_date_time,
});

interface GridCell {
    id: string;
    /** The Dolphin view shown in this cell; absent for the centre logo. */
    view?: PhotoViewCode;
    alt: string;
    isLogo?: boolean;
}

interface CachedShareBlob {
    url: string | null;
    blob: Blob | null;
    fetchId: number;
}


const GridComponent = ({ personId, tpCode = '0' }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    // Timepoints read on useQuery (loose contract models only tp_code/date/desc;
    // rows carry the full Timepoint shape). A timepoint mutation's invalidation
    // refreshes this live (Phase 3).
    const { data: timepointsData, isLoading: loadingTimepoints, refetch: refetchTimepoints } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const timepoints: Timepoint[] = timepointsData ?? [];
    // Gallery images for the current timepoint, on useQuery. The gallery drives the
    // grid's loading/error state (the visibility read below is best-effort, exactly
    // as in the prior Promise.all where gallery threw and visibility .catch→null'd).
    const galleryQ = useQuery({ ...galleryQuery(personId ?? '', tpCode), enabled: !!personId });
    const visibilityQ = useQuery({ ...photoVisibilityQuery(personId ?? ''), enabled: !!personId });
    // Gallery keyed by view code ({ i10: {...}|null, … }); null = unrendered slot.
    const gallery = galleryQ.data;
    const loading = !!personId && galleryQ.isLoading;
    const error = galleryQ.error ? httpErrorMessage(galleryQ.error, 'Unknown error') : null;
    // Refresh both gallery reads after a render/delete; callers await it (the await
    // settles once the refetch completes, preserving the old reload-then-act order).
    const reloadGallery = () =>
        Promise.all([
            queryClient.invalidateQueries({ queryKey: qk.patient.gallery(personId ?? '', tpCode) }),
            queryClient.invalidateQueries({ queryKey: qk.patient.photoVisibility(personId ?? '') }),
        ]);
    const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
    // LocalSend share modal — opened imperatively from the lightbox toolbar.
    const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);
    // Time-point edit/delete UI state.
    const [menuFor, setMenuFor] = useState<{ tp: Timepoint; x: number; y: number } | null>(null);
    // Originals-folder existence for the open menu (null = still checking).
    const [menuFolder, setMenuFolder] = useState<{ folder: string | null; exists: boolean } | null>(null);
    const menuTpRef = useRef<string | null>(null);
    const [editTp, setEditTp] = useState<LegacyTimepoint | null>(null);
    const [deleteTp, setDeleteTp] = useState<LegacyTimepoint | null>(null);
    const [deleteScope, setDeleteScope] = useState<DeleteScope>('all');
    const [savingTp, setSavingTp] = useState(false);
    const [deletingTp, setDeletingTp] = useState(false);
    // Set of private photo filenames (lowercase) for the CURRENT tpCode.
    // Used both for grid badges and for the PhotoSwipe eye-toggle button.
    const [privateNames, setPrivateNames] = useState<Set<string>>(() => new Set());
    // Ref mirrors privateNames so PhotoSwipe callbacks (outside React's tree) read fresh
    // state. Kept in sync two ways: the effect below (for the query re-seed) AND a direct
    // write in togglePhotoPrivacy — the click handler runs syncButton() synchronously
    // right after a toggle, before this effect runs on the next commit, so the effect
    // alone would leave the lightbox icon a toggle behind.
    const privateNamesRef = useRef<Set<string>>(privateNames);
    useEffect(() => {
        privateNamesRef.current = privateNames;
    }, [privateNames]);
    // Seed the private-name set from the visibility query (filtered to this tpCode).
    // togglePhotoPrivacy still updates this set optimistically; a visibility
    // invalidation re-seeds it from the server on the next settle. Done during render
    // (adjust-state-during-render), keyed on the visibility-data identity + tpCode,
    // rather than in an effect so the React Compiler can optimize it.
    const [seededFor, setSeededFor] = useState<{ data: typeof visibilityQ.data; tpCode: string } | null>(null);
    if (seededFor === null || seededFor.data !== visibilityQ.data || seededFor.tpCode !== tpCode) {
        setSeededFor({ data: visibilityQ.data, tpCode });
        const priv = (visibilityQ.data?.privateImages ?? []) as Array<{ tp: string; name: string }>;
        setPrivateNames(new Set(priv.filter((r) => r.tp === tpCode).map((r) => r.name.toLowerCase())));
    }
    const componentRef = useRef<HTMLDivElement>(null);
    const isSharingRef = useRef(false);

    // Pre-cached blob for native sharing (mobile only)
    // Stores: { url, blob, fetchId } - fetchId prevents race conditions
    const cachedShareBlobRef = useRef<CachedShareBlob>({ url: null, blob: null, fetchId: 0 });

    // 3×3 layout (logo in the centre), each cell bound to its Dolphin view code —
    // matches the photo-editor's GRID_CELLS. No positional coupling to the payload.
    const gridCells: GridCell[] = [
        { id: 'pf', view: 'i10', alt: 'Profile' },
        { id: 'fr', view: 'i12', alt: 'Rest' },
        { id: 'fs', view: 'i13', alt: 'Smile' },
        { id: 'up', view: 'i23', alt: 'Upper' },
        { id: 'logo', alt: 'Shwan Orthodontics', isLogo: true },
        { id: 'lw', view: 'i24', alt: 'Lower' },
        { id: 'rt', view: 'i20', alt: 'Right' },
        { id: 'ct', view: 'i22', alt: 'Center' },
        { id: 'lf', view: 'i21', alt: 'Left' }
    ];

    // File name mapping for share
    const fileNameMap: Record<string, string> = {
        'i10': 'Profile.jpg',
        'i12': 'Rest.jpg',
        'i13': 'Smile.jpg',
        'i23': 'Upper.jpg',
        'i24': 'Lower.jpg',
        'i20': 'Right.jpg',
        'i22': 'Center.jpg',
        'i21': 'Left.jpg'
    };

    // Get descriptive filename from image URL
    const getShareFileName = (imageUrl: string): string => {
        // Drop any `?v=` cache-bust token before parsing the extension.
        const fileName = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0];
        const extensionMatch = fileName.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        return fileNameMap[extension] || `patient_${personId}_photo.jpg`;
    };

    // Pre-fetch blob for current slide (called on slide change, mobile only)
    const prefetchBlobForShare = async (imageUrl: string) => {
        // Only pre-fetch if native share is available
        if (!navigator.share || !navigator.canShare) return;

        // Skip logo and placeholder images
        if (imageUrl.includes('logo.png') || imageUrl.includes('placeholder')) return;

        // Increment fetchId to handle race conditions
        const currentFetchId = ++cachedShareBlobRef.current.fetchId;

        // Clear previous cache immediately
        cachedShareBlobRef.current.url = null;
        cachedShareBlobRef.current.blob = null;

        try {
            // Raw image fetch read as a Blob for the native share sheet — not a
            // JSON API call, so it stays on bare fetch().
            // eslint-disable-next-line no-restricted-syntax
            const response = await fetch(imageUrl);
            if (!response.ok) return;

            const blob = await response.blob();

            // Only store if this is still the most recent fetch (race condition check)
            if (currentFetchId === cachedShareBlobRef.current.fetchId) {
                cachedShareBlobRef.current.url = imageUrl;
                cachedShareBlobRef.current.blob = blob;
            }
        } catch {
            // Silent fail - user will see "please wait" message if they try to share
        }
    };

    // Clear cached blob (called on lightbox close and component unmount)
    const clearCachedBlob = () => {
        cachedShareBlobRef.current = { url: null, blob: null, fetchId: 0 };
    };

    // Native share handler - uses pre-cached blob for instant sharing
    // IMPORTANT: Must be synchronous until navigator.share() to preserve user gesture
    const handleNativeShare = (pswp: PhotoSwipeInstance) => {
        if (isSharingRef.current) return;
        isSharingRef.current = true;

        const imageUrl = pswp.currSlide?.data?.src;
        if (!imageUrl) {
            isSharingRef.current = false;
            return;
        }
        const cached = cachedShareBlobRef.current;

        // Check if cached blob matches current slide
        if (cached.url !== imageUrl || !cached.blob) {
            toast.warning('Please wait a moment and try again');
            isSharingRef.current = false;
            return;
        }

        const shareFileName = getShareFileName(imageUrl);
        const file = new File([cached.blob], shareFileName, { type: 'image/jpeg' });

        navigator.share({ files: [file] })
            .catch((err: Error) => {
                if (err.name !== 'AbortError') {
                    toast.error('Failed to share photo');
                }
            })
            .finally(() => {
                isSharingRef.current = false;
            });
    };

    // Refetch the timepoints query and return the fresh array (callers that act on
    // the new list — e.g. after a create/delete — still get it synchronously).
    // TODO(phase3): post-mutation callers should invalidate the query instead.
    const loadTimepoints = async (): Promise<Timepoint[]> => {
        if (!personId) return [];
        const { data } = await refetchTimepoints();
        return data ?? [];
    };

    // Toggle a photo's private flag. Called from the PhotoSwipe eye button (outside
    // React's tree), so it reads state from the ref and writes to setPrivateNames.
    const togglePhotoPrivacy = async (fileName: string): Promise<void> => {
        if (!personId) return;
        const lower = fileName.toLowerCase();
        const wasPrivate = privateNamesRef.current.has(lower);
        const nextPrivate = !wasPrivate;
        try {
            await postJSON(`/api/patients/${personId}/photos/visibility`, {
                tp: tpCode,
                name: fileName,
                isPrivate: nextPrivate,
            });
            // Write the ref synchronously so the immediate syncButton() (and the grid)
            // reflect the toggle right away — the [privateNames] effect only runs on the
            // next commit, which is too late for the click handler's own re-sync.
            const next = new Set(privateNamesRef.current);
            if (nextPrivate) next.add(lower);
            else next.delete(lower);
            privateNamesRef.current = next;
            setPrivateNames(next);
            toast.success(nextPrivate ? 'Photo hidden from patient' : 'Photo visible to patient');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to update visibility'));
        }
    };

    // Extract the dolphin filename from a URL served via /DolImgs/{name}.
    const getFileNameFromUrl = (imageUrl: string): string => {
        // Strip any `?v=` cache-bust token so callers see the bare `….iNN` name.
        return imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0];
    };

    const LOGO_SRC = '/images/logo.png';

    // The rendered view shown in a cell (null for the logo or an unrendered slot).
    const cellImage = (cell: GridCell): GalleryView | null =>
        cell.view ? gallery?.[cell.view] ?? null : null;

    // Full-resolution Dolphin render — the LIGHTBOX target and the source for every
    // share / download / send-message action. Cache-busted by mtime.
    const fullResUrl = (image: GalleryView): string => `/DolImgs/${image.name}?v=${image.mtime}`;

    // Lightweight WebP thumbnail for the grid CELL only (the lightbox still opens the
    // full-res image above). Reuses the disk-cached working-file thumbnail endpoint;
    // `v=mtime` busts the browser cache when a slot is re-rendered to the same name.
    const thumbUrl = (image: GalleryView): string =>
        personId
            ? buildWorkingContentUrl(personId, image.name, { thumb: 480, v: image.mtime })
            : fullResUrl(image);

    // Initialize PhotoSwipe once the gallery is on screen. This effect runs after the
    // gallery DOM is committed, so the anchors already exist when there are real
    // photos — no timing hack needed; it just bails when the empty state is shown.
    useEffect(() => {
        if (!gallery || !componentRef.current) return;
        const links = componentRef.current.querySelectorAll('#dolph_gallery a');
        if (links.length === 0) return;

        // The lightbox ships via npm, bundled by Vite (our own origin, fingerprinted —
        // no CDN). Its heavy core is code-split behind a dynamic import() so it only
        // downloads when a gallery actually mounts.
        const lightboxInstance = new PhotoSwipeLightbox({
            gallery: '#dolph_gallery',
            children: 'a',
            pswpModule: () => import('photoswipe'),
            bgOpacity: 0.9,
            showHideOpacity: true,
            // The LocalSend share modal opens OVER the still-open lightbox
            // (portaled into #modal-root, z-index above pswp). PhotoSwipe's
            // default focus trap (trapFocus:true) installs a focusin handler
            // that yanks focus back into the lightbox whenever it lands
            // outside — which kills typing in the modal's IP / PIN inputs.
            // Disable it; Esc/arrow keys are bound to document and still work,
            // and the modal carries its own Tab focus-trap.
            // Trade-off (accepted): the lightbox itself loses keyboard
            // focus-containment (a keyboard user could Tab out to background
            // controls), and while the share modal is open arrow/Esc keys can
            // still reach the lightbox underneath. Fine for this mouse-driven
            // internal tool; the alternative was closing the lightbox on share.
            trapFocus: false
        });

        // Add custom buttons
        lightboxInstance.on('uiRegister', () => {
            // Capture the UI registry once: narrowing on lightboxInstance.pswp
            // resets after each registerElement() call, so a local const keeps it stable.
            const pswpUi = lightboxInstance.pswp?.ui;
            if (!pswpUi) return;

            // Add download button
            pswpUi.registerElement({
                name: 'download-button',
                order: 8,
                isButton: true,
                tagName: 'a',

                html: {
                    isCustomSVG: true,
                    inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
                    outlineID: 'pswp__icn-download'
                },

                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    el.setAttribute('download', '');
                    el.setAttribute('target', '_blank');
                    el.setAttribute('rel', 'noopener');
                    el.setAttribute('title', 'Download Image');

                    pswp.on('change', () => {
                        const imageUrl = pswp.currSlide?.data?.src;
                        if (!imageUrl) return;
                        el.setAttribute('download', getShareFileName(imageUrl));
                        (el as HTMLAnchorElement).href = imageUrl;
                    });
                }
            });

            // Add eye-toggle button: staff can mark individual photos as
            // private (hidden from the patient portal). Reads current
            // state from privateNamesRef; updates on slide change.
            pswpUi.registerElement({
                name: 'visibility-toggle-button',
                order: 7.5,
                isButton: true,
                tagName: 'button',

                // Plain FontAwesome icon (not pswp's SVG) so the lightbox shows the SAME
                // eye / eye-slash glyphs as the grid badge — syncButton swaps the shape
                // and the red tint together, so "hidden" looks identical everywhere.
                html: '<i class="fas fa-eye" aria-hidden="true"></i>',

                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    const PRIVATE_CLASS = 'pswp__button--visibility-private';
                    el.classList.add('pswp__visibility-btn');
                    const syncButton = () => {
                        const src = pswp.currSlide?.data?.src;
                        if (!src) return;
                        const fileName = getFileNameFromUrl(src);
                        const isPlaceholder =
                            src.includes('logo.png') ||
                            src.includes('placeholder') ||
                            !/\.i\d+$/i.test(fileName);
                        if (isPlaceholder) {
                            el.style.display = 'none';
                            return;
                        }
                        el.style.display = '';
                        const isPrivate = privateNamesRef.current.has(fileName.toLowerCase());
                        el.classList.toggle(PRIVATE_CLASS, isPrivate);
                        const icon = el.querySelector('i');
                        if (icon) icon.className = isPrivate ? 'fas fa-eye-slash' : 'fas fa-eye';
                        el.setAttribute(
                            'title',
                            isPrivate ? 'Make visible to patient' : 'Hide from patient'
                        );
                        el.setAttribute(
                            'aria-label',
                            isPrivate ? 'Make visible to patient' : 'Hide from patient'
                        );
                    };
                    el.addEventListener('click', async () => {
                        const src = pswp.currSlide?.data?.src;
                        if (!src) return;
                        const fileName = getFileNameFromUrl(src);
                        if (!/\.i\d+$/i.test(fileName)) return;
                        await togglePhotoPrivacy(fileName);
                        syncButton();
                    });
                    pswp.on('change', syncButton);
                    // Initial sync
                    syncButton();
                }
            });

            // Add native share button (mobile only)
            if ('share' in navigator && 'canShare' in navigator) {
                pswpUi.registerElement({
                    name: 'native-share-button',
                    order: 8.5,
                    isButton: true,
                    tagName: 'button',

                    html: {
                        isCustomSVG: true,
                        inner: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" id="pswp__icn-share"/>',
                        outlineID: 'pswp__icn-share'
                    },

                    onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                        el.setAttribute('title', 'Share');
                        el.setAttribute('aria-label', 'Share photo');

                        el.addEventListener('click', () => handleNativeShare(pswp));
                    }
                });
            }

            // Add send message button (desktop only - mobile uses native share)
            if (!navigator.share || !navigator.canShare) {
                pswpUi.registerElement({
                    name: 'send-message-button',
                    order: 9,
                    isButton: true,
                    tagName: 'button',

                    html: {
                        isCustomSVG: true,
                        inner: '<path d="M2 21l21-9L2 3v7l15 2-15 2v7z" id="pswp__icn-send"/>',
                        outlineID: 'pswp__icn-send'
                    },

                    onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                        el.setAttribute('title', 'Send Message');
                        el.setAttribute('aria-label', 'Send Message');

                        el.addEventListener('click', async () => {
                            const imageSrc = pswp.currSlide?.data?.src;
                            if (!imageSrc) return;

                            try {
                                let webPath = imageSrc;
                                if (imageSrc.includes('://')) {
                                    const url = new URL(imageSrc);
                                    webPath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
                                }
                                // Drop any `?v=` cache-bust token before path conversion.
                                webPath = webPath.split('?')[0];

                                const { fullPath } = await fetchJSON<{ fullPath: string }>(
                                    `/api/convert-path?path=${encodeURIComponent(webPath)}`,
                                    { schema: utilityContract.convertPath.response }
                                );

                                // Use actual file path - backend will handle filename conversion
                                const convertedPath = fullPath;

                                const sendMessageUrl = `/send-message?file=${encodeURIComponent(convertedPath)}`;
                                window.open(sendMessageUrl, '_blank');

                            } catch (error) {
                                // Event-handler failure (PhotoSwipe button, outside React's tree)
                                // — ship it to Winston instead of a console the prod build silences.
                                reportClientError({
                                    source: 'window-error',
                                    message: `Send-message path conversion failed: ${error instanceof Error ? error.message : String(error)}`,
                                    stack: error instanceof Error ? error.stack : undefined,
                                    ...describeHttpError(error),
                                });
                                toast.error(httpErrorMessage(error, 'Failed to prepare the image for messaging.'));
                            }
                        });
                    }
                });
            }

            // Add LocalSend share button — push the current photo to a LAN
            // device (phone/tablet/PC) without WhatsApp or a USB stick.
            pswpUi.registerElement({
                name: 'localsend-share-button',
                order: 9.5,
                isButton: true,
                tagName: 'button',

                html: {
                    isCustomSVG: true,
                    inner: '<path d="M21 11a3 3 0 0 0-2.6 1.5l-5.5-2.8a3 3 0 0 0 0-1.4l5.5-2.8A3 3 0 1 0 17.5 7L12 9.8a3 3 0 1 0 0 6.4l5.5 2.8A3 3 0 1 0 21 11z" id="pswp__icn-localsend"/>',
                    outlineID: 'pswp__icn-localsend'
                },

                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    el.setAttribute('title', 'Share');
                    el.setAttribute('aria-label', 'Share');

                    el.addEventListener('click', () => {
                        const src = pswp.currSlide?.data?.src;
                        if (!src || !personId) return;
                        const fileName = getFileNameFromUrl(src);
                        // Skip logo / placeholder — only real Dolphin views.
                        if (src.includes('logo.png') || src.includes('placeholder') || !/\.i\d+$/i.test(fileName)) {
                            return;
                        }
                        setShareSources([{
                            source: 'patient-image',
                            personId,
                            ref: fileName,
                            displayName: getShareFileName(src)
                        }]);
                    });
                }
            });
        });

        // Pre-fetch the current slide's blob for the native share sheet (mobile only).
        if ('share' in navigator && 'canShare' in navigator) {
            lightboxInstance.on('firstUpdate', () => {
                const src = lightboxInstance.pswp?.currSlide?.data?.src;
                if (src) prefetchBlobForShare(src);
            });
            lightboxInstance.on('change', () => {
                const src = lightboxInstance.pswp?.currSlide?.data?.src;
                if (src) prefetchBlobForShare(src);
            });
            lightboxInstance.on('destroy', () => clearCachedBlob());
        }

        lightboxInstance.init();
        lightboxRef.current = lightboxInstance;

        // This effect solely owns the lightbox lifecycle: its cleanup destroys the
        // instance it created (on deps change or unmount), so nothing double-frees it.
        return () => {
            lightboxInstance.destroy();
            lightboxRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gallery]);

    // Hold the appointments SSE stream open while this grid is mounted — it also
    // carries `photos_rendered`, fired when a background photo-editor save finishes.
    useEffect(() => {
        void sseAppointments.ensureConnected().catch(() => {
            /* transport errors are surfaced by the appointments connection UI */
        });
        return () => {
            sseAppointments.release();
        };
    }, []);

    // When a background render for THIS patient+timepoint completes, refetch the
    // gallery (and timepoints, in case the save created a brand-new one) so the new
    // photos appear without a manual reload.
    useEffect(() => {
        const onPhotosRendered = (payload: unknown): void => {
            const p = payload as { personId?: number | string; tpCode?: number | string; tp_code?: number | string };
            if (!personId) return;
            // Tolerate either casing for the timepoint code: the internal emitter is
            // untyped, so a snake_case `tp_code` slipped through historically and
            // silently broke this match (→ no refetch → stale image until reload).
            const pTp = p.tpCode ?? p.tp_code;
            if (String(p.personId) !== String(personId) || String(pTp) !== String(tpCode)) return;
            void reloadGallery();
            void loadTimepoints();
            // Outcome toasts (success / warnings / timeout) are owned by the
            // saving tab's photo-render-watch module — toasting here too would
            // double-notify when the user is parked on this grid.
        };
        sseAppointments.on('photos_rendered', onPhotosRendered);
        return () => {
            sseAppointments.off('photos_rendered', onPhotosRendered);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, tpCode]);

    // Clear cached share blob on unmount. The lightbox instance itself is owned
    // and destroyed by the init effect's cleanup above.
    useEffect(() => {
        return () => {
            clearCachedBlob();
        };
    }, []);

    if (loading) {
        return (
            <div className={styles.loadingSpinner}>
                Loading gallery...
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorMessage}>
                Error: {error}
            </div>
        );
    }

    const formatDate = (dateTime: string): string => {
        if (!dateTime) return '';
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    const handleTimepointClick = (tp: string) => {
        navigate(`/patient/${personId}/photos/tp${tp}`);
    };

    // Open the kebab popover; anchor its right edge near the button (clamped in the menu).
    // The originals-folder existence check runs HERE (only on click), never on list load.
    const openTimepointMenu = (e: ReactMouseEvent<HTMLButtonElement>, tp: Timepoint) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setMenuFor({ tp, x: rect.right - 270, y: rect.bottom + 4 });
        setMenuFolder(null);
        menuTpRef.current = tp.tp_code;
        if (personId) {
            fetchJSON<{ folder: string | null; exists: boolean }>(
                `/api/patients/${personId}/timepoints/${tp.tp_code}/folder`,
                { schema: patientContract.timepointFolder.response }
            )
                .then((data) => {
                    // Ignore a stale resolve if another tab's menu was opened meanwhile.
                    if (menuTpRef.current === tp.tp_code) {
                        setMenuFolder(data ?? { folder: null, exists: false });
                    }
                })
                .catch(() => {
                    if (menuTpRef.current === tp.tp_code) setMenuFolder({ folder: null, exists: false });
                });
        }
    };

    // Open the file explorer at the time point's originals folder.
    const handleOpenFolder = () => {
        if (!personId || !menuFolder?.folder) return;
        navigate(`/patient/${personId}/files/${encodeRelPath(menuFolder.folder)}`);
        setMenuFor(null);
    };

    // Open the read-only working-files view (this patient's rendered .iNN images,
    // filtered out of the shared working/ dir). Patient-wide, not per-timepoint.
    const handleOpenWorking = () => {
        if (!personId) return;
        navigate(`/patient/${personId}/working-files`);
        setMenuFor(null);
    };

    // Open the native photo editor for THIS time point (its own name+date, so a
    // re-render resolves to the same timepoint and reuses its originals folder).
    const handleReimport = (tp: Timepoint) => {
        const date = (tp.tp_date_time ?? '').substring(0, 10);
        navigate(
            `/patient/${personId}/photo-editor/tp${tp.tp_code}` +
                `?tpName=${encodeURIComponent(tp.tp_description ?? '')}&date=${date}`
        );
    };

    const handleSaveTimepoint = async (fields: { tpDescription: string; tpDateTime: string }) => {
        if (!personId || !editTp) return;
        setSavingTp(true);
        try {
            await putJSON(`/api/patients/${personId}/timepoints/${editTp.tpCode}`, fields);
            queryClient.invalidateQueries({ queryKey: qk.patient.timepoints(personId) });
            toast.success('Time point updated');
            setEditTp(null);
            await loadTimepoints();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update time point');
        } finally {
            setSavingTp(false);
        }
    };

    const handleDeleteTimepoint = async () => {
        if (!personId || !deleteTp) return;
        const removed = deleteTp;
        const scope = deleteScope;
        setDeletingTp(true);
        try {
            await deleteJSON(`/api/patients/${personId}/timepoints/${removed.tpCode}?scope=${scope}`);
            queryClient.invalidateQueries({ queryKey: qk.patient.timepoints(personId) });
            toast.success(
                scope === 'cropped'
                    ? 'Cropped photos deleted'
                    : scope === 'entry'
                      ? 'Time point deleted (originals kept)'
                      : 'Time point deleted'
            );
            setDeleteTp(null);
            if (scope === 'cropped') {
                // The time point stays — just refresh the gallery if we're viewing it.
                if (removed.tpCode === tpCode) await reloadGallery();
            } else {
                const next = await loadTimepoints();
                // If the active tab was the one removed, move to a remaining timepoint.
                if (removed.tpCode === tpCode) {
                    if (next.length > 0) {
                        navigate(`/patient/${personId}/photos/tp${next[0].tp_code}`);
                    } else {
                        navigate(`/patient/${personId}/photos`);
                    }
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete time point');
        } finally {
            setDeletingTp(false);
        }
    };

    // Hover/focus lift is now pure CSS (.galleryImage:hover / :focus-visible).

    // The gallery is keyed by view code with `null` for unrendered slots, so "has
    // photos" means at least one view actually resolved to a rendered image.
    const hasRealPhotos = !!gallery && Object.values(gallery).some(Boolean);
    // Whether the current tpCode is actually one of this patient's sessions. The
    // sidebar Photos button always points at tp0, which often doesn't exist.
    const selectedTpExists = timepoints.some((tp) => tp.tp_code === tpCode);
    const noSessions = !loadingTimepoints && timepoints.length === 0;

    return (
        <div
            ref={componentRef}
            className={styles.container}
        >
            {/* Timepoints Selector */}
            {!loadingTimepoints && timepoints.length > 0 && (
                <div className={tpStyles.selector}>
                    {timepoints.map((timepoint, index) => (
                        <div
                            key={`tp-${timepoint.tp_code}-${index}`}
                            className={`${tpStyles.tab} ${tpCode === timepoint.tp_code ? tpStyles.tabActive : ''}`}
                        >
                            <button
                                type="button"
                                className={tpStyles.tabNav}
                                onClick={() => handleTimepointClick(timepoint.tp_code)}
                            >
                                <div className={tpStyles.tabIcon}>
                                    <i className="fas fa-camera"></i>
                                </div>
                                <div className={tpStyles.tabContent}>
                                    <div className={tpStyles.tabDesc}>{timepoint.tp_description}</div>
                                    <div className={tpStyles.tabDate}>{formatDate(timepoint.tp_date_time)}</div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className={tpStyles.kebab}
                                aria-label="Time point actions"
                                aria-haspopup="menu"
                                aria-expanded={menuFor?.tp.tp_code === timepoint.tp_code}
                                onClick={(e) => openTimepointMenu(e, timepoint)}
                            >
                                <i className="fas fa-ellipsis-v" aria-hidden="true"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {!hasRealPhotos ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-camera-retro" aria-hidden="true"></i>
                    <h3>
                        {noSessions
                            ? 'No photos yet'
                            : selectedTpExists
                              ? 'No photos in this session'
                              : 'No photo session selected'}
                    </h3>
                    <p>
                        {noSessions
                            ? 'This patient has no photo sessions yet.'
                            : selectedTpExists
                              ? 'This session has no photos yet.'
                              : 'Select a photo session above to view its photos.'}
                    </p>
                </div>
            ) : (
            <div
                id="dolph_gallery"
                className={`pswp-gallery ${styles.galleryPadded}`}
            >
                {gridCells.map((cell) => {
                    // Centre logo — a fixed lightbox anchor showing the clinic logo.
                    if (cell.isLogo) {
                        return (
                            <a
                                key={`dolph_gallery-${cell.id}`}
                                id={`a${cell.id}`}
                                href={LOGO_SRC}
                                data-pswp-width={400}
                                data-pswp-height={400}
                                target="_blank"
                                rel="noreferrer"
                                className={styles.galleryCell}
                            >
                                <img
                                    id={cell.id}
                                    src={LOGO_SRC}
                                    alt={cell.alt}
                                    decoding="async"
                                    className={`${styles.galleryImage} ${styles.logoBorder}`}
                                />
                            </a>
                        );
                    }

                    const image = cellImage(cell);

                    // Absent slot — a theme-aware placeholder (icon + view name), NOT a
                    // lightbox target. Rendered as a <div> so PhotoSwipe (children:'a')
                    // skips it and dark mode no longer shows a baked light-grey SVG; the
                    // view name doubles as a "which photo is missing" hint.
                    if (!image) {
                        return (
                            <div
                                key={`dolph_gallery-${cell.id}`}
                                className={styles.placeholderCell}
                            >
                                <i className="fas fa-image" aria-hidden="true"></i>
                                <span className={styles.placeholderLabel}>{cell.alt}</span>
                            </div>
                        );
                    }

                    // Real photo — a lightbox anchor. The grid cell shows the light WebP
                    // thumbnail; the anchor (the lightbox target) points at the full-res
                    // render. The view-type caption fades in on hover / keyboard focus.
                    // A badge marks ONLY photos hidden from the patient — visible photos
                    // stay unmarked for a cleaner grid; visibility is toggled in the lightbox.
                    const isHidden = privateNames.has(image.name.toLowerCase());

                    return (
                        <a
                            key={`dolph_gallery-${cell.id}`}
                            id={`a${cell.id}`}
                            href={fullResUrl(image)}
                            data-pswp-width={image.width ?? 800}
                            data-pswp-height={image.height ?? 600}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.galleryCell}
                        >
                            <img
                                id={cell.id}
                                src={thumbUrl(image)}
                                alt={cell.alt}
                                decoding="async"
                                className={styles.galleryImage}
                            />
                            <span className={styles.typeLabel} aria-hidden="true">
                                {cell.alt}
                            </span>
                            {isHidden && (
                                <span
                                    className={styles.visibilityBadge}
                                    title="Hidden from patient"
                                    aria-hidden="true"
                                >
                                    <i className="fas fa-eye-slash"></i>
                                </span>
                            )}
                        </a>
                    );
                })}
            </div>
            )}

            {menuFor && (
                <TimepointActionsMenu
                    x={menuFor.x}
                    y={menuFor.y}
                    folderState={
                        (menuFolder === null
                            ? 'checking'
                            : menuFolder.exists
                              ? 'present'
                              : 'absent') satisfies FolderState
                    }
                    onEdit={() => { setEditTp(toLegacyTp(menuFor.tp)); setMenuFor(null); }}
                    onReimport={() => { handleReimport(menuFor.tp); setMenuFor(null); }}
                    onOpenFolder={handleOpenFolder}
                    onOpenWorking={handleOpenWorking}
                    onDelete={(scope) => { setDeleteScope(scope); setDeleteTp(toLegacyTp(menuFor.tp)); setMenuFor(null); }}
                    onClose={() => setMenuFor(null)}
                />
            )}

            <EditTimepointModal
                isOpen={!!editTp}
                timepoint={editTp}
                saving={savingTp}
                onClose={() => setEditTp(null)}
                onSave={handleSaveTimepoint}
            />

            <DeleteTimepointModal
                isOpen={!!deleteTp}
                timepoint={deleteTp}
                scope={deleteScope}
                deleting={deletingTp}
                onConfirm={handleDeleteTimepoint}
                onCancel={() => setDeleteTp(null)}
            />

            <ShareSheet
                open={!!shareSources}
                sources={shareSources ?? []}
                onClose={() => setShareSources(null)}
            />
        </div>
    );
};

export default GridComponent;
